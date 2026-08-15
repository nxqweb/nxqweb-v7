import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(root).filter((name) => name.endsWith(".sql")).sort();
const failures = [];

const pass = (label, ok, detail = "") => {
  if (ok) console.log(`PASS  ${label}`);
  else {
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
    failures.push(label);
  }
};

const functionBlockPattern = /create\s+(?:or\s+replace\s+)?function\s+[\s\S]*?\$\$[\s\S]*?\$\$\s*;/gi;
const functionHeaderPattern = /create\s+(?:or\s+replace\s+)?function\s+([^\s(]+)\s*\(([^)]*)\)/i;

const countTopLevelArgs = (args) => {
  const trimmed = args.trim();
  if (!trimmed) return 0;

  let depth = 0;
  let inSingleQuote = false;
  let count = 1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    const next = trimmed[i + 1];
    if (char === "'" && inSingleQuote && next === "'") {
      i += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) count += 1;
  }
  return count;
};

// Migration history is append-only. Security must be judged from the final effective
// CREATE/REPLACE definition, not from obsolete definitions that later migrations hardened.
// Name + arity is deliberate here: it distinguishes the overloads used by this schema while
// remaining stable when migrations rename argument variables without changing the SQL signature.
const effectiveFunctions = new Map();
const roleEscalationHits = [];
const dangerousTableGrantHits = [];

for (const file of files) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");

  for (const match of sql.matchAll(functionBlockPattern)) {
    const block = match[0];
    const header = block.match(functionHeaderPattern);
    if (!header) continue;
    const name = header[1].toLowerCase();
    const arity = countTopLevelArgs(header[2]);
    effectiveFunctions.set(`${name}/${arity}`, { file, block, display: `${header[1]}(${header[2].replace(/\s+/g, " ").trim()})` });
  }

  const dangerousRolePatterns = [
    /grant\s+[^;]*\b(?:service_role|supabase_admin|postgres)\b[^;]*\bto\s+(?:anon|authenticated)\b/gi,
    /grant\s+(?:all|usage)\s+on\s+schema\s+(?:auth|vault|extensions)\s+to\s+(?:anon|authenticated)\b/gi,
  ];
  for (const pattern of dangerousRolePatterns) {
    for (const match of sql.matchAll(pattern)) roleEscalationHits.push(`${file}: ${match[0].replace(/\s+/g, " ").trim()}`);
  }

  const sensitiveTablePattern = /grant\s+(?:all|insert|update|delete|truncate|references|trigger)(?:\s*,\s*(?:insert|update|delete|truncate|references|trigger))*\s+on\s+(?:table\s+)?(?:public\.)?(automation_jobs|automation_audit_log|automation_escalations|automation_worker_heartbeats|website_automation_runs|website_automation_steps|project_deployment_configs|owner_users)\s+to\s+(anon|authenticated)\b/gi;
  for (const match of sql.matchAll(sensitiveTablePattern)) {
    dangerousTableGrantHits.push(`${file}: ${match[0].replace(/\s+/g, " ").trim()}`);
  }
}

const securityDefinerWithoutPinnedSearchPath = [];
for (const { file, block, display } of effectiveFunctions.values()) {
  if (/\bsecurity\s+definer\b/i.test(block) && !/\bset\s+search_path\s*=\s*/i.test(block)) {
    securityDefinerWithoutPinnedSearchPath.push(`${file}: ${display}`);
  }
}

pass(
  "Every effective SECURITY DEFINER function pins search_path",
  securityDefinerWithoutPinnedSearchPath.length === 0,
  securityDefinerWithoutPinnedSearchPath.join(" | "),
);
pass(
  "Migrations do not grant privileged database roles or sensitive schemas to browser roles",
  roleEscalationHits.length === 0,
  roleEscalationHits.join(" | "),
);
pass(
  "Browser roles receive no direct write grants on automation/control-plane tables",
  dangerousTableGrantHits.length === 0,
  dangerousTableGrantHits.join(" | "),
);

console.log(`\nAudited ${effectiveFunctions.size} effective function definition(s) across ${files.length} migration(s).`);
console.log(`${failures.length === 0 ? "Database security audit passed" : `${failures.length} database security audit check(s) failed`}.`);
if (failures.length) process.exit(1);
