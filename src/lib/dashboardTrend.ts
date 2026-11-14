// Pure helpers for the daily page-view/click trend shown on the Analytics page and the Business dashboard.
export type Rollup = { rollup_date: string; page_views: number; clicks: number };

export function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// One entry per calendar day ending today. A day with no stored rollup is plotted as 0.
export function lastDays(count: number, nowMs: number) {
  const days: string[] = [];
  const today = new Date(nowMs);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    days.push(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)));
  }
  return days;
}

export function trendSeries(rows: Rollup[], days: string[], field: "page_views" | "clicks") {
  const byDay = new Map(rows.map((row) => [row.rollup_date, row]));
  return days.map((day) => ({ date: day, value: byDay.get(day)?.[field] ?? 0 }));
}

// Compares the most recent 7 days with the 7 before them. Returns null when there is nothing honest to compare
// (previous week had no data), so the page shows no percentage rather than inventing one.
export function weekOverWeek(points: { value: number }[]) {
  if (points.length < 14) return null;
  const recent = points.slice(-7).reduce((sum, point) => sum + point.value, 0);
  const previous = points.slice(-14, -7).reduce((sum, point) => sum + point.value, 0);
  if (previous <= 0) return null;
  return { recent, previous, changePercent: Math.round(((recent - previous) / previous) * 100) };
}
