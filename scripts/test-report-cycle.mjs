// Logic + wiring tests for the Reports page monthly-cycle panel (Node runs the TypeScript directly).
import fs from "node:fs";
import { buildCycle, statusLabel, summarizeReport } from "../src/lib/reportCycle.ts";

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
check("the unused combined business-summary list is gone (nothing writes that table)", !page.includes("client_monthly_business_reports") && !page.includes("Business summary reports") && !page.includes("No business summary reports yet"));
check("the page subtitle only promises what is shown", page.includes("Your monthly report schedule and the improvements recommended for your website.") && !page.includes("usage summaries"));


// ---- plain summary of a finished report (only real values, never invented)
const good = summarizeReport({ health_summary: { total_checks: 12, completed_checks: 11, unresolved_checks: 1 }, recommendations: ["Review unresolved maintenance exceptions in the NXQX owner portal."] });
check("a finished report becomes plain sentences with the real numbers", good && good.checks === 12 && good.completed === 11 && good.needAttention === 1 && good.sentences.join(" ") === "12 website checks were run this month. 11 finished without a problem. 1 needs attention. The NXQX team is looking at it." && good.recommendations.length === 1);
check("one check, zero checks and all-clear read naturally", summarizeReport({ health_summary: { total_checks: 1, completed_checks: 1, unresolved_checks: 0 }, recommendations: [] }).sentences.join(" ") === "1 website check was run this month. 1 finished without a problem." && summarizeReport({ health_summary: { total_checks: 0 }, recommendations: [] }).sentences[0] === "No website checks were needed this month.");
check("missing, wrong-typed or negative values are dropped, and an empty report shows nothing", summarizeReport({ health_summary: {}, recommendations: [] }) === null && summarizeReport({ health_summary: null, recommendations: null }) === null && summarizeReport({ health_summary: { total_checks: -4, completed_checks: "9" }, recommendations: [] }) === null && summarizeReport({ health_summary: "x", recommendations: [5, {}, "  ", "ok"] }).recommendations.join() === "ok");
check("recommendations are trimmed, capped at 5 and 300 characters", (() => { const r = summarizeReport({ health_summary: { total_checks: 1 }, recommendations: Array.from({ length: 9 }, (_, i) => `${i} ${"x".repeat(400)}`) }); return r.recommendations.length === 5 && r.recommendations.every((t) => t.length <= 300); })());
check("only ready or delivered months carry a summary", (() => { const c = buildCycle(plan(), [report("2026-10", "draft", { health_summary: { total_checks: 3 } }), report("2026-09", "delivered", { health_summary: { total_checks: 3 } })], NOW); const by = Object.fromEntries(c.months.map((m) => [m.month.slice(0, 7), m.summary])); return by["2026-10"] === null && by["2026-09"] && by["2026-09"].checks === 3; })());
const reportsPage = fs.readFileSync("src/pages/ClientBusinessReports.tsx", "utf8");
check("the page reads the two report columns and shows the latest summary with an honest scope note", /select\("report_month,status,generated_at,delivered_at,health_summary,recommendations"\)/.test(reportsPage) && /data-testid="report-summary"/.test(reportsPage) && /cycle\.latest\?\.summary/.test(reportsPage) && /These reports cover your website checks\./.test(reportsPage));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll report cycle checks passed.");
process.exit(failures ? 1 : 0);
