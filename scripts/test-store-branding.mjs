// Offline test: a shop's own look comes from the database row only; every unsafe or odd value is dropped; the store page reads it with a failure-tolerant call; the logo file ships.
import fs from "node:fs";
import path from "node:path";
let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const m = await import(`${path.resolve("src/lib/storeBranding.ts")}?${Date.now()}`);
const good = { bg: "#FDF9F6", ink: "#1d2f4f", muted: "#4f5b73", accent: "#a8284f", accent_dark: "#861f3e", heading_font: "serif", logo: "/brand/light-of-the-world-logo.png" };
const b = m.storeLookFromRow(good);
check("a good row becomes variables, a logo and serif headings (colors lower-cased)", b && b.vars["--store-bg"] === "#fdf9f6" && b.vars["--store-ink"] === "#1d2f4f" && b.vars["--store-accent-dark"] === "#861f3e" && b.logo === "/brand/light-of-the-world-logo.png" && b.serifHeadings === true);
check("empty, junk and unknown rows mean the default look", [null, undefined, "x", 5, [], {}, { foo: "bar" }, { ink: "red" }].every((r) => m.storeLookFromRow(r) === null));
check("outside, relative, dot-dot, query-string and script logos are dropped", ["https://evil.example.com/x.png", "brand/x.png", "/brand/../x.png", "/brand/x.png?a=1", "javascript:alert(1)", "//evil.com/x.png", "/other/x.png"].every((l) => m.storeLookFromRow({ ...good, logo: l }).logo === null));
check("colors that are not #rrggbb are dropped one by one (no style injection)", (() => { const r = m.storeLookFromRow({ ink: "#1d2f4f", accent: "red;background:url(x)", bg: "#12" }); return Object.keys(r.vars).join() === "--store-ink"; })());
check("heading font is serif only when the row says serif", m.storeLookFromRow({ ...good, heading_font: "comic" }).serifHeadings === false);
check("the logo file exists in public/", fs.existsSync("public/brand/light-of-the-world-logo.png") && fs.statSync("public/brand/light-of-the-world-logo.png").size > 1000);
const a = await import(`${path.resolve("src/lib/storeLookAdmin.ts")}?${Date.now()}`);
check("owner page: the default look is saveable; unreadable text, a pale button, a bad color or an outside logo each give a plain problem", a.lookProblem(a.defaultLookDraft) === "" && /hard to read/.test(a.lookProblem({ ...a.defaultLookDraft, ink: "#ffffff" })) && /button color/.test(a.lookProblem({ ...a.defaultLookDraft, accent: "#ffee00" })) && /must be a color/.test(a.lookProblem({ ...a.defaultLookDraft, tint: "red" })) && /under \/brand\//.test(a.lookProblem({ ...a.defaultLookDraft, logo: "https://x.com/a.png" })));
check("owner page: the payload is lower-cased, has only known keys, and a row round-trips", (() => { const d = { ...a.defaultLookDraft, ink: "#1D2F4F", logo: "/brand/a.png", heading_font: "serif" }; const p = a.lookPayload(d); return p.ink === "#1d2f4f" && p.logo === "/brand/a.png" && p.heading_font === "serif" && Object.keys(p).length === 10 && a.draftFromRow(p).logo === "/brand/a.png"; })());
check("owner page and its route and menu link exist", /owner_set_store_look/.test(fs.readFileSync("src/pages/OwnerStoreLook.tsx", "utf8")) && /"\/owner\/store-look"/.test(fs.readFileSync("src/App.tsx", "utf8")) && /href="\/owner\/store-look"/.test(fs.readFileSync("src/pages/OwnerPortal.tsx", "utf8")));
const store = fs.readFileSync("src/pages/PublicCommerceStorefront.tsx", "utf8");
check("the store reads its look from the database, tolerates any failure, and waits for it before first paint", /rpc\("get_public_store_look", \{ store_slug_value: slug \}\)/.test(store) && /catch \{ \/\* default look \*\/ \}/.test(store) && /Promise\.all\(\[loadStoreStatus\(\), loadStoreLook\(\)\]\)/.test(store) && /await statusLoad;/.test(store));
check("the page applies it through the helper (marker, inline variables, decorative logo) and nothing is hardcoded per shop", /data-branded=/.test(store) && /branding\?\.logo/.test(store) && /className="store-logo" src=\{branding\.logo\} alt=""/.test(store) && !/light-of-the-world/.test(store) && !/light-of-the-world/.test(fs.readFileSync("src/lib/storeBranding.ts", "utf8")));
const sql = fs.readFileSync("supabase/migrations/286_store_look.sql", "utf8");
check("migration 286: owner-only setters, contrast and logo rules, public read is the look only", /from public\.owner_users where auth_user_id = auth\.uid\(\)/.test(sql) && /< 4\.5/.test(sql) && /\^\/brand\//.test(sql) && /grant execute on function public\.get_public_store_look\(text\) to anon, authenticated;/.test(sql) && !/grant execute on function public\.owner_[a-z_]+\([^)]*\) to anon/.test(sql));
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
