import axios from "axios";
import { config } from "../config";

const client = axios.create({
  baseURL: config.devrev.baseUrl,
  headers: {
    // DevRev PATs go in the Authorization header with no "Bearer " prefix.
    Authorization: config.devrev.apiToken,
    "Content-Type": "application/json",
  },
});

export interface DevRevWork {
  id: string;
  displayId: string;
  title: string;
  stageName: string | null;
  stateIsFinal: boolean;
  ownerEmail: string | null;
  freshdeskTicketId: string | null;
  raw: unknown;
}

function extractOwnerEmail(raw: any): string | null {
  const owners = raw?.owned_by;
  if (Array.isArray(owners) && owners.length > 0) {
    return owners[0]?.email ?? null;
  }
  return null;
}

function extractFreshdeskId(raw: any): string | null {
  const fieldKey = config.devrev.freshdeskFieldKey;
  if (!fieldKey) return null;
  const value = raw?.custom_fields?.[fieldKey];
  return value ? String(value) : null;
}

export async function getWork(displayId: string): Promise<DevRevWork | null> {
  const { data } = await client.post("/works.get", { id: displayId });
  const raw = data?.work;
  if (!raw) return null;

  return {
    id: raw.id,
    displayId: raw.display_id ?? displayId,
    title: raw.title,
    stageName: raw.stage?.name ?? null,
    // stage.state.is_final is DevRev's actual "done, nothing more to do" signal —
    // more reliable than pattern-matching stage names, which vary per ticket type.
    stateIsFinal: Boolean(raw.stage?.state?.is_final),
    ownerEmail: extractOwnerEmail(raw),
    freshdeskTicketId: extractFreshdeskId(raw),
    raw,
  };
}

export function isClosed(work: DevRevWork): boolean {
  return work.stateIsFinal;
}
