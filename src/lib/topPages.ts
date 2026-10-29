// Combines the per-day `summary.top_pages` lists (written by rollup_website_analytics_day) into one ranked list for the Analytics page.
// Only what the rollups contain is shown: a page below the daily minimum (3 views) is never listed, so totals here can be lower than the
// site-wide total. Old rollups with no top_pages simply contribute nothing.
export type TopPage = { path: string; views: number; clicks: number; maxScroll: number | null };
type DayRollup = { rollup_date: string; summary?: unknown };

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function aggregateTopPages(rows: DayRollup[], days: string[], limit = 10): TopPage[] {
  const inRange = new Set(days);
  const byPath = new Map<string, TopPage>();
  for (const row of rows) {
    if (!inRange.has(row.rollup_date)) continue;
    const summary = row.summary && typeof row.summary === "object" ? row.summary as Record<string, unknown> : null;
    const list = summary && Array.isArray(summary.top_pages) ? summary.top_pages : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const path = typeof entry.path === "string" && entry.path ? entry.path.split(/[?#]/)[0] || "/" : "";
      if (!path) continue;
      const scroll = typeof entry.max_scroll === "number" && Number.isFinite(entry.max_scroll) ? entry.max_scroll : null;
      const current = byPath.get(path) || { path, views: 0, clicks: 0, maxScroll: null };
      current.views += asNumber(entry.views);
      current.clicks += asNumber(entry.clicks);
      if (scroll !== null) current.maxScroll = current.maxScroll === null ? scroll : Math.max(current.maxScroll, scroll);
      byPath.set(path, current);
    }
  }
  return [...byPath.values()].sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)).slice(0, limit);
}
