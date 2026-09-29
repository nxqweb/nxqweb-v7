import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration254 = read("supabase/migrations/254_restrict_client_notification_recipient_kind.sql");
const migration133 = read("supabase/migrations/133_business_growth_operations_foundation.sql");

const checks = [];
const check = (name, passed) => checks.push([name, Boolean(passed)]);

check(
  "Migration 254 drops and recreates client_read_own_notifications (not a brand-new policy name)",
  migration254.includes("drop policy if exists client_read_own_notifications on public.notification_deliveries") &&
  migration254.includes("create policy client_read_own_notifications on public.notification_deliveries")
);

check(
  "Migration 254's policy restricts to recipient_kind = 'client' in addition to client_id ownership",
  /recipient_kind\s*=\s*'client'/.test(migration254) &&
  migration254.includes("client_id is not null") &&
  migration254.includes("c.auth_user_id = auth.uid()")
);

check(
  "Migration 254 does not alter owner_manage_all_notifications -- owner access must remain unaffected (the comment block may still reference it in prose)",
  !/(drop|create|alter)\s+policy[^;]*owner_manage_all_notifications/i.test(migration254)
);

check(
  "Migration 254 explicitly documents the required apply-together ordering with 253",
  migration254.includes("253") && /same guarded apply_all run/i.test(migration254)
);

check(
  "Migration 133's original (still-vulnerable) policy text is exactly what 254 documents replacing -- no undocumented drift",
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
