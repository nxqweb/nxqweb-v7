import fs from "node:fs";

const read=(path)=>fs.readFileSync(path,"utf8");
const edge=read("supabase/functions/ingest-stripe-webhook/index.ts");
const migration=read("supabase/migrations/227_stripe_ready_billing_adapter.sql");
const client=read("src/pages/ClientCommerceLiveStore.tsx");
const publicStore=read("src/pages/PublicCommerceStorefront.tsx");
const config=read("supabase/config.toml");

const checks=[
  ["Stripe billing fails closed by default",edge.includes('NXQ_BILLING_ENABLED')&&edge.includes('Stripe billing is disabled')],
  ["Webhook signature uses raw payload and five-minute tolerance",edge.includes('stripe-signature')&&edge.includes('`${timestamp}.${raw}`')&&edge.includes('>300')],
  ["Stripe customers resolve through server links",edge.includes('billing_provider_customer_links')&&edge.includes('provider_customer_id')&&!edge.includes('client_id?:')],
  ["Disposable QA billing is explicitly rejected",edge.includes('qa_only')&&edge.includes('Billing artifacts are forbidden for QA-only clients')],
  ["Stripe storefront orders also reject disposable QA",migration.includes('qa_only_client')&&migration.includes("if qa_only_client then raise exception 'Billing artifacts are forbidden for QA-only clients.'")],
  ["Provider events are idempotent and ordered",edge.includes('provider_event_id')&&edge.includes('apply_verified_billing_provider_event')],
  ["Only normalized billing events are accepted",edge.includes('invoice.paid')&&edge.includes('customer.subscription.deleted')],
  ["Stripe provider starts disabled",migration.includes("'stripe','payments','global','not_configured'")&&migration.includes("'online_billing_enabled',false")],
  ["Only public Stripe Payment Links enter client UI",client.includes('https://buy.stripe.com/')&&client.includes('Never enter a Stripe secret key')],
  ["Public storefront prefers Stripe without removing legacy records",publicStore.includes('Continue to Stripe')&&migration.includes('paypal_link_legacy')],
  ["Stripe-only checkout reuses the hardened inventory order primitive",migration.includes('transaction-local compatibility value')&&migration.includes('public.create_public_direct_payment_order')&&migration.includes('settings=original_settings')],
  ["Stripe webhook is in the deployment manifest",config.includes('[functions.ingest-stripe-webhook]')],
];

let failures=0;
for(const [label,ok] of checks){console.log(`${ok?"PASS":"FAIL"} ${label}`);if(!ok)failures++;}
if(failures){console.error(`Stripe readiness contract failed: ${failures}/${checks.length}`);process.exit(1);}
console.log(`Stripe readiness contract passed: ${checks.length}/${checks.length}`);
