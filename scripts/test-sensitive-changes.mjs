// Offline test for the change watcher: it must catch real secret shapes, ignore code that merely mentions them, and flag sensitive files. Values below are fake and built at runtime.
import fs from "node:fs";
import { scanLine, isExempt, sensitiveKind } from "./check-sensitive-changes.mjs";
let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const fake = (...parts) => parts.join("");
const caught = (line) => scanLine(line).length > 0;
check("a Stripe live key, webhook secret and AWS key id are caught", caught(`const k = "${fake("sk", "_live_", "A".repeat(24))}";`) && caught(fake("whsec", "_", "b".repeat(24))) && caught(fake("AKIA", "ABCDEFGHIJKLMNOP")));
check("a GitHub token, a Slack token and a model-provider style key are caught", caught(fake("ghp", "_", "c".repeat(36))) && caught(fake("xoxb", "-", "1".repeat(24))) && caught(fake("sk", "-ant-", "d".repeat(40))));
check("GitHub fine-grained, Netlify, Supabase and Resend token shapes are caught", caught(fake("github", "_pat_", "A".repeat(22), "_", "b".repeat(59))) && caught(fake("nfp", "_", "c".repeat(36))) && caught(fake("sbp", "_", "0123456789abcdef".repeat(3))) && caught(fake("sb", "_secret_", "d".repeat(30))) && caught(fake("re", "_", "E".repeat(8), "_", "f".repeat(28))));
check("ordinary code and words that look a little like those prefixes are NOT flagged", !caught("const re_run_all_the_checks_again_please = 1;") && !caught("see github_pat_ in the docs") && !caught("the nfp_ and sbp_ prefixes are described here") && !caught("renderer_options_are_set_elsewhere_long_name_here") && !caught("sb_secret_ is a prefix"));
check("a JWT-shaped token is caught", caught(fake("eyJ", "a".repeat(20), ".", "eyJ", "b".repeat(20), ".", "c".repeat(24))));
check("a key file header on its own line, and a header followed by key data, are caught", caught(fake("-----BEGIN ", "PRIVATE KEY-----")) && caught(fake('"-----BEGIN RSA ', "PRIVATE KEY-----", "\\n", "M".repeat(60), '"')));
check("code that only mentions the header text (a PEM parser) and ordinary words are NOT flagged", !caught(fake("const header = '-----BEGIN ", "PRIVATE KEY-----';")) && !caught("the sk_live_ prefix means a live key") && !caught("Stripe live keys are never stored here") && !caught("const token = getToken();"));
check("this script, test files and docs may contain examples; source files may not", isExempt("scripts/check-sensitive-changes.mjs") && isExempt("scripts/test-anything.mjs") && isExempt("docs/NOTES.md") && !isExempt("src/lib/x.ts") && !isExempt("supabase/functions/a/index.ts"));
check("sensitive files are recognized (workflows, migrations, functions, dependencies, switches, rules, env)", ["../.github/workflows/ci.yml", "supabase/migrations/1.sql", "supabase/functions/a/index.ts", "package.json", "package-lock.json", "netlify.toml", "CLAUDE.md", "src/lib/aiDeskConfig.ts", ".env.local"].every((f) => sensitiveKind(f.replace("../", "")) !== null) && sensitiveKind("src/pages/Home.tsx") === null);
const wf = fs.readFileSync(".github/workflows/security-audit.yml", "utf8");
check("the security workflow runs on every push, monthly, and on demand, and uses the watcher", /push:/.test(wf) && /schedule:\s*\n\s*- cron: "[^"]+"/.test(wf) && /workflow_dispatch:/.test(wf) && /check-sensitive-changes\.mjs --range/.test(wf) && /check-sensitive-changes\.mjs --tree/.test(wf) && /npm audit --audit-level=high/.test(wf));
check("the workflow keeps read-only permissions and uses no third-party actions", /permissions:\s*\n\s*contents: read/.test(wf) && (wf.match(/uses:\s*([^\s]+)/g) || []).every((u) => /actions\/(checkout|setup-node)@/.test(u)));
if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
