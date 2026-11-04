// Pre-launch waiting list: the pure rules and the request handler, the form rules, the gateway against the SQL, the OFF switch, and (after promotion) the wiring.
// Offline, no network, no database. Node >= 22.18 imports the .ts helper directly. Planted-bug controls included: each rule is also run against a deliberately broken copy.
// This one file works in both places: as a draft (docs/drafts/waitlist/) and after promotion (scripts/test-waitlist.mjs); it finds the files by where it sits.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const isDraft = /docs[\\/]drafts[\\/]waitlist$/.test(here);
const root = isDraft ? path.resolve(here, "../../..") : path.resolve(here, "..");
const P = isDraft
  ? { input: `${here}/waitlist-input.mjs`, lib: `${here}/waitlist.ts`, gateway: `${here}/waitlistSupabaseGateway.ts`, config: `${here}/waitlistConfig.ts`, fn: `${here}/join-waitlist.index.ts`, publicPage: `${here}/PublicWaitlist.tsx`, ownerPage: `${here}/OwnerWaitlist.tsx`, sqlDir: `${root}/docs/drafts/migrations` }
  : { input: `${root}/supabase/functions/_shared/waitlist-input.mjs`, lib: `${root}/src/lib/waitlist.ts`, gateway: `${root}/src/lib/waitlistSupabaseGateway.ts`, config: `${root}/src/lib/waitlistConfig.ts`, fn: `${root}/supabase/functions/join-waitlist/index.ts`, publicPage: `${root}/src/pages/PublicWaitlist.tsx`, ownerPage: `${root}/src/pages/OwnerWaitlist.tsx`, sqlDir: `${root}/supabase/migrations` };
const read = (file) => fs.readFileSync(file, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-waitlist-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const importFile = (file) => import(`${pathToFileURL(file).href}?t=${Date.now()}${Math.random()}`);

const real = await importFile(P.input);
const lib = await importFile(P.lib);

// ---- a fake world for the handler ------------------------------------------------------------------------------------------------
function world(over = {}) {
  const calls = { reserve: [], join: [], bodyReads: 0 };
  const counters = new Map();
  const env = { NXQ_WAITLIST_ENABLED: "true", NXQ_WAITLIST_ALLOWED_ORIGINS: "https://site.test, https://www.site.test", NXQ_LEAD_FINGERPRINT_SALT: "salt", ...(over.env || {}) };
  const deps = {
    env: (name) => env[name],
    sha256: async (text) => createHash("sha256").update(text).digest("hex"),
    reserve: over.reserve ?? (async (r) => { calls.reserve.push(r); const key = `${r.operation}|${r.identity}`; const used = (counters.get(key) || 0) + 1; counters.set(key, used); return { allowed: used <= r.limit }; }),
    join: over.join ?? (async (j) => { calls.join.push(j); }),
  };
  const request = (extra = {}) => ({
    method: "POST", origin: "https://site.test", ip: "1.2.3.4", agent: "ua",
    readBody: async () => { calls.bodyReads += 1; return "body" in extra ? extra.body : JSON.stringify({ email: "Fan@Example.COM", source: "Creator_A" }); },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "body")),
  });
  return { calls, deps, request };
}

