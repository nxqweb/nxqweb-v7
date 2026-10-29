// Contract test for the client Analytics chart (static; no browser). Protects the promise audit fix:
// a real daily chart, honest empty/refresh states, and no fake "live" claim.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const read = (file) => fs.readFileSync(file, "utf8");
const page = read("src/pages/ClientBusinessAnalytics.tsx");
const chart = read("src/components/DailyTrendChart.tsx");
const css = read("src/styles/trend-chart.css");

check("analytics page renders page-view and click charts from the daily rollups", page.includes("DailyTrendChart") && page.includes("Page views per day") && page.includes("Clicks per day") && page.includes("website_analytics_daily_rollups"));
check("date range presets (30 and 90 days) scope the charts and totals", page.includes("([30, 90] as const)") && page.includes("aria-pressed") && page.includes("lastDays(range,"));
check("freshness is a polled 'Updated N min ago' label, not a live badge", page.includes("updatedLabel") && page.includes("REFRESH_MS") && !/>\s*Live\s*</i.test(page) && !/live badge|is live|real-time/i.test(page));
check("a failed refresh is disclosed and earlier data is kept", page.includes("Could not refresh"));
check("empty state is honest (no invented values)", page.includes("No charts yet") && page.includes("drawn as 0"));
check("a plan without analytics access still sees the upgrade message, not charts", page.includes("is not included in") && page.includes("analyticsAccess.allowed"));
check("table view stays available beside the charts", page.includes("table view"));
check("chart uses one y-scale per chart (no dual axis)", (chart.match(/yAt\(/g) || []).length > 0 && !/secondaryAxis|yRight|rightAxis|secondScale/.test(chart) && (chart.match(/const yAt =/g) || []).length === 1);
check("chart never injects HTML", !/dangerouslySetInnerHTML|innerHTML/.test(chart + page));
check("chart is keyboard operable and labelled", chart.includes("tabIndex={0}") && chart.includes("ArrowLeft") && chart.includes("aria-label"));
check("chart ticks are integers and the line is 2px", chart.includes("niceStep") && /stroke-width:\s*2;/.test(css));
check("chart has a light-theme override", css.includes('data-nxq-theme="light"') && css.includes("--trend-ink"));
check("analytics data still comes only from RLS-protected reads for the signed-in client", page.includes('.eq("project_id", projectId)') && !page.includes("service_role"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll analytics chart checks passed.");
process.exit(failures ? 1 : 0);
