// What the owner's AI Desk panel needs from the server once the AI Desk migration is live. Types only: the real connection is a draft
// (src/lib/aiDeskSupabaseGateway.ts, promoted with migration 277; switched on in src/lib/aiDeskConfig.ts only after the migration is applied).
import type { DeskRequest } from "./aiDesk";

export type DeskStatus = {
  status: "none" | "waiting" | "saved" | "used";
  request: DeskRequest | null;
  savedAt: string | null;
  usedAt: string | null;
  lastError: string | null;
};

export type AiDeskGateway = {
  getStatus(clientId: string): Promise<DeskStatus>;
  save(clientId: string, answer: unknown): Promise<void>;
};

const STATUSES = ["none", "waiting", "saved", "used"];

// Turns the database's answer into a safe shape; anything unexpected becomes "none" rather than a crash.
export function deskStatusFromRow(row: unknown): DeskStatus {
  const value = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
  const status = typeof value.status === "string" && STATUSES.includes(value.status) ? (value.status as DeskStatus["status"]) : "none";
  const request = value.request && typeof value.request === "object" && !Array.isArray(value.request) ? (value.request as DeskRequest) : null;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { status, request: status === "waiting" ? request : null, savedAt: text(value.saved_at), usedAt: text(value.used_at), lastError: text(value.last_error) };
}