async function handlerChecks(mod, ok) {
  const { handleWaitlist, normalizeEmail, normalizeSource, WAITLIST_LIMITS, WAITLIST_CONSENT_VERSION, WAITLIST_OK_MESSAGE } = mod;
  let w = world();
  const good = await handleWaitlist(w.request(), w.deps);
  ok("a valid sign-up answers 200 with the thank-you message and writes one row with the address lower-cased", good.status === 200 && good.body.ok === true && good.body.message === WAITLIST_OK_MESSAGE
    && w.calls.join.length === 1 && w.calls.join[0].email === "fan@example.com" && w.calls.join[0].source === "creator_a" && w.calls.join[0].consentVersion === WAITLIST_CONSENT_VERSION);

  for (const flag of [undefined, "", "TRUE", "1", "yes", "false", " true"]) {
    w = world({ env: { NXQ_WAITLIST_ENABLED: flag } });
    const res = await handleWaitlist(w.request(), w.deps);
    ok(`OFF unless the switch is exactly "true" (${JSON.stringify(flag)}): 404, the body is never read, nothing is written`, res.status === 404 && w.calls.bodyReads === 0 && w.calls.join.length === 0 && w.calls.reserve.length === 0);
  }
  w = world({ env: { NXQ_WAITLIST_ENABLED: undefined } });
  const offBody = JSON.stringify((await handleWaitlist(w.request(), w.deps)).body);

  for (const [label, extra, env] of [["an origin that is not listed", { origin: "https://evil.test" }, {}], ["the plain-http version of a listed site", { origin: "http://site.test" }, {}], ["no origin at all", { origin: "" }, {}],
    ["a list with only non-https entries", { origin: "http://site.test" }, { NXQ_WAITLIST_ALLOWED_ORIGINS: "http://site.test" }], ["an empty origin list", {}, { NXQ_WAITLIST_ALLOWED_ORIGINS: "" }]]) {
    w = world({ env });
    const res = await handleWaitlist(w.request(extra), w.deps);
    ok(`${label} gets the same 404 as "off" (nothing reveals the list or its settings) and nothing happens`, res.status === 404 && JSON.stringify(res.body) === offBody && w.calls.bodyReads === 0 && w.calls.join.length === 0);
  }
  w = world();
  const pre = await handleWaitlist(w.request({ method: "OPTIONS" }), w.deps);
  ok("a preflight from a listed site answers 204 with no body", pre.status === 204 && pre.body === null && w.calls.bodyReads === 0);
  w = world();
  const get = await handleWaitlist(w.request({ method: "GET" }), w.deps);
  ok("GET is refused with 405", get.status === 405 && w.calls.join.length === 0);

  w = world();
  await handleWaitlist(w.request(), w.deps);
  const second = await handleWaitlist(w.request(), w.deps);
  ok("an address that is already listed gets exactly the same answer as a new one", JSON.stringify(second) === JSON.stringify(good));

  w = world();
  const bot = await handleWaitlist(w.request({ body: JSON.stringify({ email: "a@b.co", company_website: "http://spam.test" }) }), w.deps);
  ok("the bot trap looks like success and does no database work at all", JSON.stringify(bot) === JSON.stringify(good) && w.calls.join.length === 0 && w.calls.reserve.length === 0);

  for (const [label, body, status] of [["a bad email", JSON.stringify({ email: "nope" }), 400], ["a missing email", JSON.stringify({}), 400], ["invalid JSON", "{oops", 400], ["a JSON array", "[1]", 400], ["a body that is too large", null, 413]]) {
    w = world();
    const res = await handleWaitlist(w.request({ body }), w.deps);
    ok(`${label} is refused with ${status} before any database work`, res.status === status && w.calls.join.length === 0 && w.calls.reserve.length === 0);
  }
  w = world();
  const unreadable = await handleWaitlist(w.request({ readBody: async () => { throw new Error("stream broke"); } }), w.deps);
  ok("a body that cannot be read is a 400, never a crash", unreadable.status === 400);

  w = world();
  const statuses = [];
  for (let i = 0; i < WAITLIST_LIMITS.hourlyPerVisitor + 1; i += 1) statuses.push((await handleWaitlist(w.request(), w.deps)).status);
  ok(`one visitor gets ${WAITLIST_LIMITS.hourlyPerVisitor} sign-ups an hour, then 429, and the extra one writes nothing`, statuses.slice(0, -1).every((s) => s === 200) && statuses.at(-1) === 429 && w.calls.join.length === WAITLIST_LIMITS.hourlyPerVisitor);
  const other = await handleWaitlist(w.request({ ip: "9.9.9.9" }), w.deps);
  ok("a different visitor is not affected by the first one's limit", other.status === 200);

  w = world();
  await handleWaitlist(w.request(), w.deps);
  ok("the per-visitor limit is reserved first, then the whole-list limit, both under the 'waitlist' scope with the shared limits",
    w.calls.reserve.map((r) => r.operation).join() === "waitlist_visitor_hourly,waitlist_total_hourly" && w.calls.reserve.every((r) => r.scope === "waitlist") && w.calls.reserve[0].limit === WAITLIST_LIMITS.hourlyPerVisitor && w.calls.reserve[1].limit === WAITLIST_LIMITS.hourlyTotal);
  w = world({ reserve: async (r) => { w.calls.reserve.push(r); return { allowed: r.operation !== "waitlist_visitor_hourly" }; } });
  const visitorDenied = await handleWaitlist(w.request(), w.deps);
  ok("when the visitor is over their limit, the whole-list total is not touched (a flood cannot use up everyone else's share)", visitorDenied.status === 429 && w.calls.reserve.length === 1);
  w = world({ reserve: async (r) => { w.calls.reserve.push(r); return { allowed: r.operation !== "waitlist_total_hourly" }; } });
  const totalDenied = await handleWaitlist(w.request(), w.deps);
  ok("when the whole list is full for the hour, the answer is 429 and nothing is written", totalDenied.status === 429 && w.calls.join.length === 0);

  for (const [label, over] of [["a failing rate limiter", { reserve: async () => { throw new Error("secret-detail-123"); } }], ["a failing database write", { join: async () => { throw new Error("secret-detail-123"); } }], ["a missing fingerprint secret", { env: { NXQ_LEAD_FINGERPRINT_SALT: undefined } }]]) {
    w = world(over);
    const res = await handleWaitlist(w.request(), w.deps);
    ok(`${label} gives one generic 500 that leaks no detail and writes nothing`, res.status === 500 && !JSON.stringify(res.body).includes("secret-detail-123") && w.calls.join.length === 0);
  }

  ok("emails: trimmed, lower-cased, and the sensible ones pass", normalizeEmail("  Fan@Example.COM ") === "fan@example.com" && normalizeEmail("a.b+c@d.co.uk") === "a.b+c@d.co.uk");
  ok("emails: bad shapes, control characters, non-strings and over-long ones are refused", ["", "a@b", "a b@c.de", "a@@b.co", "@b.co", "a@.co", "a@b.", "a@b\u0007.co", "a\u0000@b.co", null, 12, undefined].every((v) => normalizeEmail(v) === null)
    && normalizeEmail(`${"a".repeat(249)}@b.co`) !== null && normalizeEmail(`${"a".repeat(250)}@b.co`) === null);
  ok("sources: plain tags are kept lower-case; anything odd, empty or too long becomes 'direct'", normalizeSource(" Creator_A-1 ") === "creator_a-1" && ["", "a b", "drop table;", "x".repeat(WAITLIST_LIMITS.sourceMax + 1), null, 5].every((v) => normalizeSource(v) === "direct") && normalizeSource("x".repeat(WAITLIST_LIMITS.sourceMax)) !== "direct");
}

