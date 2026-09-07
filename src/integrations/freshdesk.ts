import axios from "axios";
import { config } from "../config";

const client = axios.create({
  baseURL: `https://${config.freshdesk.domain}/api/v2`,
  auth: { username: config.freshdesk.apiKey, password: "X" },
});

export interface FreshdeskConversation {
  id: number;
  createdAt: string;
  fromAgent: boolean;
}

export async function getConversations(ticketId: string): Promise<FreshdeskConversation[]> {
  const { data } = await client.get(`/tickets/${ticketId}/conversations`);
  return (data as any[]).map((c) => ({
    id: c.id,
    createdAt: c.created_at,
    // incoming === true means the customer wrote it; agent replies are outgoing.
    fromAgent: c.incoming === false,
  }));
}

function byCreatedAtAsc(a: FreshdeskConversation, b: FreshdeskConversation): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function isResolvedForMerchant(conversations: FreshdeskConversation[]): boolean {
  if (conversations.length === 0) return false;
  const latest = [...conversations].sort(byCreatedAtAsc).at(-1)!;
  return latest.fromAgent;
}
