import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/125_nxq_universal_identity_foundation.sql', 'utf8');

const checks = [
  ['One auth user maps to one NXQ account', migration.includes('auth_user_id uuid not null unique')],
  ['Global NXQ public identifier exists', migration.includes('nxq_id text not null unique') && migration.includes("'NXQ-'" )],
  ['NXQ Web keeps a product-specific client code', migration.includes('client_code text') && migration.includes("'WEB-'" )],
  ['Existing client UUID primary key is preserved', !migration.includes('drop column id') && !migration.includes('drop constraint clients_pkey')],
  ['Products have independent access policies', migration.includes('nxq_products') && migration.includes('minimum_assurance_level') && migration.includes('verification_policy')],
  ['Product memberships are separated from identity', migration.includes('nxq_product_memberships') && migration.includes('unique (nxq_account_id, product_id)')],
  ['Verification claims are reusable identity state', migration.includes('nxq_verification_claims') && migration.includes('verification_type') && migration.includes('assurance_level')],
  ['Passkey and device biometric assertions are modeled without raw biometrics', migration.includes("'passkey'") && migration.includes("'device_biometric_assertion'")],
  ['Source explicitly forbids raw biometric templates', migration.includes('Do NOT store raw biometric templates')],
  ['Source explicitly forbids loose government-ID images', migration.includes('government-ID') && migration.includes('document images')],
  ['Product capability step-up requirements exist', migration.includes('nxq_product_verification_requirements') && migration.includes('step_up_required')],
  ['Cross-product access status returns missing verification claims', migration.includes('nxq_product_access_status') && migration.includes("'missing_claims'")],
  ['NXQ organizations support enterprise identity relationships', migration.includes('nxq_organizations') && migration.includes('nxq_organization_memberships')],
  ['Existing authenticated Web clients are backfilled', migration.includes('Backfill existing authenticated NXQ Web clients') && migration.includes('where auth_user_id is not null')],
  ['New Web clients auto-attach to NXQ ID', migration.includes('attach_client_to_nxq_account') && migration.includes('before insert or update of auth_user_id')],
  ['Verification mutations remain service-side', migration.includes('grant select, insert, update, delete on public.nxq_verification_claims to service_role') && !migration.includes('grant insert, update on public.nxq_verification_claims to authenticated')],
  ['Users can only read their own account identity', migration.includes('nxq_account_self_read') && migration.includes('auth_user_id = auth.uid()')],
  ['Users can only read their own verification claims', migration.includes('nxq_verification_claim_self_read') && migration.includes('current_nxq_account_id()')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}

console.log(`\n${checks.length - failed}/${checks.length} NXQ identity contract checks passed.`);
if (failed) process.exit(1);
