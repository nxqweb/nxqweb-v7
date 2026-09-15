import fs from "node:fs";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";

if (!accessToken || !projectRef) {
  console.error("FAIL protected-staging-configuration");
  process.exit(1);
}

const sql = fs.readFileSync(
  new URL("./sql/validate-paid-capability-guards-staging.sql", import.meta.url),
  "utf8",
);

let response;
try {
  response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
} catch {
  console.error("FAIL staging-database-transport");
  process.exit(1);
}

const responseText = await response.text();

function responseStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(responseStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(responseStrings);
  }
  return [];
}

function responseCandidates(text) {
  let candidates = [text];
  try {
    // Prefer decoded JSON strings so escaped base64 line breaks are restored
    // before matching. Keep the raw body as a fallback for nonstandard shapes.
    candidates = [...responseStrings(JSON.parse(text)), text];
  } catch {
    // A non-JSON management response is still eligible for the exact marker.
  }

  return candidates;
}

function rollbackSentinel(candidates) {
  for (const candidate of candidates) {
    // The SQL emits one unwrapped Base64 token followed by an explicit
    // non-Base64 terminator. Requiring both boundaries prevents a following
    // database diagnostic line (for example CONTEXT) from being consumed as
    // part of the encoded result.
    const encoded = /NXQ_PAID_GUARD_RESULT:([A-Za-z0-9+/]+={0,2}):NXQ_END/
      .exec(candidate)?.[1];
    if (encoded) return encoded;
  }
  return null;
}

function failureSentinel(candidates) {
  for (const candidate of candidates) {
    const classification = /NXQ_PAID_GUARD_FAILURE:([a-z0-9-]+):NXQ_END/
      .exec(candidate)?.[1];
    if (classification) return classification;
  }
  return null;
}

const candidates = responseCandidates(responseText);
const sentinel = rollbackSentinel(candidates);
const failure = failureSentinel(candidates);

if (!response.ok && failure) {
  console.error(`FAIL ${failure}`);
  console.log("PASS fixture-cleanup-by-rollback");
  process.exit(1);
}

if (response.ok || !sentinel) {
  console.error(response.ok
    ? "FAIL rollback-sentinel-missing"
    : `FAIL staging-database-safe-classification-http-${response.status}`);
  process.exit(1);
}

let result;
try {
  result = JSON.parse(Buffer.from(sentinel, "base64").toString("utf8"));
} catch {
  console.error("FAIL rollback-result-classification");
  process.exit(1);
}

const expectedChecks = [
  "tier_denial",
  "credits_usage_only",
  "billing_state_denial",
  "included_usage_accounting",
  "purchased_credit_accounting",
  "business_page_limits",
  "business_location_limits",
  "location_identity_established",
  "location_client_visible",
  "location_lifecycle_eligible",
  "location_business_tier_compatible",
  "location_billing_eligible",
  "location_zero_existing",
  "location_insert_trigger_probe",
  "location_audit_write_probe",
  "location_result_construction_probe",
  "location_first_created",
  "location_second_denied",
  "location_denial_classified",
  "location_active_count_one",
  "resource_limit_rejection",
  "economic_margin_rejection",
  "reservation_idempotency",
  "reservation_release",
  "reservation_reconciliation",
  "storage_quota_authorization",
  "storage_reservation_cleanup",
  "tenant_isolation",
  "synthetic_fixtures_only",
  "no_external_runtime",
  "rollback_forced",
];

const diagnosticChecks = [
  "location_first_failure_authentication",
  "location_first_failure_client_not_found",
  "location_first_failure_lifecycle",
  "location_first_failure_tier",
  "location_first_failure_subscription",
  "location_first_failure_input_validation",
  "location_first_failure_downstream_schema_write",
  "location_failure_integrity_constraint",
  "location_failure_permission",
  "location_failure_missing_schema_object",
  "location_failure_undefined_column",
  "location_failure_undefined_function",
  "location_failure_undefined_table",
  "location_failure_undefined_object",
  "location_failure_trigger_rejection",
  "location_failure_unknown_downstream",
];

const exactShape = result && typeof result === "object"
  && !Array.isArray(result)
  && Object.keys(result).sort().join("\n")
    === [...expectedChecks, ...diagnosticChecks].sort().join("\n");
const booleanOnly = exactShape
  && [...expectedChecks, ...diagnosticChecks]
    .every((name) => typeof result[name] === "boolean");

if (!booleanOnly) {
  console.error("FAIL sanitized-result-shape");
  process.exit(1);
}

let failed = 0;
for (const check of expectedChecks) {
  const passed = result[check] === true;
  console.log(`${passed ? "PASS" : "FAIL"} ${check.replaceAll("_", "-")}`);
  if (!passed) failed += 1;
}

for (const diagnostic of diagnosticChecks) {
  if (result[diagnostic] === true) {
    console.log(`FAIL ${diagnostic.replaceAll("_", "-")}`);
  }
}

console.log(`${expectedChecks.length - failed}/${expectedChecks.length} paid-capability staging checks passed.`);
if (failed) process.exit(1);
