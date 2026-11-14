import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const preferencesPage = read("src/pages/ClientNotificationPreferences.tsx");
const portalPage = read("src/pages/ClientPortal.tsx");
const migration133 = read("supabase/migrations/133_business_growth_operations_foundation.sql");
const app = read("src/App.tsx");

const checks = [];
const check = (name, passed) => checks.push([name, Boolean(passed)]);

function checkClientScopedNotificationList(pageName, source, clientIdExpr) {
  check(
    `${pageName}: notification list is scoped to this client's own client_id`,
    source.includes(`.eq("client_id", ${clientIdExpr})`) && source.includes('.from("notification_deliveries")')
  );

  check(
    `${pageName}: explicitly filters recipient_kind to client -- RLS ownership alone would also match owner-facing rows about the same client`,
    source.includes('.eq("recipient_kind", "client")')
  );

  check(
    `${pageName}: does not request owner-only columns (metadata, provider fields) that could carry internal detail`,
    !/\.from\("notification_deliveries"\)[\s\S]{0,60}\.select\([^)]*metadata/.test(source)
  );

  check(
    `${pageName}: no write/update call against notification_deliveries -- authenticated only has SELECT (migration 133), so marking read/seen requires a migration, not a direct write`,
    !/notification_deliveries[\s\S]{0,80}\.(update|upsert|insert|delete)\(/.test(source)
  );
}

checkClientScopedNotificationList("ClientNotificationPreferences.tsx", preferencesPage, "client.data.id");
checkClientScopedNotificationList("ClientPortal.tsx", portalPage, "loadedClient.id");

check(
  "Underlying RLS still restricts client reads to their own rows (migration 133 unchanged)",
  migration133.includes("create policy client_read_own_notifications on public.notification_deliveries") &&
  migration133.includes("exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid())")
);

check(
  "Underlying grant still restricts authenticated to SELECT only on notification_deliveries",
  migration133.includes("grant select on public.notification_deliveries to authenticated") &&
  !/grant\s+select,\s*insert/.test(migration133.match(/grant[^;]*authenticated;/g)?.find((line) => line.includes("notification_deliveries")) || "")
);

check(
  "/client/notifications route is wired to the notification-preferences page",
  app.includes('path === "/client/notifications"') && app.includes("ClientNotificationPreferences")
);

check(
  "ClientNotificationPreferences.tsx still fails safely (no Supabase configured / no session) before querying notifications",
  preferencesPage.includes("isSupabaseConfigured") && preferencesPage.includes('window.location.replace("/portal/login")')
);

check(
  "ClientPortal.tsx still fails safely (no Supabase configured / no session) before querying notifications",
  portalPage.includes("isSupabaseConfigured") && portalPage.includes('window.location.replace("/portal/login")')
);

check(
  "ClientPortal.tsx clears notifications state when dependent portal data is reset (e.g. on load failure)",
  portalPage.includes("function resetDependentPortalData") &&
  /function resetDependentPortalData\(\)\s*\{[\s\S]*?setNotifications\(\[\]\);[\s\S]*?\}/.test(portalPage)
);

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) failed += 1;
}
console.log(`${checks.length - failed}/${checks.length} client notification-center checks passed.`);
if (failed) process.exit(1);
