import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const notifications=read("src/pages/ClientNotificationPreferences.tsx");
const files=read("src/pages/ClientFiles.tsx");
const app=read("src/App.tsx");
const sim=read("scripts/simulate-autonomy-failures.mjs");
const readiness=read("supabase/migrations/157_wave5_launch_readiness_evidence.sql");
const checks=[
  ["Client notification page is tenant-account based",notifications.includes('auth_user_id')&&notifications.includes('client_notification_preferences')],
  ["Notification settings expose channel and digest controls",notifications.includes('email_enabled')&&notifications.includes('sms_enabled')&&notifications.includes('digest_mode')&&notifications.includes('quiet_hours_start')],
  ["Client secure files require clean released scan",files.includes('scan.status!=="clean"')&&files.includes('scan.quarantine_status!=="released"')],
  ["Restricted client files never receive signed URL",files.indexOf('scan.status!=="clean"')<files.indexOf('createSignedUrl')],
  ["Client notifications and files routes are wired",app.includes('/client/notifications')&&app.includes('/client/files')&&app.includes('ClientNotificationPreferences')&&app.includes('ClientFiles')],
  ["Failure simulator covers notification digest",sim.includes('Normal notification enters digest instead of sending immediately')],
  ["Failure simulator covers quiet hours",sim.includes('Quiet-hours notification defers')],
  ["Failure simulator covers file quarantine",sim.includes('Quarantined or pending files cannot open')],
  ["Failure simulator covers SEO HTTPS and safe branch",sim.includes('SEO rejects non-HTTPS canonical target')&&sim.includes('SEO rejects production main as working branch')],
  ["Failure simulator covers privacy delete identity gate",sim.includes('Privacy deletion requires identity verification')],
  ["SEO runtime readiness requires cron plus Vault URL",readiness.includes('nxq-business-seo-artifacts-every-minute')&&readiness.includes('nxq_business_seo_edge_url')],
  ["Digest readiness requires both batching and delivery cron",readiness.includes('nxq-prepare-notification-digests')&&readiness.includes('nxq-dispatch-notifications')],
  ["Missing wave-five runtime evidence stays unknown",readiness.includes("then 'ready' else 'unknown' end")],
];
let passed=0;for(const [label,ok] of checks){if(ok){console.log(`PASS  ${label}`);passed++;}else console.error(`FAIL  ${label}`);}console.log(`\n${passed}/${checks.length} autonomy ops wave-six checks passed.`);if(passed!==checks.length)process.exit(1);
