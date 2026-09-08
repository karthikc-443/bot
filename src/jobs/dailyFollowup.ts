import { DevRevWork, getWork, isClosed, listComments } from "../integrations/devrev";
import { FreshdeskConversation, getConversations, isResolvedForMerchant } from "../integrations/freshdesk";
import { lookupUserIdByEmail, postInThread, getFullThreadText } from "../integrations/slack";
import { ensureSlackToken } from "../integrations/slackAuth";
import { analyzeBlocker, BlockerAnalysis, isEnabled as claudeEnabled } from "../integrations/claude";
import { listActive, markStopped, updateLastFollowupAt, TrackedThread } from "../db/trackedThreads";

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

  let analysis: BlockerAnalysis | null = null;
  if (claudeEnabled()) {
    const [comments, slackThreadText] = await Promise.all([
      listComments(work.id),
      getFullThreadText(thread.slackChannelId, thread.slackThreadTs),
    ]);
    analysis = await analyzeBlocker({ ticketTitle: work.title, devrevComments: comments, slackThreadText });
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
    `${mention} daily check-in: ${statusLine}${merchantLine} Any update?`
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
