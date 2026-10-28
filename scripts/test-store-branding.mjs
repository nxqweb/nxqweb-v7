// Offline test: only Light of the World gets its own look; colors stay readable; the store page uses the helper; the logo file ships.
import fs from "node:fs";
import path from "node:path";
let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const m = await import(`${path.resolve("src/lib/storeBranding.ts")}?${Date.now()}`);
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const b = m.storeBrandingFor("light-of-the-world-abc");
check("Light of the World (any suffix, any case) gets the branding", !!b && !!m.storeBrandingFor("LIGHT-OF-THE-WORLD-x1") && b.logo === "/brand/light-of-the-world-logo.png");
check("every other shop, and junk, keeps the default look", [null, undefined, "", "glow", "light-abc", "the-light-of-the-world"].every((s) => m.storeBrandingFor(s) === null));
check("text is readable: ink on page 4.5:1+, muted on page 4.5:1+, white on accent 4.5:1+, white on dark accent 4.5:1+", ratio(b.vars["--store-ink"], b.vars["--store-bg"]) >= 4.5 && ratio(b.vars["--store-muted"], b.vars["--store-bg"]) >= 4.5 && ratio("#ffffff", b.vars["--store-accent"]) >= 4.5 && ratio("#ffffff", b.vars["--store-accent-dark"]) >= 4.5);
check("the logo file exists in public/", fs.existsSync("public/brand/light-of-the-world-logo.png") && fs.statSync("public/brand/light-of-the-world-logo.png").size > 1000);
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("the store page applies it through the helper (class, inline variables, decorative logo)", /storeBrandingFor\(slug\)/.test(store) && /data-branded=/.test(store) && /className="store-logo" src=\{branding\.logo\} alt=""/.test(store));
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
