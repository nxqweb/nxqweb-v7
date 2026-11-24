# Full key rotation plan (written 2026-11-24; NAMES ONLY, never a value)

Owner request: once everything works, rotate every key and token so nothing that may ever have been exposed is still valid. Rotation happens at the provider (owner only); Claude never sees a value, only checks names, runs the read-only validators and reads the logs.

## What was checked on 2026-11-24 (read-only)
- Secret-shaped values in the checked-in tree (`node scripts/check-sensitive-changes.mjs --tree`): none.
- The whole git history, all branches, 1,717 commits, with the same patterns plus GitHub fine-grained, Netlify, Supabase-access, Supabase-secret and Resend token shapes (added lines only): none. Only `.env.example` is a tracked env-like file (placeholders only).
- Limits: this finds known token SHAPES in this repository. It does not prove a key was never exposed elsewhere (chat, screenshots, a browser, a password manager, a past paste). If the owner remembers what the small incident was, rotate THAT item now rather than waiting for the end.
- Gap found and FIXED the same day: `scripts/check-sensitive-changes.mjs` now also matches GitHub fine-grained tokens (`github_pat_`), Netlify (`nfp_`), Supabase (`sbp_`, `sb_secret_`) and Resend (`re_`) shapes, with tests that plant fake values and check that lookalike words are not flagged. The tree still scans clean.

## Inventory (names only; see `docs/EXPIRING_TOKENS.md` for expiry months)
| Group | Names | Where it is set | Difficulty |
|---|---|---|---|
| Netlify | `NETLIFY_ACCESS_TOKEN`, `NXQ_NETLIFY_VERIFY_TOKEN` (one Netlify personal token feeds both); four old no-expiry Netlify tokens still listed | Netlify user settings, Supabase Edge secrets | Easy |
| GitHub | `NXQ_GITHUB_VERIFY_TOKEN` (fine-grained); a classic token named like the old automation one (delete, nothing uses it) | GitHub settings, Supabase Edge secrets | Easy |
| GitHub App | `GITHUB_APP_PRIVATE_KEY` (plus app id and installation id, which are not secret) | the GitHub App page, Supabase Edge secrets | Medium: make a new key, update the secret, check a run, delete the old key |
| Supabase CLI/Actions | `SUPABASE_ACCESS_TOKEN` (GitHub environment secret on `nxq-staging`) | Supabase account tokens, GitHub environment secrets | Easy |
| Scanii | `NXQ_SCANII_API_KEY`, `NXQ_SCANII_API_SECRET` | Scanii API Keys page (2 keys exist), Supabase Edge secrets | Easy |
| Internal shared tokens | `NXQ_AUTOMATION_WORKER_TOKEN` and the adapter tokens (`NXQ_*_ADAPTER_TOKEN`, `NXQ_LEAD_CHALLENGE_TOKEN`) | BOTH Supabase Edge secrets AND the Vault (migration 197 reads Vault values) | Hard: both places must change together or workers stop |
| Supabase project keys | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, database password, JWT secret | Supabase project settings | Hardest: check Supabase's current docs first. The browser build bakes the anon key in (`VITE_SUPABASE_ANON_KEY`), so a changed anon key needs a main-app deploy; signed-in sessions may be invalidated |
| Not created yet | Resend, live Stripe, AI provider key | n/a | Create them fresh at launch; do not rotate what does not exist yet |

## Order (do it AFTER everything else works, BEFORE the final evidence refresh and the sign-off)
1. Prepare: password manager ready, one item at a time, write the new token's expiry MONTH in `docs/EXPIRING_TOKENS.md` (never the day or the value).
2. Easy group first: Netlify, GitHub verify token, Supabase Actions token, Scanii. After each, update the matching secret, then run the read-only `validate_foundation` and the provider-health check, and confirm nothing broke before the next one.
3. GitHub App key, then the internal shared tokens (Edge secret and Vault in the same sitting).
4. Supabase project keys last, only if the owner wants them rotated and after reading Supabase's current instructions. Expect a main-app deploy (15 credits) if the anon key changes.
5. Delete every old token that is no longer used (the four old Netlify tokens, the classic GitHub token, old GitHub App keys, old Scanii key).
6. Re-prove: `validate_foundation`, provider health, then `run_evidence_suite` (this is also the final-week evidence refresh). One QA run (about 30 credits) proves Netlify and GitHub end to end if the owner wants that extra proof.

## Effort
Owner: roughly a few hours spread over one or two sittings, mostly clicking at providers. Claude: checks names, runs the validators and reads logs after each step. The only genuinely risky parts are the shared internal tokens and the Supabase project keys, because a half-done change stops the background workers.

## Owner to-dos that help regardless
- Turn on GitHub secret scanning and push protection (Repo, Settings, Advanced Security); see `docs/OWNER_SECURITY_SETTINGS_CHECK.md` (still open).
- Never paste a secret into chat or a screenshot.
