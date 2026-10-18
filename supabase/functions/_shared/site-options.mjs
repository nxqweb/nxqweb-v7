// The website options a client picks in their "Request your website" brief (colour mode, SEO on/off, smooth scrolling), as they travel through the build:
// signed setup report -> prepare-build-plan (plan.site_options) -> build-business-website (site.config.js). Pure functions, no network.
// The label text must match src/lib/websiteBrief.ts (scripts/test-site-options.mjs fails if it drifts).

export const COLOUR_MODES = ["recommend", "dark", "light", "both"];

const LABEL_TO_MODE = new Map([
  ["nxqx recommends", "recommend"],
  ["nxq recommends", "recommend"],
  ["dark", "dark"],
  ["light", "light"],
  ["both (visitors can switch)", "both"],
  ["both", "both"],
]);

export const DEFAULT_SITE_OPTIONS = Object.freeze({ color_mode: "recommend", seo: true, smooth_scroll: true });

function yesNo(value, fallback) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return fallback;
  return !(text === "no" || text === "off" || text === "false");
}

// read(label) returns the saved report text for that label ("" when missing). An old report without the new lines gets the defaults.
export function siteOptionsFromReport(read) {
  const modeText = String(read("Website colour mode") ?? "").trim().toLowerCase();
  return {
    color_mode: LABEL_TO_MODE.get(modeText) ?? DEFAULT_SITE_OPTIONS.color_mode,
    seo: yesNo(read("Search-engine setup (SEO)"), DEFAULT_SITE_OPTIONS.seo),
    smooth_scroll: yesNo(read("Smooth scrolling"), DEFAULT_SITE_OPTIONS.smooth_scroll),
  };
}

// Anything stored in a build plan is untrusted until it is normalized here.
export function normalizeSiteOptions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    color_mode: COLOUR_MODES.includes(source.color_mode) ? source.color_mode : DEFAULT_SITE_OPTIONS.color_mode,
    seo: typeof source.seo === "boolean" ? source.seo : DEFAULT_SITE_OPTIONS.seo,
    smooth_scroll: typeof source.smooth_scroll === "boolean" ? source.smooth_scroll : DEFAULT_SITE_OPTIONS.smooth_scroll,
  };
}

// "NXQX recommends" builds the look the template has had from the start (dark) until a smarter choice exists.
export function resolveColourMode(mode) {
  return mode === "light" || mode === "both" ? mode : "dark";
}
