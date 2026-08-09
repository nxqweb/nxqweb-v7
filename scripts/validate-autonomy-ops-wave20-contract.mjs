import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const migration=read("supabase/migrations/180_owner_billing_provider_controls.sql");
const panel=read("src/components/OwnerBillingProviderPanel.tsx");
const page=read("src/pages/OwnerBillingLifecycle.tsx");
const checks=[
["Billing provider summary is owner gated",migration.includes("owner_billing_provider_summary")&&migration.includes("Owner access required")],
["Billing provider summary exposes bounded events",migration.includes("limit 100")&&migration.includes("recent_events")],
["Billing provider summary exposes no secret values",migration.includes("secret_values_exposed',false")&&migration.includes("direct_charge_action_available',false")],
["Provider customer mapping is owner gated",migration.includes("owner_link_billing_provider_customer")&&migration.includes("Owner access required")],
["Provider customer cannot map to another client",migration.includes("already linked to another NXQ client")&&migration.includes("client_id<>target_client_id")],
["Provider mapping never processes charge",migration.includes("charge_processed',false")],
["Online billing enable is explicit owner action",migration.includes("owner_set_online_billing_enabled")&&migration.includes("online_billing_enabled")],
["Enabling billing resets readiness to unknown",migration.includes("when target_enabled then 'unknown' else 'not_applicable'")],
["Manual billing remains supported",migration.includes("manual_billing_supported',true")],
["Billing panel reads narrow summary RPC",panel.includes('rpc("owner_billing_provider_summary")')],
["Billing panel maps customers through narrow RPC",panel.includes('rpc("owner_link_billing_provider_customer"')],
["Billing panel enables provider through narrow RPC",panel.includes('rpc("owner_set_online_billing_enabled"')],
["Billing panel never exposes a charge button",!panel.includes("Charge now")&&!panel.includes("processPayment")&&panel.includes("No charge was processed")],
["Billing panel explains secret values are hidden",panel.includes("Values are never shown here")],
["Billing lifecycle embeds provider panel",page.includes("OwnerBillingProviderPanel")&&page.includes("<OwnerBillingProviderPanel/>")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty checks passed.`);if(passed!==checks.length)process.exit(1);
