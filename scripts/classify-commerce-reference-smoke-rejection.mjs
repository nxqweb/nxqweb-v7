import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SAFE_REJECTION_SOURCES = new Map([
  ["worker-token-guard", "commerce-function-worker-token-guard"],
  ["runtime-environment-guard", "commerce-function-runtime-environment-guard"],
]);
const COMMERCE_FUNCTION_REACHED = "commerce-reference-upload";
const SAFE_SMOKE_FAILURES = new Map([
  ["fixture-client-creation:completed", "commerce-smoke-fixture-client-creation-rejection-cleanup-completed"],
  ["fixture-request-creation:completed", "commerce-smoke-fixture-request-creation-rejection-cleanup-completed"],
  ["fixture-ticket-creation:completed", "commerce-smoke-fixture-ticket-creation-rejection-cleanup-completed"],
  ["fixture-private-storage-upload:completed", "commerce-smoke-fixture-private-storage-upload-rejection-cleanup-completed"],
  ["fixture-private-storage-auth-rejection:completed", "commerce-smoke-private-storage-auth-rejection-cleanup-completed"],
  ["fixture-private-storage-resource-unavailable:completed", "commerce-smoke-private-storage-resource-unavailable-cleanup-completed"],
  ["fixture-private-storage-conflict:completed", "commerce-smoke-private-storage-conflict-cleanup-completed"],
  ["fixture-private-storage-payload-limit:completed", "commerce-smoke-private-storage-payload-limit-cleanup-completed"],
  ["fixture-private-storage-request-rejection:completed", "commerce-smoke-private-storage-request-rejection-cleanup-completed"],
  ["fixture-private-storage-service-failure:completed", "commerce-smoke-private-storage-service-failure-cleanup-completed"],
  ["fixture-private-storage-unclassified:completed", "commerce-smoke-private-storage-unclassified-cleanup-completed"],
  ["fixture-database-registration:completed", "commerce-smoke-fixture-database-registration-rejection-cleanup-completed"],
  ["isolation-verification:completed", "commerce-smoke-isolation-verification-rejection-cleanup-completed"],
  ["clean-release-simulation:completed", "commerce-smoke-clean-release-simulation-rejection-cleanup-completed"],
  ["multimodal-context-creation:completed", "commerce-smoke-multimodal-context-creation-rejection-cleanup-completed"],
  ["audit-writing:completed", "commerce-smoke-audit-writing-rejection-cleanup-completed"],
  ["cleanup-failure:not-completed", "commerce-smoke-cleanup-failure-cleanup-not-completed"],
]);

function headerValues(headersText, headerName) {
  return headersText
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== headerName) return "";
      return line.slice(separator + 1).trim().toLowerCase();
    })
    .filter(Boolean);
}

export function classifyCommerceReferenceSmokeRejection(headersText) {
  if (typeof headersText !== "string") return "unclassified-protected-rejection";

  const rejectionSources = headerValues(headersText, "x-nxq-rejection-source");
  const reachedMarkers = headerValues(headersText, "x-nxq-function-reached");
  const smokePhases = headerValues(headersText, "x-nxq-smoke-phase");
  const smokeCleanup = headerValues(headersText, "x-nxq-smoke-cleanup");

  if (reachedMarkers.length === 0) {
    return rejectionSources.length === 0 && smokePhases.length === 0 && smokeCleanup.length === 0
      ? "gateway-or-upstream-before-commerce-function"
      : "unclassified-protected-rejection";
  }
  if (reachedMarkers.length !== 1 || reachedMarkers[0] !== COMMERCE_FUNCTION_REACHED) {
    return "unclassified-protected-rejection";
  }

  if (rejectionSources.length > 0) {
    if (rejectionSources.length !== 1 || smokePhases.length !== 0 || smokeCleanup.length !== 0) {
      return "unclassified-protected-rejection";
    }
    return SAFE_REJECTION_SOURCES.get(rejectionSources[0]) || "unclassified-protected-rejection";
  }

  if (smokePhases.length === 0 && smokeCleanup.length === 0) {
    return "commerce-function-post-auth-rejection";
  }
  if (smokePhases.length !== 1 || smokeCleanup.length !== 1) return "unclassified-protected-rejection";
  return SAFE_SMOKE_FAILURES.get(`${smokePhases[0]}:${smokeCleanup[0]}`) || "unclassified-protected-rejection";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const headersPath = process.argv[2];
  const httpStatus = /^\d{3}$/.test(process.argv[3] || "") ? process.argv[3] : "unknown";
  let classification = "unclassified-protected-rejection";
  try {
    classification = classifyCommerceReferenceSmokeRejection(fs.readFileSync(headersPath, "utf8"));
  } catch {
    // Never print raw response headers, paths, or unexpected values.
  }
  console.error(`Commerce reference AI-handoff smoke rejected (HTTP ${httpStatus}): ${classification}`);
}