await handlerChecks(real, check);

// ---- planted bugs: each rule must be able to fail --------------------------------------------------------------------------------
const inputSource = read(P.input);
const mutants = [
  ["the off switch is ignored", [['deps.env("NXQ_WAITLIST_ENABLED") !== "true"', "false"]]],
  ["any origin is accepted", [["!allowedOrigins.length || !allowedOrigins.includes(input.origin)", "false"]]],
  ["the bot trap is removed", [['if (parsed.kind === "bot") return { status: 200, body: { ok: true, message: WAITLIST_OK_MESSAGE } };', ""]]],
  ["the per-visitor limit is removed", [["if (!perVisitor.allowed) return limited;", ""]]],
  ["the whole-list limit is removed", [["if (!total.allowed) return limited;", ""]]],
  ["the fingerprint secret becomes optional", [['if (!salt) throw new Error("fingerprint salt missing");', ""]]],
  ["emails are not lower-cased", [["const value = raw.trim().toLowerCase();", "const value = raw.trim();"]]],
  ["a failure leaks its detail", [["} catch {\n    return { status: 500,", "} catch (e) {\n    return { status: 500,"], ['error: "The waiting list is unavailable right now."', "error: String(e)"]]],
];
for (const [name, edits] of mutants) {
  let text = inputSource;
  const applied = edits.every(([from, to]) => { if (!text.includes(from)) return false; text = text.replace(from, to); return true; });
  const file = path.join(tmp, `mutant-${mutants.findIndex((m) => m[0] === name)}.mjs`);
  fs.writeFileSync(file, text);
  let caught = 0;
  if (applied) await handlerChecks(await importFile(file), (_name, cond) => { if (!cond) caught += 1; });
  check(`PLANTED BUG caught: ${name}`, applied && caught > 0, applied ? "no check failed" : "the edit did not apply, so the control proves nothing");
}

// ---- the form rules and the wording shared with the server ------------------------------------------------------------------------
check("the form wording, version and limits match the server file exactly", lib.WAITLIST_CONSENT_VERSION === real.WAITLIST_CONSENT_VERSION && lib.WAITLIST_CONSENT_TEXT === real.WAITLIST_CONSENT_TEXT && lib.WAITLIST_OK_MESSAGE === real.WAITLIST_OK_MESSAGE
  && lib.WAITLIST_EMAIL_MAX === real.WAITLIST_LIMITS.emailMax && lib.WAITLIST_SOURCE_MAX === real.WAITLIST_LIMITS.sourceMax);
