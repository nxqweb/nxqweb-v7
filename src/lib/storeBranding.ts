// Look-and-feel for a client's public store (colors, heading font, logo). Today only "Light of the World Candles and Soap" has one; every other shop keeps the warm default theme.
// The match is on the start of the store address, which comes from the shop name, so it needs no database change. Colors were checked for readable text on their backgrounds.
export type StoreBranding = { logo: string; vars: Record<string, string> };

const lightOfTheWorld: StoreBranding = {
  logo: "/brand/light-of-the-world-logo.png",
  vars: {
    "--store-bg": "#fdf9f6", "--store-surface": "#ffffff", "--store-tint": "#f8ece8", "--store-ink": "#1d2f4f", "--store-muted": "#4f5b73", "--store-line": "#eaddd8",
    "--store-accent": "#a8284f", "--store-accent-dark": "#861f3e",
  },
};

export function storeBrandingFor(slug: string): StoreBranding | null {
  return String(slug || "").toLowerCase().startsWith("light-of-the-world") ? lightOfTheWorld : null;
}
