// Offline test: the store's QR code on the Live store page (src/components/StoreQrCard.tsx, src/lib/storeQr.ts). The code itself comes from
// the already-verified maker (scripts/test-qr-code.mjs); this checks the picture plan, the file name and the wiring.
import fs from "node:fs";
import { makeQr } from "../src/lib/qrCode.ts";
import { qrFileName, qrPixelPlan } from "../src/lib/storeQr.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const grid = makeQr("https://example.com/store/candle-shop");
const plan = qrPixelPlan(grid.size);
check("the picture uses whole pixels per square and keeps the 4-square quiet border", Number.isInteger(plan.scale) && plan.border === 4 && plan.side === (grid.size + 8) * plan.scale);
check("the picture is big enough to print and never larger than asked", plan.side <= 1024 && plan.side >= 900 && plan.scale >= 8, `${plan.side}px at ${plan.scale}`);
check("every code size the maker can produce gets a sharp picture (at least 4 pixels a square)", [21, 25, 29, 33, 37, 41, 45, 49, 53, 57].every((size) => { const p = qrPixelPlan(size); return p.scale >= 4 && p.side <= 1024 && p.side === (size + 8) * p.scale; }));
check("an odd size never gives a zero or broken picture", [0, -5, NaN, 2.7].every((size) => { const p = qrPixelPlan(size); return Number.isFinite(p.side) && p.side > 0 && p.scale >= 4; }));

check("the file name comes from the store name, letters digits and hyphens only", qrFileName("Wick & Wax Candle Co.") === "wick-wax-candle-co-qr-code.png" && qrFileName("  Café Été  ") === "cafe-ete-qr-code.png");
check("a name with nothing usable, or a path trick, still gives a safe file name", qrFileName("") === "my-store-qr-code.png" && qrFileName("../../etc/passwd") === "etc-passwd-qr-code.png" && qrFileName("***") === "my-store-qr-code.png" && !/[\\/:]/.test(qrFileName("a/b\\c:d")));
check("a very long name is cut", qrFileName("x".repeat(500)).length <= 60 + "-qr-code.png".length);

const card = fs.readFileSync("src/components/StoreQrCard.tsx", "utf8");
check("the code is drawn black on white as ordinary SVG shapes (never raw HTML), with a label for screen readers", card.includes('fill="#ffffff"') && card.includes('fill="#000000"') && card.includes("aria-label={`QR code for") && !/dangerouslySetInnerHTML/.test(card));
check("an address too long for a code hides the card instead of breaking the page", card.includes("try { return makeQr(url); } catch { return null; }") && card.includes("if (!grid) return null;"));
check("nothing is fetched or sent: the picture is made in the browser", !/fetch\(|supabase|XMLHttpRequest|https?:\/\//.test(card));
check("a failed save tells the owner what to do instead", card.includes("Take a screenshot of the code instead."));
const live = fs.readFileSync("src/pages/ClientCommerceLiveStore.tsx", "utf8");
check("the Live store page shows the code next to the store link, only when the store is open", /data\.status === "active" \? <div data-testid="store-link-box">[\s\S]{0,700}<StoreQrCard url=\{liveUrl\} storeName=\{storeName\} \/>/.test(live));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store QR checks passed (offline).");
process.exit(failures ? 1 : 0);
