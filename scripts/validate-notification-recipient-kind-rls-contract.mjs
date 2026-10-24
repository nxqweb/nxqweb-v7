import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration253 = read("supabase/migrations/253_restrict_client_notification_recipient_kind.sql");
const migration254 = read("supabase/migrations/254_deliver_billing_notification_events.sql");
const migration133 = read("supabase/migrations/133_business_growth_operations_foundation.sql");

const checks = [];
const check = (name, passed) => checks.push([name, Boolean(passed)]);

check(
  "Migration 253 drops and recreates client_read_own_notifications (not a brand-new policy name)",
  migration253.includes("drop policy if exists client_read_own_notifications on public.notification_deliveries") &&
  migration253.includes("create policy client_read_own_notifications on public.notification_deliveries")
);

check(
  "Migration 253's policy restricts to recipient_kind = 'client' in addition to client_id ownership",
  /recipient_kind\s*=\s*'client'/.test(migration253) &&
  migration253.includes("client_id is not null") &&
  migration253.includes("c.auth_user_id = auth.uid()")
);

check(
  "Migration 253 does not alter owner_manage_all_notifications -- owner access must remain unaffected (the comment block may still reference it in prose)",
  !/(drop|create|alter)\s+policy[^;]*owner_manage_all_notifications/i.test(migration253)
);

check(
  "Migration 253 is numbered lower than 254 -- ordering enforced by filename, not just documentation",
  253 < 254
);

check(
  "Migration 253 documents that it is deliberately numbered ahead of 254 so ordering is structural, not procedural",
  migration253.includes("deliberately numbered 253") &&
  migration253.includes("one lower than migration 254") &&
  migration253.includes("guaranteed to")
);

check(
  "Migration 254 documents the same numbering relationship from its side, and never claims independently-verified applied status",
  migration254.includes("deliberately numbered 254") &&
  migration254.includes("one higher") &&
  migration254.includes("than migration 253") &&
  migration254.includes("has not been independently verified")
);

check(
  "Migration 253 also states its own applied status has not been independently verified against staging",
  /has not been independently verified/i.test(migration253)
);

check(
  "Migration 133's original (still-vulnerable) policy text is exactly what 253 documents replacing -- no undocumented drift",
  migration133.includes("create policy client_read_own_notifications on public.notification_deliveries") &&
  migration133.includes("using (client_id is not null and exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));") &&
  !migration133.includes("recipient_kind = 'client'")
);

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed += 1;
}
console.log(`${checks.length - failed}/${checks.length} notification recipient-kind RLS checks passed.`);
if (failed) process.exit(1);
