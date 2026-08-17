import { pathToFileURL } from "node:url";

const entry = (name, verifyJwt, authBoundary) => Object.freeze({ name, verifyJwt, authBoundary });

export const edgeFunctionManifest = Object.freeze([
  entry("apply-business-change-request", false, "worker-token"),
  entry("bootstrap-runtime-vault", true, "owner-jwt"),
  entry("build-business-location-pages", false, "worker-token"),
  entry("build-business-seo-artifacts", false, "worker-token"),
  entry("build-business-website", false, "trusted-worker-or-owner"),
  entry("check-preview-deployment-safety", true, "owner-jwt"),
  entry("check-preview-netlify-status", true, "owner-jwt"),
  entry("check-production-launch-audit", true, "owner-jwt"),
  entry("check-production-netlify-status", true, "owner-jwt"),
  entry("check-provider-health", false, "worker-token"),
  entry("classify-business-change-request", false, "worker-token"),
  entry("dispatch-notifications", false, "worker-token"),
  entry("execute-preview-netlify-build", true, "owner-jwt"),
  entry("execute-production-netlify-build", true, "owner-jwt"),
  entry("generate-business-build-plan", false, "adapter-token"),
  entry("ingest-billing-provider-event", false, "billing-adapter-token"),
  entry("ingest-business-analytics", false, "public-ingest-key"),
  entry("ingest-business-lead", false, "public-form-key"),
  entry("prepare-build-plan", false, "trusted-worker-or-owner"),
  entry("prepare-preview-deployment-execution", true, "owner-jwt"),
  entry("prepare-production-deployment-execution", true, "owner-jwt"),
  entry("process-data-subject-request", false, "worker-token"),
  entry("promote-business-production", false, "trusted-worker-or-owner"),
  entry("provider-health-adapter", false, "provider-health-adapter-token"),
  entry("provision-project-infrastructure", false, "trusted-worker-or-owner"),
  entry("provision-storefront", false, "trusted-worker-or-owner"),
  entry("publish-production-netlify-deploy", true, "owner-jwt"),
  entry("reconcile-domain", false, "trusted-worker-or-owner"),
  entry("refresh-production-deployment-preparation", true, "owner-jwt"),
  entry("run-backup-restore-drill", false, "worker-token"),
  entry("run-website-maintenance", false, "worker-token"),
  entry("scan-client-file", false, "worker-token"),
  entry("secure-client-file-access", true, "client-jwt"),
  entry("secure-owner-file-access", true, "owner-jwt"),
  entry("verify-deployment-connection", true, "owner-jwt"),
]);

export const managedEdgeSecrets = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

const sourceRef = "NXQ_AUTOMATION_SOURCE_REF";