check("emailProblem: empty and malformed addresses get plain words, good ones get null", /enter your email/.test(lib.emailProblem("  ")) && /does not look/.test(lib.emailProblem("nope")) && lib.emailProblem(" a@b.co ") === null && /does not look/.test(lib.emailProblem(`${"a".repeat(250)}@b.co`)));
check("sourceFromSearch: a creator tag is kept, anything odd is 'direct'", lib.sourceFromSearch("?ref=Creator_A") === "creator_a" && ["", "?ref=", "?ref=bad value!", "?other=1", `?ref=${"x".repeat(61)}`].every((s) => lib.sourceFromSearch(s) === "direct"));
check("summaryFromRpc: counts only, and odd data never crashes", JSON.stringify(lib.summaryFromRpc({ by_status: { pending: 2, confirmed: 1, bad: -1, worse: "x" }, by_source: { direct: 3 } })) === JSON.stringify({ byStatus: { pending: 2, confirmed: 1 }, bySource: { direct: 3 } })
  && [null, undefined, "x", 5, [], { by_status: null }].every((v) => { const s = lib.summaryFromRpc(v); return Object.keys(s.byStatus).length === 0 && Object.keys(s.bySource).length === 0; }));
check("totalOnList adds every status", lib.totalOnList({ byStatus: { pending: 2, confirmed: 3, invited: 1 }, bySource: {} }) === 6);
check("waveProblem: wave 1+ and 1 to 100 people pass; 0, 101, fractions and NaN do not", lib.waveProblem(1, 1) === null && lib.waveProblem(7, 100) === null && [[0, 5], [1, 0], [1, 101], [1.5, 5], [1, 2.5], [NaN, 5], [1, NaN]].every(([a, b]) => lib.waveProblem(a, b) !== null));
check("suggestedWave goes one past the last wave used", lib.suggestedWave(null) === 1 && lib.suggestedWave(0) === 1 && lib.suggestedWave(3) === 4 && lib.suggestedWave(2.5) === 1);
check("joinFailureMessage: 429, 400/413 and everything else each get a friendly line", /Too many/.test(lib.joinFailureMessage(429)) && /check your email/.test(lib.joinFailureMessage(400)) && lib.joinFailureMessage(413) === lib.joinFailureMessage(400) && /not open/.test(lib.joinFailureMessage(500)) && lib.joinFailureMessage(0) === lib.joinFailureMessage(500));
check("every status the database can store has a label", ["pending", "confirmed", "invited", "joined"].every((s) => typeof lib.waitlistStatusLabels[s] === "string"));

// ---- the gateway against a fake client, and against the SQL ----------------------------------------------------------------------
const gatewayCopy = path.join(tmp, "waitlistSupabaseGateway.ts");
fs.writeFileSync(gatewayCopy, read(P.gateway).replace('from "./waitlist"', `from "${pathToFileURL(P.lib).href}"`));
const { createWaitlistGateway } = await importFile(gatewayCopy);
const fake = (over = {}) => {
  const seen = [];
  return { seen, client: {
    functions: { invoke: over.invoke ?? (async (name, opts) => { seen.push(["invoke", name, opts]); return { data: { ok: true, message: "Welcome!" }, error: null }; }) },
    rpc: over.rpc ?? (async (name, args) => { seen.push(["rpc", name, args]); return { data: { by_status: { confirmed: 4 }, by_source: { direct: 4 }, invited: 25 }, error: null }; }),
  } };
};
let f = fake();
const joined = await createWaitlistGateway(f.client).join({ email: "a@b.co", source: "creator_a", honeypot: "" });
check("join calls the join-waitlist function with the email, the source and the bot-trap field, and passes its message on", joined.ok === true && joined.message === "Welcome!" && f.seen[0][1] === "join-waitlist" && JSON.stringify(f.seen[0][2]) === JSON.stringify({ body: { email: "a@b.co", source: "creator_a", company_website: "" } }));
f = fake({ invoke: async () => ({ data: null, error: Object.assign(new Error("x"), { context: { status: 429 } }) }) });
const limited = await createWaitlistGateway(f.client).join({ email: "a@b.co", source: "direct", honeypot: "" });
check("a 429 from the function becomes the 'too many' message, not a crash", limited.ok === false && /Too many/.test(limited.message));
f = fake({ invoke: async () => ({ data: { ok: false }, error: null }) });
check("an answer that is not ok:true is a failure, never shown as success", (await createWaitlistGateway(f.client).join({ email: "a@b.co", source: "direct", honeypot: "" })).ok === false);
f = fake();
const summary = await createWaitlistGateway(f.client).summary();
check("summary calls owner_waitlist_summary and maps the counts", summary.byStatus.confirmed === 4 && f.seen[0][1] === "owner_waitlist_summary");
const invited = await createWaitlistGateway(f.client).inviteWave(2, 25);
check("inviteWave sends exactly target_wave and target_count and returns how many were invited", invited === 25 && JSON.stringify(f.seen[1][2]) === JSON.stringify({ target_wave: 2, target_count: 25 }));
f = fake({ rpc: async () => ({ data: null, error: { message: "Owner access required." } }) });
let thrown = "";
try { await createWaitlistGateway(f.client).summary(); } catch (e) { thrown = e.message; }
check("a database error is thrown with its message (the owner screen shows it)", thrown === "Owner access required.");

