// Offline test: the Analytics "Top pages" view shows only what the rollups contain, merges days, and never leaks query strings.
import fs from "node:fs";
import { aggregateTopPages } from "../src/lib/topPages.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const days = ["2026-10-07", "2026-10-08", "2026-10-09"];
const rows = [
  { rollup_date: "2026-10-09", summary: { top_pages: [{ path: "/a", views: 5, clicks: 2, max_scroll: 60 }, { path: "/b", views: 3, clicks: 0, max_scroll: null }] } },
  { rollup_date: "2026-10-08", summary: { top_pages: [{ path: "/a", views: 4, clicks: 1, max_scroll: 90 }, { path: "/c", views: 10, clicks: 3, max_scroll: 20 }] } },
  { rollup_date: "2026-10-01", summary: { top_pages: [{ path: "/old", views: 99, clicks: 9, max_scroll: 100 }] } },
  { rollup_date: "2026-10-07", summary: { source: "privacy_safe_raw_events" } },
  { rollup_date: "2026-10-06" },
];
const result = aggregateTopPages(rows, days);
check("days are merged per page and ordered by views", result.map((p) => p.path).join(",") === "/c,/a,/b" && result[1].views === 9 && result[1].clicks === 3);
check("deepest scroll is the maximum across days, and null stays null", result[1].maxScroll === 90 && result[2].maxScroll === null);
check("days outside the selected range are ignored", !result.some((p) => p.path === "/old"));
check("old rollups with no top_pages contribute nothing (no invented rows)", aggregateTopPages([{ rollup_date: "2026-10-07", summary: { source: "x" } }, { rollup_date: "2026-10-07" }], days).length === 0);
check("malformed entries are skipped", aggregateTopPages([{ rollup_date: "2026-10-07", summary: { top_pages: [null, 5, { path: "" }, { views: 4 }, { path: "/ok", views: "many" }] } }], days).map((p) => p.path).join(",") === "/ok");
check("a query string that slipped through is cut off", aggregateTopPages([{ rollup_date: "2026-10-07", summary: { top_pages: [{ path: "/x?email=a@b.c", views: 3, clicks: 0, max_scroll: null }] } }], days)[0].path === "/x");
check("result is capped at 10 pages", aggregateTopPages([{ rollup_date: "2026-10-07", summary: { top_pages: Array.from({ length: 15 }, (_, i) => ({ path: `/p${i}`, views: 3 + i, clicks: 0, max_scroll: null })) } }], days).length === 10);

const page = fs.readFileSync("src/pages/ClientBusinessAnalytics.tsx", "utf8");
check("Analytics page reads the rollup summary column", page.includes('"rollup_date,page_views,clicks,max_scroll_depth,heatpoint_count,summary"'));
check("Analytics page renders a Top pages table with an honest empty state", page.includes("<h2>Top pages</h2>") && page.includes("No page-level data yet."));
check("Analytics page explains the 3-view privacy minimum", page.includes("fewer than 3 views in a day"));
check("Top pages sits inside the plan-gated analytics block", page.indexOf("<h2>Top pages</h2>") > page.indexOf("analyticsAccess.allowed ? <>"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll top-pages checks passed (offline).");
process.exit(failures ? 1 : 0);
