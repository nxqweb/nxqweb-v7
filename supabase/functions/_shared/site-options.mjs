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

// Options that must be visible WITHOUT running any script are written into the page itself when it is built:
//  - SEO off: a static noindex tag (the template also adds one at run time, but a crawler that does not run scripts must see it too);
//  - Light only: data-mode="light" on <html> and the light browser theme colour, so the first paint is already light (no dark flash).
// "Both" is decided in the visitor's browser (their system setting and saved choice); no inline script is possible under the site's content security policy.
// Each change needs its anchor text to exist exactly once; if the template changes and an anchor is missing, the page is left untouched rather than guessed at.
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';
const HTML_TAG = '<html lang="en">';
const THEME_COLOR = '<meta name="theme-color" content="#070b12" />';
const once = (html, needle) => html.split(needle).length === 2;

export function applyStaticOptions(html, options) {
  if (typeof html !== "string") return html;
  const opts = normalizeSiteOptions(options);
  let out = html;
  if (!opts.seo && !/name="robots"/i.test(out) && once(out, VIEWPORT)) {
    out = out.replace(VIEWPORT, `${VIEWPORT}\n    <meta name="robots" content="noindex, nofollow" />`);
  }
  if (resolveColourMode(opts.color_mode) === "light" && once(out, HTML_TAG) && once(out, THEME_COLOR)) {
    out = out.replace(HTML_TAG, '<html lang="en" data-mode="light">').replace(THEME_COLOR, '<meta name="theme-color" content="#f5f6fa" />');
  }
  return out;
}

// The builder moves templates around as base64 text (the GitHub contents API); this applies the options to such a file.
export function applyStaticOptionsToBase64(base64, options) {
  const binary = atob(String(base64).replace(/\s/g, ""));
  const text = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  const changed = applyStaticOptions(text, options);
  if (changed === text) return base64;
  const bytes = new TextEncoder().encode(changed);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
