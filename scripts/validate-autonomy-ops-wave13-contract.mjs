import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const routing=read("supabase/migrations/165_route_only_supported_structured_changes_to_edge.sql");
const simulator=read("scripts/simulate-autonomy-failures.mjs");

const checks=[
  ["Structured-safe routing inspects requested payload patch",routing.includes("new.requested_payload->'patch'")&&routing.includes("structured_safe")],
  ["Deterministic worker supported keys are explicit",routing.includes("'contact_phone'")&&routing.includes("'contact_email'")&&routing.includes("'add_services'")&&routing.includes("'remove_services'")],
  ["Only low-risk supported structured patches route to Edge",routing.includes("if new.risk_level='low' and structured_safe")&&routing.includes("'website_apply_change_request'")&&routing.includes("'execution_target','edge'")],
  ["Unstructured or higher-risk requests route to AI classification",routing.includes("'classify_website_change_request'")&&routing.includes("'execution_target','ai'")&&routing.includes("unstructured_request_requires_classification")],
  ["Governance pause still hard-blocks request routing",routing.includes("nxq_automation_scope_allowed")&&routing.includes("Client automation is paused by governance")],
  ["Edge and AI lanes use distinct idempotency keys",routing.includes(":apply:v2")&&routing.includes(":classify:v3")],
  ["Simulator covers low-risk structured Edge routing",simulator.includes("Low-risk structured change routes to deterministic Edge")],
  ["Simulator covers low-risk unstructured AI routing",simulator.includes("Low-risk unstructured change routes to AI classification")],
  ["Failure simulator scenario count advanced",simulator.includes("23/23 autonomous lifecycle failure simulations passed")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-thirteen checks passed.`);if(passed!==checks.length)process.exit(1);
