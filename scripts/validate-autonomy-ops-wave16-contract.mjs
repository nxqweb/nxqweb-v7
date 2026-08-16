import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const worker=read("supabase/functions/classify-business-change-request/index.ts");
const readiness=read("supabase/migrations/175_harden_change_classifier_readiness.sql");
const routing=read("supabase/migrations/221_strict_structured_change_routing.sql");
const checks=[
["Classifier reports explicit adapter configuration",worker.includes("adapter_configured:adapterConfigured")&&worker.includes('target_status:adapterConfigured?"healthy":"degraded"')],
["Classifier reports database trigger as routing authority",worker.includes('routing_authority:"database_trigger"')],
["Classifier handles only explicit contact payloads deterministically",worker.includes("deterministicResult(requestedPayload:unknown)")&&worker.includes("record(record(requestedPayload).patch)")&&worker.includes("contact_email")&&worker.includes("contact_phone")],
["AI adapter requires both URL and dedicated token",worker.includes("NXQ_AI_CLASSIFIER_URL")&&worker.includes("NXQ_AI_CLASSIFIER_TOKEN")&&worker.includes("if(!adapterUrl||!adapterToken)")],
["AI adapter timeout remains bounded",worker.includes("controller.abort(),15000")],
["Classifier no longer directly enqueues Edge job",!worker.includes('target_job_type:"website_apply_change_request"')&&!worker.includes('target_idempotency_key:`change-request:')],
["Safe classifier result returns request to submitted routing state",worker.includes('status:"submitted"')&&worker.includes('route:"classifier_to_structured_edge"')],
["Database trigger remains the structured Edge queue authority",routing.includes("route_submitted_change_request")&&routing.includes("website_apply_change_request")],
["Readiness requires recent healthy heartbeat",readiness.includes("recent_healthy_worker_heartbeat")&&readiness.includes("heartbeat_status='healthy'")],
["Readiness requires explicit adapter proof",readiness.includes("adapter_configured:=")&&readiness.includes("and adapter_configured")],
["Readiness requires single routing authority proof",readiness.includes("single_router_proven")&&readiness.includes("database_trigger")],
["Missing classifier evidence remains unknown",readiness.includes("then 'ready' else 'unknown'")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-sixteen checks passed.`);if(passed!==checks.length)process.exit(1);
