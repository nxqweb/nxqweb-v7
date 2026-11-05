import assert from "node:assert/strict";
import { confirmProject } from "./confirm-linked-project-identity.mjs";

const REF = "sampleref00000000000";
const a = { id: REF, name: "Sample Staging", region: "us-east-1", linked: true };
const b = { id: "otherref0000000000000", name: "Other", region: "eu-west-1", linked: false };
const cases = [
  ["bare array (--output json)", [b, a], REF, { ok: true, name: "Sample Staging", region: "us-east-1" }],
  ["envelope {projects}", { projects: [a, b] }, REF, { ok: true, name: "Sample Staging", region: "us-east-1" }],
  ["nested envelope {data:{projects}}", { ok: true, data: { projects: [a] } }, REF, { ok: true, name: "Sample Staging", region: "us-east-1" }],
  ["missing region", [{ id: REF, name: "N" }], REF, { ok: true, name: "N", region: "(unknown)" }],
  ["no match", [b], REF, { ok: false }],
  ["ambiguous", [a, { ...a }], REF, { ok: false }],
  ["unrecognized shape", { foo: 1 }, REF, { ok: false }],
  ["empty ref", [a], "", { ok: false }],
];
for (const [label, input, ref, expected] of cases) {
  const result = confirmProject(input, ref);
  assert.equal(result.ok, expected.ok, label);
  if (expected.ok) assert.deepEqual(result, expected, label);
  assert.ok(!JSON.stringify(result).includes(REF), `${label}: result must not contain the ref`);
  console.log(`PASS  ${label}`);
}
console.log(`${cases.length}/${cases.length} project-identity parser checks passed.`);
