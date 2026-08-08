import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/130_server_side_tier_entitlements.sql', 'utf8');

const checks = [
  ['Tier entitlement table is family + tier + feature scoped', migration.includes('unique(product_family_slug, tier_key, feature_key)')],
  ['Feature checks deny by default', migration.includes("'feature_not_entitled'") && migration.includes("'tier_not_entitled'")],
  ['Current client feature access is server-side', migration.includes('current_client_feature_access') && migration.includes('c.auth_user_id = auth.uid()')],
  ['Owner/service feature access exists for workers', migration.includes('client_feature_access') && migration.includes('Owner or service-role access required')],
  ['Inactive/denied clients cannot use entitled features', migration.includes("client_row.status::text in ('approved','active')")],
  ['Starter does not get mouse tracking', migration.includes("('business','starter','mouse_tracking',false")],
  ['Premium gets mouse tracking with consent requirement', migration.includes("('business','premium','mouse_tracking',true") && migration.includes("'consent_required',true")],
  ['Advanced SEO is tier controlled', migration.includes("'advanced_seo'")],
  ['Pricing is not embedded in entitlement authority', !migration.toLowerCase().includes('monthly_price') && !migration.includes('$50')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} tier entitlement checks passed.`);
if (failed) process.exit(1);