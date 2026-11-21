import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const worker=read("supabase/functions/classify-business-change-request/index.ts");
const compactWorker=worker.replace(/\s+/g,"");
const readiness=read("supabase/migrations/222_unify_change_classifier_ai_provider.sql");
const routing=read("supabase/migrations/221_strict_structured_change_routing.sql");
const checks=[
["Classifier reports explicit provider configuration",worker.includes("provider_configured: providerConfigured")&&worker.includes('target_status: providerConfigured ? "healthy" : "degraded"')],
["Classifier reports database trigger as routing authority",compactWorker.includes('routing_authority:"database_trigger"')],
["Classifier handles only explicit contact payloads deterministically",compactWorker.includes("deterministicResult(requestedPayload:unknown)")&&compactWorker.includes("record(record(requestedPayload).patch)")&&worker.includes("contact_email")&&worker.includes("contact_phone")],
["Staging without an AI provider safely routes ambiguous changes to owner review",compactWorker.includes('stagingOnlyFallbackAllowed=newSet(["staging","stage","development","dev","test","qa"])')&&compactWorker.includes('!providerConfigured&&stagingOnlyFallbackAllowed')&&compactWorker.includes('route:"owner_review"')&&worker.includes('staging-owner-review-v1')],
["No-provider fallback remains staging-only and production fails closed",worker.includes('NXQ_RUNTIME_ENVIRONMENT')&&worker.includes('AI model provider is not configured.')&&!worker.includes('production", "prod')],
["AI classifier shares the protected model-provider contract",["NXQ_AI_MODEL_PROVIDER_URL","NXQ_AI_MODEL_PROVIDER_TOKEN","NXQ_AI_MODEL_PROVIDER_MODEL","NXQ_AI_MODEL_PROVIDER_PROTOCOL"].every((name)=>worker.includes(name))&&!worker.includes("NXQ_AI_CLASSIFIER_URL")&&!worker.includes("NXQ_AI_CLASSIFIER_TOKEN")],
["AI provider timeout remains bounded",compactWorker.includes("controller.abort(),15_000")],
["Classifier no longer directly enqueues Edge job",!worker.includes('target_job_type:"website_apply_change_request"')&&!worker.includes('target_idempotency_key:`change-request:')],
["Safe classifier result returns request to submitted routing state",compactWorker.includes('status:"submitted"')&&compactWorker.includes('route:"classifier_to_structured_edge"')],
["Database trigger remains the structured Edge queue authority",routing.includes("route_submitted_change_request")&&routing.includes("website_apply_change_request")],
["Readiness requires recent healthy heartbeat",readiness.includes("recent_healthy_worker_heartbeat")&&readiness.includes("heartbeat_status='healthy'")],
["Readiness requires explicit provider proof",readiness.includes("provider_configured:=")&&readiness.includes("and provider_configured")],
["Readiness requires a real successful provider call",readiness.includes("into provider_call_proven")&&readiness.includes("provider_key='change_classifier_ai'")&&readiness.includes("last_success_at is not null")&&readiness.includes("and provider_call_proven")&&worker.includes("provider_call_proven: true")],
["Readiness requires single routing authority proof",readiness.includes("single_router_proven")&&readiness.includes("database_trigger")],
["Missing classifier evidence remains unknown",readiness.includes("then 'ready' else 'unknown'")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-sixteen checks passed.`);if(passed!==checks.length)process.exit(1);
