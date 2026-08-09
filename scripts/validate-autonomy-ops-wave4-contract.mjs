import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const domainRpc=read("supabase/migrations/152_client_domain_recheck_controls.sql");
const domainPage=read("src/pages/ClientDomainStatus.tsx");
const app=read("src/App.tsx");
const privacyPage=read("src/pages/ClientSecurityPrivacy.tsx");
const privacyRoute=read("supabase/migrations/148_route_privacy_requests_safely.sql");
const readiness=read("supabase/migrations/153_extended_launch_readiness_evidence.sql");
const checks=[
  ["Client domain recheck resolves current authenticated client",domainRpc.includes("auth_user_id=auth.uid()")&&domainRpc.includes("client_id=client_uuid")],
  ["Client cannot mark its own domain connected",!domainRpc.includes("automation_state='connected'")&&domainRpc.includes("case when automation_state='connected' then 'connected' else 'queued' end")],
  ["Domain page shows DNS and SSL evidence",domainPage.includes("dns_status")&&domainPage.includes("ssl_status")&&domainPage.includes("action_required_message")],
  ["Domain page uses safe recheck RPC",domainPage.includes("current_client_request_domain_recheck")],
  ["Domain status route is wired",app.includes("/client/domain")&&app.includes("ClientDomainStatus")],
  ["Ready privacy export is client-downloadable",privacyPage.includes("Download export")&&privacyPage.includes("JSON.stringify(r.result")],
  ["Privacy export download is local blob, not public URL",privacyPage.includes("URL.createObjectURL")&&!privacyPage.includes("publicUrl")],
  ["Deletion remains identity-check gated",privacyRoute.includes("request_type = 'delete'")&&privacyRoute.includes("identity_check")],
  ["Extended readiness adds notification pipeline gate",readiness.includes("notification_pipeline_ready")&&readiness.includes("nxq-dispatch-notifications")],
  ["Extended readiness adds privacy pipeline gate",readiness.includes("privacy_pipeline_ready")&&readiness.includes("nxq-process-data-subject-requests")],
  ["File security readiness requires healthy malware scanner provider",readiness.includes("provider_category='malware_scan'")&&readiness.includes("status='healthy'")],
  ["Domain readiness checks both queue and dispatch cron",readiness.includes("nxq-domain-reconcile-queue-every-5-minutes")&&readiness.includes("nxq-domain-reconcile-dispatch-every-minute")],
  ["Provider health readiness uses actual provider cron",readiness.includes("nxq-provider-health-every-five-minutes")],
  ["Recovery readiness uses weekly drill schedule",readiness.includes("nxq-weekly-backup-restore-drill")],
  ["Missing runtime evidence stays unknown",readiness.includes("then 'ready' else 'unknown' end")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-four checks passed.`);if(passed!==checks.length)process.exit(1);
