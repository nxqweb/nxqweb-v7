// "Screen attention map" (Intelligence and Enterprise): where visitors' pointers rested on their VISIBLE SCREEN, per page. Positions are stored as fractions of the visitor's screen,
// not of the page (no scroll position is kept), so this is an honest "where on the screen" picture and never called a page heat-map. The numbers come from
// current_client_screen_attention_map (draft migration 13); the database already hides pages under 10 sessions and cells under 3 sessions. Pure functions so tests can pin each case.
export type AttentionCell = { x: number; y: number; points: number };
export type AttentionPage = { path: string; points: number; sessions: number };
export type AttentionMap =
  | { enabled: false; reason: string }
  | { enabled: true; days: number; cols: number; rows: number; pages: AttentionPage[]; page: string | null; points: number; sessions: number; cells: AttentionCell[] };
export type ScreenAttentionGateway = { load(page: string | null, days: number): Promise<AttentionMap> };

export const attentionDayChoices = [7, 30, 90] as const;

export const attentionCopy = {
  title: "Where visitors look on the screen",
  how: "Each square is a part of the visitor's visible screen. Darker means more pointer time there. Positions are of the screen, not of the whole page, so the same square can be different content when people scroll. Only visits where the visitor agreed to tracking are counted.",
  privacy: "To protect visitors, a page only appears after at least 10 different visits, and a square only after at least 3.",
  upgrade: "The screen attention map is included with the Intelligence and Enterprise plans. You can ask for a plan change in Settings.",
  waiting: "The screen attention map appears here once your website is approved and live.",
  off: "Pointer tracking is not switched on for your website yet, so there is nothing to show.",
  empty: "Not enough visits yet. A page shows up here after 10 different visits with tracking allowed.",
  failed: "The screen attention map could not be loaded right now.",
  notOn: "The screen attention map is not switched on yet.",
};

// What the page says for each way the database can answer or refuse.
export function attentionErrorMessage(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : "";
  if (/not included in this plan/i.test(message)) return attentionCopy.upgrade;
  return attentionCopy.failed;
}
export function attentionOffMessage(reason: string): string {
  return reason === "mouse_tracking_off" || reason === "no_analytics_profile" ? attentionCopy.off : attentionCopy.waiting;
}

// Darkness level 0..5 for a cell, relative to the busiest cell on this page. Zero stays 0; any real cell is at least 1 so it never looks empty.
export function attentionLevel(points: number, maxPoints: number): number {
  if (!(points > 0) || !(maxPoints > 0)) return 0;
  return Math.min(5, Math.max(1, Math.ceil((points / maxPoints) * 5)));
}

// A full rows x cols grid of point counts (0 where the database returned no cell). Cells outside the grid are ignored.
export function attentionGrid(cells: AttentionCell[], cols: number, rows: number): number[][] {
  const grid = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (const cell of cells) {
    if (Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.x >= 0 && cell.x < cols && cell.y >= 0 && cell.y < rows && cell.points > 0) grid[cell.y][cell.x] += cell.points;
  }
  return grid;
}

export function attentionHottest(cells: AttentionCell[], cols: number, rows: number): { x: number; y: number; points: number } | null {
  let best: { x: number; y: number; points: number } | null = null;
  const grid = attentionGrid(cells, cols, rows);
  grid.forEach((row, y) => row.forEach((points, x) => { if (points > 0 && (!best || points > best.points)) best = { x, y, points }; }));
  return best;
}

const bands = (count: number, names: [string, string, string]) => (index: number) => names[Math.min(2, Math.floor((index / count) * 3))];
// "top left", "middle", "bottom right": a plain-words place on the visible screen.
export function attentionPlace(x: number, y: number, cols: number, rows: number): string {
  const vertical = bands(rows, ["top", "middle", "bottom"])(y);
  const horizontal = bands(cols, ["left", "centre", "right"])(x);
  if (vertical === "middle" && horizontal === "centre") return "middle of the screen";
  if (vertical === "middle") return `${horizontal} side of the screen`;
  if (horizontal === "centre") return `${vertical} of the screen`;
  return `${vertical} ${horizontal} of the screen`;
}

export function attentionSentence(map: Extract<AttentionMap, { enabled: true }>): string {
  const hottest = attentionHottest(map.cells, map.cols, map.rows);
  const base = `${map.sessions} visit${map.sessions === 1 ? "" : "s"} and ${map.points} pointer readings on ${map.page ?? "this page"} in the last ${map.days} days.`;
  return hottest ? `${base} Most attention: ${attentionPlace(hottest.x, hottest.y, map.cols, map.rows)}.` : base;
}

// Reads the database answer defensively; anything unexpected becomes "not enabled" rather than a crash or an invented picture.
export function parseAttentionMap(raw: unknown): AttentionMap {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (root.enabled !== true) return { enabled: false, reason: typeof root.reason === "string" ? root.reason : "unknown" };
  const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
  return {
    enabled: true, days: num(root.days, 30), cols: num(root.cols, 16), rows: num(root.rows, 10),
    pages: list(root.pages).map((p) => ({ path: typeof p.path === "string" ? p.path : "", points: num(p.points), sessions: num(p.sessions) })).filter((p) => p.path),
    page: typeof root.page === "string" ? root.page : null, points: num(root.points), sessions: num(root.sessions),
    cells: list(root.cells).map((c) => ({ x: num(c.x, -1), y: num(c.y, -1), points: num(c.points) })),
  };
}
