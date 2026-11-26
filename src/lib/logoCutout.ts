// Turns a logo that sits on a plain (usually white) background into a transparent one, automatically, so nobody has to ask a client for a
// "transparent PNG". Only the background that touches the picture's edges is removed (a flood fill), so white INSIDE the logo (a jar's glow,
// white letters) stays. Soft edges are kept: pixels along the border get partial transparency and their color is "un-blended" from the
// background, so there is no white halo on a cream page. If the picture does not look like "logo on a plain background" it is left alone.
// Pure functions work on raw pixels (RGBA bytes), so they are easy to test; the browser part is at the bottom and never throws.

export type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type CutoutResult = { ok: boolean; reason: string; removedShare: number };

const FLOOD_TOLERANCE = 28; // how close to the background color a pixel must be to count as background (largest single-channel difference, 0-255)
const EDGE_REACH = 2; // how many pixels outside the removed area get soft edges
const EDGE_FULL = 110; // used only when no solid logo pixel is found nearby
const SOLID_SEARCH = 6; // how far to look for the logo's own color
const MIN_REMOVED = 0.04; // less than 4% removed: there was no real plain background
const MAX_REMOVED = 0.93; // more than 93% removed: the "logo" is almost all background, something is off

const diff = (d: Uint8ClampedArray, i: number, bg: [number, number, number]) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));

// Works in place on img.data. Returns whether it changed anything and why not.
export function cutOutBackground(img: Pixels): CutoutResult {
  const { width: w, height: h, data: d } = img;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || d.length !== w * h * 4) return { ok: false, reason: "bad-size", removedShare: 0 };
  const at = (x: number, y: number) => (y * w + x) * 4;

  // 1. The four corners must all be opaque and nearly the same color: that color is the background.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.some((i) => d[i + 3] < 250)) return { ok: false, reason: "already-transparent", removedShare: 0 };
  const bg: [number, number, number] = [0, 1, 2].map((c) => Math.round(corners.reduce((sum, i) => sum + d[i + c], 0) / 4)) as [number, number, number];
  if (corners.some((i) => diff(d, i, bg) > 20)) return { ok: false, reason: "busy-background", removedShare: 0 };

  // 2. Flood fill from every edge pixel through pixels close to the background color.
  const gone = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => { const p = y * w + x; if (!gone[p] && diff(d, p * 4, bg) <= FLOOD_TOLERANCE) { gone[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop() as number; const x = p % w; const y = (p - x) / w;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  let removed = 0;
  for (let p = 0; p < gone.length; p++) if (gone[p]) removed++;
  const share = removed / (w * h);
  if (share < MIN_REMOVED) return { ok: false, reason: "no-plain-background", removedShare: share };
  if (share > MAX_REMOVED) return { ok: false, reason: "almost-all-background", removedShare: share };

  // 3. Soft edges: pixels within EDGE_REACH of the removed area are a mix of logo and background. Find the logo color just inside (the nearest solid
  //    pixel), work out how much of the pixel is logo (alpha) from how far it sits between background and that color, then un-blend the background.
  const nearGone = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (gone[p]) continue;
    outer: for (let dy = -EDGE_REACH; dy <= EDGE_REACH; dy++) for (let dx = -EDGE_REACH; dx <= EDGE_REACH; dx++) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && gone[ny * w + nx]) { nearGone[p] = 1; break outer; }
    }
  }
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; const i = p * 4;
    if (gone[p]) { out[i + 3] = 0; continue; }
    if (!nearGone[p]) continue;
    // nearest solid pixel (not removed, not itself on the edge), searching outward ring by ring
    let fg: number | null = null;
    for (let r = 1; r <= SOLID_SEARCH && fg === null; r++) {
      for (let dy = -r; dy <= r && fg === null; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (!gone[q] && !nearGone[q]) { fg = q * 4; break; }
      }
    }
    const dist = diff(d, i, bg);
    const full = fg === null ? EDGE_FULL : Math.max(diff(d, fg, bg), 1);
    // a logo color that is itself almost the background color (a very light logo) gives no way to tell the two apart: keep the pixel as it is
    if (full < 40) continue;
    const alpha = Math.min(1, Math.max(0.12, dist / full));
    if (alpha >= 1) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - bg[c] * (1 - alpha)) / alpha)));
    out[i + 3] = Math.round(alpha * 255);
  }
  d.set(out);
  return { ok: true, reason: "cut", removedShare: share };
}

