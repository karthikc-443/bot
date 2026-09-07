import { DevRevWork, getWork, isClosed } from "../integrations/devrev";
import { FreshdeskConversation, getConversations, isResolvedForMerchant } from "../integrations/freshdesk";
import { lookupUserIdByEmail, postInThread } from "../integrations/slack";
import { ensureSlackToken } from "../integrations/slackAuth";
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

  const assigneeSlackId = work.ownerEmail ? await lookupUserIdByEmail(work.ownerEmail) : null;
  const mention = assigneeSlackId ? `<@${assigneeSlackId}>` : work.ownerEmail ?? "unassigned";
  const statusLine = `${work.displayId} is *${work.stageName ?? "open"}*`;
  const merchantLine = decision.waitingOnMerchantReply
    ? " — customer is still waiting on a Freshdesk reply."
    : "";

  await postInThread(
    thread.slackChannelId,
    thread.slackThreadTs,
    `${mention} daily check-in: ${statusLine}.${merchantLine} Any update?`
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
