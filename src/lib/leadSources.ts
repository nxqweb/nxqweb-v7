// Parses the aggregated payload from current_client_lead_sources(days) (migration 259) for display.
// The database already sanitizes the values, but this is still a boundary: anything that is not the exact shape we expect is
// dropped rather than trusted, and nothing here is ever rendered as HTML.

export type SourceRow = { label: string; leads: number; won: number; tagged: boolean };

export type SourcesSummary = {
  days: number;
  total: number; // leads in the window, spam excluded
  tagged: number; // leads that carry at least one campaign (UTM) tag
  channels: SourceRow[];
  sources: SourceRow[];
  mediums: SourceRow[];
  campaigns: SourceRow[];
};

export const NOT_TAGGED = "Not tagged";
const MAX_ROWS = 10;

function count(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function toRows(value: unknown): SourceRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SourceRow[] = [];
  for (const entry of value.slice(0, MAX_ROWS)) {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const raw = typeof item.value === "string" ? item.value.trim() : "";
    const leads = count(item.leads);
    if (leads === 0) continue;
    rows.push({
      label: raw ? raw.replace(/[_]+/g, " ") : NOT_TAGGED,
      leads,
      won: Math.min(count(item.won), leads),
      tagged: raw !== "",
    });
  }
  return rows;
}

export function parseLeadSources(payload: unknown): SourcesSummary | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.total !== "number" && typeof data.total !== "string") return null;
  const total = count(data.total);
  return {
    days: Math.max(1, count(data.days) || 90),
    total,
    tagged: Math.min(count(data.tagged), total),
    channels: toRows(data.channels),
    sources: toRows(data.sources),
    mediums: toRows(data.mediums),
    campaigns: toRows(data.campaigns),
  };
}
