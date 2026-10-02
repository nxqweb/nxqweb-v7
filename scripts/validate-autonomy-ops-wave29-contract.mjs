import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const netlify = read("netlify.toml");
const vite = read("vite.config.ts");
const html = read("index.html");
const app = read("src/App.tsx");
const css = read("src/styles/nxq.css");
const supabaseClient = read("src/lib/supabaseClient.ts");
const tutorial = read("src/components/ClientPortalTutorialOverlay.tsx");
const edgeCheck = read("scripts/check-edge-functions.mjs");
const securityAudit = read("scripts/audit-frontend-security.mjs");
const accessibilityAudit = read("scripts/audit-frontend-accessibility.mjs");
const pkg = read("package.json");
const ci = read(".github/workflows/ci-mega-extended.yml");

const edgeFiles = fs.readdirSync("supabase/functions", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join("supabase/functions", entry.name, "index.ts")))
  .map((entry) => read(path.join("supabase/functions", entry.name, "index.ts")));

const checks = [
  ["Static host sends CSP HSTS framing MIME referrer and permissions protections", ["Content-Security-Policy","Strict-Transport-Security","X-Frame-Options","X-Content-Type-Options","Referrer-Policy","Permissions-Policy"].every((header) => netlify.includes(header))],
  ["CSP permits only self-hosted scripts and trusted Supabase connections", netlify.includes("script-src 'self'") && netlify.includes("https://*.supabase.co") && netlify.includes("wss://*.supabase.co")],
  ["HTML is not cached while hashed assets are immutable", netlify.includes("no-cache, no-store, must-revalidate") && netlify.includes("max-age=31536000, immutable")],
  ["Production source maps are disabled", vite.includes("sourcemap: false")],
  ["Browser Supabase configuration never previews the public key", !supabaseClient.includes("anonKeyPreview") && !supabaseClient.includes("supabaseDebug")],
  ["All Edge functions use deterministic npm Supabase imports", edgeFiles.every((file) => !file.includes("https://esm.sh/") && (!file.includes("createClient") || file.includes('from "npm:@supabase/supabase-js@2"')))],
  ["Edge check uses the locked local Deno binary and offline node modules", edgeCheck.includes("node_modules") && edgeCheck.includes('"--node-modules-dir=manual"') && edgeCheck.includes('"--no-config"')],
  ["Deno and jose are locked developer dependencies", pkg.includes('"deno"') && pkg.includes('"jose"')],
  ["Frontend security audit covers credentials browser sinks direct writes CSP CORS and bundles", ["credential-shaped","dangerous HTML","direct Supabase table mutations","Content-Security-Policy","Wildcard CORS","Production bundle"].every((value) => securityAudit.includes(value))],
  ["Application offers skip navigation and a focusable target", html.includes("nxq-skip-link") && app.includes('id="main-content" tabIndex={-1}')],
  ["Keyboard focus and reduced motion are global", css.includes(":focus-visible") && css.includes("transition-duration: 0.01ms") && css.includes("animation-duration: 0.01ms")],
  ["Tutorial modal traps focus supports Escape and locks background scroll", tutorial.includes('event.key !== "Tab"') && tutorial.includes('event.key === "Escape"') && tutorial.includes('document.body.style.overflow = "hidden"')],
  ["Accessibility audit covers landmarks images buttons dialogs focus and motion", ["semantic main","alternative text","Every button","dialog","keyboard focus","Reduced-motion"].every((value) => accessibilityAudit.includes(value))],
  ["Package exposes security accessibility Edge and route gates", ["test:security","test:accessibility","test:edge","test:routes"].every((value) => pkg.includes(`"${value}"`))],
  ["Extended CI runs all Wave 29 release gates", ["validate-autonomy-ops-wave29-contract.mjs","npm run test:security","npm run test:accessibility","npm run test:edge","npm run test:routes"].every((value) => ci.includes(value))],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} autonomy ops wave-twenty-nine checks passed.`);
if (passed !== checks.length) process.exit(1);
