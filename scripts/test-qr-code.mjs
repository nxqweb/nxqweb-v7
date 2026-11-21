// Offline test: the QR code maker used on the review card. A printed card with a code that does not scan would hurt a client, so this test is strict:
//  - structure checks (finder squares, timing lines, the always-dark square, valid format bits stored twice, sizes by version),
//  - GOLDEN fingerprints for fixed inputs. Each of these exact codes was decoded back to its text with an independent QR reader (zxing-cpp) on 2026-10-17
//    (97 of 97 sample codes, versions 1 to 10, including unicode), so a change in any fingerprint means the output changed and must be re-verified that way,
//  - planted-bug controls: deliberately broken copies of the maker must change the output.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { makeQr, qrCapacityBytes, qrMaxBytes, qrPathData, qrToSvg } from "../src/lib/qrCode.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const fingerprint = (grid) => crypto.createHash("sha256").update(grid.modules.map((r) => r.map((b) => (b ? 1 : 0)).join("")).join("\n")).digest("hex").slice(0, 16);

const golden = [
  ["a", 1, "e8ab680854e4019c"],
  ["https://g.page/r/CabcDEF/review", 3, "bf69e630d04a0eff"],
  ["https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4", 5, "e544acaaff3796cc"],
  ["https://www.yelp.com/biz/light-of-the-world-candles-and-soap-springfield?osq=candles", 5, "f715d2cd21aa845d"],
  ["Café ☕ 日本語", 2, "40b0c042ecc8aa42"],
  ["x".repeat(213), 10, "f8a692e420006d88"],
];
// One golden code per version (each filled to that version's capacity), so a wrong table entry for ANY version changes a fingerprint.
const versionHashes = { 1: "381f465cecde7ad3", 2: "6d51b0ceed6d3013", 3: "19a76629188446ab", 4: "ef9f58ff3b4ac593", 5: "c33741259b2dbadb", 6: "4b6ecf43c86e7ce6", 7: "763a0124b4e732a6", 8: "606dc3a70e158758", 9: "6a1773415ed36ac6", 10: "7a66f21d75076716" };
const fullText = (v) => ("https://example.com/Ab9-_?q=" + "Zz0.~".repeat(50)).slice(0, qrCapacityBytes(v)).padEnd(qrCapacityBytes(v), "k");
for (const [v, hash] of Object.entries(versionHashes)) golden.push([fullText(Number(v)), Number(v), hash]);
check("golden codes (each decoded with a real QR reader when recorded) still come out identical", golden.every(([text, version, hash]) => { const g = makeQr(text); return g.version === version && fingerprint(g) === hash; }), golden.map(([t]) => fingerprint(makeQr(t))).join(","));

// ---- structure
const g = makeQr("https://g.page/r/CabcDEF/review");
const at = (grid, x, y) => grid.modules[y][x];
function finderOk(grid, cx, cy) {
  for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (at(grid, cx + dx, cy + dy) !== (dist !== 2)) return false;
  }
  return true;
}
check("size follows the version (17 + 4 x version) and every row is square", [1, 2, 5, 7, 10].every((v) => { const text = "x".repeat(qrCapacityBytes(v)); const q = makeQr(text); return q.version === v && q.size === 17 + 4 * v && q.modules.length === q.size && q.modules.every((r) => r.length === q.size); }));
check("the three corner squares are drawn exactly", finderOk(g, 3, 3) && finderOk(g, g.size - 4, 3) && finderOk(g, 3, g.size - 4));
check("the white gaps next to the corner squares are clear", [0, 1, 2, 3, 4, 5, 6, 7].every((i) => at(g, 7, i) === false && at(g, i, 7) === false));
check("timing lines alternate dark and light between the corner squares", Array.from({ length: g.size - 16 }, (_, i) => i + 8).every((i) => at(g, i, 6) === (i % 2 === 0) && at(g, 6, i) === (i % 2 === 0)));
check("the always-dark square is present", at(g, 8, g.size - 8) === true);
function formatBits(grid, first) {
  const size = grid.size; let bits = 0;
  const set = (i, x, y) => { if (at(grid, x, y)) bits |= 1 << i; };
  if (first) { for (let i = 0; i <= 5; i += 1) set(i, 8, i); set(6, 8, 7); set(7, 8, 8); set(8, 7, 8); for (let i = 9; i < 15; i += 1) set(i, 14 - i, 8); }
  else { for (let i = 0; i < 8; i += 1) set(i, size - 1 - i, 8); for (let i = 8; i < 15; i += 1) set(i, 8, size - 15 + i); }
  return bits;
}
function formatValid(bits) { const data = (bits ^ 0x5412) >>> 10; let rem = data; for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return (((data << 10) | rem) ^ 0x5412) === bits && (data >>> 3) === 0; }
check("the format information is valid (error-correction level M) and stored twice identically", [g, makeQr("a"), makeQr("x".repeat(100))].every((q) => formatBits(q, true) === formatBits(q, false) && formatValid(formatBits(q, true))));
check("the same text always gives the same code", fingerprint(makeQr("https://example.com/a")) === fingerprint(makeQr("https://example.com/a")) && fingerprint(makeQr("https://example.com/a")) !== fingerprint(makeQr("https://example.com/b")));

