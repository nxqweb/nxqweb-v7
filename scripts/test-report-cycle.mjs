// Logic + wiring tests for the Reports page monthly-cycle panel (Node runs the TypeScript directly).
import fs from "node:fs";
import { buildCycle, statusLabel } from "../src/lib/reportCycle.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime(); // 15 Oct 2026
const plan = (extra = {}) => ({ status: "active", monthly_report_enabled: true, next_monthly_report_at: "2026-11-01T00:00:00.000Z", ...extra });
const report = (month, status, extra = {}) => ({ report_month: `${month}-01`, status, generated_at: null, delivered_at: null, ...extra });

const none = buildCycle(null, [], NOW);
check("no plan means no cycle and no invented dates", none.state === "no_plan" && none.nextReportAt === null && none.latest === null);
check("six months are always returned, ending with the current month", none.months.length === 6 && none.months[0].month === "2026-05-01" && none.months[5].month === "2026-10-01");
check("months with no report row are 'missing', never assumed delivered", none.months.every((m) => m.status === "missing"));

const active = buildCycle(plan(), [], NOW);
check("an active plan with reports enabled shows the next report date", active.state === "active" && active.nextReportAt === "2026-11-01T00:00:00.000Z");
check("a paused plan hides the next date", buildCycle(plan({ status: "paused" }), [], NOW).nextReportAt === null && buildCycle(plan({ status: "paused" }), [], NOW).state === "paused");
check("reports switched off hides the next date", buildCycle(plan({ monthly_report_enabled: false }), [], NOW).state === "off" && buildCycle(plan({ monthly_report_enabled: false }), [], NOW).nextReportAt === null);
check("an unparseable next date is dropped, not shown", buildCycle(plan({ next_monthly_report_at: "garbage" }), [], NOW).nextReportAt === null);
check("a missing next date is dropped", buildCycle(plan({ next_monthly_report_at: null }), [], NOW).nextReportAt === null);

const full = buildCycle(plan(), [
  report("2026-10", "draft"),
  report("2026-09", "delivered", { delivered_at: "2026-10-02T09:00:00Z", generated_at: "2026-10-01T09:00:00Z" }),
  report("2026-08", "ready"),
  report("2026-06", "failed"),
  report("2025-01", "delivered"),
], NOW);
const by = Object.fromEntries(full.months.map((m) => [m.month, m.status]));
check("each month takes its real status", by["2026-10-01"] === "draft" && by["2026-09-01"] === "delivered" && by["2026-08-01"] === "ready" && by["2026-06-01"] === "failed");
check("a month without a row stays missing even next to real ones", by["2026-07-01"] === "missing" && by["2026-05-01"] === "missing");
check("reports older than the window do not appear", full.months.length === 6 && !full.months.some((m) => m.month.startsWith("2025")));
check("latest is the newest month that has a real report", full.latest.month === "2026-10-01" && full.latest.status === "draft");
check("delivery and generation times carry through", full.months.find((m) => m.month === "2026-09-01").deliveredAt === "2026-10-02T09:00:00Z" && full.months.find((m) => m.month === "2026-09-01").generatedAt === "2026-10-01T09:00:00Z");
check("an unknown status is shown as missing, not guessed", buildCycle(plan(), [report("2026-10", "weird")], NOW).months[5].status === "missing");
check("a duplicate month keeps the first row", buildCycle(plan(), [report("2026-10", "ready"), report("2026-10", "failed")], NOW).months[5].status === "ready");
check("a malformed month string is ignored", buildCycle(plan(), [{ report_month: "oops", status: "ready", generated_at: null, delivered_at: null }], NOW).months.every((m) => m.status === "missing"));
const jan = buildCycle(plan(), [report("2025-12", "ready")], new Date(2026, 0, 10).getTime());
check("the window rolls back across a year boundary", jan.months[0].month === "2025-08-01" && jan.months[4].month === "2025-12-01" && jan.months[4].status === "ready" && jan.months[5].month === "2026-01-01");
check("every status has a plain-language label", ["delivered", "ready", "draft", "blocked", "failed", "missing"].every((k) => typeof statusLabel[k] === "string" && statusLabel[k].length > 0));

// ---- Page wiring (static) ----
const read = (file) => fs.readFileSync(file, "utf8");
const page = read("src/pages/ClientBusinessReports.tsx");
check("the page builds its cycle from the tested library", page.includes("buildCycle") && page.includes("reportCycle"));
check("the page reads the client's own plan and monthly reports (RLS-protected tables)", page.includes('"website_maintenance_plans"') && page.includes('"website_monthly_reports"'));
check("a failed cycle read says so and shows no dates", page.includes("Monthly cycle could not be verified"));
check("the page states when reports are prepared and never says live", page.includes("first of each month") && !/\blive\b/i.test(page.replace(/Open live website/g, "")));
check("the combined business summary list no longer pretends reports are coming", page.includes("No business summary reports yet"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll report cycle checks passed.");
process.exit(failures ? 1 : 0);