// The rectangle that holds every visible (not transparent) pixel, or null when nothing is visible.
export function visibleBox(img: Pixels, minAlpha = 12): { left: number; top: number; right: number; bottom: number } | null {
  const { width: w, height: h, data: d } = img;
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > minAlpha) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

// Where the logo's picture part (a candle, a tree, a monogram) ends and its wordmark text begins: the first wide empty horizontal band that has
// a real picture above it. Returns the first row of that band, or null when the logo has no such split (then no icon is made).
export function markEndRow(img: Pixels, minAlpha = 12): number | null {
  const { width: w, height: h, data: d } = img;
  const empty: boolean[] = [];
  for (let y = 0; y < h; y++) { let any = false; for (let x = 0; x < w && !any; x++) if (d[(y * w + x) * 4 + 3] > minAlpha) any = true; empty.push(!any); }
  const minGap = Math.max(3, Math.round(h * 0.04));
  let y = 0;
  while (y < h) {
    if (!empty[y]) { y++; continue; }
    let end = y; while (end < h && empty[end]) end++;
    const above = y; const below = h - end;
    if (end - y >= minGap && above >= h * 0.35 && above <= h * 0.85 && below >= h * 0.08) return y;
    y = end;
  }
  return null;
}

// Unsharp mask for a logo that was enlarged: adds back edge contrast the smooth enlargement softened. Works on color only; transparency is untouched.
// amount 0 changes nothing; 0.6 to 1 is a clear but natural boost. Returns a new array.
export function sharpen(img: Pixels, amount = 0.7): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img;
  const out = new Uint8ClampedArray(d);
  if (!(amount > 0) || w < 3 || h < 3 || d.length !== w * h * 4) return out;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 8) continue;
    for (let c = 0; c < 3; c++) {
      const blur = (d[i + c] * 4 + d[i - 4 + c] + d[i + 4 + c] + d[i - w * 4 + c] + d[i + w * 4 + c]) / 8;
      out[i + c] = Math.max(0, Math.min(255, Math.round(d[i + c] + (d[i + c] - blur) * amount * 2)));
    }
  }
  return out;
}

// ---- browser part -------------------------------------------------------------------------------------------------------------------------

const MAX_SIDE = 1600;
const UPSCALE_TARGET = 900;
// How large (CSS pixels) to show a logo so it still looks sharp: twice its real visible width (sharp screens show two device pixels per CSS pixel),
// never below 220 and never above 900. A small file stays small and crisp; a big, sharp file automatically gets to show large. No per-client setting.
export function crispLogoSize(visibleWidth: number): number {
  const width = Number.isFinite(visibleWidth) && visibleWidth > 0 ? visibleWidth : 0;
  return Math.min(900, Math.max(220, Math.round(width * 2)));
}

export type CutoutLogo = { full: string; mark: string | null; size: number };
const cache = new Map<string, Promise<CutoutLogo | null>>();
const CACHE_PREFIX = "nxq-logo-cut-v1:";
const CACHE_MAX_CHARS = 1_200_000; // a cleaned logo is a few hundred KB; anything bigger is not stored

// What was stored earlier in this browser tab, re-checked (browser storage can hold anything). Returns null when it is missing or not exactly what we wrote.
export function parseCachedCutout(raw: unknown): CutoutLogo | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > CACHE_MAX_CHARS + 2000) return null;
  try {
    const row = JSON.parse(raw) as Record<string, unknown>;
    const png = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length <= CACHE_MAX_CHARS;
    if (!png(row.full)) return null;
    const mark = row.mark === null ? null : png(row.mark) ? row.mark : undefined;
    const size = typeof row.size === "number" && Number.isFinite(row.size) && row.size >= 220 && row.size <= 900 ? row.size : null;
    if (mark === undefined || size === null) return null;
    return { full: row.full, mark, size };
  } catch { return null; }
}

const toCanvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// A transparent, trimmed version of the logo, plus (when the logo has a picture above its text) just the picture as a small icon. Null when
// not possible or not needed: the page then uses the original picture. Never throws.
export function cutoutLogo(url: string): Promise<CutoutLogo | null> {
  if (typeof document === "undefined" || !url) return Promise.resolve(null);
  const known = cache.get(url);
  if (known) return known;
  const job = (async (): Promise<CutoutLogo | null> => {
    try {
      // Remembered for this browser tab only (sessionStorage), so moving between store pages is instant and a changed logo is picked up on the next visit.
      try { const hit = parseCachedCutout(window.sessionStorage.getItem(CACHE_PREFIX + url)); if (hit) return hit; } catch { /* storage unavailable: just compute */ }
      const img = new Image();
      img.decoding = "async";
      if (/^https:/i.test(url)) img.crossOrigin = "anonymous"; // an uploaded logo lives on another address; without this the picture cannot be read back and the original is shown instead
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale)); const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = toCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);
      const result = cutOutBackground({ width, height, data: pixels.data });
      if (!result.ok) return null;
      ctx.putImageData(pixels, 0, 0);
      // Trim the empty transparent margin around the logo (a logo file is often a square with a lot of blank space), keeping a small border.
      const box = visibleBox(pixels);
      let current = canvas;
      if (box) {
        const pad = Math.round(Math.max(box.right - box.left, box.bottom - box.top) * 0.03);
        const left = Math.max(0, box.left - pad); const top = Math.max(0, box.top - pad);
        const cw = Math.min(width, box.right + pad) - left; const ch = Math.min(height, box.bottom + pad) - top;
        if (cw > 8 && ch > 8 && (cw < width || ch < height)) {
          const trimmed = toCanvas(cw, ch);
          const tctx = trimmed.getContext("2d");
          if (tctx) { tctx.drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch); current = trimmed; }
        }
      }
      // The icon alone (the part above the wordmark), for the small header spot.
      let mark: string | null = null;
      try {
        const cctx = current.getContext("2d", { willReadFrequently: true });
        const cpx = cctx ? cctx.getImageData(0, 0, current.width, current.height) : null;
        const cut = cpx ? markEndRow({ width: current.width, height: current.height, data: cpx.data }) : null;
        if (cctx && cpx && cut) {
          const top = { width: current.width, height: cut, data: cpx.data.slice(0, current.width * cut * 4) };
          const tb = visibleBox(top);
          if (tb && tb.right - tb.left > 8 && tb.bottom - tb.top > 8) {
            let m = toCanvas(tb.right - tb.left, tb.bottom - tb.top);
            const mctx = m.getContext("2d");
            if (mctx) {
              mctx.drawImage(current, tb.left, tb.top, m.width, m.height, 0, 0, m.width, m.height);
              while (m.width < 200) { const b = toCanvas(m.width * 2, m.height * 2); const bctx = b.getContext("2d"); if (!bctx) break; bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high"; bctx.drawImage(m, 0, 0, b.width, b.height); m = b; }
              mark = m.toDataURL("image/png");
            }
          }
        }
      } catch { mark = null; }
      const size = crispLogoSize(current.width); // measured on the trimmed logo at its real resolution, before any enlarging
      // The logo is shown big (up to ~660 px). A small file is enlarged in smooth doubling steps so its edges are not blocky; detail still cannot be added.
      while (current.width < UPSCALE_TARGET && current.width * 2 <= MAX_SIDE) {
        const bigger = toCanvas(current.width * 2, current.height * 2);
        const bctx = bigger.getContext("2d");
        if (!bctx) break;
        bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
        bctx.drawImage(current, 0, 0, bigger.width, bigger.height);
        current = bigger;
      }
      try {
        const sctx = current.getContext("2d", { willReadFrequently: true });
        if (sctx) { const sp = sctx.getImageData(0, 0, current.width, current.height); sp.data.set(sharpen({ width: current.width, height: current.height, data: sp.data }, 0.8)); sctx.putImageData(sp, 0, 0); }
      } catch { /* keep the unsharpened picture */ }
      const finished: CutoutLogo = { full: current.toDataURL("image/png"), mark, size };
      try { const text = JSON.stringify(finished); if (text.length <= CACHE_MAX_CHARS) window.sessionStorage.setItem(CACHE_PREFIX + url, text); } catch { /* storage full or blocked: fine */ }
      return finished;
    } catch { return null; }
  })();
  cache.set(url, job);
  return job;
}

// Kept for callers that only need the full transparent logo.
export async function cutoutLogoUrl(url: string): Promise<string | null> { return (await cutoutLogo(url))?.full ?? null; }
