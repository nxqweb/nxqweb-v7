// Offline test: the automatic logo cutout (src/lib/logoCutout.ts). A logo on a plain white background must become transparent by itself,
// white INSIDE the logo must stay, soft edges must not leave a white halo, and anything that is not "logo on a plain background" is left alone.
import fs from "node:fs";
import { cutOutBackground, visibleBox } from "../src/lib/logoCutout.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

function make(w, h, bg, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  const set = (x, y, c) => { const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  paint(set);
  return { width: w, height: h, data };
}
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [...img.data.slice(i, i + 4)]; };
const RED = [190, 30, 70];

// A red ring (so the middle is white but ENCLOSED) on white.
const ring = () => make(60, 60, [255, 255, 255], (set) => { for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) { const r = Math.hypot(x - 30, y - 30); if (r > 14 && r < 22) set(x, y, RED); } });
let img = ring();
let res = cutOutBackground(img);
check("a ring on white is cut out", res.ok && res.reason === "cut", JSON.stringify(res));
check("the outside background becomes fully transparent", px(img, 2, 2)[3] === 0 && px(img, 58, 58)[3] === 0 && px(img, 30, 58)[3] === 0);
check("white INSIDE the logo (the enclosed middle) stays opaque white", px(img, 30, 30)[3] === 255 && px(img, 30, 30)[0] === 255);
check("the logo's own color stays solid", px(img, 30, 11).slice(3)[0] === 255 && Math.abs(px(img, 30, 11)[0] - RED[0]) < 8 && Math.abs(px(img, 30, 11)[1] - RED[1]) < 8);

// Soft edge: an anti-aliased pixel (red mixed 50% with white) next to the background.
const soft = make(40, 40, [255, 255, 255], (set) => { for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, RED); set(9, 20, [222, 142, 162]); });
cutOutBackground(soft);
const e = px(soft, 9, 20);
check("an anti-aliased edge pixel becomes partly transparent", e[3] > 0 && e[3] < 255, String(e[3]));
check("its color is un-blended from the white (no white halo): it is redder than before", e[0] < 222 && e[1] < 142 && e[2] < 162, JSON.stringify(e));

// Colored plain background (cream) works the same way.
const cream = make(50, 50, [250, 246, 239], (set) => { for (let y = 15; y < 35; y++) for (let x = 15; x < 35; x++) set(x, y, [30, 47, 79]); });
check("a plain cream background is cut out too", cutOutBackground(cream).ok && px(cream, 1, 1)[3] === 0 && px(cream, 25, 25)[3] === 255);

// The empty margin around a logo is found so the picture can be trimmed.
const boxed = make(100, 80, [255, 255, 255], (set) => { for (let y = 30; y < 50; y++) for (let x = 40; x < 70; x++) set(x, y, RED); });
cutOutBackground(boxed);
const vb = visibleBox(boxed);
check("the visible box of a cut-out logo is found exactly (so blank margins can be trimmed)", vb && vb.left <= 40 && vb.left >= 36 && vb.right >= 70 && vb.right <= 74 && vb.top <= 30 && vb.top >= 26 && vb.bottom >= 50 && vb.bottom <= 54, JSON.stringify(vb));
check("a fully transparent picture has no visible box", visibleBox({ width: 10, height: 10, data: new Uint8ClampedArray(400) }) === null);

// Things that must be left alone.
const clear = make(30, 30, [255, 255, 255], () => {}); clear.data[3] = 0;
check("a picture that is already transparent at the corners is left alone", cutOutBackground(clear).reason === "already-transparent");
const photo = make(40, 40, [255, 255, 255], (set) => { for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) set(x, y, [(x * 6) % 256, (y * 6) % 256, 120]); });
const before = new Uint8ClampedArray(photo.data);
check("a busy picture (corners differ) is left alone and not modified", cutOutBackground(photo).reason === "busy-background" && photo.data.every((v, i) => v === before[i]));
const allWhite = make(40, 40, [255, 255, 255], () => {});
check("an all-white picture is refused (almost everything would vanish)", cutOutBackground(allWhite).reason === "almost-all-background");
const filled = make(100, 100, [255, 255, 255], (set) => { for (let y = 1; y < 99; y++) for (let x = 1; x < 99; x++) set(x, y, RED); });
check("a picture with no real plain background (only a thin border) is refused", cutOutBackground(filled).reason === "no-plain-background");
check("odd input never throws", [{ width: 0, height: 0, data: new Uint8ClampedArray(0) }, { width: 10, height: 10, data: new Uint8ClampedArray(4) }, { width: 3.5, height: 9, data: new Uint8ClampedArray(9) }].every((x) => cutOutBackground(x).ok === false));

const page = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("the showcase hero uses the cutout only when it matches the current logo, and falls back to the original otherwise", page.includes('src={logoCut && logoCut.source === branding.logo ? logoCut.url : branding.logo}') && page.includes('data-cutout={logoCut && logoCut.source === branding.logo ? "true" : undefined}'));
check("the cutout is requested only for a logo that exists, and a late answer for an old logo is ignored", page.includes("cutoutLogoUrl(source).then((url) => { if (live && url) setLogoCut({ source, url }); })") && page.includes("return () => { live = false; };"));
const lib = fs.readFileSync("src/lib/logoCutout.ts", "utf8");
check("the picture is processed in the browser only (nothing is uploaded or sent anywhere)", !/fetch\(|supabase|XMLHttpRequest|sendBeacon/.test(lib) && lib.includes("catch { return null; }"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll logo cutout checks passed (offline).");
process.exit(failures ? 1 : 0);
