// Helpers for the owner's background-maker screens (parked patch 11_background_owner_screens.patch; database draft 11).
// Pure text and number work only: nothing here calls the database, so it is safe to live in the app before the backend exists.
// The database enforces every rule; these checks only let the page say what is wrong before saving.
import { storeLookFromRow } from "./storeBranding.ts";

export type BackgroundSettings = { switchedOn: boolean; perStoreAllowance: number; periodDays: number; monthlyCap: number; cooldownSeconds: number; madeThisMonth: number };
export type SettingsForm = { switchedOn: boolean; perStoreAllowance: string; periodDays: string; monthlyCap: string; cooldownSeconds: string };
export type WaitingRequest = { id: string; storeName: string; storeSlug: string; status: string; imageUrl: string | null; overlay: number; createdAt: string };

const whole = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Safe default (everything off and zero) for anything missing or odd, the same as the database's own starting values.
export function parseBackgroundSettings(raw: unknown): BackgroundSettings {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    switchedOn: row.switched_on === true,
    perStoreAllowance: whole(row.per_store_allowance, 0, 50) ?? 0,
    periodDays: whole(row.period_days, 1, 3650) ?? 365,
    monthlyCap: whole(row.monthly_cap, 0, 100000) ?? 0,
    cooldownSeconds: whole(row.cooldown_seconds, 0, 86400) ?? 60,
    madeThisMonth: whole(row.made_this_month, 0, 1000000) ?? 0,
  };
}

export const formFromSettings = (s: BackgroundSettings): SettingsForm => ({ switchedOn: s.switchedOn, perStoreAllowance: String(s.perStoreAllowance), periodDays: String(s.periodDays), monthlyCap: String(s.monthlyCap), cooldownSeconds: String(s.cooldownSeconds) });

function field(text: string, label: string, min: number, max: number): { value: number | null; problem: string } {
  const clean = text.trim();
  if (!/^\d{1,7}$/.test(clean)) return { value: null, problem: `${label} must be a whole number from ${min} to ${max}.` };
  const n = Number(clean);
  return n >= min && n <= max ? { value: n, problem: "" } : { value: null, problem: `${label} must be a whole number from ${min} to ${max}.` };
}

// The first problem in plain words, or "" when the form can be saved.
export function settingsProblem(form: SettingsForm): string {
  return field(form.perStoreAllowance, "Pictures per store", 0, 50).problem || field(form.periodDays, "The period (days)", 1, 3650).problem
    || field(form.monthlyCap, "The monthly limit for all stores", 0, 100000).problem || field(form.cooldownSeconds, "The wait between tries (seconds)", 0, 86400).problem;
}

// The exact arguments of the database's save-limits function, or null when the form has a problem.
export function settingsPayload(form: SettingsForm): { switched_on_value: boolean; per_store_allowance_value: number; period_days_value: number; monthly_cap_value: number; cooldown_seconds_value: number } | null {
  if (settingsProblem(form)) return null;
  return { switched_on_value: form.switchedOn === true, per_store_allowance_value: Number(form.perStoreAllowance.trim()), period_days_value: Number(form.periodDays.trim()),
    monthly_cap_value: Number(form.monthlyCap.trim()), cooldown_seconds_value: Number(form.cooldownSeconds.trim()) };
}

// A plain sentence listing what saving will change, for the confirm box. Turning the maker ON from OFF is called out.
export function settingsChangeSummary(before: BackgroundSettings, form: SettingsForm): string {
  const lines: string[] = [];
  if (before.switchedOn !== form.switchedOn) lines.push(form.switchedOn ? "Automatic backgrounds will be switched ON." : "Automatic backgrounds will be switched OFF.");
  const pairs: Array<[string, number, string]> = [["Pictures per store", before.perStoreAllowance, form.perStoreAllowance], ["Period (days)", before.periodDays, form.periodDays], ["Monthly limit for all stores", before.monthlyCap, form.monthlyCap], ["Wait between tries (seconds)", before.cooldownSeconds, form.cooldownSeconds]];
  for (const [label, was, now] of pairs) if (String(was) !== now.trim()) lines.push(`${label}: ${was} to ${now.trim()}.`);
  return lines.length ? lines.join("\n") : "Nothing is changing.";
}

// The owner's waiting list. A picture is only shown when it matches the strict own-folder shape the database checks (never an outside address).
export function parseWaitingRequests(raw: unknown): WaitingRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: WaitingRequest[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !uuid.test(r.id)) continue;
    const look = storeLookFromRow({ background: r.image_url });
    const overlay = typeof r.overlay === "number" && Number.isFinite(r.overlay) ? Math.min(0.75, Math.max(0, r.overlay)) : 0;
    out.push({ id: r.id, storeName: typeof r.store_name === "string" ? r.store_name.slice(0, 120) : "", storeSlug: typeof r.store_slug === "string" ? r.store_slug.slice(0, 120) : "",
      status: typeof r.status === "string" ? r.status : "", imageUrl: look?.background ?? null, overlay, createdAt: typeof r.created_at === "string" ? r.created_at : "" });
  }
  return out;
}

export function decisionConfirm(request: WaitingRequest, approve: boolean): string {
  const store = request.storeName || request.storeSlug || "this store";
  return approve
    ? `Approve this background for ${store}? It goes live on their store right away.`
    : `Reject this background for ${store}? Their store stays as it is. It still counts toward their allowance.`;
}
