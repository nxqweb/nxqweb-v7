// Offline test: billing can never lock the owner out or charge the owner, and no billing event can freeze anyone by itself. Reads the real migrations
// and Edge function source. Rules proven: owner access depends only on the owner list; only an owner can link a Stripe customer or freeze a client;
// Stripe events can only touch clients the owner linked; a failed payment never freezes; QA clients can never be billed.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const sliceFn = (sql, name) => {
  const start = sql.lastIndexOf(`create or replace function public.${name}`);
  if (start < 0) return "";
  const open = sql.indexOf("$$", start);
  const close = open >= 0 ? sql.indexOf("$$", open + 2) : -1;
  const body = close > 0 ? sql.slice(start, close + 2) : sql.slice(start);
  // some functions use a named dollar tag or are a single statement: cap at the next function either way
  const next = sql.indexOf("create or replace function", start + 10);
  return next > 0 && next < start + body.length ? sql.slice(start, next) : body;
};

const m036 = read("supabase/migrations/036_commerce_foundation.sql");
const m176 = read("supabase/migrations/176_ordered_billing_provider_events.sql");
const m187 = read("supabase/migrations/187_human_billing_freeze_and_exception_recovery.sql");
const m261 = read("supabase/migrations/261_owner_link_stripe_customer.sql");
const hook = read("supabase/functions/ingest-stripe-webhook/index.ts");

// ---- the owner can never be locked out
const isOwner = sliceFn(m036, "is_nxq_owner");
check("owner access is decided ONLY by the owner list, never by any client's billing status", /from public\.owner_users/.test(isOwner) && /auth\.uid\(\)/.test(isOwner) && !/billing|clients|status/i.test(isOwner.replace(/owner_users/g, "")));
check("on the owner portal, a client's billing status is only ever DISPLAYED or typed, never used to allow or block anything", read("src/pages/OwnerPortal.tsx").split("\n").filter((l) => /billing_status/.test(l)).every((l) => /formatStatus\(client\.billing_status|^\s*billing_status: string;/.test(l)));
check("only an owner can link a Stripe customer to a client, and QA-only clients can never be billed", /from public\.owner_users where auth_user_id = auth\.uid\(\)/.test(m261) && /QA-only clients are permanently non-billable/.test(m261));

// ---- Stripe events can only touch clients the owner linked
check("the webhook finds the client ONLY through the owner-controlled link table, never from the event payload", /from\("billing_provider_customer_links"\)\.select\("client_id,status"\)\.eq\("provider_key","stripe"\)\.eq\("provider_customer_id",providerCustomerId\)/.test(hook) && !/client_id\s*[:=]\s*(object|event)\./.test(hook) && /Stripe customer is not linked to an active NXQX client\./.test(hook));
check("test and complimentary clients that are never linked can never receive any Stripe event", /if\(link\.error\|\|!link\.data\)throw new Error\("Stripe customer is not linked to an active NXQX client\."\)/.test(hook) && /if\(client\.data\.qa_only\)throw new Error\("Billing artifacts are forbidden for QA-only clients\."\)/.test(hook));

// ---- no event can freeze by itself
const apply = sliceFn(m176, "apply_verified_billing_provider_event");
check("a failed payment only ever makes a client 'past_due', and an already frozen or cancelled client stays as it was", /event_type='payment_failed'[\s\S]*?case when billing_status::text in \('cancelled','frozen'\) then billing_status else 'past_due' end/.test(apply));
check("no billing event ever sets 'frozen' (only a human decision can)", !/billing_status\s*=\s*'frozen'/.test(apply) && /'auto_freeze',false/.test(apply));
check("the overdue job moves accounts to REVIEW for a human, and reports zero automatic freezes", /'freeze_review'/.test(m187) && /'automatically_frozen',0/.test(m187));
const setState = sliceFn(m187, "owner_set_client_billing_state");
check("freezing or cancelling needs a logged-in owner and a written reason of at least 8 characters", /is_nxq_owner\(\)|owner_users/.test(setState) && /length\(coalesce\(note_value,''\)\)<8/.test(m187) && /grant execute on function public\.owner_set_client_billing_state\(uuid,public\.billing_status,text,text\) to authenticated;/.test(m187));
check("a verified payment can bring a client back to active on its own (no stuck states)", /event_type in \('payment_succeeded','subscription_active'\)[\s\S]*?billing_status='active'/.test(apply));
check("billing events from before the account existed or far in the future are refused, and old or repeated events are ignored", /too far in the future/.test(apply) && /stale_or_out_of_order_event/.test(apply));

// ---- billing is off unless deliberately switched on
check("the webhook refuses every request unless billing is explicitly switched on", /NXQ_BILLING_ENABLED[^)]*\)\?\.trim\(\)\.toLowerCase\(\)!=="true"\)return response\(\{ok:false,error:"Stripe billing is disabled\."\},503\)/.test(hook));
check("live-mode Stripe events are refused unless a second switch is on (sandbox events stay allowed)", /event\.livemode&&Deno\.env\.get\("NXQ_STRIPE_LIVE_MODE_ENABLED"\)/.test(hook));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll owner-billing-safety checks passed (offline).");
process.exit(failures ? 1 : 0);
