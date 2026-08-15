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

check("Malware scanner adapter requires a public HTTPS endpoint", scanner.includes('requirePublicHttpsUrl(endpoint, "Malware scanner adapter URL")'));
check("Malware scanner refuses adapter redirects", scanner.includes('redirect: "error"'));
check("File scan byte ceiling validates finite bounded configuration", scanner.includes("Number.isSafeInteger(maxBytes)") && scanner.includes("100 * 1024 * 1024"));
check("Notification adapter requires a public HTTPS endpoint", notifications.includes('requirePublicHttpsUrl(endpoint, "Notification adapter URL")'));
check("Notification adapter refuses redirects", notifications.includes('redirect: "error"'));
check("Maintenance validates every redirect target", maintenance.includes("validatedRedirectTarget(location, currentUrl"));
check("Maintenance GitHub App key accepts PKCS#1 and PKCS#8", maintenance.includes('normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY"))'));

const githubTokenSources = [provision, build, production, maintenance].join("\n");
check("GitHub installation tokens have no hardcoded ghs_ prefix dependency", !githubTokenSources.includes("ghs_"));
check("GitHub installation tokens have no hardcoded token-length dependency", !/\btoken\s*\.\s*length\b/.test(githubTokenSources));

console.log(`\n${failures.length ? `${failures.length} runtime security hardening check(s) failed` : "Runtime security hardening contract passed"}.`);
if (failures.length) process.exit(1);
