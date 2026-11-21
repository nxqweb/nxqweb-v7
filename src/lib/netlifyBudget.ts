// Owner-side helpers for the Netlify build limit screen (migration 234). The database enforces every rule (owner_update_netlify_budget_settings); the same checks run here only so the
// page can say what is wrong before saving. This is NXQX's own safety counter, not the Netlify credit balance: that is read on Netlify, and Netlify's reporting can lag.
export const MAX_BUILD_LIMIT = 100;

export type NetlifyBudget = {
  enabled: boolean;
  emergencyStop: boolean;
  maxBuilds: number;
  maxQaBuilds: number;
  anchorDay: number;
  cycleStart: string;
  reservedBuilds: number;
  reservedQaBuilds: number;
};
export type BudgetSettings = { enabled: boolean; emergencyStop: boolean; maxBuilds: number; maxQaBuilds: number };

function whole(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// owner_netlify_budget_status() returns { settings: {...the settings row}, cycle_start, reserved_builds, reserved_qa_builds }. Anything odd becomes null (the page then says it could not be read).
export function budgetFromRpc(data: unknown): NetlifyBudget | null {
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const settings = row && row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : null;
  if (!row || !settings) return null;
  const maxBuilds = whole(settings.max_builds_per_cycle);
  const maxQaBuilds = whole(settings.max_qa_builds_per_cycle);
  const anchorDay = whole(settings.billing_cycle_anchor_day);
  const reservedBuilds = whole(row.reserved_builds);
  const reservedQaBuilds = whole(row.reserved_qa_builds);
  if (maxBuilds === null || maxQaBuilds === null || anchorDay === null || reservedBuilds === null || reservedQaBuilds === null) return null;
  if (typeof settings.enabled !== "boolean" || typeof settings.emergency_stop !== "boolean") return null;
  return { enabled: settings.enabled, emergencyStop: settings.emergency_stop, maxBuilds, maxQaBuilds, anchorDay, cycleStart: typeof row.cycle_start === "string" ? row.cycle_start : "", reservedBuilds, reservedQaBuilds };
}

// The first problem in plain words, or "" when the two limits can be saved. Same rules as the database function.
export function budgetProblem(maxBuilds: number, maxQaBuilds: number): string {
  if (!Number.isInteger(maxBuilds) || maxBuilds < 0 || maxBuilds > MAX_BUILD_LIMIT) return `The cycle limit must be a whole number from 0 to ${MAX_BUILD_LIMIT}.`;
  if (!Number.isInteger(maxQaBuilds) || maxQaBuilds < 0) return "The QA limit must be a whole number, 0 or more.";
  if (maxQaBuilds > maxBuilds) return "The QA limit cannot be higher than the cycle limit, because QA builds count inside it.";
  return "";
}

export type BuildsLeft = { total: number; qa: number };
// Every build counts toward the cycle total, and a QA build ALSO counts toward the QA limit, so the QA builds left can never be more than the total left.
export function buildsLeft(budget: Pick<NetlifyBudget, "maxBuilds" | "maxQaBuilds" | "reservedBuilds" | "reservedQaBuilds">): BuildsLeft {
  const total = Math.max(0, budget.maxBuilds - budget.reservedBuilds);
  const qa = Math.min(total, Math.max(0, budget.maxQaBuilds - budget.reservedQaBuilds));
  return { total, qa };
}

// An approve run reserves a preview and a production build, and a third while Netlify still builds a new site once by itself (see docs/TEN_CLEAN_RUNS_PLAN.md).
export const BUILDS_PER_APPROVE_RUN = { fewest: 2, most: 3 } as const;
export function approveRunsLeft(qaBuildsLeft: number): { atLeast: number; atMost: number } {
  const left = Math.max(0, Math.floor(qaBuildsLeft));
  return { atLeast: Math.floor(left / BUILDS_PER_APPROVE_RUN.most), atMost: Math.floor(left / BUILDS_PER_APPROVE_RUN.fewest) };
}

// What a save would change, one plain line each, for the "are you sure" box. Empty when nothing changes.
export function describeChange(before: NetlifyBudget, next: BudgetSettings): string[] {
  const lines: string[] = [];
  if (before.enabled !== next.enabled) lines.push(next.enabled ? "Build limit: OFF -> ON." : "Build limit: ON -> OFF (the guard stops counting; credits are then the only limit).");
  if (before.emergencyStop !== next.emergencyStop) lines.push(next.emergencyStop ? "Emergency stop: OFF -> ON (every new build, real clients' included, is refused until you turn it off)." : "Emergency stop: ON -> OFF (builds can be reserved again).");
  if (before.maxBuilds !== next.maxBuilds) lines.push(`Builds allowed this cycle: ${before.maxBuilds} -> ${next.maxBuilds}.`);
  if (before.maxQaBuilds !== next.maxQaBuilds) lines.push(`Of those, test (QA) builds allowed: ${before.maxQaBuilds} -> ${next.maxQaBuilds}.`);
  return lines;
}
