# NXQ runtime handoff

## Current checkpoint — 2026-08-16

Draft PR #11 contains the audited V11 baseline. Commit `71c6f0d` is the last published audit checkpoint before the unified AI-provider follow-up described here; PR #17 and the later security/schema work are already ancestors of the same PR branch, not separate missing work.

The 2026-08-16 audit adds migration 221 and closes tenant read-model, outbound request, quota-concurrency, structured-change routing, and GitHub App key compatibility gaps. The staging validation that followed stopped safely before mutations because the classifier required a second, nonexistent AI adapter. Migration 222 and classifier runtime v3 remove that duplicate contract: classification and build-plan generation now share one provider-neutral four-secret model configuration, strict structured output, bounded public-HTTPS networking, independent patch validation, and real provider-call readiness evidence.

Local verification is green across all 67 contract validators, 189 migration files, 276 effective `SECURITY DEFINER` functions, 35 Edge functions, security/accessibility checks, 23 failure simulations, and 10 deterministic lifecycle replays.

The temporary no-key path is intentionally staging-only. Deterministic build planning can continue without the external model, contact-only structured changes remain automated, and ambiguous change requests route to owner review instead of failing. Production still requires a real successful provider call.

The zero-key provider fallback is also explicit and staging-only. Public lead intake may operate without a challenge adapter only when the form does not require a challenge and the runtime environment is staging-like; origin allowlists, global/per-fingerprint quotas, fingerprint hashing, request limits, and the honeypot remain mandatory. External notifications are blocked while in-app notifications continue. Missing malware scanning never claims or downloads a file in staging, and every pending upload remains quarantined. Outside staging, missing lead-challenge and malware adapters fail closed.

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

1. Review the latest safe checkpoint on draft PR #11. Do not merge it yet.
2. Create a separate hosted Supabase staging project. Do not point `nxq-staging` at production.
3. Create the GitHub Environment named `nxq-staging` with:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_DB_PASSWORD`
4. Add the Edge secret names required by `business-prelaunch` to the staging Supabase project. This profile checks every Business launch secret except `NXQ_AI_MODEL_PROVIDER_TOKEN`. `NXQ_RUNTIME_ENVIRONMENT` must have the value `staging`. Print the exact names without values with:

   ```bash
   node scripts/edge-function-manifest.mjs --profile=business-prelaunch
   ```

   The local machine check is authoritative for manifest/auth consistency:

   ```bash
   npm run test:runtime-stage
   ```

   The shared AI model provider requires exactly these four protected Edge secret names:

   - `NXQ_AI_MODEL_PROVIDER_URL`
   - `NXQ_AI_MODEL_PROVIDER_TOKEN`
   - `NXQ_AI_MODEL_PROVIDER_MODEL`
   - `NXQ_AI_MODEL_PROVIDER_PROTOCOL`

   For an OpenAI Responses configuration, set the URL to the provider's Responses endpoint and the protocol to `openai_responses`. Store the API key only in Supabase Edge secrets; never paste it into chat, source, logs, workflow inputs, or a committed environment file. The selected model must support strict structured outputs.

   Provider readiness also uses two first-party, protected adapter functions. Point each adapter URL at the matching function in the same staging project and use a separate randomly generated adapter token. Never reuse the automation worker token or place any value in source, GitHub workflow inputs, or chat.

   Notification delivery requires:

   - `NXQ_NOTIFICATION_ADAPTER_URL` → the hosted `notification-provider-adapter` function
   - `NXQ_NOTIFICATION_ADAPTER_TOKEN`
   - `NXQ_RESEND_API_KEY`
   - `NXQ_NOTIFICATION_FROM_EMAIL`

   Malware scanning requires:

   - `NXQ_MALWARE_SCAN_ADAPTER_URL` → the hosted `malware-scan-provider-adapter` function
   - `NXQ_MALWARE_SCAN_ADAPTER_TOKEN`
   - `NXQ_CLOUDMERSIVE_API_KEY`

   The default Cloudmersive adapter limit is 3,500,000 bytes so the evaluation tier fails closed before an unsupported upload. A later paid plan may use the optional `NXQ_MALWARE_ADAPTER_MAX_BYTES`, capped by NXQ at 100 MiB. File access remains restricted unless the provider returns valid clean evidence and the independently computed SHA-256 matches.

   Merely adding these names cannot make readiness green. Notification readiness requires a real successful delivery within 30 days. File-security readiness requires real provider success plus a released clean scan within 30 days. The generic provider-health worker deliberately preserves those activity-owned statuses instead of fabricating health from configuration.

5. Before the real AI key is available, run **NXQ Manual Supabase Stage** with action `validate_prelaunch`. It links staging, dry-runs migrations, and proves every other launch secret name is present without changing the database.
6. Run `validate_zero_key` while the challenge, malware-scan, and external-notification providers are intentionally unavailable. This validates the existing public analytics/lead endpoints and fingerprint salt without accepting fake adapter values. `validate_prelaunch` must continue to fail on those nine adapter/provider names until real providers are connected.
7. Run `validate_non_ai` while using the temporary staging fallback. Only after the real provider token is added should `validate` and `apply_all` be allowed to pass. `apply_all` requires confirmation `APPLY-NXQ-SUPABASE-STAGING`; confirm migration 238 and every earlier pending migration are included before deploying the client portal and changed Edge functions.
   After migration 238 is applied, the manual staging action `deploy_provider_readiness` deploys exactly the six provider-readiness functions changed by that repair. It does not deploy the full function manifest or call Netlify.
8. Sign into the staging Owner Portal, open **Launch readiness**, and choose **Configure staging runtime routes**. Confirm the exact phrase shown by the dialog.
9. Refresh Provider Health and request checks for the configured providers. Missing provider secret names stay visible; no secret value is displayed.
10. Re-check provider capacity before retrying the existing QA02 preview. Its last recorded Netlify attempt was skipped because account build credits were exhausted; do not blindly create a replacement site or deploy.
11. Start one disposable DENY-path QA run and prove zero infrastructure.
12. Start disposable APPROVE-path QA runs one at a time until ten strict external runs pass. Do not count local simulations as external evidence.

## Plug-in-and-launch sequence

When Netlify production deployments resume and the model-provider token is available:

1. Add or replace only `NXQ_AI_MODEL_PROVIDER_TOKEN` in protected Supabase Edge secrets. Never place it in GitHub, chat, source, logs, or workflow inputs.
2. Run `validate`; it must pass the strict `business-external-qa` profile.
3. Run `apply_all` with the exact staging confirmation, then configure staging runtime routes from Owner Launch Readiness.
4. Prove a real provider call and healthy worker/provider evidence.
5. Complete one DENY-path run and ten consecutive APPROVE-path external runs without duplicate infrastructure, crossed tenant data, or manual rescue.
6. Review the production change, provide explicit owner signoff, and make a separate production launch decision. No earlier step merges or publishes production.

## Production remains blocked

Production still requires the ten strict external staging runs, healthy provider/worker evidence, recovery proof, owner signoff, a separate production change review, and an explicit production deployment decision. The staging workflow cannot merge a branch, publish Netlify production, change DNS, enable billing, or mark QA evidence passed.
