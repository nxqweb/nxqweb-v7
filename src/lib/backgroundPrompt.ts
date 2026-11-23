// Builds the picture request for a store's own website background (not the logo). Pure text work: nothing is sent anywhere from here.
// Used by hand today (copy the text into an image tool) and by the automatic generator later. Whatever a client typed is cleaned first,
// so it can describe a product but can never add instructions of its own.
export type BackgroundBrief = {
  businessType?: unknown; // e.g. "handmade candles and soap"
  mood?: unknown; // e.g. "calm and warm"
  colors?: { bg?: unknown; tint?: unknown; accent?: unknown };
};

export const BACKGROUND_SIZE = { width: 2400, height: 1400 } as const;

function plain(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[^\p{L}\p{N} ,.'&-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text.length >= 2 ? text : fallback;
}

function hexName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 510, spread = max - min;
  if (spread < 5) return light > 0.9 ? "soft white" : light > 0.6 ? "light gray" : light > 0.3 ? "mid gray" : "charcoal";
  if (light > 0.82) {
    // Pale colors: a small spread is still a real tint (cream, blush, sage, powder blue, lavender), not gray.
    if (max === r) return g >= b ? "cream" : "blush pink";
    if (max === g) return "pale sage green";
    return r > g ? "pale lavender" : "powder blue";
  }
  const tone = light > 0.6 ? "light" : light > 0.35 ? "mid" : "deep";
  let hue: string;
  if (max === r) hue = g >= b ? (g - b > spread * 0.6 ? "yellow" : "warm orange") : b - g > spread * 0.25 ? "rose" : "red";
  else if (max === g) hue = b > r ? "teal" : r > b && r - b > spread * 0.35 ? "yellow-green" : "green";
  else hue = r > g ? "violet" : "blue";
  return `${tone} ${hue}`;
}

export function buildBackgroundPrompt(brief: BackgroundBrief): string {
  const kind = plain(brief?.businessType, 60, "small business");
  const mood = plain(brief?.mood, 40, "calm and welcoming");
  const base = hexName(brief?.colors?.bg, "cream");
  const tint = hexName(brief?.colors?.tint, "pale sage green");
  const accent = hexName(brief?.colors?.accent, "soft warm gold");
  const { width, height } = BACKGROUND_SIZE;
  return [
    `Create a soft, elegant website background image, ${width} by ${height} pixels, for a ${kind} shop.`,
    `Mood: ${mood}. Very light and airy: a ${base} color wash with ${tint} tones, and a subtle bokeh of ${accent} light in the corners.`,
    "Keep the middle of the picture calm and clear so a logo and text sit on top of it easily.",
    "No text, no letters, no logos, no watermarks, no people, no hands and no objects. Low contrast. Soft and blurred, not busy.",
  ].join(" ");
}
