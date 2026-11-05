// Pure lead-funnel maths for the client Business workspace. No network, no React: easy to test.
// Everything is derived from fields the Leads page already shows (status, service, urgency, created date).
// Source/UTM are not part of this view: the client lead RPC does not return them.

export type FunnelLead = {
  status: string;
  service_key: string | null;
  urgency: string;
  created_at: string;
};

export type FunnelStage = { key: "received" | "contacted" | "qualified" | "won"; label: string; count: number };
export type FunnelService = { service: string; total: number; won: number };
export type FunnelWeek = { date: string; value: number };

export type FunnelSummary = {
  total: number;
  spam: number;
  stages: FunnelStage[];
  // Step conversion as a 0..1 fraction, or null when there is nothing to divide by (never a fake 0%).
  conversion: { contacted: number | null; qualified: number | null; won: number | null; overall: number | null };
  services: FunnelService[];
  urgent: number;
  weekly: FunnelWeek[];
};

const REACHED_CONTACT = new Set(["contacted", "qualified", "won"]);
const REACHED_QUALIFIED = new Set(["qualified", "won"]);
const URGENT = new Set(["urgent", "emergency"]);
const TOP_SERVICES = 6;

function ratio(part: number, whole: number) {
  return whole > 0 ? part / whole : null;
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Monday of the week containing `date`, in local time.
function weekStart(date: Date) {
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

export function buildFunnel(leads: FunnelLead[], nowMs: number, weeks = 8): FunnelSummary {
  const real = leads.filter((lead) => lead.status !== "spam");
  const contacted = real.filter((lead) => REACHED_CONTACT.has(lead.status)).length;
  const qualified = real.filter((lead) => REACHED_QUALIFIED.has(lead.status)).length;
  const won = real.filter((lead) => lead.status === "won").length;

  const byService = new Map<string, FunnelService>();
  for (const lead of real) {
    const key = (lead.service_key || "").trim() || "Not specified";
    const entry = byService.get(key) || { service: key, total: 0, won: 0 };
    entry.total += 1;
    if (lead.status === "won") entry.won += 1;
    byService.set(key, entry);
  }
  const services = [...byService.values()]
    .sort((a, b) => b.total - a.total || a.service.localeCompare(b.service))
    .slice(0, TOP_SERVICES);

  const thisWeek = weekStart(new Date(nowMs));
  const buckets: FunnelWeek[] = [];
  const indexByDay = new Map<string, number>();
  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const start = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - offset * 7);
    const day = localDay(start);
    indexByDay.set(day, buckets.length);
    buckets.push({ date: day, value: 0 });
  }
  for (const lead of real) {
    const created = new Date(lead.created_at);
    if (Number.isNaN(created.getTime())) continue;
    const index = indexByDay.get(localDay(weekStart(created)));
    if (index !== undefined) buckets[index].value += 1;
  }

  return {
    total: leads.length,
    spam: leads.length - real.length,
    stages: [
      { key: "received", label: "Received", count: real.length },
      { key: "contacted", label: "Contacted", count: contacted },
      { key: "qualified", label: "Qualified", count: qualified },
      { key: "won", label: "Won", count: won },
    ],
    conversion: {
      contacted: ratio(contacted, real.length),
      qualified: ratio(qualified, contacted),
      won: ratio(won, qualified),
      overall: ratio(won, real.length),
    },
    services,
    urgent: real.filter((lead) => URGENT.has(lead.urgency)).length,
    weekly: buckets,
  };
}

export function percent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}
