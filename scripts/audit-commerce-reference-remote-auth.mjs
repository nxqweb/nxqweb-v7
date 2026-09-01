import fs from "node:fs";
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
  const passed = results.every((result) => result.passed);
  console.log(`${passed ? "PASS" : "FAIL"}: Commerce remote authentication audit`);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2] || "");
}
