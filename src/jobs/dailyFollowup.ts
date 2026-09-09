import { DevRevWork, getWork, isClosed, listComments } from "../integrations/devrev";
import {
  FreshdeskConversation,
  getConversations,
  getTicketStatus,
  isPendingOnPse,
  isResolvedForMerchant,
} from "../integrations/freshdesk";
import { lookupUserIdByEmail, postInThread, getThreadContext } from "../integrations/slack";
import { ensureSlackToken } from "../integrations/slackAuth";
import { analyzeBlocker, BlockerAnalysis, isEnabled as claudeEnabled } from "../integrations/claude";
import { listActive, markStopped, updateLastFollowupAt, TrackedThread } from "../db/trackedThreads";

// TEMP for testing — was 8. Revert once done.
const SILENCE_HOURS_BEFORE_NAG_BLOCKER = 0.5;
// Pending-on-PSE means DevRev's already closed but the merchant hasn't
// actually heard back — tighter cadence since it's a customer-facing gap.
const SILENCE_HOURS_BEFORE_NAG_CREATOR = 1;

export type FollowupDecision =
  | { action: "resolved" }
  // DevRev closed, but Freshdesk shows the merchant-facing ticket is still
  // "Pending on PSE" — DevRev's done, but our side hasn't actually closed
  // the loop with the merchant. Goes to the creator, not the blocker.
  | { action: "nag_creator" }
  | { action: "nag_blocker"; waitingOnMerchantReply: boolean };

// Pure decision logic — kept separate from I/O so it's directly unit-testable.
export function decide(
  work: DevRevWork,
  conversations: FreshdeskConversation[] | null,
  freshdeskStatus: number | null
): FollowupDecision {
  const closed = isClosed(work);

  if (!closed) {
    return { action: "nag_blocker", waitingOnMerchantReply: false };
  }

  if (freshdeskStatus !== null && isPendingOnPse(freshdeskStatus)) {
    return { action: "nag_creator" };
  }

  const merchantResolved = conversations === null ? true : isResolvedForMerchant(conversations);
  if (merchantResolved) {
    return { action: "resolved" };
  }
  return { action: "nag_blocker", waitingOnMerchantReply: true };
}

// Prefer Claude's read on who's actually blocking progress right now; fall
// back to the plain DevRev assignee if analysis is off, failed, or unsure.
// Defensive guard: the creator is never the blocker (they're the one
// waiting) — if the analysis picks them anyway, fall back to the assignee.
export function pickBlockerEmail(work: DevRevWork, analysis: BlockerAnalysis | null): string | null {
  const candidate = analysis?.blockerEmail ?? work.ownerEmail;
  if (candidate && work.creatorEmail && candidate.toLowerCase() === work.creatorEmail.toLowerCase()) {
    return work.ownerEmail;
  }
  return candidate;
}

function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

// Nags at most once per thresholdHours window of quiet — the clock resets
// on either a real response (Slack/DevRev activity) or our own last nag,
// whichever is more recent, so an active thread doesn't get spammed on
// every run once past the threshold.
export function shouldNag(
  now: Date,
  lastResponseAt: Date,
  lastFollowupAt: Date | null,
  thresholdHours: number
): boolean {
  const silenceStart = lastFollowupAt && lastFollowupAt > lastResponseAt ? lastFollowupAt : lastResponseAt;
  return hoursBetween(silenceStart, now) >= thresholdHours;
}

function latestOf(...dates: (Date | null)[]): Date {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.reduce((max, d) => (d > max ? d : max));
}

async function processThread(thread: TrackedThread): Promise<void> {
  const work = await getWork(thread.devrevTicketId);
  if (!work) return;

  const [conversations, freshdeskStatus] = thread.freshdeskTicketId
    ? await Promise.all([getConversations(thread.freshdeskTicketId), getTicketStatus(thread.freshdeskTicketId)])
    : [null, null];

  const decision = decide(work, conversations, freshdeskStatus);

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
  const thresholdHours =
    decision.action === "nag_creator" ? SILENCE_HOURS_BEFORE_NAG_CREATOR : SILENCE_HOURS_BEFORE_NAG_BLOCKER;

  if (!shouldNag(new Date(), lastResponseAt, lastFollowupAt, thresholdHours)) {
    return;
  }

  if (decision.action === "nag_creator") {
    const mention = thread.creatorSlackUserId ? `<@${thread.creatorSlackUserId}>` : "the ticket creator";
    await postInThread(
      thread.slackChannelId,
      thread.slackThreadTs,
      `${mention} check-in: *${work.displayId}* is closed in DevRev, but Freshdesk still shows it *Pending on PSE* — the merchant hasn't actually been closed out yet. Can you follow up on Freshdesk?`
    );
    updateLastFollowupAt(thread.id);
    return;
  }

  let analysis: BlockerAnalysis | null = null;
  if (claudeEnabled()) {
    analysis = await analyzeBlocker({
      ticketTitle: work.title,
      devrevComments: comments,
      slackThreadText: threadContext.text,
      creatorEmail: work.creatorEmail,
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

// Caps how many threads are checked concurrently — enough to not scale
// linearly with the number of tracked tickets, but bounded so a large
// backlog doesn't fire a burst of simultaneous DevRev/Freshdesk/Slack/Claude
// calls all at once.
const CONCURRENT_THREAD_CHECKS = 5;

async function processThreadSafely(thread: TrackedThread): Promise<void> {
  try {
    await processThread(thread);
  } catch (err) {
    console.error(`Failed to process thread ${thread.slackChannelId}/${thread.slackThreadTs}`, err);
  }
}

export async function runDailyFollowup(): Promise<void> {
  const threads = listActive();
  const queue = [...threads];

  async function worker(): Promise<void> {
    let next: TrackedThread | undefined;
    while ((next = queue.shift())) {
      await processThreadSafely(next);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENT_THREAD_CHECKS, threads.length) }, worker);
  await Promise.all(workers);
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
