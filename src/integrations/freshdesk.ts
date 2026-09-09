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

// Confirmed via GET /ticket_fields against this org's status choices —
// status 24's label is literally "Pending on PSE".
const PENDING_ON_PSE_STATUS = 24;

export async function getTicketStatus(ticketId: string): Promise<number> {
  const { data } = await client.get(`/tickets/${ticketId}`);
  return data.status;
}

export function isPendingOnPse(status: number): boolean {
  return status === PENDING_ON_PSE_STATUS;
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
