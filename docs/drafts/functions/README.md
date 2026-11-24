# Draft Edge functions (NOT deployed, NOT in `supabase/functions`)

A function here is finished, tested source that is deliberately kept OUT of `supabase/functions`, so it cannot change the function manifest, the CI gate or what `deploy_functions` ships ("deploy ships ALL functions") until the owner approves adopting it.

| Draft | What it does | Needs first |
|---|---|---|
| `generate-store-background/` | The automatic store-background maker: takes the oldest waiting request, asks a picture service, checks and saves the picture in the store's own branding folder, and reports back for the owner's approval. One request per run. Switched OFF until its settings exist. | draft 10 and draft 11 promoted and applied; a provider account, key and spending cap (owner) |

Tests: `scripts/test-generate-store-background.mjs` (fakes only: no network, no key, no database). It also checks that the function's copy of the prompt builder gives the same text as the app's, and that the function is still only a draft.

## Adopting a draft function (all steps gated; dry-run on 2026-11-24 showed this is exactly what the repo asks for)
1. Apply the migrations it calls (298 and 299, promoted 2026-11-24 and not yet applied; the CI rule "every source RPC call has a captured migration definition" is satisfied now that they are real migrations).
2. Copy the folder to `supabase/functions/<name>/`.
3. Add `entry("<name>", false, "worker-token")` to `scripts/edge-function-manifest.mjs`.
4. Add `[functions.<name>]` with `verify_jwt = false` to `supabase/config.toml`.
5. Flip the "still only a draft" check in its test to "is in the manifest".
6. Run `npm run test:ci-parity`; then the guarded deploy workflow with the owner's phrase and approval.
