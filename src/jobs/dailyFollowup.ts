import { DevRevWork, getWork, isClosed, listComments } from "../integrations/devrev";
import { FreshdeskConversation, getConversations, isResolvedForMerchant } from "../integrations/freshdesk";
import { lookupUserIdByEmail, postInThread, getThreadContext } from "../integrations/slack";
import { ensureSlackToken } from "../integrations/slackAuth";
import { analyzeBlocker, BlockerAnalysis, isEnabled as claudeEnabled } from "../integrations/claude";
import { listActive, markStopped, updateLastFollowupAt, TrackedThread } from "../db/trackedThreads";

const SILENCE_HOURS_BEFORE_NAG = 8;

export type FollowupDecision =
  | { action: "resolved" }
  | { action: "nag"; waitingOnMerchantReply: boolean };

// Pure decision logic — kept separate from I/O so it's directly unit-testable.
export function decide(work: DevRevWork, conversations: FreshdeskConversation[] | null): FollowupDecision {
  const closed = isClosed(work);
  const merchantResolved = conversations === null ? true : isResolvedForMerchant(conversations);

  if (closed && merchantResolved) {
    return { action: "resolved" };
  }
  return { action: "nag", waitingOnMerchantReply: closed && !merchantResolved };
}

// Prefer Claude's read on who's actually blocking progress right now; fall
// back to the plain DevRev assignee if analysis is off, failed, or unsure.
export function pickBlockerEmail(work: DevRevWork, analysis: BlockerAnalysis | null): string | null {
  return analysis?.blockerEmail ?? work.ownerEmail;
}

function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

// Nags at most once per SILENCE_HOURS_BEFORE_NAG window of quiet — the clock
// resets on either a real response (Slack/DevRev activity) or our own last
// nag, whichever is more recent, so an active thread doesn't get spammed on
// every run once past the threshold.
export function shouldNag(now: Date, lastResponseAt: Date, lastFollowupAt: Date | null): boolean {
  const silenceStart = lastFollowupAt && lastFollowupAt > lastResponseAt ? lastFollowupAt : lastResponseAt;
  return hoursBetween(silenceStart, now) >= SILENCE_HOURS_BEFORE_NAG;
}

function latestOf(...dates: (Date | null)[]): Date {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.reduce((max, d) => (d > max ? d : max));
}

async function processThread(thread: TrackedThread): Promise<void> {
  const work = await getWork(thread.devrevTicketId);
  if (!work) return;

  const conversations = thread.freshdeskTicketId
    ? await getConversations(thread.freshdeskTicketId)
    : null;

  const decision = decide(work, conversations);

  if (decision.action === "resolved") {
    markStopped(thread.id);
    const mention = thread.creatorSlackUserId ? `<@${thread.creatorSlackUserId}> ` : "";
    await postInThread(
      thread.slackChannelId,
      thread.slackThreadTs,
      `${mention}✅ *${work.displayId}* is closed and resolved on Freshdesk. Stopping followups on this thread.`
    );
    return;
  }

  const [comments, threadContext] = await Promise.all([
    listComments(work.id),
    getThreadContext(thread.slackChannelId, thread.slackThreadTs),
  ]);

  const lastCommentAt = comments.length ? new Date(comments[comments.length - 1].createdAt) : null;
  const lastResponseAt = latestOf(lastCommentAt, threadContext.lastMessageAt, new Date(thread.createdAt));
  const lastFollowupAt = thread.lastFollowupAt ? new Date(thread.lastFollowupAt) : null;

  if (!shouldNag(new Date(), lastResponseAt, lastFollowupAt)) {
    return;
  }

  let analysis: BlockerAnalysis | null = null;
  if (claudeEnabled()) {
    analysis = await analyzeBlocker({
      ticketTitle: work.title,
      devrevComments: comments,
      slackThreadText: threadContext.text,
    });
  }

  const blockerEmail = pickBlockerEmail(work, analysis);
  const blockerSlackId = blockerEmail ? await lookupUserIdByEmail(blockerEmail) : null;
  const mention = blockerSlackId ? `<@${blockerSlackId}>` : blockerEmail ?? "unassigned";
  const statusLine = analysis?.summary ?? `${work.displayId} is *${work.stageName ?? "open"}*`;
  const merchantLine = decision.waitingOnMerchantReply
    ? " Customer is still waiting on a Freshdesk reply."
    : "";

  await postInThread(
    thread.slackChannelId,
    thread.slackThreadTs,
    `${mention} check-in: ${statusLine}${merchantLine} Any update?`
  );
  updateLastFollowupAt(thread.id);
}

export async function runDailyFollowup(): Promise<void> {
  const threads = listActive();
  for (const thread of threads) {
    try {
      await processThread(thread);
    } catch (err) {
      console.error(`Failed to process thread ${thread.slackChannelId}/${thread.slackThreadTs}`, err);
    }
  }
}

if (require.main === module) {
  ensureSlackToken()
    .then(runDailyFollowup)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