const sqlFile = fs.readdirSync(P.sqlDir).find((n) => /prelaunch_waitlist\.sql$/.test(n));
check("the waitlist SQL file is where it should be", Boolean(sqlFile), P.sqlDir);
const sql = sqlFile ? read(`${P.sqlDir}/${sqlFile}`) : "";
const sqlArgs = (name, text = sql) => { const m = text.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`)); return m ? m[1].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean) : null; };
const callArgs = (source, name) => { const m = source.match(new RegExp(`rpc\\("${name}"(?:,\\s*\\{([^}]*)\\})?`)); return m ? (m[1] || "").split(",").map((p) => p.split(":")[0].trim()).filter(Boolean) : null; };
const gatewaySource = read(P.gateway);
const fnSource = read(P.fn);
for (const [source, label, name] of [[gatewaySource, "gateway", "owner_waitlist_summary"], [gatewaySource, "gateway", "owner_waitlist_invite_wave"], [fnSource, "function", "nxq_waitlist_join"]]) {
  const wanted = sqlArgs(name); const got = callArgs(source, name);
  check(`${label} calls ${name} with exactly the SQL's argument names`, Boolean(wanted) && Boolean(got) && JSON.stringify(wanted) === JSON.stringify(got), `sql=${wanted} call=${got}`);
}
const ingressSql = read(`${root}/supabase/migrations/204_atomic_ingress_capacity_reservations.sql`);
check("the function calls nxq_reserve_ingress_capacity with exactly that function's argument names", JSON.stringify(sqlArgs("nxq_reserve_ingress_capacity", ingressSql)) === JSON.stringify(callArgs(fnSource, "nxq_reserve_ingress_capacity")));
check("control: the comparison notices a wrong argument name", JSON.stringify(sqlArgs("nxq_waitlist_join")) !== JSON.stringify(["target_email", "target_source"]));
check("the SQL and the code agree on the limits (254-character addresses, 60-character tags, 1 to 100 people per wave)", /length\(email\) between 5 and 254/.test(sql) && /length\(source\) between 1 and 60/.test(sql) && /target_count not between 1 and 100/.test(sql)
  && real.WAITLIST_LIMITS.emailMax === 254 && real.WAITLIST_LIMITS.sourceMax === 60 && lib.MAX_INVITES_PER_WAVE === 100);
check("the SQL join function is service-role only and the owner functions are owner-checked", /nxq_waitlist_join[\s\S]*?service_role/.test(sql) && /revoke all on function public\.nxq_waitlist_join\(text, text, text\) from public, anon, authenticated/.test(sql) && (sql.match(/Owner access required/g) || []).length >= 2);

