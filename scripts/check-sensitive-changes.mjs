// Change watcher for the security workflow. Two modes, no network, no third-party code:
//   node scripts/check-sensitive-changes.mjs --range <base>..<head>   what a push changed: fails on a secret-looking value in an ADDED line, and prints a loud notice for sensitive files
//   node scripts/check-sensitive-changes.mjs --tree                    the whole checked-in tree (the monthly run): fails on a secret-looking value anywhere
// It only ever prints the file, line number and the KIND of secret, never the value itself.
import { execFileSync } from "node:child_process";

const secretPatterns = [
  ["Stripe live key", /\b[sr]k_live_[0-9A-Za-z]{16,}/],
  ["Stripe webhook secret", /\bwhsec_[0-9A-Za-z]{16,}/],
  // a real key: the header alone on its own line, or the header followed by key data (code that merely mentions the header text, such as a PEM parser, does not match)
  ["private key block", /^\s*-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----\s*$/],
  ["private key with data", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/]{40,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[0-9A-Za-z]{30,}/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}/],
  ["Supabase/JWT style token", /\beyJ[A-Za-z0-9_-]{17,}\.eyJ[A-Za-z0-9_-]{17,}\.[A-Za-z0-9_-]{20,}/],
  ["Anthropic/OpenAI style key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
];
// Files that legitimately contain the patterns as text (this script, its test, and the tests that plant fake values to prove detection).
const exempt = [/^scripts\/check-sensitive-changes\.mjs$/, /^scripts\/test-[^/]*\.mjs$/, /^scripts\/manual\//, /^docs\//];
const sensitive = [
  [/^\.github\/workflows\//, "a CI/CD workflow"], [/^supabase\/migrations\//, "a database migration"], [/^supabase\/functions\//, "a server function"],
  [/^package(?:-lock)?\.json$/, "dependencies"], [/^netlify\.toml$/, "Netlify settings"], [/^CLAUDE\.md$/, "the standing rules file"], [/^src\/lib\/[A-Za-z]*Config\.ts$/, "a feature switch"],
  [/^\.env/, "an environment file"],
];

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
export function scanLine(line) { return secretPatterns.filter(([, rx]) => rx.test(line)).map(([name]) => name); }
export function isExempt(file) { return exempt.some((rx) => rx.test(file)); }
export function sensitiveKind(file) { return sensitive.find(([rx]) => rx.test(file))?.[1] ?? null; }

function scanRange(range) {
  const files = git(["diff", "--name-only", range]).split("\n").filter(Boolean);
  for (const f of files) { const kind = sensitiveKind(f); if (kind) console.log(`::warning file=${f}::Sensitive change: ${kind}. Review this file in the diff.`); }
  const findings = [];
  let file = ""; let line = 0;
  for (const raw of git(["diff", "--unified=0", "--no-color", range]).split("\n")) {
    if (raw.startsWith("+++ b/")) { file = raw.slice(6); continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (raw.startsWith("+") && !raw.startsWith("+++")) { if (file && !isExempt(file)) for (const kind of scanLine(raw.slice(1))) findings.push([file, line, kind]); line += 1; }
  }
  return { findings, changed: files.length };
}

function scanTree() {
  const findings = [];
  for (const f of git(["ls-files"]).split("\n").filter(Boolean)) {
    if (isExempt(f) || /\.(png|jpe?g|webp|gif|ico|woff2?|pdf|zip)$/i.test(f)) continue;
    let text; try { text = git(["show", `HEAD:${f}`]); } catch { continue; }
    text.split("\n").forEach((l, i) => { for (const kind of scanLine(l)) findings.push([f, i + 1, kind]); });
  }
  return { findings, changed: 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode !== "--range" && mode !== "--tree") { console.error("Usage: --range <base>..<head> | --tree"); process.exit(2); }
  const { findings, changed } = mode === "--range" ? scanRange(process.argv[3] || "") : scanTree();
  for (const [f, l, kind] of findings) console.log(`::error file=${f},line=${l}::Possible ${kind} (value not shown).`);
  console.log(findings.length ? `FAIL  ${findings.length} possible secret(s) found.` : `PASS  no secret-looking values${mode === "--range" ? ` in the ${changed} changed file(s)` : " in the checked-in tree"}.`);
  process.exit(findings.length ? 1 : 0);
}
