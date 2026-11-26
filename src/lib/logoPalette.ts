// Automatic store colors from the client's own logo (owner decision 2026-11-24: nobody should have to set colors by hand per client).
// Two steps: find the logo's main brand color, then build a full, readable palette from it. Everything here is pure arithmetic except the last function,
// which loads the logo picture in the browser. The palette only ever applies when the owner has NOT set colors for the store (see PublicCommerceStorefront).
// Readability is guaranteed by construction and by tests for every hue: the same contrast rules the database enforces on an owner's colors.
import { contrastRatio } from "./storeLookAdmin.ts";

type Hsl = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360, ss = Math.min(1, Math.max(0, s)), ll = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = ll - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

const hexRe = /^#[0-9a-f]{6}$/i;
function hexToHsl(hex: string): Hsl | null {
  if (!hexRe.test(hex)) return null;
  return rgbToHsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}

// The logo's main brand color as a hex, or null when it has none (black, white, gray or a near-empty picture): then the store keeps its normal colors.
// Looks only at solid (non-see-through), saturated, not-too-dark and not-too-light pixels, grouped by hue, so white or cream backgrounds and black text never win.
export function dominantAccent(data: ArrayLike<number>, width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !data || data.length < width * height * 4) return null;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)));
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) continue;
    opaque += 1;
    const hsl = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (hsl.l < 0.15 || hsl.l > 0.92 || hsl.s < 0.35) continue;
    const k = Math.floor(hsl.h / 15) % 24, w = hsl.s;
    buckets[k].w += w; buckets[k].r += data[i] * w; buckets[k].g += data[i + 1] * w; buckets[k].b += data[i + 2] * w;
  }
  if (opaque === 0) return null;
  let best = 0;
  for (let k = 1; k < 24; k += 1) if (buckets[k].w > buckets[best].w) best = k;
  const b = buckets[best];
  if (b.w < opaque * 0.015) return null; // too little real color to call it a brand color
  const hsl = rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w);
  return hslToHex(hsl.h, hsl.s, hsl.l);
}

const VAR_KEYS = ["--store-bg", "--store-surface", "--store-tint", "--store-ink", "--store-muted", "--store-line", "--store-accent", "--store-accent-dark"] as const;

// A full palette (the same variables the store page uses) from one brand color. Returns null for anything that is not a normal hex color.
export function autoLookVars(accentHex: unknown): Record<string, string> | null {
  const base = typeof accentHex === "string" ? hexToHsl(accentHex) : null;
  if (!base) return null;
  const { h } = base;
  const accentS = Math.min(0.85, Math.max(0.38, base.s));
  let accentL = Math.min(0.46, base.l);
  let accent = hslToHex(h, accentS, accentL);
  while (contrastRatio(accent, "#ffffff") < 4.6 && accentL > 0.12) { accentL -= 0.01; accent = hslToHex(h, accentS, accentL); } // white button text must stay readable
  const accentDark = hslToHex(h, accentS, Math.max(0.1, accentL - 0.09));
  const bg = hslToHex(h, 0.42, 0.97);
  const tint = hslToHex(h, 0.38, 0.93);
  const line = hslToHex(h, 0.28, 0.86);
  let inkL = 0.17; let ink = hslToHex(h, 0.45, inkL);
  while ((contrastRatio(ink, bg) < 7 || contrastRatio(ink, tint) < 7) && inkL > 0.03) { inkL -= 0.01; ink = hslToHex(h, 0.45, inkL); }
  let mutedL = 0.38; let muted = hslToHex(h, 0.22, mutedL);
  while ((contrastRatio(muted, bg) < 4.8 || contrastRatio(muted, tint) < 4.6) && mutedL > 0.08) { mutedL -= 0.01; muted = hslToHex(h, 0.22, mutedL); }
  const out: Record<string, string> = { "--store-bg": bg, "--store-surface": "#ffffff", "--store-tint": tint, "--store-ink": ink, "--store-muted": muted, "--store-line": line, "--store-accent": accent, "--store-accent-dark": accentDark };
  for (const k of VAR_KEYS) if (!hexRe.test(out[k])) return null;
  return out;
}

// ---- browser part ----
const cache = new Map<string, Promise<string | null>>();
const KEY = "nxq-logo-accent-v1:";

// Reads the logo picture (downscaled, so it is quick) and returns its brand color, or null. Remembered for this browser tab. Never throws.
export function accentFromLogoUrl(url: string): Promise<string | null> {
  if (typeof document === "undefined" || !url) return Promise.resolve(null);
  const known = cache.get(url);
  if (known) return known;
  const job = (async (): Promise<string | null> => {
    try {
      try { const hit = window.sessionStorage.getItem(KEY + url); if (hit && hexRe.test(hit)) return hit; if (hit === "none") return null; } catch { /* storage unavailable */ }
      const img = new Image();
      img.decoding = "async";
      if (/^https:/i.test(url)) img.crossOrigin = "anonymous";
      img.src = url;
      await img.decode();
      const scale = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const found = dominantAccent(ctx.getImageData(0, 0, w, h).data, w, h);
      try { window.sessionStorage.setItem(KEY + url, found ?? "none"); } catch { /* fine */ }
      return found;
    } catch { return null; }
  })();
  cache.set(url, job);
  return job;
}
