// Offline test: automatic store colors from the client's own logo (src/lib/logoPalette.ts), owner decision 2026-11-24.
import fs from "node:fs";
import { autoLookVars, dominantAccent } from "../src/lib/logoPalette.ts";
import { contrastRatio } from "../src/lib/storeLookAdmin.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

function image(w, h, bg, paint = () => {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = bg[3] ?? 255; }
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] ?? 255; } };
  paint(rect);
  return { w, h, data };
}
const hue = (hex) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d === 0) return -1; const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (hh * 60 + 360) % 360; };
const near = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 12;
const pick = (img) => dominantAccent(img.data, img.w, img.h);

let img = image(100, 100, [255, 255, 255], (r) => r(20, 20, 80, 80, [200, 30, 60]));
check("a red logo on white gives a red accent (the white is ignored)", near(hue(pick(img)), 348) || near(hue(pick(img)), 350) || near(hue(pick(img)), 0), pick(img));
img = image(100, 100, [250, 246, 239], (r) => r(10, 10, 90, 90, [30, 140, 50]));
check("a green logo on a cream background gives a green accent (the cream is ignored)", near(hue(pick(img)), 130), pick(img));
img = image(100, 100, [0, 0, 0, 0], (r) => r(20, 20, 80, 80, [110, 50, 180]));
check("a transparent logo works too (see-through pixels are skipped)", near(hue(pick(img)), 268), pick(img));
check("black, white, gray and an empty picture have no brand color (the store keeps its normal colors)", [[0, 0, 0], [255, 255, 255], [128, 128, 128], [30, 30, 30]].every((c) => pick(image(80, 80, c)) === null) && pick(image(50, 50, [0, 0, 0, 0])) === null && pick(image(100, 100, [255, 255, 255], (r) => r(10, 10, 90, 90, [20, 20, 20]))) === null);
img = image(200, 200, [255, 255, 255], (r) => r(95, 95, 99, 99, [200, 30, 60]));
check("a tiny speck of color is not a brand color", pick(img) === null, pick(img));
img = image(200, 200, [255, 255, 255], (r) => { r(10, 10, 130, 90, [30, 70, 200]); r(150, 150, 170, 160, [200, 30, 60]); });
check("the biggest real color wins over a small accent", near(hue(pick(img)), 222), pick(img));
check("odd input never throws and gives nothing", [[undefined, 1, 1], [new Uint8ClampedArray(3), 10, 10], [new Uint8ClampedArray(400), 0, 10], [new Uint8ClampedArray(400), 2.5, 2], [null, 5, 5]].every(([d, w, h]) => dominantAccent(d, w, h) === null));

// Readability for EVERY hue: the same rules the database enforces on an owner's colors, plus the soft panels.
let worst = { accent: 99, dark: 99, ink: 99, inkTint: 99, muted: 99, mutedTint: 99 }; let valid = true; let count = 0;
const hexOf = (h, s, l) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join(""); };
for (let h = 0; h < 360; h += 3) for (const s of [0.35, 0.6, 0.95]) for (const l of [0.2, 0.35, 0.5, 0.65, 0.8]) {
  const v = autoLookVars(hexOf(h, s, l)); count += 1;
  if (!v) { valid = false; continue; }
  worst.accent = Math.min(worst.accent, contrastRatio(v["--store-accent"], "#ffffff")); worst.dark = Math.min(worst.dark, contrastRatio(v["--store-accent-dark"], "#ffffff"));
  worst.ink = Math.min(worst.ink, contrastRatio(v["--store-ink"], v["--store-bg"])); worst.inkTint = Math.min(worst.inkTint, contrastRatio(v["--store-ink"], v["--store-tint"]));
  worst.muted = Math.min(worst.muted, contrastRatio(v["--store-muted"], v["--store-bg"])); worst.mutedTint = Math.min(worst.mutedTint, contrastRatio(v["--store-muted"], v["--store-tint"]));
}
check(`every one of ${count} brand colors across the whole wheel gives a palette`, valid);
check("white button text on the accent and on the pressed accent is always readable (at least 4.5)", worst.accent >= 4.5 && worst.dark >= 4.5, JSON.stringify(worst));
check("main text on the page and on soft panels is always very readable (at least 7)", worst.ink >= 7 && worst.inkTint >= 7, JSON.stringify(worst));
check("soft text on the page and on soft panels is always readable (at least 4.5)", worst.muted >= 4.5 && worst.mutedTint >= 4.5, JSON.stringify(worst));
const v = autoLookVars("#a8284f");
check("the palette has exactly the store's eight color variables, all real hex colors, with a white card color and a very light page", Object.keys(v).sort().join() === "--store-accent,--store-accent-dark,--store-bg,--store-ink,--store-line,--store-muted,--store-surface,--store-tint" && Object.values(v).every((c) => /^#[0-9a-f]{6}$/.test(c)) && v["--store-surface"] === "#ffffff" && contrastRatio(v["--store-bg"], "#ffffff") < 1.15);
const same = fs.readFileSync("src/lib/storeBranding.ts", "utf8");
check("those variable names are the ones the store page already uses for an owner's colors", Object.keys(v).every((k) => same.includes(`"${k}"`)));
check("anything that is not a normal hex color gives nothing", ["red", "#12", "#gggggg", "#12345678", 5, null, undefined, {}].every((x) => autoLookVars(x) === null));

const page = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("owner-set colors always win: the automatic colors apply only when the owner set none, and never over them", page.includes("const ownerColors = branding ? Object.keys(branding.vars).length > 0 : false;") && page.includes("if (!source || ownerColors) { setAutoLook(null); return; }") && page.includes("const autoVars = branding && !ownerColors && autoLook && autoLook.source === branding.logo ? autoLook.vars : null;") && page.includes("{ ...branding.vars, ...(autoVars ?? {}),") && page.includes('data-auto-look={autoVars ? "true" : undefined}'));
check("an old answer for a previous logo is ignored (the colors belong to the current logo only)", page.includes("autoLook.source === branding.logo") && page.includes("if (live && vars) setAutoLook({ source, vars });") && page.includes("return () => { live = false; };"));
const lib = fs.readFileSync("src/lib/logoPalette.ts", "utf8").replace(/\/\/.*$/gm, "");
check("the picture is read in the browser only (nothing is uploaded or sent anywhere)", !/fetch\(|supabase|XMLHttpRequest|sendBeacon/.test(lib) && lib.includes("catch { return null; }"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll logo palette checks passed (offline).");
process.exit(failures ? 1 : 0);
