// Owner-side helpers for setting a store's look (migration 286). The database enforces every rule; the same checks run here only so the page can say what is wrong before saving.
export const lookColorFields = [
  { key: "bg", label: "Page background" }, { key: "surface", label: "Cards" }, { key: "tint", label: "Soft panels" }, { key: "ink", label: "Main text" },
  { key: "muted", label: "Soft text" }, { key: "line", label: "Lines" }, { key: "accent", label: "Buttons" }, { key: "accent_dark", label: "Buttons when pressed" },
] as const;

export type LookDraft = Record<string, string>;
export const defaultLookDraft: LookDraft = { bg: "#faf6ef", surface: "#ffffff", tint: "#f3ebdf", ink: "#3a2e27", muted: "#6b5d52", line: "#e6dccd", accent: "#8a5a3c", accent_dark: "#6f4630", heading_font: "sans", logo: "" };

const hex = /^#[0-9a-f]{6}$/i;
const logoPath = /^\/brand\/[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|jpeg|webp|svg)$/;

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The first problem in plain words, or "" when the look can be saved.
export function lookProblem(draft: LookDraft): string {
  for (const f of lookColorFields) if (!hex.test(draft[f.key] || "")) return `${f.label} must be a color like #1d2f4f.`;
  if (contrastRatio(draft.ink, draft.bg) < 4.5) return "Main text on the page background is hard to read. Pick a darker text or lighter background.";
  if (contrastRatio(draft.muted, draft.bg) < 4.5) return "Soft text on the page background is hard to read.";
  if (contrastRatio(draft.accent, "#ffffff") < 4.5) return "White text on the button color is hard to read. Pick a darker button color.";
  if (contrastRatio(draft.accent_dark, "#ffffff") < 4.5) return "White text on the pressed-button color is hard to read.";
  if (draft.logo && !logoPath.test(draft.logo)) return "The logo must be a file under /brand/, for example /brand/shop-logo.png.";
  return "";
}

export function lookPayload(draft: LookDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of lookColorFields) out[f.key] = draft[f.key].toLowerCase();
  out.heading_font = draft.heading_font === "serif" ? "serif" : "sans";
  if (draft.logo) out.logo = draft.logo;
  return out;
}

export function draftFromRow(row: unknown): LookDraft {
  const source = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
  const out: LookDraft = { ...defaultLookDraft };
  for (const f of lookColorFields) if (typeof source[f.key] === "string" && hex.test(source[f.key] as string)) out[f.key] = source[f.key] as string;
  if (source.heading_font === "serif") out.heading_font = "serif";
  if (typeof source.logo === "string" && logoPath.test(source.logo)) out.logo = source.logo;
  return out;
}
