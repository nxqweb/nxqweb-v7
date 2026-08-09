import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const pref=read("supabase/migrations/154_notification_preferences_and_digest_batching.sql");
const policy=read("supabase/migrations/155_notification_delivery_policy_decisions.sql");
const notifyWorker=read("supabase/functions/dispatch-notifications/index.ts");
const seoWorker=read("supabase/functions/build-business-seo-artifacts/index.ts");
const seoSchedule=read("supabase/migrations/156_schedule_business_seo_artifact_worker.sql");
const seoLane=read("supabase/migrations/160_business_seo_maintenance_publish_lane.sql");
const checks=[
  ["Notification preferences are tenant scoped",pref.includes("client_notification_preferences")&&pref.includes("auth_user_id=auth.uid()")],
  ["Notification policy has explicit delivery decisions",policy.includes("'immediate'")&&policy.includes("'digest'")&&policy.includes("'defer'")&&policy.includes("'blocked'")],
  ["Quiet hours return a next run time",policy.includes("quiet_hours")&&policy.includes("next_run_after")&&policy.includes("next_utc")],
  ["Digest cadence supports hourly daily weekly",policy.includes("when 'hourly'")&&policy.includes("when 'daily'")&&policy.includes("when 'weekly'")],
  ["Notification worker checks policy before claiming",notifyWorker.indexOf("notification_delivery_decision")<notifyWorker.indexOf('status: "sending"')],
  ["Digest decisions are left queued for batcher",notifyWorker.includes('decision.decision==="digest"')&&notifyWorker.includes("digestPending")],
  ["Disabled channels block honestly",notifyWorker.includes('decision.decision==="blocked"')&&notifyWorker.includes("Delivery blocked by notification preference")],
  ["SEO worker claims only guarded SEO maintenance job types",seoWorker.includes('target_job_types:["website_project_seo_refresh","website_project_seo_preview_check","website_project_seo_promote","website_project_seo_production_check"]')&&!seoWorker.includes('target_job_types:["website_prepare_safe_branch"')],
  ["SEO generation requires approved Business client",seoWorker.includes("website_setup_review")&&seoWorker.includes("family.data?.slug!==\"business\"")],
  ["SEO canonical base must be HTTPS",seoWorker.includes('u.protocol!=="https:"')],
  ["SEO worker writes sitemap robots and schema",seoWorker.includes('"sitemap.xml"')&&seoWorker.includes('"robots.txt"')&&seoWorker.includes('"seo.schema.json"')],
  ["SEO worker uses safe branch and guarded fast-forward production",seoWorker.includes('safe/seo-${job.project_id.slice(0,8)}-${job.id.slice(0,8)}')&&seoWorker.includes('branch==="main"')&&seoWorker.includes("force:false")&&seoWorker.includes("compareMainToBranch")],
  ["SEO artifacts store commit and content hash evidence",seoWorker.includes("git_commit_sha")&&seoWorker.includes("content_hash")&&seoWorker.includes("SHA-256")],
  ["SEO dispatcher is Vault backed",seoLane.includes("vault.decrypted_secrets")&&seoLane.includes("nxq_business_seo_edge_url")],
  ["SEO dispatcher wakes only when due guarded work exists",seoLane.includes("due_count=0")&&seoLane.includes("website_project_seo_refresh")&&seoLane.includes("website_project_seo_production_check")],
  ["SEO dispatcher runs automatically",seoSchedule.includes("nxq-business-seo-artifacts-every-minute")&&seoSchedule.includes("cron.schedule")&&seoSchedule.includes("dispatch_business_seo_artifacts")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-five checks passed.`);if(passed!==checks.length)process.exit(1);