export const runtimeSecretProfiles = Object.freeze({
  "business-configured-foundation": Object.freeze([
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_REPOSITORY_OWNER",
    "NETLIFY_ACCESS_TOKEN",
    "NETLIFY_GITHUB_INSTALLATION_ID",
    "NXQ_AUTOMATION_SOURCE_OWNER",
    "NXQ_AUTOMATION_SOURCE_REPO",
    sourceRef,
    "NXQ_AUTOMATION_WORKER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
    "NXQ_BUSINESS_TEMPLATE_OWNER",
    "NXQ_BUSINESS_TEMPLATE_REPO",
    "NXQ_RUNTIME_ENVIRONMENT",
    "PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_SUPABASE_URL",
  ]),
  "business-non-ai-staging": Object.freeze([
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_REPOSITORY_OWNER",
    "NETLIFY_ACCESS_TOKEN",
    "NETLIFY_GITHUB_INSTALLATION_ID",
    "NXQ_AUTOMATION_SOURCE_OWNER",
    "NXQ_AUTOMATION_SOURCE_REPO",
    sourceRef,
    "NXQ_AUTOMATION_WORKER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
    "NXQ_BUSINESS_TEMPLATE_OWNER",
    "NXQ_BUSINESS_TEMPLATE_REPO",
    "NXQ_GITHUB_VERIFY_TOKEN",
    "NXQ_NETLIFY_VERIFY_TOKEN",
    "NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN",
    "NXQ_PROVIDER_HEALTH_ADAPTER_URL",
    "NXQ_RUNTIME_ENVIRONMENT",
    "PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_SUPABASE_URL",
  ]),
  "business-external-qa": Object.freeze([
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_REPOSITORY_OWNER",
    "NETLIFY_ACCESS_TOKEN",
    "NETLIFY_GITHUB_INSTALLATION_ID",
    "NXQ_AI_MODEL_PROVIDER_MODEL",
    "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
    "NXQ_AI_MODEL_PROVIDER_TOKEN",
    "NXQ_AI_MODEL_PROVIDER_URL",
    "NXQ_AUTOMATION_SOURCE_OWNER",
    "NXQ_AUTOMATION_SOURCE_REPO",
    sourceRef,
    "NXQ_AUTOMATION_WORKER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
    "NXQ_BUSINESS_TEMPLATE_OWNER",
    "NXQ_BUSINESS_TEMPLATE_REPO",
    "NXQ_GITHUB_VERIFY_TOKEN",
    "NXQ_NETLIFY_VERIFY_TOKEN",
    "NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN",
    "NXQ_PROVIDER_HEALTH_ADAPTER_URL",
    "NXQ_RUNTIME_ENVIRONMENT",
    "PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_SUPABASE_URL",
  ]),
  "business-launch": Object.freeze([
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_REPOSITORY_OWNER",
    "NETLIFY_ACCESS_TOKEN",
    "NETLIFY_GITHUB_INSTALLATION_ID",
    "NXQ_AI_MODEL_PROVIDER_MODEL",
    "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
    "NXQ_AI_MODEL_PROVIDER_TOKEN",
    "NXQ_AI_MODEL_PROVIDER_URL",
    "NXQ_AUTOMATION_SOURCE_OWNER",
    "NXQ_AUTOMATION_SOURCE_REPO",
    sourceRef,
    "NXQ_AUTOMATION_WORKER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
    "NXQ_BUSINESS_TEMPLATE_OWNER",
    "NXQ_BUSINESS_TEMPLATE_REPO",
    "NXQ_GITHUB_VERIFY_TOKEN",
    "NXQ_LEAD_CHALLENGE_ENDPOINT",
    "NXQ_LEAD_CHALLENGE_TOKEN",
    "NXQ_LEAD_FINGERPRINT_SALT",
    "NXQ_MALWARE_SCAN_ADAPTER_TOKEN",
    "NXQ_MALWARE_SCAN_ADAPTER_URL",
    "NXQ_NETLIFY_VERIFY_TOKEN",
    "NXQ_NOTIFICATION_ADAPTER_TOKEN",
    "NXQ_NOTIFICATION_ADAPTER_URL",
    "NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN",
    "NXQ_PROVIDER_HEALTH_ADAPTER_URL",
    "NXQ_PUBLIC_ANALYTICS_ENDPOINT",
    "NXQ_PUBLIC_LEAD_ENDPOINT",
    "NXQ_RUNTIME_ENVIRONMENT",
    "PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_SUPABASE_URL",
  ]),
});

export const vaultRuntimeRoutes = Object.freeze([
  ["nxq_automation_edge_url", "provision-project-infrastructure"],
  ["nxq_backup_drill_edge_url", "run-backup-restore-drill"],
  ["nxq_build_plan_edge_url", "prepare-build-plan"],
  ["nxq_business_build_edge_url", "build-business-website"],
  ["nxq_business_production_edge_url", "promote-business-production"],
  ["nxq_business_seo_edge_url", "build-business-seo-artifacts"],
  ["nxq_change_classifier_edge_url", "classify-business-change-request"],
  ["nxq_domain_edge_url", "reconcile-domain"],
  ["nxq_file_scan_edge_url", "scan-client-file"],
  ["nxq_maintenance_edge_url", "run-website-maintenance"],
  ["nxq_notification_dispatch_url", "dispatch-notifications"],
  ["nxq_privacy_processor_edge_url", "process-data-subject-request"],
  ["nxq_provider_health_edge_url", "check-provider-health"],
]);

export function functionNames(group = "all") {
  if (group === "all") return edgeFunctionManifest.map((item) => item.name);
  if (group === "verify-jwt") return edgeFunctionManifest.filter((item) => item.verifyJwt).map((item) => item.name);
  if (group === "no-verify-jwt") return edgeFunctionManifest.filter((item) => !item.verifyJwt).map((item) => item.name);
  throw new Error(`Unknown Edge-function group: ${group}`);
}

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = argument("profile");
  const group = argument("group", "all");
  const format = argument("format", "text");
  const names = profile ? runtimeSecretProfiles[profile] : functionNames(group);
  if (!names) throw new Error(`Unknown runtime secret profile: ${profile}`);
  if (format === "json") console.log(JSON.stringify(names));
  else console.log(names.join("\n"));
}
