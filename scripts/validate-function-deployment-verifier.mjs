// Unit checks for scripts/verify-function-deployment.mjs using synthetic list captures.
import assert from "node:assert/strict";
import { compareDeployments } from "./verify-function-deployment.mjs";

const fn = (slug, version, extra = {}) => ({ slug, name: slug, status: "ACTIVE", version, updated_at: 1000 + version, ...extra });
const base = [fn("provision-storefront", 4), fn("ingest-business-lead", 9), fn("prepare-build-plan", 2, { verify_jwt: true })];
const cases = [
  ["only target version bumped (bare array)", base, [fn("provision-storefront", 5), fn("ingest-business-lead", 9), fn("prepare-build-plan", 2, { verify_jwt: true })], true],
  ["envelope shape is accepted", { ok: true, data: { functions: base } }, { data: { functions: [fn("provision-storefront", 5), fn("ingest-business-lead", 9), fn("prepare-build-plan", 2, { verify_jwt: true })] } }, true],
  ["target unchanged is rejected", base, base, false],
  ["another function changed is rejected", base, [fn("provision-storefront", 5), fn("ingest-business-lead", 10), fn("prepare-build-plan", 2, { verify_jwt: true })], false],
  ["verify_jwt true on the target is rejected", base, [fn("provision-storefront", 5, { verify_jwt: true }), fn("ingest-business-lead", 9), fn("prepare-build-plan", 2, { verify_jwt: true })], false],
  ["inactive target is rejected", base, [fn("provision-storefront", 5, { status: "REMOVED" }), fn("ingest-business-lead", 9), fn("prepare-build-plan", 2, { verify_jwt: true })], false],
  ["target missing after deploy is rejected", base, [fn("ingest-business-lead", 9)], false],
  ["a function disappearing is rejected", base, [fn("provision-storefront", 5), fn("ingest-business-lead", 9)], false],
  ["empty after list is rejected", base, [], false],
  ["first-ever deploy of the target is accepted", [fn("ingest-business-lead", 9)], [fn("provision-storefront", 1), fn("ingest-business-lead", 9)], true],
  ["no version or updated_at cannot be confirmed", [{ slug: "provision-storefront", status: "ACTIVE" }], [{ slug: "provision-storefront", status: "ACTIVE" }], false],
];
for (const [label, before, after, expected] of cases) {
  const result = compareDeployments(before, after, "provision-storefront", false);
  assert.equal(result.ok, expected, `${label}: ${result.problems.join("; ")}`);
  console.log(`PASS ${label}`);
}
console.log(`${cases.length}/${cases.length} function-deployment verifier checks passed.`);
