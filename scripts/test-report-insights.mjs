// The automatic monthly report: plain rules over counts the database already holds. No AI, no visitor or lead details.
import fs from "node:fs";
import { buildPerformanceSummary, buildRecommendations } from "../supabase/functions/_shared/report-insights.mjs";

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}
const days = (n, views, extra = {}) => Array.from({ length: n }, () => ({ page_views: views, clicks: 1, max_scroll_depth: 70, heatpoint_count: 2, ...extra }));

const s = buildPerformanceSummary({ rollups: days(10, 5), prevRollups: days(10, 3), leads: { total: 4, urgent: 1, stillNew: 2 }, prevLeads: { total: 1 } });
check("totals add up from the daily rollups, and last month is kept for comparison", s.tracking && s.page_views === 50 && s.clicks === 10 && s.heatpoints === 20 && s.prev_page_views === 30 && s.avg_scroll_depth === 70);
check("lead counts are counts only", s.leads === 4 && s.urgent_leads === 1 && s.still_new_leads === 2 && s.prev_leads === 1 && !JSON.stringify(s).match(/@|name|phone|message/i));
check("no tracking data means tracking is false, not zero visits", buildPerformanceSummary({ rollups: [], leads: { total: 2 } }).tracking === false);
check("junk numbers are dropped, never trusted", (() => { const r = buildPerformanceSummary({ rollups: [{ page_views: -5, clicks: "9", max_scroll_depth: 900, heatpoint_count: NaN }], leads: { total: "x" } }); return r.page_views === 0 && r.clicks === 0 && r.avg_scroll_depth === null && r.leads === 0; })());
check("it never crashes on odd input", [undefined, null, {}, { rollups: null }, { rollups: "x", leads: 5 }, "nope"].every((v) => { try { return buildPerformanceSummary(v).tracking === false; } catch { return false; } }));

const rec = (summary, health) => buildRecommendations(summary, health);
const base = { tracking: true, page_views: 100, prev_page_views: 100, leads: 3, still_new_leads: 0, avg_scroll_depth: 70 };
check("unanswered inquiries are called out", rec({ ...base, still_new_leads: 2 }).some((t) => /2 inquiries are still marked New/.test(t)));
check("visitors but no inquiries gets a Contact-button suggestion", rec({ ...base, leads: 0 }).some((t) => /nobody sent an inquiry/.test(t)));
check("very few visits suggests sharing the link", rec({ ...base, page_views: 10, prev_page_views: 10 }).some((t) => /few visits/.test(t)));
check("visits up or down by a fifth or more are mentioned with the real percentage", rec({ ...base, page_views: 150 }).some((t) => /up 50%/.test(t)) && rec({ ...base, page_views: 60 }).some((t) => /down 40%/.test(t)) && !rec({ ...base, page_views: 105 }).some((t) => /up|down/.test(t)));
check("low scrolling suggests putting key info near the top", rec({ ...base, avg_scroll_depth: 20 }).some((t) => /do not scroll far/.test(t)));
check("failed site checks are mentioned in client-friendly words", rec(base, { unresolved_checks: 2 }).some((t) => /2 website checks need attention\. The NXQX team is looking into them\./.test(t)));
check("a quiet healthy month still gets one calm line", (() => { const r = rec(base, { unresolved_checks: 0 }); return r.length === 1 && /healthy/.test(r[0]); })());
check("a plan without tracking gets no visit advice at all", !rec({ tracking: false, page_views: 0, leads: 0, still_new_leads: 0 }).some((t) => /visit|scroll/.test(t)));
check("at most 5 suggestions, each short plain text", (() => { const r = rec({ tracking: true, page_views: 10, prev_page_views: 100, leads: 0, still_new_leads: 5, avg_scroll_depth: 10 }, { unresolved_checks: 3 }); return r.length <= 5 && r.every((t) => typeof t === "string" && t.length < 300); })());
check("no promise-words or invented claims in the rule text", !/trusted|guarantee|best|expert|premium|licensed|ranking will|more leads guaranteed/i.test(fs.readFileSync("supabase/functions/_shared/report-insights.mjs", "utf8").replace(/\/\/.*$/gm, "")));

const worker = fs.readFileSync("supabase/functions/run-website-maintenance/index.ts", "utf8");
const wiring = {
  "the worker builds the activity summary and suggestions from real reads": (w) => w.includes("buildPerformanceSummary(") && w.includes("buildRecommendations(") && w.includes("performance_summary: performanceSummary") && w.includes('from("website_analytics_daily_rollups")') && w.includes('from("client_leads")'),
  "a failed read leaves the activity part out instead of claiming zero": (w) => /const activityOk = !thisRollups\.error && !lastRollups\.error && !monthLeads\.error && !lastLeads\.error;/.test(w) && w.includes("activityOk ? performanceSummary : { tracking: false }") && /: \{\};/.test(w),
  "the worker reads only counts (no lead names, emails or messages)": (w) => w.includes('.select("status,urgency")') && !/select\("[^"]*(contact_name|contact_email|contact_phone|message)/.test(w.split("async function monthlyReport")[1].split("Deno.serve")[0]),
};
for (const [name, test] of Object.entries(wiring)) check(name, test(worker));
const plant = (name, from, to, wiringName) => check(`control: ${name}`, worker.includes(from) && !wiring[wiringName](worker.split(from).join(to)));
plant("dropping the saved activity summary is noticed", "performance_summary: performanceSummary,", "", "the worker builds the activity summary and suggestions from real reads");
plant("reading lead contact details into the report is noticed", '.select("status,urgency")', '.select("status,urgency,contact_email")', "the worker reads only counts (no lead names, emails or messages)");
plant("treating a failed read as zero visits is noticed", "const activityOk =", "const activityOk = true || ", "a failed read leaves the activity part out instead of claiming zero");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll report insight checks passed.");
process.exit(failures ? 1 : 0);
