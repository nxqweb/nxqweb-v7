import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SAFE_REJECTION_SOURCES = new Map([
  ["worker-token-guard", "commerce-function-worker-token-guard"],
  ["runtime-environment-guard", "commerce-function-runtime-environment-guard"],
]);

export function classifyCommerceReferenceSmokeRejection(headersText) {
  if (typeof headersText !== "string") return "unclassified-protected-rejection";

  const values = headersText
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== "x-nxq-rejection-source") return "";
      return line.slice(separator + 1).trim().toLowerCase();
    })
    .filter(Boolean);

  if (values.length === 0) return "gateway-or-upstream-before-commerce-function";
  if (new Set(values).size !== 1) return "unclassified-protected-rejection";
  return SAFE_REJECTION_SOURCES.get(values[0]) || "unclassified-protected-rejection";
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
