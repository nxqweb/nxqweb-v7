import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const worker=read("supabase/functions/classify-business-change-request/index.ts");
const dispatch=read("supabase/migrations/166_change_classifier_dispatch_readiness.sql");
const exceptions=read("supabase/migrations/167_change_request_owner_exception_visibility.sql");
const checks=[
["Classifier worker consumes AI change jobs",worker.includes('target_execution_target:"ai"')&&worker.includes('target_job_types:["classify_website_change_request"]')],
["Classifier requires protected worker token",worker.includes('NXQ_AUTOMATION_WORKER_TOKEN')&&worker.includes('x-nxq-worker-token')],
["Classifier adapter URL is protected environment configuration",worker.includes('NXQ_AI_CLASSIFIER_URL')&&!worker.includes('https://api.openai.com')],
["Classifier adapter timeout is bounded",worker.includes('setTimeout(()=>controller.abort(),15000)')],
["Classifier accepts only safe patch needs-info or owner-review",worker.includes('"safe_patch"|"needs_info"|"owner_review"')],
["Safe AI patch needs high confidence",worker.includes('result.confidence<0.9')],
["Safe AI patch keys are allowlisted",worker.includes('supportedPatchKeys')&&worker.includes('keys.some((k)=>!supportedPatchKeys.has(k))')],
["Safe AI result routes back into deterministic Edge worker",worker.includes('target_job_type:"website_apply_change_request"')&&worker.includes('execution_target:"edge"')],
["Needs-info never becomes automatic edit",worker.includes('status:"needs_info"')],
["Unsafe classifier output becomes owner review",worker.includes('status:"blocked"')&&worker.includes('route:"owner_review"')],
["Classifier dispatcher is Vault backed",dispatch.includes('vault.decrypted_secrets')&&dispatch.includes('nxq_change_classifier_edge_url')&&dispatch.includes('nxq_automation_worker_token')],
["Classifier dispatcher runs automatically",dispatch.includes("nxq-change-classifier-every-minute")&&dispatch.includes("'* * * * *'")],
["Classifier readiness is required",dispatch.includes("'change_classifier_ready'")&&dispatch.includes(',true)')],
["Missing runtime classifier evidence remains unknown",dispatch.includes("then 'ready' else 'unknown'")],
["Classifier readiness requires recent worker heartbeat",dispatch.includes("worker_key='classify-business-change-request'")&&dispatch.includes("interval '15 minutes'")],
["Blocked change requests enter owner exception center",exceptions.includes("'source','change_request'")&&exceptions.includes("where r.status in ('blocked','failed')")],
["Owner exception RPC remains owner gated",exceptions.includes("owner_users.auth_user_id=auth.uid()")&&exceptions.includes("Owner access required")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-fourteen checks passed.`);if(passed!==checks.length)process.exit(1);