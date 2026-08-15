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
const securityDefinerWithoutPinnedSearchPath = [];
const roleEscalationHits = [];
const dangerousTableGrantHits = [];

for (const file of files) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");

  for (const match of sql.matchAll(functionBlockPattern)) {
    const block = match[0];
    if (/\bsecurity\s+definer\b/i.test(block) && !/\bset\s+search_path\s*=\s*/i.test(block)) {
      const signature = block.match(/create\s+(?:or\s+replace\s+)?function\s+([^\s(]+\s*\([^)]*\))/i)?.[1] ?? "unknown function";
      securityDefinerWithoutPinnedSearchPath.push(`${file}: ${signature}`);
    }
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

pass(
  "Every SECURITY DEFINER function pins search_path",
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

console.log(`\n${failures.length === 0 ? "Database security audit passed" : `${failures.length} database security audit check(s) failed`}.`);
if (failures.length) process.exit(1);
