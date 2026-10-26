// Offline guard for DRAFT migration 12 (test clients stop counting as revenue, owner chose "Draft it" on 2026-10-26). The database behaviour is proven by its sidecar test on a real
// Postgres (scripts/test-local-full-schema.mjs); this checks the draft, its test and the app stay in step, and that the draft stays small and safe.
import fs from "node:fs";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const norm = (text) => text.replace(/\s+/g, " ").trim();
const mig = fs.readFileSync("docs/drafts/migrations/12_complimentary_clients_excluded_from_revenue.sql", "utf8");
const side = fs.readFileSync("docs/drafts/migrations/12_complimentary_clients_excluded_from_revenue.test.sql", "utf8");
const old = fs.readFileSync("supabase/migrations/217_scalable_owner_portal_read_models.sql", "utf8");
const page = fs.readFileSync("src/pages/OwnerBillingLifecycle.tsx", "utf8");

const label = norm(mig.slice(mig.indexOf("update public.clients"), mig.indexOf(";", mig.indexOf("update public.clients")) + 1));
check("the label statement in the draft is word for word the one its test ran", label.length > 100 && norm(side).includes(label.replace(/;$/, "")));
check("it labels only the four staging test clients by exact name, only while active, never qa_only, and is safe to run twice", /business_name in \('Tier Test Starter', 'Tier Test Growth', 'Tier Test Intelligence', 'Tier Test Enterprise'\)/.test(label) && /billing_status::text = 'active'/.test(label) && /coalesce\(qa_only, false\) = false/.test(label) && /coalesce\(billing_provider, ''\) <> 'complimentary'/.test(label));
const summary = mig.slice(mig.indexOf("create or replace function public.owner_portal_summary()"), mig.indexOf("comment on function"));
const oldSummary = old.slice(old.indexOf("create or replace function public.owner_portal_summary()"), old.indexOf("comment on function public.owner_portal_summary()"));
const sig = (text) => norm(text.slice(text.indexOf("returns table"), text.indexOf("as $$")));
check("the new summary keeps the same columns, owner-only check, security and grants as migration 217", sig(summary) === sig(oldSummary) && summary.includes("Owner access required.") && summary.includes("revoke all on function public.owner_portal_summary() from public, anon;") && summary.includes("grant execute on function public.owner_portal_summary() to authenticated, service_role;"));
check("exactly the two money sums skip complimentary clients; the two counts do not", (summary.match(/coalesce\(c\.billing_provider, ''\) <> 'complimentary'/g) || []).length === 2 && /select count\(\*\) from public\.clients\)::bigint/.test(summary) && /billing_status::text = 'active'\)::bigint/.test(summary));
check("the draft stays small: no new table or column, nothing about intakes or onboarding (the style backfill is a separate owner decision)", !/create table|add column|alter table/i.test(mig) && !/client_intakes|client_onboarding_state|desired_style/.test(mig.replace(/^--.*$/gm, "")));
check("the owner's free-activation button writes provider complimentary, and only that button does", /changeBillingState\(client, "active", "complimentary"\)/.test(page) && /next_billing_provider: provider \|\| client\.billing_provider \|\| "manual"/.test(page));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
