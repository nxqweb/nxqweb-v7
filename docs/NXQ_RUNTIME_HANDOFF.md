# NXQ runtime handoff

Wave 31 makes the repository staging-ready without applying anything to Supabase, Netlify, GitHub client infrastructure, DNS, billing, or production.

## What the repository now enforces

- `npm run test:release` runs the complete local release gate.
- `npm run test:runtime-stage` proves every Edge function is in the deployment manifest and has an explicit JWT/custom-auth boundary.
- `supabase/config.toml` records the gateway policy for every function.
- The manual workflow targets the protected `nxq-staging` GitHub environment only.
- Every mutation action requires `APPLY-NXQ-SUPABASE-STAGING` exactly and always runs a linked migration dry-run first.
- Remote staging validation checks required Edge secret names and deployed function names without printing secret values.
- The Owner Launch Readiness page can configure the internal Supabase Vault routes after functions are deployed. It derives URLs from the project, reads the existing protected worker token server-side, and never returns the token.

## One-time staging setup

1. Push the safe branch and open a draft PR. Do not merge it yet.
2. Create a separate hosted Supabase staging project. Do not point `nxq-staging` at production.
3. Create the GitHub Environment named `nxq-staging` with:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_DB_PASSWORD`
4. Add the Edge secret names required by `business-external-qa` to the staging Supabase project. `NXQ_RUNTIME_ENVIRONMENT` must have the value `staging`. Print the exact names without values with:

   ```bash
   node scripts/edge-function-manifest.mjs --profile=business-external-qa
   ```

   The local machine check is authoritative for manifest/auth consistency:

   ```bash
   npm run test:runtime-stage
   ```

5. Run **NXQ Manual Supabase Stage** with action `validate`. It links staging, dry-runs migrations, and checks secret names without changing the database.
6. Run the same workflow with `apply_all` and confirmation `APPLY-NXQ-SUPABASE-STAGING`.
7. Sign into the staging Owner Portal, open **Launch readiness**, and choose **Configure staging runtime routes**. Confirm the exact phrase shown by the dialog.
8. Refresh Provider Health and request checks for the configured providers. Missing provider secret names stay visible; no secret value is displayed.
9. Start one disposable DENY-path QA run and prove zero infrastructure.
10. Start disposable APPROVE-path QA runs one at a time until ten strict external runs pass. Do not count local simulations as external evidence.

## Production remains blocked

Production still requires the ten strict external staging runs, healthy provider/worker evidence, recovery proof, owner signoff, a separate production change review, and an explicit production deployment decision. The staging workflow cannot merge a branch, publish Netlify production, change DNS, enable billing, or mark QA evidence passed.
