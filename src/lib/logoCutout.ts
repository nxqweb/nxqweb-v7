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

// ---- browser part -------------------------------------------------------------------------------------------------------------------------

const MAX_SIDE = 1600;
const cache = new Map<string, Promise<string | null>>();

// A transparent version of the logo as a data URL, or null when it is not possible or not needed (the page then uses the original picture).
export function cutoutLogoUrl(url: string): Promise<string | null> {
  if (typeof document === "undefined" || !url) return Promise.resolve(null);
  const known = cache.get(url);
  if (known) return known;
  const job = (async () => {
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale)); const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);
      const result = cutOutBackground({ width, height, data: pixels.data });
      if (!result.ok) return null;
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    } catch { return null; }
  })();
  cache.set(url, job);
  return job;
}
