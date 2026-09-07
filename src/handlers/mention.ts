import type { App } from "@slack/bolt";
import { getWork } from "../integrations/devrev";
import {
  extractCreatorSlackUserId,
  extractDevRevTicketId,
  getThreadParentText,
  postInThread,
} from "../integrations/slack";
import { upsertThread } from "../db/trackedThreads";

export function registerMentionHandler(app: App): void {
  app.event("app_mention", async ({ event, say }) => {
    const threadTs = event.thread_ts ?? event.ts;

    const parentText = await getThreadParentText(event.channel, threadTs);
    if (!parentText) {
      await say({ text: "Couldn't read this thread's parent message.", thread_ts: threadTs });
      return;
    }

    const devrevTicketId = extractDevRevTicketId(parentText);
    if (!devrevTicketId) {
      await say({
        text: "Couldn't find a DevRev ticket link in this thread's first message — nothing to track.",
        thread_ts: threadTs,
      });
      return;
    }

    const work = await getWork(devrevTicketId);
    if (!work) {
      await say({ text: `Couldn't find DevRev ticket ${devrevTicketId}.`, thread_ts: threadTs });
      return;
    }

    const creatorSlackUserId = extractCreatorSlackUserId(parentText);

    upsertThread({
      slackChannelId: event.channel,
      slackThreadTs: threadTs,
      devrevTicketId: work.displayId,
      freshdeskTicketId: work.freshdeskTicketId,
      createdBySlackUserId: event.user ?? "unknown",
      creatorSlackUserId,
    });

    const freshdeskNote = work.freshdeskTicketId
      ? `linked Freshdesk ticket \`${work.freshdeskTicketId}\``
      : "⚠️ no linked Freshdesk ticket found — tracking DevRev status only";

    await postInThread(
      event.channel,
      threadTs,
      `Tracking *${work.displayId}* (${freshdeskNote}). I'll follow up daily until it's closed and resolved.`
    );
  });
}