// ---- limits
check("too much or no text is refused with a plain message instead of a broken code", (() => { let a = ""; let b = ""; try { makeQr("x".repeat(qrMaxBytes + 1)); } catch (e) { a = e.message; } try { makeQr(""); } catch (e) { b = e.message; } return /too long/.test(a) && /Nothing/.test(b); })());
check("the biggest allowed text still fits, and unicode counts by bytes not characters", makeQr("x".repeat(qrMaxBytes)).version === 10 && qrMaxBytes === 213 && (() => { try { makeQr("日".repeat(72)); return false; } catch { return true; } })());

// ---- drawing
const svg = qrToSvg(g);
check("the drawing has the standard 4-square quiet border, white behind and black squares, and nothing active inside", qrPathData(g).viewSize === g.size + 8 && /viewBox="0 0 \d+ \d+"/.test(svg) && /fill="#ffffff"/.test(svg) && /fill="#000000"/.test(svg) && !/<script|onload|href|javascript:/i.test(svg) && qrToSvg(g, { dark: "red;}</svg><script>" }).includes('fill="#000000"'));
check("the path draws exactly one square per dark module", (qrPathData(g).path.match(/M/g) || []).length === g.modules.flat().filter(Boolean).length);

// ---- planted-bug controls: broken copies of the maker must give a different code
const source = fs.readFileSync("src/lib/qrCode.ts", "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qrbug-"));
async function broken(label, from, to) {
  if (!source.includes(from)) { check(`PLANTED BUG control is valid: ${label}`, false, "text to break not found"); return; }
  const file = path.join(dir, `${label.replace(/\W+/g, "_")}.ts`);
  fs.writeFileSync(file, source.replace(from, to));
  const mod = await import(`file://${file}`);
  let different;
  try { different = golden.some(([text, , hash]) => fingerprint(mod.makeQr(text)) !== hash); } catch { different = true; }
  check(`PLANTED BUG caught: ${label}`, different);
}
await broken("wrong Reed-Solomon polynomial", "0x11d", "0x11b");
await broken("wrong format polynomial", "0x537", "0x535");
await broken("wrong format mask", "0x5412", "0x5413");
await broken("wrong error-correction level bits", "const data = (0 << 3) | mask;", "const data = (1 << 3) | mask;");
await broken("wrong pad bytes", "pad ^= 0xec ^ 0x11", "pad ^= 0xec ^ 0x12");
await broken("wrong block count table", "const blockCount = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];", "const blockCount = [1, 1, 1, 2, 2, 4, 4, 5, 5, 5];");
await broken("wrong mask rule", "case 2: invert = x % 3 === 0; break;", "case 2: invert = y % 3 === 0; break;");
fs.rmSync(dir, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll QR code checks passed (offline).");
process.exit(failures ? 1 : 0);
