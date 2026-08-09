import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const pref=read("supabase/migrations/154_notification_preferences_and_digest_batching.sql");
const policy=read("supabase/migrations/155_notification_delivery_policy_decisions.sql");
const notifyWorker=read("supabase/functions/dispatch-notifications/index.ts");
const seoWorker=read("supabase/functions/build-business-seo-artifacts/index.ts");
const seoDispatch=read("supabase/migrations/156_schedule_business_seo_artifact_worker.sql");
const checks=[
  ["Notification preferences are tenant scoped",pref.includes("client_notification_preferences")&&pref.includes("auth_user_id=auth.uid()")],
  ["Notification policy has explicit delivery decisions",policy.includes("'immediate'")&&policy.includes("'digest'")&&policy.includes("'defer'")&&policy.includes("'blocked'")],
  ["Quiet hours return a next run time",policy.includes("quiet_hours")&&policy.includes("next_run_after")&&policy.includes("next_utc")],
  ["Digest cadence supports hourly daily weekly",policy.includes("when 'hourly'")&&policy.includes("when 'daily'")&&policy.includes("when 'weekly'")],
  ["Notification worker checks policy before claiming",notifyWorker.indexOf("notification_delivery_decision")<notifyWorker.indexOf('status: "sending"')],
  ["Digest decisions are left queued for batcher",notifyWorker.includes('decision.decision==="digest"')&&notifyWorker.includes("digestPending")],
  ["Disabled channels block honestly",notifyWorker.includes('decision.decision==="blocked"')&&notifyWorker.includes("Delivery blocked by notification preference")],
  ["SEO worker claims only project SEO jobs",seoWorker.includes('target_job_types:["website_project_seo_refresh"]')],
  ["SEO generation requires approved Business client",seoWorker.includes("website_setup_review")&&seoWorker.includes("family.data?.slug!==\"business\"")],
  ["SEO canonical base must be HTTPS",seoWorker.includes('u.protocol!=="https:"')],
  ["SEO worker writes sitemap robots and schema",seoWorker.includes('"sitemap.xml"')&&seoWorker.includes('"robots.txt"')&&seoWorker.includes('"seo.schema.json"')],
  ["SEO worker uses safe source branch rather than main",seoWorker.includes("source_branch")&&!seoWorker.includes('refs/heads/main')&&!seoWorker.includes('force: true')],
  ["SEO artifacts store commit and content hash evidence",seoWorker.includes("git_commit_sha")&&seoWorker.includes("content_hash")&&seoWorker.includes("SHA-256")],
  ["SEO dispatcher is Vault backed",seoDispatch.includes("vault.decrypted_secrets")&&seoDispatch.includes("nxq_business_seo_edge_url")],
  ["SEO dispatcher wakes only when due work exists",seoDispatch.includes("due_count=0")&&seoDispatch.includes("website_project_seo_refresh")],
  ["SEO dispatcher runs automatically",seoDispatch.includes("nxq-business-seo-artifacts-every-minute")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-five checks passed.`);if(passed!==checks.length)process.exit(1);
