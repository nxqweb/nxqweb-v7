// Post-deploy smoke check for a LIVE site. READ-ONLY: it only sends plain GET requests to the address you give it. No login, no cookies, no keys, no form posts.
//   node scripts/smoke-live-site.mjs https://nxqweb-v9-staging.netlify.app [store-slug]
// Checks: the main public pages load (HTTP 200, HTML with the app root), every script and stylesheet the home page needs loads with a sane type, the security headers
// from netlify.toml are present with the SAME values, the home page is not cached and the built assets are cached long, and (optionally) a store page loads.
// It cannot see anything that needs a login (client portal, orders): use docs/COMMERCE_TEST_PLAN.md for those. It does not replace preflight or the CI parity run.
// `node scripts/smoke-live-site.mjs --self-test` runs the checks against canned responses and plants bugs to prove each check can fail (used by CI-free local runs).
import fs from "node:fs";

const toml = fs.readFileSync("netlify.toml", "utf8");
const headerBlocks = [...toml.matchAll(/\[\[headers\]\]\s*for = "([^"]+)"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n*$)/g)].map((m) => ({
  pattern: m[1], values: Object.fromEntries([...m[2].matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)].map((v) => [v[1].toLowerCase(), v[2]])),
}));
const expectedAll = headerBlocks.find((b) => b.pattern === "/*")?.values ?? {};
const expectedIndexCache = headerBlocks.find((b) => b.pattern === "/index.html")?.values["cache-control"] ?? "";
const expectedAssetCache = headerBlocks.find((b) => b.pattern === "/assets/*")?.values["cache-control"] ?? "";
export const publicPages = ["/", "/plans", "/about", "/contact", "/privacy", "/terms", "/portal/login", "/portal/signup"];

// `get(url)` returns { status, headers: Record<lowercase, string>, text }. Injected so the checks can be tested without a network.
export async function smoke(base, storeSlug, get) {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, ok: Boolean(cond), detail });
  const root = base.replace(/\/+$/, "");
  const home = await get(`${root}/`);
  ok("home page answers 200 with an HTML app shell", home.status === 200 && /<div id="root"/.test(home.text) && /text\/html/.test(home.headers["content-type"] || ""), `status ${home.status}`);
  const missing = Object.entries(expectedAll).filter(([k, v]) => (home.headers[k] || "") !== v).map(([k]) => k);
  ok("every security header from netlify.toml is present with the same value (CSP, HSTS, frame, referrer, permissions...)", missing.length === 0, missing.length ? `wrong or missing: ${missing.join(", ")}` : "");
  ok("the home page is never cached (a new deploy shows up at once)", (home.headers["cache-control"] || "") === expectedIndexCache, home.headers["cache-control"] || "no cache-control header");
  const assets = [...home.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  ok("the home page points at built scripts and styles", assets.some((a) => a.endsWith(".js")) && assets.some((a) => a.endsWith(".css")), `found ${assets.length}`);
  for (const asset of [...new Set(assets)].slice(0, 12)) {
    const res = await get(`${root}${asset}`);
    const want = asset.endsWith(".js") ? /javascript/ : /css/;
    ok(`asset ${asset.split("/").pop()} loads with the right type and long caching`, res.status === 200 && want.test(res.headers["content-type"] || "") && (res.headers["cache-control"] || "") === expectedAssetCache, `status ${res.status}, ${res.headers["content-type"] || "no type"}`);
  }
  ok("no inline script on the home page (the strict CSP would block it)", !/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/.test(home.text));
  for (const page of publicPages.slice(1)) {
    const res = await get(`${root}${page}`);
    ok(`page ${page} loads`, res.status === 200 && /<div id="root"/.test(res.text), `status ${res.status}`);
  }
  const nope = await get(`${root}/definitely-not-a-real-page-xyz`);
  ok("an unknown address still serves the app (it shows its own 'not found' screen)", nope.status === 200 && /<div id="root"/.test(nope.text), `status ${nope.status}`);
  if (storeSlug) {
    const store = await get(`${root}/store/${encodeURIComponent(storeSlug)}`);
    ok(`store page /store/${storeSlug} loads`, store.status === 200 && /<div id="root"/.test(store.text), `status ${store.status}`);
  }
  return results;
}

