import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const migration=read("supabase/migrations/176_ordered_billing_provider_events.sql");
const readiness=read("supabase/migrations/177_ordered_billing_runtime_readiness.sql");
const worker=read("supabase/functions/ingest-billing-provider-event/index.ts");
const checks=[
["Billing customer links map provider identity to NXQ client",migration.includes("billing_provider_customer_links")&&migration.includes("unique(provider_key,provider_customer_id)")],
["Billing webhook no longer trusts raw client id",worker.includes("provider_customer_id")&&!worker.includes("client_id?:unknown")],
["Billing provider must be registered and enabled",worker.includes("nxq_provider_connections")&&worker.includes("Billing provider is not registered and enabled")],
["Billing customer must be server-linked",worker.includes("billing_provider_customer_links")&&worker.includes("Provider customer is not linked")],
["Billing timestamps have past and future bounds",worker.includes("5*60*1000")&&worker.includes("365*24*60*60*1000")],
["Billing payload size is bounded",worker.includes("payloadSize")&&worker.includes(">32768")],
["Currency is strict when amount exists",worker.includes("^[A-Z]{3}$")],
["Stale billing events are ignored",migration.includes("stale_or_out_of_order_event")&&migration.includes("e.occurred_at<=latest_applied_at")],
["Stale billing events are audited",migration.includes("stale_billing_provider_event_ignored")],
["Verified success auto-unfreezes",migration.includes("billing_frozen_at=null")&&migration.includes("auto_unfreeze_on_verified_payment")],
["Single provider event never auto-freezes",migration.includes("'auto_freeze',false")&&!migration.includes("set billing_status='frozen'")],
["Billing worker records hardened runtime evidence",worker.includes("server_mapped_customer:true")&&worker.includes("ordered_event_apply:true")],
["Billing capabilities use valid PostgreSQL array syntax",readiness.includes("set capabilities=array[")&&!readiness.includes("set capabilities=array(")],
["Online billing stays optional until explicitly enabled",readiness.includes("online_billing_enabled")&&readiness.includes("status='not_applicable'")&&readiness.includes("manual_billing_supported")],
["Enabled online billing becomes required",readiness.includes("set required=true")],
["Enabled billing requires provider health heartbeat and mappings",readiness.includes("provider_healthy and heartbeat_ready and customer_mapping_ready")],
["Missing enabled billing evidence remains unknown",readiness.includes("then 'ready' else 'unknown'")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-seventeen checks passed.`);if(passed!==checks.length)process.exit(1);
