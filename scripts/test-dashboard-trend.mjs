// Offline test: the Business dashboard's 14-day trend is built from real rollups only, never invents a comparison, and is plan-gated.
import fs from "node:fs";
import { lastDays, trendSeries, weekOverWeek } from "../src/lib/dashboardTrend.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const noon = new Date(2026, 9, 9, 12, 0, 0).getTime();
const days = lastDays(14, noon);
check("lastDays returns 14 consecutive days ending today", days.length === 14 && days[13] === "2026-10-09" && days[0] === "2026-09-26");

const rows = [{ rollup_date: "2026-10-09", page_views: 30, clicks: 4 }, { rollup_date: "2026-10-08", page_views: 20, clicks: 1 }, { rollup_date: "2026-10-01", page_views: 10, clicks: 0 }];
const views = trendSeries(rows, days, "page_views");
check("days with no stored rollup are plotted as 0 (not interpolated)", views[12].value === 20 && views[13].value === 30 && views[11].value === 0);
check("clicks series reads the clicks field", trendSeries(rows, days, "clicks")[13].value === 4);

const wow = weekOverWeek(views);
check("week over week compares the last 7 days with the 7 before", wow && wow.recent === 50 && wow.previous === 10 && wow.changePercent === 400);
check("no earlier data means no percentage (not an invented one)", weekOverWeek(trendSeries([{ rollup_date: "2026-10-09", page_views: 5, clicks: 0 }], days, "page_views")) === null);
check("fewer than 14 points means no comparison", weekOverWeek(views.slice(0, 10)) === null);
check("a drop is reported as a negative percentage", weekOverWeek([...Array(7).fill({ value: 10 }), ...Array(7).fill({ value: 5 })]).changePercent === -50);

const dash = fs.readFileSync("src/pages/ClientBusinessDashboard.tsx", "utf8");
const analytics = fs.readFileSync("src/pages/ClientBusinessAnalytics.tsx", "utf8");
check("dashboard trend only loads for plans that include analytics", dash.includes("const analyticsAllowed") && dash.includes("if (!analyticsAllowed) return;"));
check("dashboard trend panel is only rendered for allowed plans, without errors, with data loaded", dash.includes("access.analytics?.allowed && !trendError && trend ?"));
check("dashboard trend has an honest empty state", dash.includes("No visits recorded yet."));
check("dashboard trend never calls Date.now during render (computed in the loader)", !/const trendDays = lastDays\(14, Date\.now\(\)\)/.test(dash));
check("Analytics page shares the same day helper", analytics.includes('from "../lib/dashboardTrend"') && !analytics.includes("function localDay"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll dashboard-trend checks passed (offline).");
process.exit(failures ? 1 : 0);
