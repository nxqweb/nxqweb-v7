// Owner-side helpers for pausing, cancelling and the free first month (migration 285). Pure functions plus thin rpc wrappers; all rules live in the database.

export type LifecycleRow = {
  client_id: string;
  business_name: string;
  status: string;
  billing_status: string | null;
  paused_at: string | null;
  paused_reason: string | null;
  cancelled_at: string | null;
  site_taken_down_at: string | null;
  first_month_started_at: string | null;
  first_month_ends_at: string | null;
  first_invoice_noted_at: string | null;
  first_month_days_left: number | null;
};

export type LifecycleOverview = { needs_take_down: LifecycleRow[]; paused: LifecycleRow[]; first_month: LifecycleRow[] };

export type FirstMonthTone = "running" | "ending" | "over";

export function firstMonthTone(daysLeft: number | null): FirstMonthTone {
  if (daysLeft === null || daysLeft <= 0) return "over";
  return daysLeft <= 7 ? "ending" : "running";
}

export function firstMonthLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "No free month";
  if (daysLeft < 0) return `Free month ended ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago: time to invoice`;
  if (daysLeft === 0) return "Free month ends today: time to invoice";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left of the free month`;
}

export function emptyOverview(): LifecycleOverview {
  return { needs_take_down: [], paused: [], first_month: [] };
}

export function normalizeOverview(value: unknown): LifecycleOverview {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof LifecycleOverview, unknown>>;
  const list = (x: unknown): LifecycleRow[] => (Array.isArray(x) ? (x as LifecycleRow[]) : []);
  return { needs_take_down: list(v.needs_take_down), paused: list(v.paused), first_month: list(v.first_month) };
}

export function validNote(value: string): boolean {
  const n = value.trim();
  return n.length >= 8 && n.length <= 500;
}

type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

async function call(client: Rpc, fn: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { message?: string } | null;
}

export function createClientLifecycleGateway(client: Rpc) {
  return {
    async overview() { return normalizeOverview(await call(client, "owner_client_lifecycle_overview")); },
    pause: (id: string, reason: string) => call(client, "owner_pause_client", { target_client_id: id, reason_value: reason }),
    resume: (id: string) => call(client, "owner_resume_client", { target_client_id: id }),
    cancel: (id: string, note: string) => call(client, "owner_cancel_client", { target_client_id: id, note_value: note }),
    markTakenDown: (id: string) => call(client, "owner_mark_site_taken_down", { target_client_id: id }),
    setFirstMonth: (id: string, start: string) => call(client, "owner_set_first_month", { target_client_id: id, start_value: start }),
    noteFirstInvoice: (id: string) => call(client, "owner_note_first_invoice", { target_client_id: id }),
  };
}
