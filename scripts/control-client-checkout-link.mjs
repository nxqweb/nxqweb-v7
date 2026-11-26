// CONTROL RUN for scripts/test-client-checkout-link.mjs (2026-11-26). A test that cannot fail proves nothing, so this copies the draft checkout-link code to a
// throwaway folder, breaks ONE safety rule at a time, and demands that the test goes red for each. It also demands that the untouched copy stays green.
// Read-only for the repo: everything happens in a temp folder that is removed at the end. No network, no keys. Run: `npm run test:checkout-link-control`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fn = "docs/drafts/functions/create-client-checkout-link";
const copy = [
  "scripts/test-client-checkout-link.mjs", "scripts/edge-function-manifest.mjs", "supabase/config.toml",
  `${fn}/stripe.ts`, `${fn}/core.ts`, `${fn}/index.ts`, `${fn}/checkout-completed.ts`, `${fn}/README.md`, `${fn}/ingest-stripe-webhook.checkout-completed.patch`,
  "docs/drafts/migrations/13_stripe_checkout_links.sql", "supabase/functions/ingest-stripe-webhook/index.ts",
];

// [name, file, exact text to find, text to put instead]
const mutants = [
  ["a live key is accepted even when live mode is off", `${fn}/stripe.ts`, `if (mode === "live" && !liveAllowed)`, `if (false)`],
  ["a page on any host is handed out (hosted-page check removed)", `${fn}/stripe.ts`, `page.hostname !== CHECKOUT_HOST`, `false`],
  ["the $10 minimum is removed", `${fn}/stripe.ts`, `input.amountCents < MIN_AMOUNT_CENTS ||`, `false ||`],
  ["the return host allow-list is removed", `${fn}/stripe.ts`, `if (!allowedHosts.map((h) => h.toLowerCase()).includes(parsed.hostname.toLowerCase()))`, `if (false)`],
  ["a protocol-relative return path is accepted", `${fn}/stripe.ts`, ` || path.startsWith("//")`, ``],
  ["the Stripe answer mode is no longer compared with the key's mode", `${fn}/stripe.ts`, `if (body.livemode !== (expected.mode === "live")) return unusable("session_mode_mismatch");`, ``],
  ["the idempotency key for the session changes on every call (retries would duplicate)", `${fn}/stripe.ts`, "`nxq-checkout-${input.attemptId}`", "`nxq-checkout-${Math.random()}`"],
  ["an 'unknown' Stripe answer (500, 429) is treated as a definite refusal", `${fn}/stripe.ts`, `const definite = status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;`, `const definite = status >= 400;`],
  ["Stripe error text that echoes the key is copied into the reason", `${fn}/stripe.ts`, `code = /^[a-z]+(_[a-z]+){0,5}$/.test(raw) ? raw : "";`, `code = raw.replace(/[^A-Za-z0-9_]/g, "");`],
  ["the customer is not required to be linked before the link is handed out", `${fn}/core.ts`, `if (!linked) return fail("customer_link_failed", false);`, ``],
  ["a session that could not be recorded is handed out anyway", `${fn}/core.ts`, `if (!recorded) return fail("session_not_recorded", false);`, ``],
  ["the database is not asked first (reserve skipped for an invalid client id)", `${fn}/core.ts`, `if (!uuidPattern.test(input.clientId || "")) return { ok: false, reason: "client_id_invalid", retrySafe: false };`, ``],
  ["a checkout NXQX did not create can mark a client as finished", `${fn}/checkout-completed.ts`, `if (String(metadata.nxq_client_id ?? "") !== clientId) return { ok: false, reason: "not_an_nxqx_checkout" };`, ``],
  ["an unpaid checkout counts as finished", `${fn}/checkout-completed.ts`, `if (object.payment_status !== "paid" && object.payment_status !== "no_payment_required")`, `if (false)`],
  ["the handler no longer needs the second off switch", `${fn}/index.ts`, ` || !on("NXQ_STRIPE_CHECKOUT_ENABLED")`, ``],
  ["the migration lets any signed-in user call the reserve function", "docs/drafts/migrations/13_stripe_checkout_links.sql", `revoke all on function public.nxq_checkout_reserve(uuid, uuid) from public, anon, authenticated;`, `grant execute on function public.nxq_checkout_reserve(uuid, uuid) to authenticated;`],
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nxq-checkout-control-"));
function stage(dir) {
  for (const rel of copy) { const to = path.join(dir, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(rel, to); }
  fs.mkdirSync(path.join(dir, "supabase/migrations"), { recursive: true });
}
const runTest = (dir) => spawnSync("node", ["scripts/test-client-checkout-link.mjs"], { cwd: dir, encoding: "utf8", timeout: 120000 });

let bad = 0;
try {
  const clean = path.join(root, "clean"); stage(clean);
  const baseline = runTest(clean);
  const baselineOk = baseline.status === 0 && !/^FAIL/m.test(baseline.stdout);
  console.log(`${baselineOk ? "PASS" : "FAIL"}  untouched copy stays green`);
  if (!baselineOk) { bad += 1; console.log(baseline.stdout.split("\n").filter((l) => l.startsWith("FAIL")).join("\n")); }
  mutants.forEach(([name, file, from, to], i) => {
    const dir = path.join(root, `m${i}`); stage(dir);
    const target = path.join(dir, file); const text = fs.readFileSync(target, "utf8");
    if (text.split(from).length !== 2) { bad += 1; console.log(`FAIL  mutant "${name}": the text to break was not found exactly once (the control run is stale)`); return; }
    fs.writeFileSync(target, text.replace(from, () => to));
    const result = runTest(dir);
    const caught = result.status !== 0 && /^FAIL/m.test(result.stdout);
    if (!caught) bad += 1;
    console.log(`${caught ? "PASS" : "FAIL"}  test goes red when: ${name}`);
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(bad ? `\n${bad} control check(s) failed: the test would not notice a broken rule.` : `\nAll ${mutants.length + 1} control checks passed: each broken rule turned the test red.`);
process.exit(bad ? 1 : 0);
