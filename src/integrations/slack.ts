import { WebClient } from "@slack/web-api";

// Constructed without a default token — every call below passes the current
// token explicitly (see setSlackBotToken/getCurrentToken), since WebClient's
// own `token` property is read-only after construction.
export const slackClient = new WebClient();

let currentToken: string | undefined;

export function setSlackBotToken(token: string): void {
  currentToken = token;
}

export function getCurrentToken(): string | undefined {
  return currentToken;
}

const emailToUserIdCache = new Map<string, string | null>();

export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  if (emailToUserIdCache.has(email)) {
    return emailToUserIdCache.get(email)!;
  }
  try {
    const result = await slackClient.users.lookupByEmail({ email, token: currentToken });
    const userId = result.user?.id ?? null;
    emailToUserIdCache.set(email, userId);
    return userId;
  } catch {
    emailToUserIdCache.set(email, null);
    return null;
  }
}

export async function getThreadParentText(channel: string, threadTs: string): Promise<string | null> {
  const result = await slackClient.conversations.replies({
    channel,
    ts: threadTs,
    limit: 1,
    token: currentToken,
  });
  return result.messages?.[0]?.text ?? null;
}

export interface ThreadContext {
  text: string;
  lastMessageAt: Date | null;
}

export async function getThreadContext(channel: string, threadTs: string): Promise<ThreadContext> {
  const result = await slackClient.conversations.replies({
    channel,
    ts: threadTs,
    limit: 200,
    token: currentToken,
  });
  const messages = result.messages ?? [];
  const text = messages.map((m) => m.text ?? "").join("\n---\n");
  const lastTs = messages.map((m) => Number(m.ts)).filter((n) => !Number.isNaN(n)).at(-1);
  return { text, lastMessageAt: lastTs ? new Date(lastTs * 1000) : null };
}

const DEVREV_LINK_PATTERN = /app\.devrev\.ai\/[^/\s]+\/(?:issue|works)\/([A-Z]+-\d+)/;
// The card renders as "*Created by:* <@U...>" — the closing bold marker (*)
// sits between the colon and the mention, so allow an optional "*" there too.
const CREATED_BY_PATTERN = /Created by:\*?\s*<@([A-Z0-9]+)(?:\|[^>]*)?>/;

export function extractDevRevTicketId(parentText: string): string | null {
  return parentText.match(DEVREV_LINK_PATTERN)?.[1] ?? null;
}

export function extractCreatorSlackUserId(parentText: string): string | null {
  return parentText.match(CREATED_BY_PATTERN)?.[1] ?? null;
}

export async function postInThread(channel: string, threadTs: string, text: string): Promise<void> {
  await slackClient.chat.postMessage({ channel, thread_ts: threadTs, text, token: currentToken });
}
