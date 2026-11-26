// The rules for a client's logo upload (decided with the owner 2026-11-21). Pure functions only: nothing here is wired to a page, a database or storage yet.
// It waits for the logo upload screen, which needs a database change (built after the QA window). Everything is written and tested now so that screen is quick to build.
//
// The rules: use the client's OWN logo, as big as they have it. SVG is best. A PNG or JPG at least 2000 px wide is ideal; 1000 to 1999 px is fine with a gentle note;
// under 1000 px is a WARNING, never a block (the client may continue after ticking that they understand it may look soft). A rights tick is required.

export const logoStoredMaxSide = 2400; // stored at most this many pixels on the longest side
export const logoIdealWidth = 2000;
export const logoMinimumWidth = 1000;
export const logoMaxFileBytes = 10 * 1024 * 1024; // refuse anything over 10 MB before reading it
export const svgMaxBytes = 1024 * 1024; // an SVG logo over 1 MB is not a logo

export type LogoKind = "svg" | "png" | "jpeg" | "webp";
export type LogoSizeLevel = "great" | "ok" | "small";
export type LogoSizeAdvice = { level: LogoSizeLevel; mustAcknowledge: boolean; message: string };

// What kind of logo file this is, from its declared type and name. Anything else (GIF, PDF, HEIC, ...) is not accepted as a logo.
export function logoKind(mimeType: unknown, fileName: unknown): LogoKind | null {
  const type = typeof mimeType === "string" ? mimeType.toLowerCase().trim() : "";
  const name = typeof fileName === "string" ? fileName.toLowerCase().trim() : "";
  if (type === "image/svg+xml" || (type === "" && name.endsWith(".svg"))) return "svg";
  if (type === "image/png" || (type === "" && name.endsWith(".png"))) return "png";
  if (type === "image/jpeg" || type === "image/jpg" || (type === "" && /\.jpe?g$/.test(name))) return "jpeg";
  if (type === "image/webp" || (type === "" && name.endsWith(".webp"))) return "webp";
  return null;
}

// Plain-words advice for the width of the picture (in pixels). An SVG is always great because it is sharp at any size.
export function logoSizeAdvice(kind: LogoKind, width: unknown): LogoSizeAdvice {
  if (kind === "svg") return { level: "great", mustAcknowledge: false, message: "An SVG logo stays sharp at any size. Perfect." };
  const w = typeof width === "number" && Number.isFinite(width) ? width : 0;
  if (w >= logoIdealWidth) return { level: "great", mustAcknowledge: false, message: "Great: this logo is big enough to look sharp everywhere." };
  if (w >= logoMinimumWidth) return { level: "ok", mustAcknowledge: false, message: "This will look good. A bigger file (2000 pixels wide or more) looks even better." };
  return { level: "small", mustAcknowledge: true, message: "This logo is small and will look soft on big screens. Upload a larger one if you can, or tick the box to continue anyway." };
}

// Can the client continue? Size is never a block; the rights tick always is. `acknowledgedSmall` is the "I understand it may look soft" tick.
export function logoCanContinue(input: { kind: LogoKind | null; bytes: number; width: number; rightsConfirmed: boolean; acknowledgedSmall: boolean }): { ok: boolean; reason: string } {
  if (!input.kind) return { ok: false, reason: "Please choose a PNG, JPG, WEBP or SVG logo." };
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) return { ok: false, reason: "That file looks empty." };
  if (input.bytes > logoMaxFileBytes) return { ok: false, reason: "That file is over 10 MB. Please choose a smaller one." };
  if (input.kind === "svg" && input.bytes > svgMaxBytes) return { ok: false, reason: "That SVG is too large to be a logo." };
  if (input.rightsConfirmed !== true) return { ok: false, reason: "Please tick the box to confirm this is your logo, or that you have permission to use it." };
  const advice = logoSizeAdvice(input.kind, input.width);
  if (advice.mustAcknowledge && input.acknowledgedSmall !== true) return { ok: false, reason: advice.message };
  return { ok: true, reason: "" };
}

// SVG safety: an SVG can carry scripts. We REFUSE unsafe SVGs instead of trying to clean them (cleaning is easy to get wrong).
// Returns the list of problems; an empty list means it passed.
export function svgProblems(text: unknown): string[] {
  const problems: string[] = [];
  if (typeof text !== "string" || text.trim() === "") return ["The SVG is empty."];
  if (text.length > svgMaxBytes) problems.push("The SVG is too large.");
  const lower = text.toLowerCase();
  if (!/<svg[\s>]/.test(lower)) problems.push("This is not an SVG picture.");
  if (/<script[\s>]/.test(lower)) problems.push("The SVG contains a script.");
  if (/<foreignobject[\s>]/.test(lower)) problems.push("The SVG contains embedded web content.");
  if (/<(iframe|embed|object|audio|video|animate|set|use)[\s>/]/.test(lower)) problems.push("The SVG contains an element that is not allowed.");
  if (/\son[a-z]+\s*=/.test(lower)) problems.push("The SVG contains an event handler.");
  if (/javascript\s*:|data\s*:\s*text\/html|vbscript\s*:/.test(lower)) problems.push("The SVG contains a script link.");
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//.test(lower)) problems.push("The SVG loads something from the internet.");
  if (/@import|url\(\s*["']?\s*(?:https?:)?\/\//.test(lower)) problems.push("The SVG loads a style or picture from the internet.");
  if (/<!entity|<!doctype[^>]*\[/.test(lower)) problems.push("The SVG contains a custom definition that is not allowed.");
  if (!/viewbox\s*=|(?:\swidth\s*=[^>]*\sheight\s*=|\sheight\s*=[^>]*\swidth\s*=)/.test(lower)) problems.push("The SVG has no size information.");
  return problems;
}

// The size to store a picture at: never enlarged, shrunk so the longest side is at most logoStoredMaxSide, shape kept.
export function logoStoredSize(width: number, height: number): { width: number; height: number; resized: boolean } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const longest = Math.max(width, height);
  if (longest <= logoStoredMaxSide) return { width: Math.round(width), height: Math.round(height), resized: false };
  const scale = logoStoredMaxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true };
}
