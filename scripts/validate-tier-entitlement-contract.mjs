import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/130_server_side_tier_entitlements.sql', 'utf8');
const catalog = fs.readFileSync('supabase/migrations/026_multi_plan_product_family_foundation.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/build-business-website/index.ts', 'utf8');

const checks = [
  ['Tier entitlement table is family + tier + feature scoped', migration.includes('unique(product_family_slug, tier_key, feature_key)')],
  ['Feature checks deny by default', migration.includes("'feature_not_entitled'") && migration.includes("'tier_not_entitled'")],
  ['Current client feature access is server-side', migration.includes('current_client_feature_access') && migration.includes('c.auth_user_id = auth.uid()')],
  ['Owner/service feature access exists for workers', migration.includes('client_feature_access') && migration.includes('Owner or service-role access required')],
  ['Inactive/denied clients cannot use entitled features', migration.includes("client_row.status::text in ('approved','active','overdue')")],
  ['Past-due clients retain features during grace', migration.includes("not in ('approved','active','overdue')")],
  ['Starter does not get mouse tracking', migration.includes("('business','starter','mouse_tracking',false")],
  ['Intelligence gets consent-gated mouse tracking', migration.includes("('business','intelligence','mouse_tracking',true") && migration.includes("'consent_required',true")],
  ['Enterprise gets consent-gated mouse tracking', migration.includes("('business','enterprise','mouse_tracking',true")],
  ['Entitlements use only catalog tier keys', !migration.includes("('business','pro'") && !migration.includes("('business','premium'") && catalog.includes("'intelligence'") && catalog.includes("'enterprise'")],
  ['Generated site uses canonical analytics tiers', worker.includes('["growth", "intelligence", "enterprise"]') && worker.includes('["intelligence", "enterprise"]') && !worker.includes('"premium"')],
  ['Standard tiers have one location and Enterprise has 100', migration.includes("'location_management',true,jsonb_build_object('max_locations',1)") && migration.includes("'multi_location',true,jsonb_build_object('max_locations',100)")],
  ['Advanced SEO is tier controlled', migration.includes("'advanced_seo'")],
  ['Clients cannot rewrite entitlement rows', !migration.includes('grant select, insert, update, delete on table public.nxq_tier_entitlements to authenticated')],
  ['Pricing is not embedded in entitlement authority', !migration.toLowerCase().includes('monthly_price') && !migration.includes('$50')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} tier entitlement checks passed.`);
if (failed) process.exit(1);
