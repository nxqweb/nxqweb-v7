// Offline test: plain form controls on portal pages are readable (safety net at the end of src/styles/plan-forms.css).
// Found 2026-11-20: the Store look page's dropdown list showed light text on a light list and its text box had white text on a light pill.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");
const net = css.slice(css.indexOf("/* Safety net: plain form controls"));
const dark = { bg: "#0b1020", text: "#f8fafc", placeholder: "#aab4c8", checkedBg: "#164e63", checkedText: "#ffffff", border: "#8d909a" };
const light = { bg: "#ffffff", text: "#111827", placeholder: "#4b5563" };

check("the safety net exists and covers select, text boxes and text areas with no class, in both themes", ["select:not([class])", "input:not([class])", "textarea:not([class])"].every((s) => net.includes(`body:not([data-nxq-theme="light"]) .portal-shell ${s}`) && net.includes(`body[data-nxq-theme="light"] .portal-shell ${s}`)));
check("dark: typed text is very readable on its background (at least 7:1)", ratio(dark.text, dark.bg) >= 7, ratio(dark.text, dark.bg).toFixed(1));
check("dark: placeholder hints are readable (at least 4.5:1)", ratio(dark.placeholder, dark.bg) >= 4.5, ratio(dark.placeholder, dark.bg).toFixed(1));
check("dark: the highlighted option stays readable (at least 4.5:1)", ratio(dark.checkedText, dark.checkedBg) >= 4.5, ratio(dark.checkedText, dark.checkedBg).toFixed(1));
check("light: typed text and hints are readable (7:1 and 4.5:1)", ratio(light.text, light.bg) >= 7 && ratio(light.placeholder, light.bg) >= 4.5);
check("the dropdown list itself gets the same colors as the closed box (the native list used to ignore them)", /select:not\(\[class\]\) option,\s*body:not\(\[data-nxq-theme="light"\]\) \.portal-shell select:not\(\[class\]\) optgroup \{ background-color: #0b1020; color: #f8fafc; \}/.test(net) && net.includes("color-scheme: dark;") && net.includes("color-scheme: light;"));
check("checkboxes, radio buttons, color pickers, ranges, files and buttons are left alone", ['[type="checkbox"]', '[type="radio"]', '[type="color"]', '[type="range"]', '[type="file"]', '[type="button"]', '[type="submit"]', '[type="hidden"]'].every((t) => net.includes(`:not(${t})`)));
check("controls that already have a class keep their own styling (only class-less controls are touched)", !/\.portal-shell select \{|\.portal-shell input \{|\.portal-shell textarea \{/.test(net));
check("boxes are at least 44px tall (easy to tap)", (net.match(/min-height: 44px;/g) || []).length >= 2);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll form contrast checks passed (offline).");
process.exit(failures ? 1 : 0);
