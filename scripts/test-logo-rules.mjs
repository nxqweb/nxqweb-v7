// Offline test: the logo upload rules (src/lib/logoRules.ts), decided with the owner on 2026-11-21. Pure functions, not wired to anything yet.
import fs from "node:fs";
import { logoCanContinue, logoKind, logoSizeAdvice, logoStoredSize, svgProblems } from "../src/lib/logoRules.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

check("PNG, JPEG, WEBP and SVG are accepted as logos, by type or by file name", logoKind("image/png", "a.png") === "png" && logoKind("image/jpeg", "a.jpg") === "jpeg" && logoKind("image/webp", "a.webp") === "webp" && logoKind("image/svg+xml", "a.svg") === "svg" && logoKind("", "Logo.SVG") === "svg" && logoKind("", "x.JPEG") === "jpeg");
check("GIF, PDF, HEIC, text and odd input are not accepted", [["image/gif", "a.gif"], ["application/pdf", "a.pdf"], ["image/heic", "a.heic"], ["text/html", "a.html"], [undefined, undefined], [5, {}], ["", "noextension"]].every(([t, n]) => logoKind(t, n) === null));

check("an SVG is always great and never needs an acknowledgement", ["svg"].every((k) => { const a = logoSizeAdvice(k, 10); return a.level === "great" && !a.mustAcknowledge; }));
check("2000 px and wider is great", logoSizeAdvice("png", 2000).level === "great" && logoSizeAdvice("jpeg", 5000).level === "great");
check("1000 to 1999 px is fine with a gentle note", logoSizeAdvice("png", 1000).level === "ok" && logoSizeAdvice("png", 1999).level === "ok" && !logoSizeAdvice("png", 1500).mustAcknowledge && /even better/.test(logoSizeAdvice("png", 1500).message));
check("under 1000 px is a warning that must be acknowledged, never a block", logoSizeAdvice("png", 999).level === "small" && logoSizeAdvice("png", 999).mustAcknowledge && logoSizeAdvice("png", 240).level === "small" && logoSizeAdvice("png", NaN).level === "small" && logoSizeAdvice("png", undefined).level === "small");

const ok = { kind: "png", bytes: 500000, width: 2400, rightsConfirmed: true, acknowledgedSmall: false };
check("a big logo with the rights tick can continue", logoCanContinue(ok).ok);
check("the rights tick is ALWAYS required, even for a perfect SVG", !logoCanContinue({ ...ok, rightsConfirmed: false }).ok && !logoCanContinue({ ...ok, kind: "svg", bytes: 2000, rightsConfirmed: false }).ok && !logoCanContinue({ ...ok, rightsConfirmed: "yes" }).ok);
check("a small logo can continue only after the client ticks that it may look soft (option A: warn, never block)", !logoCanContinue({ ...ok, width: 240 }).ok && logoCanContinue({ ...ok, width: 240, acknowledgedSmall: true }).ok && /small/.test(logoCanContinue({ ...ok, width: 240 }).reason));
check("an unknown type, an empty file, a file over 10 MB and an SVG over 1 MB are refused with a clear reason", !logoCanContinue({ ...ok, kind: null }).ok && !logoCanContinue({ ...ok, bytes: 0 }).ok && !logoCanContinue({ ...ok, bytes: 11 * 1024 * 1024 }).ok && !logoCanContinue({ ...ok, kind: "svg", bytes: 2 * 1024 * 1024 }).ok && [{ ...ok, kind: null }, { ...ok, bytes: NaN }].every((i) => logoCanContinue(i).reason.length > 10));

const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><path d="M0 0h100v100H0z" fill="url(#g)"/><text x="5" y="50">Candles</text></svg>';
check("a normal logo SVG passes", svgProblems(good).length === 0);
const bad = {
  "script tag": good.replace("<defs>", "<script>alert(1)</script><defs>"),
  "event handler": good.replace("<path ", '<path onload="x()" '),
  "javascript link": good.replace("<text", '<a href="javascript:alert(1)"><text').replace("</text>", "</text></a>"),
  "foreignObject": good.replace("<defs>", "<foreignObject><div>x</div></foreignObject><defs>"),
  "external image": good.replace("<defs>", '<image href="https://evil.example/x.png"/><defs>'),
  "external image (xlink)": good.replace("<defs>", '<image xlink:href="//evil.example/x.png"/><defs>'),
  "css import": good.replace("<defs>", "<style>@import url(https://evil.example/a.css);</style><defs>"),
  "css url to the internet": good.replace('fill="url(#g)"', 'style="fill:url(http://evil.example/x)"'),
  "custom entity": '<!DOCTYPE svg [<!ENTITY a "x">]>' + good,
  "iframe": good.replace("<defs>", "<iframe src='x'></iframe><defs>"),
  "use element": good.replace("<defs>", '<use href="#g"/><defs>'),
  "animate element": good.replace("<defs>", '<animate attributeName="x"/><defs>'),
  "script in mixed case": good.replace("<defs>", "<ScRiPt>alert(1)</sCrIpT><defs>"),
  "not an svg": "<html><body>hello</body></html>",
  "empty": "   ",
  "no size": '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
};
check("every unsafe or broken SVG is refused (scripts, handlers, script links, embedded web content, internet loads, entities, odd elements, mixed case, no size)", Object.entries(bad).every(([name, text]) => { const p = svgProblems(text); if (p.length === 0) console.log(`      missed: ${name}`); return p.length > 0; }));
check("non-text input is refused without crashing", [undefined, null, 5, {}, []].every((v) => svgProblems(v).length > 0));
check("a gradient or an internal link inside the file (#id) is allowed", svgProblems(good.replace("<path ", '<path style="fill:url(#g)" ')).length === 0);

check("a picture is stored at most 2400 px on its longest side, never enlarged, shape kept", JSON.stringify(logoStoredSize(4800, 2400)) === JSON.stringify({ width: 2400, height: 1200, resized: true }) && JSON.stringify(logoStoredSize(2000, 1000)) === JSON.stringify({ width: 2000, height: 1000, resized: false }) && logoStoredSize(240, 240).resized === false);
check("odd sizes give nothing", [[0, 10], [10, 0], [NaN, 4], [-1, 4]].every(([w, h]) => logoStoredSize(w, h) === null));
check("the rules are not used by any page yet (they wait for the upload screen and its database change)", !fs.readdirSync("src", { recursive: true }).filter((f) => /\.tsx?$/.test(f) && !/logoRules/.test(f)).some((f) => fs.readFileSync(`src/${f}`, "utf8").includes("logoRules")));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll logo rules checks passed (offline).");
process.exit(failures ? 1 : 0);
