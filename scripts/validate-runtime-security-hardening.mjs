import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const failures = [];
const check = (label, ok) => {
  if (ok) console.log(`PASS  ${label}`);
  else { console.error(`FAIL  ${label}`); failures.push(label); }
};

const scanner = read("supabase/functions/scan-client-file/index.ts");
const notifications = read("supabase/functions/dispatch-notifications/index.ts");
const maintenance = read("supabase/functions/run-website-maintenance/index.ts");
const provision = read("supabase/functions/provision-project-infrastructure/index.ts");
const build = read("supabase/functions/build-business-website/index.ts");
const production = read("supabase/functions/promote-business-production/index.ts");
const classifier = read("supabase/functions/classify-business-change-request/index.ts");
const providerHealth = read("supabase/functions/check-provider-health/index.ts");
const leadIngest = read("supabase/functions/ingest-business-lead/index.ts");
const previewSafety = read("supabase/functions/check-preview-deployment-safety/index.ts");
const productionAudit = read("supabase/functions/check-production-launch-audit/index.ts");

check("Malware scanner adapter requires a public HTTPS endpoint", scanner.includes('requirePublicHttpsUrl(endpoint, "Malware scanner adapter URL")'));
check("Malware scanner refuses adapter redirects", scanner.includes('redirect: "error"'));
check("File scan byte ceiling validates finite bounded configuration", scanner.includes("Number.isSafeInteger(maxBytes)") && scanner.includes("100 * 1024 * 1024"));
check("Notification adapter requires a public HTTPS endpoint", notifications.includes('requirePublicHttpsUrl(endpoint, "Notification adapter URL")'));
check("Notification adapter refuses redirects", notifications.includes('redirect: "error"'));
check("Maintenance validates every redirect target", maintenance.includes("validatedRedirectTarget(location, currentUrl"));
check("Maintenance GitHub App key accepts PKCS#1 and PKCS#8", maintenance.includes('normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY"))'));
check("Maintenance GitHub provider calls use bounded fetches", maintenance.includes("const { res: tokenRes } = await timedFetch") && maintenance.includes("const { res: repoRes } = await timedFetch"));
check("Change classifier model provider requires a public HTTPS endpoint", classifier.includes('requirePublicHttpsUrl(providerUrlRaw, "AI model provider URL")') && classifier.includes('redirect: "error"'));
check("Provider-health adapter requires a public HTTPS endpoint", providerHealth.includes('requirePublicHttpsUrl(endpoint, "Provider-health adapter URL")') && providerHealth.includes('redirect: "error"'));
check("Lead challenge adapter requires a public HTTPS endpoint", leadIngest.includes('requirePublicHttpsUrl(endpoint,"Lead challenge endpoint")') && leadIngest.includes('redirect:"error"'));
check("Preview provider verification calls use bounded fetches", (previewSafety.match(/await timedFetch\(/g) || []).length >= 3);
check("Production provider verification calls use bounded fetches", (productionAudit.match(/await timedFetch\(/g) || []).length >= 2);
check("Production page audit validates every redirect target", productionAudit.includes("validatedRedirectTarget(location, currentUrl"));

const githubTokenSources = [provision, build, production, maintenance].join("\n");
check("GitHub installation tokens have no hardcoded ghs_ prefix dependency", !githubTokenSources.includes("ghs_"));
check("GitHub installation tokens have no hardcoded token-length dependency", !/\btoken\s*\.\s*length\b/.test(githubTokenSources));

console.log(`\n${failures.length ? `${failures.length} runtime security hardening check(s) failed` : "Runtime security hardening contract passed"}.`);
if (failures.length) process.exit(1);