// ---- the function source: only an adapter ---------------------------------------------------------------------------------------
check("the function hands every request to handleWaitlist and uses the shared rate limiter and the SQL join", fnSource.includes("handleWaitlist(") && fnSource.includes('"nxq_waitlist_join"') && fnSource.includes('"nxq_reserve_ingress_capacity"'));
check("the function holds no rules of its own: it never mentions the switch or origin list (the handler owns them)", !/NXQ_WAITLIST_ENABLED|NXQ_WAITLIST_ALLOWED_ORIGINS/.test(fnSource.replace(/\/\/.*$/gm, "")));
check("the function creates its database client only when a call needs it (a switched-off request touches no secret)", /let adminClient[\s\S]*function admin\(\)/.test(fnSource) && !/^const admin = createClient/m.test(fnSource));
check("no secret value is written anywhere in the function", !/eyJ[A-Za-z0-9_-]{20,}|sk_(live|test)_|service_role_key\s*=\s*["']/.test(fnSource));

// ---- the OFF switch and the screens ----------------------------------------------------------------------------------------------
const configSource = read(P.config);
const switchIsOff = (text) => { const code = text.replace(/^\s*\/\/.*$/gm, ""); return /export const waitlistGateway: WaitlistGateway \| null = null;/.test(code) && !/from "\.\/supabaseClient"/.test(code); };
check("the one switch is OFF (null) and does not import the database client", switchIsOff(configSource));
check("control: a switch that is turned on would be noticed", !switchIsOff(configSource.replace("= null;", "= supabase ? createWaitlistGateway(supabase) : null;")));
const srcFiles = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const full = `${dir}/${e.name}`; if (e.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(full); } })(isDraft ? here : `${root}/src`);
check("nothing imports the real gateway while the switch is off (only comments mention it)", srcFiles.filter((file) => /^import[^\n]*waitlistSupabaseGateway/m.test(read(file))).length === 0);
const publicPage = read(P.publicPage);
check("the sign-up page makes no request while the switch is off (it stops before any call) and shows 'not open yet'", publicPage.includes("if (!waitlistGateway || busy) return;") && publicPage.includes('data-testid="waitlist-closed"') && !/\bfetch\(/.test(publicPage));
check("the sign-up page collects one address, one consent box and the hidden bot-trap field, nothing else", (publicPage.match(/<input /g) || []).length === 3 && /name="company_website"[^>]*tabIndex=\{-1\}/.test(publicPage) && publicPage.includes('aria-hidden="true"') && /type="email"/.test(publicPage) && /type="checkbox"/.test(publicPage));
check("the sign-up page shows the consent sentence and does not store anything on the device", publicPage.includes("WAITLIST_CONSENT_TEXT") && !/localStorage|sessionStorage/.test(publicPage));
const ownerPage = read(P.ownerPage);
check("the owner page says plainly that inviting a wave sends no email, and asks before marking anyone", /does not send any email/.test(ownerPage) && ownerPage.includes("window.confirm(") && ownerPage.includes("waveProblem("));
check("the owner page shows counts only, never email addresses", !/\.email\b/.test(ownerPage) && !/email address/i.test(ownerPage.replace(/never email addresses/g, "")));

// ---- after promotion: the wiring (skipped while this is still a draft) ----------------------------------------------------------
if (!isDraft) {
  const manifest = read(`${root}/scripts/edge-function-manifest.mjs`);
  check("the function is in the manifest with no gateway JWT and the waitlist boundary", /entry\("join-waitlist", false, "public-waitlist-origin"\)/.test(manifest));
  check("supabase/config.toml keeps the function's JWT check off", /\[functions\.join-waitlist\]\s*\n\s*verify_jwt = false/.test(read(`${root}/supabase/config.toml`)));
  check("the stage-readiness check proves the waitlist boundary from the function source", /"public-waitlist-origin": \[/.test(read(`${root}/scripts/check-runtime-stage-readiness.mjs`)));
  const app = read(`${root}/src/App.tsx`);
  check("/waitlist is public and /owner/waitlist is behind the owner login", /path === "\/waitlist"\) return <PublicWaitlist \/>/.test(app) && /path === "\/owner\/waitlist"\) return <OwnerProtectedRoute><OwnerWaitlist \/><\/OwnerProtectedRoute>/.test(app));
  check("the owner portal links to the waiting list", read(`${root}/src/pages/OwnerPortal.tsx`).includes('href="/owner/waitlist"'));
  check("the built-routes smoke check lists /waitlist", /"\/waitlist"/.test(read(`${root}/scripts/smoke-built-routes.mjs`)));
  check("test:store runs this test", read(`${root}/scripts/run-store-tests.mjs`).includes('"test-waitlist"'));
}

console.log(failures ? `\n${failures} waitlist check(s) failed.` : "\nWaitlist test passed.");
process.exit(failures ? 1 : 0);
