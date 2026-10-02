import assert from "node:assert/strict";
import { formatDataApiGrantRows, dataApiGrantQuery, dataApiGrantTables } from "./remote-launch-architecture-contract.mjs";

const lines = formatDataApiGrantRows([
  { table_name: "automation_jobs", grantee: "authenticated", privileges: "SELECT" },
  { table_name: "automation_jobs", grantee: "anon", privileges: "" },
  { table_name: "bad", grantee: 5 },
  null,
]);
assert.deepEqual(lines, [
  "INFO  data-api-grants automation_jobs authenticated: SELECT",
  "INFO  data-api-grants automation_jobs anon: none",
]);
assert.equal(dataApiGrantTables.length, 4);
assert.ok(!/\b(insert into|update public|delete from|drop|alter|grant |revoke )/i.test(dataApiGrantQuery), "query must be read-only");
console.log("3/3 data-api-grant report checks passed.");