const realGet = async (url) => {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "nxq-smoke/1" } });
  return { status: res.status, headers: Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])), text: await res.text() };
};

function selfTest() {
  const page = `<!doctype html><html><head><script type="module" src="/assets/app-abc.js"></script><link rel="stylesheet" href="/assets/app-abc.css"></head><body><div id="root"></div></body></html>`;
  const make = (over = {}) => async (url) => {
    const path = new URL(url).pathname;
    if (path === "/assets/app-abc.js") return { status: 200, headers: { "content-type": "text/javascript", "cache-control": expectedAssetCache }, text: "" };
    if (path === "/assets/app-abc.css") return { status: 200, headers: { "content-type": "text/css", "cache-control": expectedAssetCache }, text: "" };
    const base = { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...expectedAll, "cache-control": expectedIndexCache }, text: page };
    return over[path] ? { ...base, ...over[path], headers: { ...base.headers, ...(over[path].headers || {}) } } : base;
  };
  let bad = 0;
  const expect = (name, cond) => { if (cond) console.log(`PASS  ${name}`); else { bad += 1; console.log(`FAIL  ${name}`); } };
  return (async () => {
    const good = await smoke("https://x.test", "shop", make());
    expect("a healthy site passes every check", good.every((r) => r.ok) && good.length >= 15);
    const csp = await smoke("https://x.test", "", make({ "/": { headers: { "content-security-policy": "default-src *" } } }));
    expect("PLANTED BUG caught: a changed Content-Security-Policy", csp.some((r) => !r.ok && /security header/.test(r.name)));
    const noHsts = await smoke("https://x.test", "", make({ "/": { headers: { "strict-transport-security": "" } } }));
    expect("PLANTED BUG caught: a missing HSTS header", noHsts.some((r) => !r.ok && /security header/.test(r.name)));
    const cached = await smoke("https://x.test", "", make({ "/": { headers: { "cache-control": "public, max-age=3600" } } }));
    expect("PLANTED BUG caught: the home page gets cached", cached.some((r) => !r.ok && /never cached/.test(r.name)));
    const down = await smoke("https://x.test", "", make({ "/privacy": { status: 404, text: "Not Found" } }));
    expect("PLANTED BUG caught: a public page returns 404", down.some((r) => !r.ok && /privacy/.test(r.name)));
    const inline = await smoke("https://x.test", "", make({ "/": { text: page.replace("</body>", "<script>alert(1)</script></body>") } }));
    expect("PLANTED BUG caught: an inline script sneaks in", inline.some((r) => !r.ok && /inline script/.test(r.name)));
    const wrongType = await smoke("https://x.test", "", async (u) => { const r = await make()(u); return new URL(u).pathname.endsWith(".js") ? { ...r, headers: { ...r.headers, "content-type": "text/html" } } : r; });
    expect("PLANTED BUG caught: a script served with the wrong type (an error page in disguise)", wrongType.some((r) => !r.ok && /\.js/.test(r.name)));
    const noStore = await smoke("https://x.test", "shop", make({ "/store/shop": { status: 500 } }));
    expect("PLANTED BUG caught: the store page breaks", noStore.some((r) => !r.ok && /store page/.test(r.name)));
    expect("the expected headers were really read from netlify.toml", Object.keys(expectedAll).length >= 8 && /script-src 'self'/.test(expectedAll["content-security-policy"] || "") && /no-store/.test(expectedIndexCache));
    console.log(bad ? `\n${bad} self-test check(s) failed.` : "\nSmoke script self-test passed.");
    process.exit(bad ? 1 : 0);
  })();
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") await selfTest();
else if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, slug] = args;
  if (!base || !/^https?:\/\//.test(base)) { console.log("Usage: node scripts/smoke-live-site.mjs <https://site address> [store-slug]   (or --self-test)"); process.exit(2); }
  const results = await smoke(base, slug, realGet).catch((e) => { console.log(`FAIL  could not reach ${base}: ${e.message}`); process.exit(1); });
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : ` - ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} of ${results.length} smoke check(s) failed.` : `\nAll ${results.length} smoke checks passed.`);
  process.exit(failed ? 1 : 0);
}
