import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const commerceReferenceFunctionNames = [
  "upload-commerce-request-reference",
  "prepare-commerce-reference-build-context",
];

export function commerceReferenceRemoteAuthResults(metadata) {
  const records = Array.isArray(metadata) ? metadata : [];
  return commerceReferenceFunctionNames.map((name) => {
    const matches = records.filter((record) =>
      record && typeof record === "object" && (record.slug === name || record.name === name)
    );
    return { name, passed: matches.length === 1 && matches[0].verify_jwt === false };
  });
}

const COMMERCE_POSTGRES_QUERY = `
with target as (
  select p.oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'resolve_commerce_request_reference_upload'
    and pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, text'
  limit 1
), checks as (
  select
    exists(select 1 from target) as function_present,
    coalesce((
      select pg_catalog.pg_get_function_result(oid) = 'jsonb'
      from target
    ), false) as signature_match,
    coalesce((
      select pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')
      from target
    ), false) as service_role_execute_match,
    exists(
      select 1
      from supabase_migrations.schema_migrations
      where version = '240'
    ) as migration_current
)
select concat_ws('|', function_present, signature_match, service_role_execute_match, migration_current)
from checks;
`;

function postgresConnectionArgs() {
  const linkedPoolerPath = "supabase/.temp/pooler-url";
  try {
    const linkedPoolerUrl = fs.readFileSync(linkedPoolerPath, "utf8").trim();
    if (linkedPoolerUrl.startsWith("postgresql://") || linkedPoolerUrl.startsWith("postgres://")) {
      return [linkedPoolerUrl];
    }
  } catch {
    // Fall through to the protected project-reference connection without printing details.
  }

  const projectRef = process.env.SUPABASE_PROJECT_REF || "";
  if (!/^[a-z0-9]+$/i.test(projectRef)) return [];
  return [
    "--host",
    `db.${projectRef}.supabase.co`,
    "--port",
    "5432",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
  ];
}

export function commercePostgresContractAudit() {
  const password = process.env.SUPABASE_DB_PASSWORD || "";
  const connectionArgs = postgresConnectionArgs();
  if (!password || connectionArgs.length === 0) {
    return { available: false, checks: null };
  }

  const result = spawnSync(
    "psql",
    [
      ...connectionArgs,
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--command=${COMMERCE_POSTGRES_QUERY}`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    },
  );

  if (result.status !== 0 || typeof result.stdout !== "string") {
    return { available: false, checks: null };
  }

  const line = result.stdout.trim();
  if (!/^(t|f)\|(t|f)\|(t|f)\|(t|f)$/.test(line)) {
    return { available: false, checks: null };
  }

  const [functionPresent, signatureMatch, serviceRoleExecuteMatch, migrationCurrent] =
    line.split("|").map((value) => value === "t");
  return {
    available: true,
    checks: {
      functionPresent,
      signatureMatch,
      serviceRoleExecuteMatch,
      migrationCurrent,
    },
  };
}

function writeConstantLine(value) {
  process.stdout.write(`${value}\n`);
}

function run(metadataPath) {
  let results = commerceReferenceRemoteAuthResults([]);
  try {
    results = commerceReferenceRemoteAuthResults(JSON.parse(fs.readFileSync(metadataPath, "utf8")));
  } catch {
    // Never print raw metadata, file paths, parser details, or protected configuration.
  }

  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"}: ${result.name} remote gateway JWT bypass`);
  }
  const remoteAuthPassed = results.every((result) => result.passed);
  console.log(`${remoteAuthPassed ? "PASS" : "FAIL"}: Commerce remote authentication audit`);

  const postgresAudit = commercePostgresContractAudit();
  if (!postgresAudit.available || !postgresAudit.checks) {
    writeConstantLine("FAIL: commerce-postgres-contract-audit-unavailable");
    process.exitCode = 1;
    return;
  }

  const checks = [
    ["function-present", postgresAudit.checks.functionPresent],
    ["signature-match", postgresAudit.checks.signatureMatch],
    ["service-role-execute-match", postgresAudit.checks.serviceRoleExecuteMatch],
    ["migration-current", postgresAudit.checks.migrationCurrent],
  ];
  for (const [name, passed] of checks) {
    writeConstantLine(`${passed ? "PASS" : "FAIL"}: ${name}`);
  }

  const schemaDriftDetected = checks.some(([, passed]) => !passed);
  writeConstantLine(`${schemaDriftDetected ? "FAIL" : "PASS"}: schema-drift-detected=${schemaDriftDetected ? "true" : "false"}`);

  if (!remoteAuthPassed || schemaDriftDetected) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2] || "");
}
