import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : [relative];
});
const sourceFiles = walk("src").filter((file) => /\.(?:ts|tsx|js|jsx|css|html)$/.test(file));
const source = sourceFiles.map((file) => `\n/* ${file} */\n${read(file)}`).join("\n");
const netlify = read("netlify.toml");
const vite = read("vite.config.ts");
const supabaseClient = read("src/lib/supabaseClient.ts");
const leadIngest = read("supabase/functions/ingest-business-lead/index.ts");
const analyticsIngest = read("supabase/functions/ingest-business-analytics/index.ts");
const verifyDeployment = read("supabase/functions/verify-deployment-connection/index.ts");

const failures = [];
const pass = (label, ok, detail = "") => {
  if (ok) console.log(`PASS  ${label}`);
  else { console.error(`FAIL  ${label}${detail ? `: ${detail}` : ""}`); failures.push(label); }
};

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const trackedEnv = tracked.filter((file) => /(^|\/)\.env(?:\..+)?$/.test(file));
pass("Only the empty environment template is tracked", trackedEnv.length === 1 && trackedEnv[0] === ".env.example", trackedEnv.join(", "));

const textExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql|toml|ya?ml|json|md|html|css|txt|env|example)$/;
const credentialPatterns = [
  /sk_live_[A-Za-z0-9]{16,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+(?:[A-Za-z0-9+/=]{16,}\s+){3,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\\n(?:[A-Za-z0-9+/=]{16,}\\n){3,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
const credentialHits = [];
for (const file of tracked.filter((candidate) => textExtensions.test(candidate) && fs.existsSync(path.join(root, candidate)))) {
  const content = read(file);
  if (credentialPatterns.some((pattern) => pattern.test(content))) credentialHits.push(file);
}
pass("Tracked source contains no credential-shaped values", credentialHits.length === 0, credentialHits.join(", "));

const frontendSecretNames = /SUPABASE_SERVICE_ROLE_KEY|NETLIFY_(?:AUTH_)?TOKEN|GITHUB_(?:APP_)?PRIVATE_KEY|OPENAI_API_KEY|NXQ_AUTOMATION_WORKER_TOKEN/;
pass("Frontend source contains no server secret names", !frontendSecretNames.test(source));

const viteNames = [...new Set([...source.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)].map((match) => match[1]))];
const allowedViteNames = new Set([
  "VITE_APP_NAME", "VITE_APP_ENV", "VITE_PUBLIC_SITE_URL", "VITE_OWNER_PORTAL_URL",
  "VITE_CLIENT_PORTAL_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY",
]);
const unexpectedViteNames = viteNames.filter((name) => !allowedViteNames.has(name) || /SECRET|PRIVATE|SERVICE|TOKEN|PASSWORD/.test(name));
pass("Browser environment variables are restricted to the public allowlist", unexpectedViteNames.length === 0, unexpectedViteNames.join(", "));
pass("Supabase browser config does not preview or log the anon key", !/anonKeyPreview|console\.(?:log|debug)\([^)]*supabase/i.test(supabaseClient));

pass("Frontend has no dangerous HTML or code execution sink", !/dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(|\beval\s*\(|new Function\s*\(/.test(source));
const directTableMutationPattern = /\.from\(\s*["'][^"']+["']\s*\)[\s\S]{0,350}?\.(?:insert|update|upsert|delete)\(/g;
pass("Frontend has no direct Supabase table mutations", !directTableMutationPattern.test(source));
pass("Browser storage is not used for auth or token material", !/(?:localStorage|sessionStorage)[\s\S]{0,100}(?:access_token|refresh_token|service_role|password|auth_session)/i.test(source));

const anchorTags = [...source.matchAll(/<a\b[\s\S]*?>/g)].map((match) => match[0]);
const unsafeBlankLinks = anchorTags.filter((tag) => /target=["']_blank["']/.test(tag) && !/rel=["'][^"']*(?:noreferrer|noopener)[^"']*["']/.test(tag));
pass("Every new-tab link blocks opener access", unsafeBlankLinks.length === 0, `${unsafeBlankLinks.length} unsafe link(s)`);
const unsafeWindowOpen = source.split("\n").filter((line) => /window\.open\s*\(/.test(line) && !/noopener/.test(line));
pass("Every window.open call uses noopener", unsafeWindowOpen.length === 0, unsafeWindowOpen.join(" | "));

const requiredHeaders = [
  "Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options",
  "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy",
];
pass("Netlify sends the complete application security-header baseline", requiredHeaders.every((header) => netlify.includes(header)));
pass("CSP blocks framing plugins and arbitrary script origins", netlify.includes("frame-ancestors 'none'") && netlify.includes("object-src 'none'") && netlify.includes("script-src 'self'") && !netlify.includes("script-src 'self' 'unsafe-inline'"));
pass("Production source maps are disabled", /sourcemap:\s*false/.test(vite));

pass("Public lead ingest reflects only verified allowlisted origins", !leadIngest.includes('"Access-Control-Allow-Origin":"*"') && leadIngest.includes("allowed_origins") && leadIngest.includes("allowed.includes(origin)") && leadIngest.includes("Origin is not allowed"));
pass("Public analytics ingest reflects only verified allowlisted origins", !analyticsIngest.includes('"Access-Control-Allow-Origin":"*"') && analyticsIngest.includes("allowed_origins") && analyticsIngest.includes("origins.includes(origin)") && analyticsIngest.includes("Origin is not allowed"));
pass("Deployment verifier blocks SSRF-shaped URLs and redirects", verifyDeployment.includes("validatedPublicHttpsUrl") && verifyDeployment.includes('redirect: "error"') && verifyDeployment.includes("ipv4Literal") && verifyDeployment.includes("ipv6Literal"));

const wildcardCorsFiles = walk("supabase/functions").filter((file) => file.endsWith("/index.ts") && read(file).includes('"Access-Control-Allow-Origin": "*"'));
const unauthenticatedWildcard = wildcardCorsFiles.filter((file) => {
  const content = read(file);
  return !(content.includes("auth.getUser") && content.includes("owner_users"));
});
pass("Wildcard CORS remains limited to bearer-authenticated owner functions", unauthenticatedWildcard.length === 0, unauthenticatedWildcard.join(", "));

if (fs.existsSync(path.join(root, "dist"))) {
  const distFiles = walk("dist");
  const maps = distFiles.filter((file) => file.endsWith(".map"));
  pass("Production build emits no source maps", maps.length === 0, maps.join(", "));
  const distText = distFiles.filter((file) => /\.(?:js|css|html)$/.test(file)).map(read).join("\n");
  pass("Production bundle contains no server secret names", !frontendSecretNames.test(distText));
}

console.log(`\n${failures.length === 0 ? "Security audit passed" : `${failures.length} security audit check(s) failed`}.`);
if (failures.length) process.exit(1);
