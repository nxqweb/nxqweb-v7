// Pure monthly-report cycle logic for the client Reports page. No network, no React.
// Inputs come straight from what the database already stores: the client's maintenance plan
// (schedule) and their website_monthly_reports rows (one per month). Nothing here is invented.

export type CyclePlan = {
  status: string;
  monthly_report_enabled: boolean;
  next_monthly_report_at: string | null;
};

export type CycleReport = {
  report_month: string; // 'YYYY-MM-DD' (first of the month)
  status: string;
  generated_at: string | null;
  delivered_at: string | null;
};

export type MonthStatus = "delivered" | "ready" | "draft" | "blocked" | "failed" | "missing";

export type CycleMonth = { month: string; status: MonthStatus; generatedAt: string | null; deliveredAt: string | null };

export type CycleState = "no_plan" | "paused" | "off" | "active";

export type CycleSummary = {
  state: CycleState;
  planStatus: string | null;
  nextReportAt: string | null; // only set while the cycle is active and the date parses
  months: CycleMonth[]; // oldest to newest, ending with the current month
  latest: CycleMonth | null; // newest month that has a real report row
};

const KNOWN: ReadonlySet<string> = new Set(["delivered", "ready", "draft", "blocked", "failed"]);

export const statusLabel: Record<MonthStatus, string> = {
  delivered: "Delivered",
  ready: "Ready",
  draft: "Being prepared",
  blocked: "Waiting",
  failed: "Could not be completed",
  missing: "No report",
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildCycle(plan: CyclePlan | null, reports: CycleReport[], nowMs: number, monthCount = 6): CycleSummary {
  const byMonth = new Map<string, CycleReport>();
  for (const report of reports) {
    const key = String(report.report_month || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key) && !byMonth.has(key)) byMonth.set(key, report);
  }

  const now = new Date(nowMs);
  const months: CycleMonth[] = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    const report = byMonth.get(key);
    const status: MonthStatus = report && KNOWN.has(report.status) ? (report.status as MonthStatus) : "missing";
    months.push({
      month: `${key}-01`,
      status,
      generatedAt: report?.generated_at ?? null,
      deliveredAt: report?.delivered_at ?? null,
    });
  }

  let state: CycleState = "active";
  if (!plan) state = "no_plan";
  else if (plan.status !== "active") state = "paused";
  else if (!plan.monthly_report_enabled) state = "off";

  const next = plan?.next_monthly_report_at ? new Date(plan.next_monthly_report_at) : null;
  const nextReportAt = state === "active" && next && !Number.isNaN(next.getTime()) ? next.toISOString() : null;
  const latest = [...months].reverse().find((month) => month.status !== "missing") ?? null;

  return { state, planStatus: plan?.status ?? null, nextReportAt, months, latest };
}
