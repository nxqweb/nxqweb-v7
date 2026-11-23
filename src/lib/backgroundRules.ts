// Rules for a store's own background picture (upload path), decided with the owner 2026-11-23. Pure functions, not wired to any screen yet.
// A background is only a picture file (PNG, JPEG or WEBP; never SVG), is stored at most 2400 px wide, and is dimmed automatically when text on it would be hard to read.
export type BackgroundKind = "png" | "jpeg" | "webp";

export const BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;
export const BACKGROUND_MAX_SIDE = 2400;
export const BACKGROUND_PHONE_WIDTH = 1200;

export function backgroundKind(mime: unknown, fileName: unknown): BackgroundKind | null {
  const type = typeof mime === "string" ? mime.toLowerCase().trim() : "";
  if (type === "image/png") return "png";
  if (type === "image/jpeg" || type === "image/jpg") return "jpeg";
  if (type === "image/webp") return "webp";
  if (type !== "") return null;
  const name = typeof fileName === "string" ? fileName.toLowerCase().trim() : "";
  if (/\.png$/.test(name)) return "png";
  if (/\.jpe?g$/.test(name)) return "jpeg";
  if (/\.webp$/.test(name)) return "webp";
  return null;
}

export type BackgroundSizeAdvice = { level: "great" | "ok" | "small"; mustAcknowledge: boolean; message: string };

export function backgroundSizeAdvice(width: unknown): BackgroundSizeAdvice {
  const w = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : 0;
  if (w >= 2000) return { level: "great", mustAcknowledge: false, message: "Great size for a background." };
  if (w >= 1600) return { level: "ok", mustAcknowledge: false, message: "Good size. A wider picture would look even better on big screens." };
  return { level: "small", mustAcknowledge: true, message: "This picture is small for a background and may look soft on big screens." };
}

export function backgroundCanContinue(input: { kind?: unknown; bytes?: unknown; width?: unknown; rightsConfirmed?: unknown; acknowledgedSmall?: unknown }): { ok: boolean; reason: string } {
  const no = (reason: string) => ({ ok: false, reason });
  if (input?.kind !== "png" && input?.kind !== "jpeg" && input?.kind !== "webp") return no("Please choose a PNG, JPEG or WEBP picture.");
  const bytes = input.bytes;
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return no("That file looks empty.");
  if (bytes > BACKGROUND_MAX_BYTES) return no("That picture is over 10 MB. Please choose a smaller file.");
  if (input.rightsConfirmed !== true) return no("Please confirm the picture is yours to use.");
  if (backgroundSizeAdvice(input.width).mustAcknowledge && input.acknowledgedSmall !== true) return no("This picture is small and may look soft. Tick the box to use it anyway.");
  return { ok: true, reason: "" };
}

// The size a picture is stored at: never wider than 2400 px, never enlarged, same shape.
export function backgroundStoredSize(width: unknown, height: unknown): { width: number; height: number; resized: boolean } | null {
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  if (longest <= BACKGROUND_MAX_SIDE) return { width: Math.round(width), height: Math.round(height), resized: false };
  const scale = BACKGROUND_MAX_SIDE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true };
}

export type Pixels = { width: number; height: number; data: ArrayLike<number> };

// How much white to lay over the picture so dark text stays easy to read: 0 means leave it alone.
// Looks at how dark the picture is and how busy (uneven) it is. Samples a grid, so a big picture is quick.
export function readabilityOverlay(pixels: Pixels): { overlay: number; level: "none" | "light" | "strong"; note: string } {
  const none = { overlay: 0, level: "none" as const, note: "" };
  const { width, height, data } = pixels ?? ({} as Pixels);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !data || data.length < width * height * 4) return none;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 64));
  let n = 0, sum = 0, sumSq = 0;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * 4;
    const alpha = data[i + 3] / 255;
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255 * alpha + (1 - alpha);
    n += 1; sum += l; sumSq += l * l;
  }
  if (n === 0) return none;
  const mean = sum / n, spread = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const fromDark = mean < 0.62 ? (0.62 - mean) / (1 - mean) : 0; // white needed to lift the average to 0.62
  const fromBusy = spread > 0.18 ? Math.min(0.35, (spread - 0.18) * 2) : 0;
  const overlay = Math.min(0.75, 1 - (1 - fromDark) * (1 - fromBusy));
  const rounded = Math.round(overlay * 100) / 100;
  if (rounded < 0.05) return none;
  return rounded >= 0.4
    ? { overlay: rounded, level: "strong", note: "This picture is dark or busy, so it is softened a lot to keep text readable. A lighter, calmer picture will look better." }
    : { overlay: rounded, level: "light", note: "This picture is softened a little so text stays easy to read." };
}
