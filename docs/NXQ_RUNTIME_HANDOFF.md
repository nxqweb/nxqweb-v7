# NXQ runtime handoff

## Current checkpoint — 2026-08-16

The current safe audit branch is based on draft PR #11 at commit `61d407a`. PR #17 has already been merged into that branch. The later security/schema branches through migrations 218–220 are ancestors of the same PR head; they are not separate missing work.

The 2026-08-16 audit adds migration 221 and closes tenant read-model, outbound request, quota-concurrency, structured-change routing, and GitHub App key compatibility gaps. Local verification is green across all contract validators, 188 migration files, 276 effective `SECURITY DEFINER` functions, 35 Edge functions, security/accessibility checks, 23 failure simulations, and 10 deterministic lifecycle replays.

No change from this audit has been applied to Supabase, Netlify, GitHub client infrastructure, DNS, billing, or production. Local lifecycle simulations are not external QA evidence.

## What the repository now enforces

- `npm run test:release` runs the complete local release gate.
- `npm run test:runtime-stage` proves every Edge function is in the deployment manifest and has an explicit JWT/custom-auth boundary.
- `supabase/config.toml` records the gateway policy for every function.
- The manual workflow targets the protected `nxq-staging` GitHub environment only.
- Every mutation action requires `APPLY-NXQ-SUPABASE-STAGING` exactly and always runs a linked migration dry-run first.
- Remote staging validation checks required Edge secret names and deployed function names without printing secret values.
- The Owner Launch Readiness page can configure the internal Supabase Vault routes after functions are deployed. It derives URLs from the project, reads the existing protected worker token server-side, and never returns the token.

## One-time staging setup

1. Review and push the safe audit branch into draft PR #11. Do not merge it yet.
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
6. Run the same workflow with `apply_all` and confirmation `APPLY-NXQ-SUPABASE-STAGING`. Confirm migrations 220 and 221 are included before deploying the client portal and changed Edge functions.
7. Sign into the staging Owner Portal, open **Launch readiness**, and choose **Configure staging runtime routes**. Confirm the exact phrase shown by the dialog.
8. Refresh Provider Health and request checks for the configured providers. Missing provider secret names stay visible; no secret value is displayed.
9. Re-check provider capacity before retrying the existing QA02 preview. Its last recorded Netlify attempt was skipped because account build credits were exhausted; do not blindly create a replacement site or deploy.
10. Start one disposable DENY-path QA run and prove zero infrastructure.
11. Start disposable APPROVE-path QA runs one at a time until ten strict external runs pass. Do not count local simulations as external evidence.

## Production remains blocked

Production still requires the ten strict external staging runs, healthy provider/worker evidence, recovery proof, owner signoff, a separate production change review, and an explicit production deployment decision. The staging workflow cannot merge a branch, publish Netlify production, change DNS, enable billing, or mark QA evidence passed.
