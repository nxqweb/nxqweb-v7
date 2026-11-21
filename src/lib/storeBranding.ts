// Look-and-feel for a client's public store (colors, heading style, logo). It lives in the database (migration 286: commerce_storefronts.settings -> look, set only by the owner)
// and is read with get_public_store_look. The database already refuses unsafe values; this re-checks them anyway, so a bad row can never put odd styles or an outside image on a shopper's page.
// Anything missing or invalid means the normal warm default theme.
export type StoreBranding = { logo: string | null; serifHeadings: boolean; vars: Record<string, string> };

const colorVars: Record<string, string> = {
  bg: "--store-bg", surface: "--store-surface", tint: "--store-tint", ink: "--store-ink", muted: "--store-muted", line: "--store-line", accent: "--store-accent", accent_dark: "--store-accent-dark",
};
const hex = /^#[0-9a-fA-F]{6}$/;
const logoPath = /^\/brand\/[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|jpeg|webp|svg)$/;

export function storeLookFromRow(row: unknown): StoreBranding | null {
  const source = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
  const vars: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(colorVars)) {
    const value = source[key];
    if (typeof value === "string" && hex.test(value)) vars[cssVar] = value.toLowerCase();
  }
  const logo = typeof source.logo === "string" && logoPath.test(source.logo) && !source.logo.includes("..") ? source.logo : null;
  const serifHeadings = source.heading_font === "serif";
  if (!Object.keys(vars).length && !logo && !serifHeadings) return null;
  return { logo, serifHeadings, vars };
}
