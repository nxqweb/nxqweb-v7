# NXQ runtime handoff (canonical)

This is the live, authoritative handoff document for `nxqweb-v7`. Read
`CLAUDE.md` first for standing operating rules, then this file for current
state. Update this file, not a new one, at every handoff.

## Progress ledger — run #214 HTTP 400 (do not re-investigate; read this first)

If a future session sees `validate_prelaunch` fail on "Remote
launch-architecture contract query failed with HTTP 400" again, **check
this ledger before re-running any investigation**:

- **Cause found and fixed, commit `b87f642`**: 3 lines in
  `scripts/remote-launch-architecture-contract.mjs` used double quotes
  around SQL string literals (`"'purchase_credit'"` etc.) inside
  `position(... in ...)` — PostgreSQL reads double quotes as an
  identifier, not a string, so this referenced a nonexistent column.
  Reproduced locally against disposable Postgres 16
  (`ERROR: column "'purchase_credit'" does not exist`); fix verified the
  same way. Full trail: "Staging preflight run #214 — HTTP 400 root
  cause and fix" section below.
- **Ruled out, do not re-check**: the `/database/query/read-only`
  endpoint suffix (confirmed working against real staging via runs
  #212/#213 logs, 2026-09-19) — a same-turn edit that removed it was
  reverted, never pushed. Also ruled out: a missing-table/unapplied-migration
  schema mismatch (the referenced tables from migrations 243/244 already
  existed in staging as of the Sep 19 run — confirmed via that run's own
  "Remote database is up to date" dry-run line).
- **If HTTP 400 recurs after this fix**: it is a **different** cause —
  do not re-apply this same diagnosis. Start from the actual new error
  text (the script does not currently log the response body on failure;
  consider adding that before re-diagnosing blind).
- **Run #215 result (HEAD `2e30e10`), 2026-09-29**: the `b87f642` fix
  worked — HTTP 400 gone, 23 of 24 checks passed. One new, separate
  failure surfaced: `architecture-one-time-topup-contract`.
- **Second cause found and fixed, commit `e0ea1cd`**: NOT a real
  contract mismatch. 4 of that check's 5 `position(... in ...)`
  substring tests expected spaces (`<> 1000`, `, 900`, `', false`) that
  this codebase's compact SQL style (see
  `supabase/migrations/246_enforce_paid_capability_boundaries.sql`
  lines 286–319, e.g. `target_amount_paid_cents<>1000`,
  `'purchase_credit',900`, `'recurring',false`) never produces —
  confirmed by reproducing migration 246's exact function against real
  Postgres and observing the same 4/5 false results purely from
  whitespace. The actual payment guard (exactly-1000-cents enforcement,
  hardcoded 900/false/false, `'purchase_credit'` ledger entry) is
  intact and correct. Fix normalizes the function-definition text
  (strips all whitespace) before matching whitespace-free versions of
  the same 5 substrings — verified this does not weaken the check by
  running it against a deliberately broken stand-in function (wrong
  amount, `recurring=true`, `auto_refill=true`) and confirming all 5
  conditions still correctly failed. No other check in the query has
  the same space-dependent substring pattern (checked via grep).
- **Run #216 result (HEAD `879ecf9`), 2026-09-30 — both fixes confirmed
  against real staging**: all 24/24 architecture checks passed
  (`Remote launch-architecture contract passed through read-only
  Supabase query endpoint`). `Migration dry run` reached and reported
  cleanly: `Would push these migrations:` listing, in exact ascending
  order, `248_notify_client_on_website_setup_denial.sql`,
  `249_notify_client_on_commerce_customer_request.sql`,
  `250_notify_client_on_file_scan_completion.sql`,
  `251_multi_location_self_serve_addon.sql`,
  `252_fix_location_addon_trigger_conflict.sql`,
  `253_restrict_client_notification_recipient_kind.sql`,
  `254_deliver_billing_notification_events.sql` — confirming none of
  the 7 have been applied to staging yet and the dependency ordering
  (251→252, 253→254) is exactly as the file numbering requires. This
  is real evidence, not an inference: `supabase db push --dry-run
  --linked` connected to the actual remote project and reported this.
  **The run still ended in failure**, but at a later, different step:
  `business-prelaunch is missing 6 Supabase Edge secret name(s):
  NXQ_CLOUDMERSIVE_API_KEY, NXQ_LEAD_CHALLENGE_ENDPOINT,
  NXQ_LEAD_CHALLENGE_TOKEN, NXQ_NOTIFICATION_FROM_EMAIL,
  NXQ_PUBLIC_TURNSTILE_SITE_KEY, NXQ_RESEND_API_KEY`. This is an
  environment-configuration gap, not a code defect — no further
  investigation needed here; see "Missing staging Edge secrets" below
  for what each value is and how to set it.
- **Verification status as of this entry**: both `b87f642` and
  `e0ea1cd` are now proven end-to-end against real staging, not just
  local reproduction. The next blocker is purely the 6 missing Edge
  secret names above — not a code or migration issue. Do not
  re-dispatch `validate_prelaunch` again until those secrets are set;
  it will fail at the same step for the same reason until then.
- **Run #217 (`validate_zero_key`, HEAD `9eca5f6`), 2026-09-30 —
  fully green**, first clean run this session: `Link project` and
  `Migration dry run` both succeeded (same 248–254 list as run #216,
  confirming staging state hasn't changed), `Verify staging Edge
  secret names` **passed** (`business-zero-key-staging has all 24
  required Supabase Edge secret names`), and all 24 architecture
  checks passed again. Confirms the zero-key staging path is fully
  wired and does not depend on the 6 secrets blocking
  `validate_prelaunch`. **This is not launch approval** — it only
  proves the zero-key profile; the full prelaunch gate still needs
  those 6 secrets.
- **Migrations 248–254 risk review (2026-09-30/10-01), read-only, no
  apply yet**: reviewed all 7 files in full. All additive/restriction-only
  — no `DROP TABLE`, no backfill, no destructive change. Real findings:
  (a) **251/252 must apply together, in order** — 251 alone leaves the
  add-on feature inert (fails closed, not a security/data risk) until
  252 lands in the same batch; (b) **253/254 ordering is the one real
  security-sensitive dependency**, already closed structurally by
  filename order (documented above); (c) **use `apply_migrations`, not
  `apply_all`** for this task — `apply_all` also deploys every Edge
  function and its secret gate falls through to `business-external-qa`
  (= `business-prelaunch` + `NXQ_AI_MODEL_PROVIDER_TOKEN`), which would
  still fail after the 6 secrets are set; `apply_migrations` skips the
  Edge-secret-name check step entirely (not in that step's `if:`
  condition) and only runs `supabase db push --linked`; (d) **traced
  exactly which already-live staging cron jobs could invoke the new
  code automatically**: `nxq-automatic-billing-hourly` (migration 100,
  already live, runs every hour at `:15`) calls
  `run_automatic_billing_orchestration()` → `queue_due_billing_attempts()`
  / `advance_automatic_billing_lifecycle()`, both of which already call
  `record_billing_notification()` (5 call sites) — so migration 254's
  new notification-insert behavior would fire on the very next hourly
  tick after apply, with no human action needed, *if* any staging
  client is currently in a qualifying billing state (not checked — would
  require reading live staging data, not done). `nxq-file-security-scans-every-two-minutes`
  (migration 144, already live) could similarly reach migration 250's
  new code, but is currently blocked earlier in its own chain by the
  same missing `NXQ_CLOUDMERSIVE_API_KEY`. (e) **Confirmed nothing can
  send externally regardless of secrets**: all 4 new notification
  inserts (248/249/250/254) hardcode `channel:'in_app'`, and
  `dispatch-notifications/index.ts` delivers `in_app` by marking the
  row `delivered` directly — it never reaches the `postAdapter()` call
  that would reach Resend/the external adapter. That external path is
  only used for non-`in_app` channels, which none of these five new
  notification types use.
- **Workflow addition, commit `268281b`, 2026-10-01**: added one
  read-only step to `.github/workflows/manual-supabase-stage.yml`
  (gated to `validate_prelaunch` only) that runs
  `supabase migration list --linked` (direct local-vs-remote history
  from `supabase_migrations.schema_migrations`, not inferred from the
  dry-run diff) and `supabase projects list` (prints only the linked
  project's **name** and **region**, matched against
  `SUPABASE_PROJECT_REF` in-memory — the ref and access token are never
  printed; exits with failure if the ref isn't found in the accessible
  projects list). Local checks passed (YAML validity via `python3 -c
  "import yaml..."`, the embedded `node -e` match/no-match logic unit-tested
  standalone, and `node scripts/check-runtime-stage-readiness.mjs` full
  pass). Pushed and confirmed matching origin.
- **Run #218 dispatched, HEAD `268281b`, 2026-10-01 — outcome not yet
  known as of this handoff entry.** Dispatched `validate_prelaunch`,
  was sitting at the `nxq-staging` environment approval gate awaiting
  the user's approval when this chat was handed off. **Next session:
  check this run's actual result before doing anything else** — it
  will still fail at "Verify staging Edge secret names" (the 6 secrets
  are still unset), but should newly report the direct migration list
  and linked project name/region from the new step above. If this run
  already completed by the time you read this, pull its log
  (`mcp__github__get_job_logs`, `run_id: 36676959762` or look up the
  latest run on this workflow) and report those two pieces of output
  before doing anything else — do not re-dispatch to get the same
  information twice.

- **Run #220 (`apply_migrations`, HEAD `475566c`), 2026-10-01 — APPLIED to
  `nxqweb-staging` (us-east-2).** Project identity confirmed first by run
  #219 (name/region only; user confirmed intended staging target). The
  apply log shows migrations applied one by one in this exact order, run
  succeeded: 248, 249, 250, 251 (benign NOTICE: trigger
  `enforce_client_location_limit` did not exist, skipped), 252, 253, 254.
  253 applied before 254, as designed. No functions deployed, no
  `apply_all`, no billing/payment change. **Not yet independently
  re-verified** by a post-apply `supabase migration list --linked` — see
  next entry once recorded. The 6 missing Edge secrets are still unset.

- **Data API grant audit (Supabase 2026-10-30 change), local/source-level
  only, 2026-10-01.** Full table-by-table checklist:
  `docs/DATA_API_GRANT_AUDIT.md`; validator
  `scripts/audit-data-api-grants.mjs` (not wired into `test:release`; exits 1
  while proven gaps exist, `--report` never fails). 178 tables, RLS on all.
  **2 proven source-level gaps** (frontend `select` with no explicit
  `authenticated` grant): `automation_jobs`, `automation_escalations` (the
  latter introduced by commit `1ba8d1e` this session). Also: 7 latent
  policy-without-grant tables (no direct use), 7 RLS-contained anon
  over-grants from temporary migration 003, 2 tables relying on migration
  195 default privileges for `service_role`. Migration 251's two tables are
  explicit and minimal. **Not proof of live grants — nothing was checked on
  staging.** Fix approved (items 1, 2, 5) and implemented locally as
  **migration 255** (`255_explicit_data_api_grants_for_owner_reads.sql`:
  select-only grants for `authenticated` on `automation_jobs` /
  `automation_escalations`; explicit `service_role` grants on the two
  `nxq_netlify_*` tables) plus `npm run test:data-api-grants`. Proven gaps
  now 0 at source level. Exercised on disposable local Postgres only
  (grants as intended, idempotent). **(at the time of this entry 255 was not yet applied; superseded by the run #223/#224 entry below)**;
  applying is a separate guarded `apply_migrations` run. Optional anon
  revokes (item 3) were not approved and are not included.

- **Run #221 (`validate_prelaunch`, HEAD `aa08dcd`), 2026-10-01 — post-apply
  verification, read-only.** `supabase migration list --linked` shows every
  migration 001–254 in BOTH Local and Remote columns (248–254 now recorded
  as applied; the run-#220 apply log is the evidence for their *order* — the
  list shows presence, and its "Time" column repeats the version number, not
  a timestamp). Dry-run: `Remote database is up to date.` Linked project
  confirmed: `nxqweb-staging`, `us-east-2`. 24/24 architecture checks passed.
  The run still ends red at "Verify staging Edge secret names": missing only
  `NXQ_CLOUDMERSIVE_API_KEY`, `NXQ_NOTIFICATION_FROM_EMAIL`,
  `NXQ_RESEND_API_KEY` (the 3 Turnstile secrets now exist by name). Not a code
  issue. Migration 255 was not in this checkout (later applied; see run #223/#224 entry).

- **Informational grant report added (script only), 2026-10-01.**
  `scripts/remote-launch-architecture-contract.mjs` now ends with a read-only
  `has_table_privilege` query for the 4 tables migration 255 addresses and
  prints `INFO  data-api-grants <table> <role>: <privileges>` lines. It never
  calls pass/fail, so it cannot turn a run red; it reads privilege metadata
  only. Tested on disposable local Postgres (before 255: authenticated has
  nothing on the two owner tables; after: SELECT only; service_role gets
  DELETE/INSERT/SELECT/UPDATE on both nxq_netlify tables) and with
  `scripts/test-data-api-grant-report.mjs` (3/3). Plan to apply only 255:
  read-only `validate_prelaunch` first (pending must be exactly 255), then
  guarded `apply_migrations`, then re-run read-only to read the INFO lines.

- **Run #223 (`apply_migrations`, HEAD `13d9f8e`) and run #224 (read-only
  `validate_prelaunch`), 2026-10-01 — migration 255 APPLIED to
  `nxqweb-staging` (us-east-2) and verified.** Pre-apply gate (run #222): the
  dry-run listed exactly one pending migration, 255; project identity matched.
  Run #223 (user confirmed project + phrase, approved the `nxq-staging` gate)
  applied only `255_explicit_data_api_grants_for_owner_reads.sql` — no
  functions deployed, no `apply_all`, no billing change. Run #224 (after):
  migration list shows 001–255 in both Local and Remote, dry-run `Remote
  database is up to date.`, identity `nxqweb-staging` / `us-east-2`, 24/24
  architecture checks passed, and the read-only `INFO data-api-grants` lines
  changed from BEFORE (run #222/#223 pre-apply: `authenticated: none` on both
  owner tables) to AFTER: `automation_jobs` and `automation_escalations`
  `authenticated: SELECT`, `anon: none`; both `nxq_netlify_*` tables
  `service_role: DELETE,INSERT,SELECT,UPDATE`, `anon`/`authenticated: none`.
  This is privilege-metadata evidence from the live database, **not** an
  observation of the owner pages actually loading. Run #224 still ends red only
  at the 3 missing secret names (`NXQ_CLOUDMERSIVE_API_KEY`,
  `NXQ_NOTIFICATION_FROM_EMAIL`, `NXQ_RESEND_API_KEY`).

- **Run #226 (`validate_paid_capability_guards`, HEAD `e9490d3`),
  2026-10-01 — FIRST REAL STAGING RUN: 38/56 passed, 18 FAILED. Rollback was
  forced and fixtures synthetic (`rollback-forced`, `synthetic-fixtures-only`,
  `no-external-runtime` all PASS). All non-location checks passed (tier denial,
  credits, billing state, usage/purchased-credit accounting, page limits,
  resource-limit/margin rejection, reservations, storage, tenant isolation).**
  Root cause of the real failures (reproduced locally, 2026-10-01): trigger
  function `public.queue_location_seo_refresh()` (migration 132, shared by
  `client_locations` and `client_location_services`) assigns
  `target_location_id := case when tg_table_name = 'client_locations' then
  coalesce(new.id, old.id) else coalesce(new.location_id, old.location_id) end`.
  PL/pgSQL resolves `new.location_id` when the statement is planned, not when
  the branch runs, so on `client_locations` (which has no `location_id`
  column) EVERY insert/update fails with SQLSTATE 42703 `record "new" has no
  field "location_id"`. Reproduced with a minimal two-table repro on Postgres
  16 and with a locally built full-schema DB (all migrations applied with
  stubs; only 197 failed, for missing runtime Vault config). Effect:
  `current_client_create_location` cannot create a location, so the
  Multi-Location feature (and the 251/252 add-on's second location) cannot work.
  Pre-dates 251/252 (introduced by 132); fails closed, no data risk.
  With only that function patched in the local DB, every location behavior
  check passes, including 251/252's add-on cap logic (add-on enabled, second
  location permitted, active count two, cap-fix verified, no-add-on denied).
  **A fix needs a new forward migration (stop-and-ask gate) and is awaiting
  user approval; nothing was changed in any migration and nothing was applied.**
  Separate validator-side defects fixed locally in
  `scripts/sql/validate-paid-capability-guards-staging.sql`: it expected exactly
  2 triggers on `client_locations` (now 3 after 251) and counted ALL CHECK
  constraints per column check (table has 3). Local evidence only, not proof
  of staging behavior.

- **Migration 256 written (user-approved), staged locally, NOT applied,
  2026-10-01.** `supabase/migrations/256_fix_location_seo_trigger_field_access.sql`
  re-creates `public.queue_location_seo_refresh()` identical to migration 132
  except the location-id expression reads the field via `to_jsonb(new)->>'location_id'`
  (no table/trigger/grant/data change; privilege revoke repeated). Tested on a
  local database built from all 255 prior migrations (stubbed Supabase
  extensions; 197 fails only for a missing runtime Vault setting): BEFORE 256
  the validator reproduces run #226's location failures (16 real checks +
  3 failure flags); AFTER 256 every location check passes (only 3
  stub-environment failures remain: tenant_isolation, storage_quota_authorization,
  storage_reservation_cleanup, which passed on staging in run #226);
  re-applying is a no-op; function stays SECURITY DEFINER and not executable by
  anon/authenticated. Plan: read-only `validate_prelaunch` (pending must be
  exactly 256) -> guarded `apply_migrations` -> re-run
  `validate_paid_capability_guards` (expect 56/56). Local evidence only.

- **Run #227 (read-only gate) and run #228 (`apply_migrations`, HEAD
  `e16f3be`), 2026-10-01 — migration 256 APPLIED to `nxqweb-staging`
  (us-east-2).** Gate #227: dry-run listed exactly one pending migration, 256;
  history 001–255 in both columns; identity matched. Run #228 (user confirmed
  project + phrase, approved the `nxq-staging` gate): the log shows only
  `Applying migration 256_fix_location_seo_trigger_field_access.sql...` then
  `Finished supabase db push.`; no functions deployed, no `apply_all`, no
  billing change. **The fix has NOT yet been verified on staging**: the
  paid-capability guards must be re-run (needs its own user authorization +
  phrase); expected 56/56 per local evidence (local DB: all location checks
  pass after 256; only stub-environment failures remain locally).

- **Run #229 (`validate_paid_capability_guards`, HEAD `af9440a`),
  2026-10-01 — 56/56 PASSED on `nxqweb-staging` (us-east-2), after 256.**
  User authorized with project confirmation + phrase and approved the
  `nxq-staging` gate. Every check that failed in run #226 now passes,
  including `location-first-created`, `location-insert-trigger-probe`,
  `location-audit-write-probe`, `location-addon-second-location-permitted`,
  `location-addon-active-count-two`, `location-addon-cap-fix-verified`, and
  the corrected `location-trigger-set-expected` / constraint checks.
  `rollback-forced`, `synthetic-fixtures-only`, `no-external-runtime` PASS.
  Dry-run in the same run: `Remote database is up to date.` (256 recorded
  as applied). No migration, deploy or billing action in this run. This is
  the first fully green staging run of the paid-capability guard suite;
  it covers synthetic fixtures only and is not external QA, not launch
  approval, and not evidence for the 10-run QA gate.

- **Dependency audit fix, 2026-10-01 (user-approved).** `npm audit` flagged
  1 high-severity advisory set (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7,
  GHSA-6j4f-fj2g-mc7p: denial of service) in the dev-only transitive package
  `brace-expansion` (`eslint` -> `minimatch@10.2.5`). `npm audit fix` changed
  exactly one package, lockfile only: `brace-expansion` 5.0.9 -> 5.0.12
  (`package.json` untouched). After a clean `npm ci`: `npm audit` = 0
  vulnerabilities, eslint, `tsc`, build, migration integrity (223),
  `test:release` (69/69 then the usual credential stop), `test:security`,
  `test:accessibility` (19/19), `test:edge` (44), `test:data-api-grants`,
  `test:runtime-stage` all pass. Not run on CI yet; CI install uses `npm ci`
  against this lockfile. (The earlier "npm audit 0 vulnerabilities" figure in
  this file predates the advisory.)

- **Run #230 (read-only `validate_prelaunch`, HEAD `de02926`), 2026-10-01 —
  Resend secrets confirmed present; only Cloudmersive still missing.** The user
  saved `NXQ_RESEND_API_KEY` and `NXQ_NOTIFICATION_FROM_EMAIL`
  (`onboarding@resend.dev`, staging test sender) in the Supabase dashboard
  (names visible in the secrets list; values never shared). Run #230:
  `business-prelaunch is missing 1 Supabase Edge secret name(s):
  NXQ_CLOUDMERSIVE_API_KEY` (down from 3). Step results: install with the
  updated lockfile (`brace-expansion` 5.0.12) succeeded, manifest/auth/remote
  architecture step succeeded, link, dry-run, and the migration-history +
  project-identity step all succeeded; only "Verify staging Edge secret names"
  failed, for that one name. Values are not verified (name presence only);
  Cloudmersive support ticket is still open. `validate_prelaunch` will pass
  once that key exists.

- **Release-focused review (execution-based), 2026-10-01 — 1 proven defect
  fixed in source, everything else below verified locally.** Method: built a
  full-schema local Postgres from all 256 migrations (stubbed Supabase
  extensions only; 197 fails solely for missing runtime Vault config) and
  checked contracts by running them, not reading them. Verified clean (local
  evidence only): (1) all 96 triggers: no trigger function references a field
  missing on its table (one apparent hit, `enforce_and_record_commerce_usage`
  `new.file_size`, is in a separate IF branch that only runs for the media
  table); (2) all 137 frontend `.rpc()` call sites match their function's
  argument names/required args; (3) 64 frontend `.from()` query chains reference
  existing columns; (4) page-vs-RLS: no client page reads an owner-only table
  and no owner page lacks an owner policy; (5) every one of the 113 distinct
  frontend RPCs, run as the role its page uses (client/owner/anon), executes
  without undefined-column/function/table errors or EXECUTE-permission
  failures (business denials only), in a fresh-signup state and an
  active-client-with-project state; (6) real lifecycle in SQL: signup trigger
  creates a `lead` client with family/tier; frontend-built setup report passes
  `submit_current_client_website_setup` (labels and $50/$100/$150 match the
  catalog); owner `approve_website_setup` -> client `approved`, project `planning`,
  jobs `create_onboarding_welcome` + `ensure_project_workspace` queued; owner
  `deny_website_setup` -> client `denied`, pipeline stopped, no infrastructure,
  in-app `business_setup_denied` notification visible to that client.
  **Defect found and fixed (source only):** `provision-storefront` called
  `nxq_reserve_netlify_build` with `target_idempotency_key`; the function takes
  `target_reservation_key` (all other callers are correct). Against the real
  function the old name raises "function ... does not exist"; the corrected
  call returns `{"ok": true, "reservation_id": ...}`. Effect before fix:
  Commerce storefront provisioning always threw "Netlify build denied by the
  protected build-credit budget" before triggering any build. New validator
  `scripts/validate-contract-rpc-call-arguments.mjs` (281 call sites in `src/`
  and `supabase/functions/`, runs inside `test:release`) fails on the old
  code and passes on the fix. **Not verified / needs live proof or your
  setup:** the Edge-function chain after the queued jobs (prepare-build-plan,
  provision-project-infrastructure, build-business-website, preview, promote,
  maintenance, domain reconcile) needs real GitHub/Netlify/AI providers; the
  fixed `provision-storefront` needs a redeploy (gated) before it takes
  effect; Cloudmersive/AI/Stripe/Netlify credits unchanged.

- **Reproducible local full-schema test added, 2026-10-01.** `scripts/test-local-full-schema.mjs`
  (`npm run test:local-full-schema`; helper `scripts/lib/rpc-call-sites.mjs`, stand-ins
  `scripts/sql/local-full-schema/stubs.sql`; full coverage/limits in
  `docs/LOCAL_FULL_SCHEMA_TEST.md`). Builds a disposable Postgres from all 223 migrations and runs 7
  focused checks (all migrations apply; trigger field references; detector self-test reproducing the
  migration-132 defect shape with a real 42703; RPC argument + EXECUTE contracts over 281 call sites;
  `provision-storefront` reservation-key static and runtime regression; client location insert after
  migration 256). Final run: 7/7 pass, ~12 s, exit 0. **Not a staging reproduction**: pg_cron, pg_net,
  supabase_vault, auth, storage are stand-ins; migration 197 is applied against PLACEHOLDER Vault secrets
  (explicit in output and docs), not skipped. It took three runs to get green: the first two failed on
  fixture mistakes in the new checks, not product defects. Environment restored afterward: Postgres service
  stopped, database dropped, the four stand-in roles left in the cluster by earlier sessions were dropped by
  hand (the script itself only drops roles it creates), no extension stubs or temp files remain. The static
  validator `validate-contract-rpc-call-arguments.mjs` now shares the call-site scanner (re-verified: fails
  on the old `target_idempotency_key`, passes on the fix). No migration or workflow was edited.
  **Redeploy of `provision-storefront` to staging is NOT done**; a plan was prepared and awaits explicit
  approval (see below).
- **Redeploy plan for `provision-storefront` (prepared 2026-10-01, awaiting approval, nothing dispatched).**
  Today the workflow has no single-function action for it: it is only reachable through
  `deploy_functions`/`apply_all` (all 44 functions) or `deploy_paid_capability_guards` (17 functions).
  "Only provision-storefront" therefore needs a one-step workflow addition (gated: workflow edit +
  approval), then a guarded dispatch. Details were given to the user in chat; summary: add action
  `deploy_provision_storefront` mirroring `deploy_commerce_reference_upload`
  (`--no-verify-jwt`, matches manifest `verify_jwt: false`), with a before/after
  `supabase functions list` check that the version increased and nothing else changed.

- **provision-storefront redeploy: status 2026-10-01 (user approved plan Option A; workflow edit BLOCKED).**
  The permission classifier denied the local edit to `.github/workflows/manual-supabase-stage.yml`
  (adding action `deploy_provision_storefront`), so the workflow is UNCHANGED and nothing was dispatched.
  Committed (safe-scope, inert until a workflow step calls them): `scripts/verify-function-deployment.mjs`
  (compares before/after `supabase functions list` captures; confirms only the named function changed,
  version increased, status ACTIVE, `verify_jwt` false) and `scripts/validate-function-deployment-verifier.mjs`
  (11 synthetic checks, runs in `test:release`). Awaiting the user's decision: allow the workflow edit,
  apply the diff themselves, or use `deploy_paid_capability_guards` (redeploys 16 other functions).
  The fixed `provision-storefront` source is on this branch but NOT deployed to staging.

- **Workflow action `deploy_provision_storefront` added, 2026-10-01 (user-approved diff; NOT dispatched).**
  `.github/workflows/manual-supabase-stage.yml`: one new action option and three steps (record
  `supabase functions list` before; deploy ONLY `provision-storefront` with `--no-verify-jwt` after a
  manifest guard; verify with `scripts/verify-function-deployment.mjs` that only that function changed,
  version increased, ACTIVE, `verify_jwt` false). Existing gates unchanged: `nxq-staging` environment
  approval and the `APPLY-NXQ-SUPABASE-STAGING` confirmation (the action is not exempt from the mutation
  gate). Local checks passed (YAML, `bash -n` per step, manifest guard, eslint, readiness script,
  verifier 11/11, `test:release` through the usual credential stop). The deploy itself needs a separate
  user message (project confirmation + phrase) and the `nxq-staging` click. Unproven until a real run:
  the exact JSON shape of `functions list --output-format json` (verifier accepts array or envelope and
  fails loudly if it cannot confirm). Behavior proof of the reservation fix still needs a real storefront
  provisioning run (Netlify credits + GitHub app).

- **Run #231 (`deploy_provision_storefront`, HEAD `9a08239`), 2026-10-01 — `provision-storefront` DEPLOYED to
  `nxqweb-staging` and verified.** User confirmed project + phrase and approved the `nxq-staging` gate. Log:
  `Deploying Function: provision-storefront` / `Deployed Functions on project ***: provision-storefront` (one
  function only). Verifier output: `provision-storefront: v27 -> v28, status ACTIVE, verify_jwt false.`,
  `43 other function(s) unchanged.`, `PASS only provision-storefront changed.` (so the `functions list --output-format
  json` shape was parsed successfully on the first real run). All other deploy steps and migration steps were
  skipped; no migration applied, no billing change. The reservation-key fix is now live on staging; its end-to-end
  effect (a real Commerce storefront provisioning that reserves Netlify credit) has NOT been exercised and still
  needs a real run with Netlify credits and the GitHub app.

## Missing staging Edge secrets — private setup checklist (values never printed)

`business-prelaunch` (the profile `validate_prelaunch` checks against)
requires every launch secret except the AI model-provider token. Run
#216 confirms exactly 6 are currently missing from the `nxq-staging`
Supabase project's Edge secrets. None of these are required by
`business-non-ai-staging` or `business-zero-key-staging` — see "Can
`validate_zero_key` make progress now?" below.

For each: **never paste the actual value into chat, a commit, a PR, a
workflow input, or any file in this repo.** Set it directly in the
Supabase dashboard (Project Settings → Edge Functions → Secrets) or via
`supabase secrets set NAME=value --project-ref <ref>` run locally on
your own machine (not in this session). To verify a name is set
without ever reading its value, this workflow's own `validate_prelaunch`
step already does exactly that (`supabase secrets list --output-format
json`, names only) — rerunning it after setting all 6 is the correct
verification method, not printing values anywhere.

1. **`NXQ_PUBLIC_TURNSTILE_SITE_KEY`** — Cloudflare Turnstile **site
   key** (the public, client-embeddable key, not the secret key).
   Consumed by `supabase/functions/build-business-website/index.ts:546`
   and baked into each deployed business site's lead form widget.
   Source: Cloudflare dashboard → Turnstile → your widget → Sitekey.
   Safe to treat as public (it's shipped to browsers), but still set
   as a proper Edge secret for consistency with the rest of the
   pipeline.
2. **`NXQ_LEAD_CHALLENGE_ENDPOINT`** — the verification endpoint URL
   this same Turnstile widget's token gets POSTed to for server-side
   validation. Consumed by
   `supabase/functions/ingest-business-lead/index.ts:33`. For
   Cloudflare Turnstile this is Cloudflare's own siteverify endpoint
   (`https://challenges.cloudflare.com/turnstile/v0/siteverify`) —
   confirm against Cloudflare's current Turnstile server-side
   verification docs before setting, in case the path has changed.
3. **`NXQ_LEAD_CHALLENGE_TOKEN`** — Turnstile **secret key** (paired
   with the site key above), sent as the verification request's auth
   credential. Same call site as #2. Source: Cloudflare dashboard →
   Turnstile → your widget → Secret key. **This one is a real secret**
   — unlike the site key, never expose it client-side.
4. **`NXQ_RESEND_API_KEY`** — Resend (email provider) API key.
   Consumed by
   `supabase/functions/notification-provider-adapter/index.ts:71`,
   gating whether the notification adapter is "configured" at all (it
   returns HTTP 503 "not configured" without it — this is the provider
   that would eventually deliver the billing/notification emails from
   migrations 248–250 and 254 once wired up). Source: Resend dashboard
   → API Keys → create a key scoped to sending only if Resend's
   dashboard offers scoping.
5. **`NXQ_NOTIFICATION_FROM_EMAIL`** — the verified "from" address
   Resend sends as. Same call site as #4
   (`notification-provider-adapter/index.ts:72`). Must be an address
   on a domain you've verified in Resend's dashboard (Resend rejects
   sends from unverified domains) — verify the domain there first,
   then set this to an address at that domain.
6. **`NXQ_CLOUDMERSIVE_API_KEY`** — Cloudmersive malware-scanning API
   key. Consumed by
   `supabase/functions/malware-scan-provider-adapter/index.ts:43`,
   gating the malware-scan adapter the same way (#4 gates
   notifications) — returns "not configured" without it. Source:
   Cloudmersive account dashboard → API Keys.

**Verification without printing any value**: after setting all 6,
either re-run `validate_prelaunch` (next session, with your approval —
not done automatically) or, for a lighter check first, note that
`supabase secrets list --output-format json` (which the workflow
already runs) reports names only, never values — so confirming the six
names now appear in that listing is itself a safe, non-printing
verification step available before the next full preflight run.

## Can `validate_zero_key` make useful progress right now?

**Yes.** Checked `scripts/edge-function-manifest.mjs`'s
`runtimeSecretProfiles`: `business-zero-key-staging` (lines 114+) is
defined as exactly `business-non-ai-staging` plus
`NXQ_LEAD_FINGERPRINT_SALT`, `NXQ_PUBLIC_ANALYTICS_ENDPOINT`, and
`NXQ_PUBLIC_LEAD_ENDPOINT` — **none of the 6 missing secrets above are
in either profile.** A `validate_zero_key` dispatch would not hit this
same blocker and could make real progress confirming the zero-key
staging path (public runtime wiring, no external challenge/malware/
notification adapters) independently of the 6 missing values. Not
dispatched this session, per your instruction to stop here and report
— this is an option for you to approve separately, same as any other
staging run.

## Canonical launch checklist (fixed, evidence-based — replaces guessed percentages)

Per user instruction: no more estimated percentages. This checklist is
derived from the "Final release-focused audit" below (each line traceable
to a named file/script) and re-verified live at HEAD `bbc56a8` before
being written: `check-migration-integrity.mjs` → 221/221,
`npm audit` → 0 vulnerabilities, `test:release` → 69/69 then stops at
`protected-staging-configuration` (unchanged), `docker info` → no daemon,
zero `SUPABASE_*`/`NXQ_*` env vars present in this container. Update this
section — don't restate it unchanged — whenever a line's status actually
changes; every future end-of-chat report should point here rather than
inventing a fresh number.

**A. Code completion — what's built and locally verified** (all of this
is independent of staging/external access; "done" means real local
checks exercise it, not that it's guessed to work):

- [x] Business signup/intake → owner approve/deny → build → preview →
  production-promotion code path (RPCs + Edge functions exist, wired,
  type-check, exercised by the 69/69 paid-capability suite)
- [x] Client portal (33 pages) and Owner portal (20 pages) — every page
  has real backing logic; all 113 `supabase.rpc()` calls resolve to a
  real function (0 missing)
- [x] Security baseline — SSRF guard on all 12 functions that need it,
  timing-safe token comparison on all 22, Stripe webhook HMAC
  verification, CORS/OPTIONS handling complete on all 17
  browser-invoked Edge functions (2 real gaps found and fixed this
  session: `secure-client-file-access`/`secure-owner-file-access`,
  `provision-storefront`)
- [x] Client-facing in-app notifications already live at HEAD (no
  migration needed): preview-ready, production-published, domain
  reconciliation, privacy-request completion
- [x] Minimal read-only client notification list (`ClientPortal.tsx` +
  `ClientNotificationPreferences.tsx`), correctly scoped by
  `recipient_kind` — verified against a real RLS-enforcing Postgres
- [ ] `commerce_cart_items` / `commerce_carts` orphaned schema — found,
  not cleaned up (needs a migration decision — your call, see next
  section's staged migrations)
- [x] `automation_escalations` — the 7 previously unsurfaced escalation
  types are now read by `OwnerExceptionCenter.tsx` directly (owner-only RLS
  policy from migration 097; read-only, no migration). Local checks pass
  (eslint, tsc, build, operational-control-surface 12/12, a11y 19/19,
  security audit); not yet exercised against a real database.
- [x] Commerce storefront provisioning reserves Netlify build credit with the
  correct RPC argument (`provision-storefront` passed `target_idempotency_key`;
  the function takes `target_reservation_key`, so provisioning always failed
  there with a misleading "denied by budget" error). Fixed in source,
  validator added; **deployed to staging in run #231 (v27 -> v28); end-to-end behavior still not proven live**.
- [x] `billing_notification_events` delivery + RLS scoping — migrations
  253+254; **applied to staging in run #220** (see section B; end-to-end
  billing-notification delivery not exercised live)
- [ ] Fuller notification center (mark-as-seen, unread badge) — needs a
  new column + RPC; deferred pending your decision, not started

**B. Migrations 248-256 — all applied to staging (`nxqweb-staging`): 248-254
in run #220, 255 in run #223, 256 in run #228. Not applied to production
(production is not launched):**

- [x] 248 — client notification on website-setup denial
- [x] 249 — client notification on Commerce customer request
- [x] 250 — client notification on file-scan completion
- [x] 251 — Multi-Location self-serve add-on (**needs 252 in the same
  run** — inert without it)
- [x] 252 — fixes 251's trigger conflict
- [x] 253 — restricts client notification reads to `recipient_kind='client'`
  (closes a real RLS gap; **applies before 254 by design** — see "Local-file
  ordering fix — implemented" below)
- [x] 254 — delivers billing notification events (**needs 253 already
  applied ahead of it — guaranteed by numbering, verify anyway before any
  real apply**)
- [x] 255 — explicit Data API grants for 2 owner-read tables + 2 service-only
  tables (applied to staging in run #223, verified by run #224; Supabase
  2026-10-30 change)
- [x] 256 — fixes latent migration-132 trigger bug (`queue_location_seo_refresh()` made
  every `client_locations` insert fail, 42703); applied to staging in run #228; verified by the paid-capability guards
  re-run in run #229 (56/56)

**C. Live launch verification — requires staging/external access, not
code work; confirmed blocked in this container as of this checklist:**

- [ ] `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` — absent (`env` check
  above); without these, `validate-paid-capability-guards-staging.mjs`
  and everything after it in `test:release` cannot run
- [ ] Docker daemon — absent (`docker info` above); without it,
  `supabase start` (full local Postgres+Auth+Storage stack) cannot run
  in this container, so no migration can be tested against a fully
  realistic environment here (only the scoped disposable-Postgres
  technique used this session, which proves trigger/RLS logic but not
  the full stack)
- [ ] Real AI provider key, Resend (email), Cloudmersive (malware scan) —
  not configured; these features fail closed by design, not broken code
- [ ] Stripe test-mode lifecycle, real payout account — not configured
- [ ] 10 consecutive disposable external Business QA runs with real
  Supabase/GitHub/Netlify evidence + your explicit signoff
  (`docs/LAUNCH_HARDENING_CHECKLIST.md`) — not started; this is the
  actual production-deploy gate, independent of everything else above
- [ ] Fresh Netlify build credits — unknown; a prior audit found credits
  previously exhausted, not confirmed restored (needs live check)
- [ ] Owner pages with the **escalations panel** live on nxqweb-v9-staging —
  NOT yet proven. 2026-10-02 screenshots showed `/owner`, `/owner/exceptions`,
  `/owner/automation-health` loading, but the published deploy is the Aug 24
  one (`safe/checkp... @52e9f72`, a commit not present in this repo's history)
  and predates the escalations change, so that load only supports the
  `automation_jobs` grant, not `automation_escalations`. Auto Publishing is
  locked; `main@77e9455` (2026-08-13) was also built but is not marked
  Published. Decision (user, Option A): wait; publish once when the
  Cloudmersive key is set and we are ready for QA — unpause Netlify, let the
  latest safe-branch deploy build, click "Publish deploy", then load
  `/owner/exceptions`. Note: every push to the safe branch triggers a Netlify
  branch build while builds are unpaused (observed for 2aa8af5, a3d5987), so
  batch pushes and pause builds in between. Remaining items shown on the pages
  are stale (pre-migration-233 `pd.published_url` errors, old
  Netlify-credit/backup alerts) or expected (AI provider not configured).

**Reading this honestly**: section A is essentially complete for what's
been built. Section B is applied to staging (248-256). Section C is the real
distance to launch, and none of it is something local code work can close —
it is credentials, external provider setup, and the 10-run QA/signoff
process, all requiring your action outside this session.

## Current checkpoint — 2026-10-01

- **Branch:** `safe/checkpoint-autonomy-wave35-sales`
- **HEAD:** `268281b6471a0bc13f8cb48e959e6f7d8da1099a` — "ci: add
  read-only staging migration history and project-identity step"
  (prior recorded HEAD was `b87f642`, superseded by `e0ea1cd`, `879ecf9`,
  `9eca5f6`, `6456bde`, then this commit — see the progress ledger at
  the top of this file for the full chain of what each one fixed).
- **Working tree:** clean, pushed to `origin`, verified matching after
  `git fetch` as of this commit.
- **Open item:** run #218 (`validate_prelaunch`, HEAD `268281b`) was
  dispatched and awaiting the `nxq-staging` environment approval gate
  when this handoff was written — see the progress ledger's last entry
  for exactly what to check first in the next session.
- This checkpoint was reached by fetching and fast-forward merging from a
  stale local cache that had lagged the real remote tip
  (`afbbc5f` → `c36568d`), then several further local commits ending at
  `a3442df` — see "Confirmed blockers/risks" for why stale tracking refs
  must always be refreshed before trusting a reported HEAD.
- **Seven new, unapplied migrations in the tree** — all pass local
  migration integrity and every other local check, but **none has been
  applied to any database** (no staging credentials in this container,
  and applying is always a separate guarded action anyway). Review all
  seven before the next `apply_all` staging run:
  - `supabase/migrations/248_notify_client_on_website_setup_denial.sql`
  - `supabase/migrations/249_notify_client_on_commerce_customer_request.sql`
  - `supabase/migrations/250_notify_client_on_file_scan_completion.sql`
  - `supabase/migrations/251_multi_location_self_serve_addon.sql` —
    Multi-Location self-serve add-on; see "Multi-Location self-serve
    add-on — implemented" below. **Depends on 252 to work correctly** —
    see next line.
  - `supabase/migrations/252_fix_location_addon_trigger_conflict.sql`
    (new this session) — forward-only fix for a trigger conflict found in
    a read-only review of 251: `client_locations` already carried a
    `BEFORE INSERT` trigger from migration 246
    (`nxq_enforce_location_entitlement`) that hardcodes the non-enterprise
    location cap at 1 with no awareness of `client_location_addons`. 251
    added a second, separate trigger with the correct add-on-aware cap,
    but both fired on every INSERT and the untouched 246 trigger still
    rejected a second location for Growth/Intelligence clients regardless
    of enabled add-on units — the add-on feature was functionally inert
    on its one real path. 252 updates `nxq_enforce_location_entitlement()`
    in place (preserving its family/status/billing/pipeline guards
    verbatim) to account for add-on units and to share the same advisory
    lock namespace as the add-on RPCs, and narrows 251's own trigger to
    only the UPDATE cases it's actually needed for (reopening a closed
    location, reassigning `client_id`). **251 and 252 must be applied
    together, in that order, for the add-on feature to work correctly —
    do not apply 251 without 252.**
  - `supabase/migrations/253_restrict_client_notification_recipient_kind.sql`
    — fixes a real RLS gap: the `client_read_own_notifications` policy
    (migration 133) checks `client_id` ownership only, never
    `recipient_kind`, so a client can directly `SELECT` any
    `notification_deliveries` row for their own `client_id` regardless of
    recipient — the app's `.eq("recipient_kind", "client")` filter is a
    query parameter, not a database boundary. **Deliberately numbered
    ahead of 254** so this restriction is guaranteed to apply first, by
    plain ascending filename order — see "Local-file ordering fix —
    implemented" below for the full mechanism and why these two were
    renumbered.
  - `supabase/migrations/254_deliver_billing_notification_events.sql` —
    extends `record_billing_notification()` to deliver the 3 client-facing
    and 2 owner-facing billing events through `notification_deliveries`;
    see "`billing_notification_events` fix — implemented" below.
    **⚠️ NEVER apply 254 to any real environment without 253 already
    applied ahead of it — numbering guarantees this under normal
    `apply_all`/`db push`, but confirm on the actual target database's
    migration history before ever applying either.**

## Staging preflight run #214 — HTTP 400 root cause and fix (this session)

**What happened**: with explicit approval, the `validate_prelaunch`
action of `.github/workflows/manual-supabase-stage.yml` was dispatched
against this branch's HEAD via the GitHub Actions API (run #214, id
`36647079388`). It failed at step 5, "Validate deployment manifest and
auth boundaries" (`npm run test:runtime-stage`), before ever reaching
"Link project" or "Migration dry run" — so the actual point of the run
(confirming which of migrations 248–254 are already applied in staging)
never executed.

**First hypothesis, tried and disproven**: the failing sub-check
(`Remote launch-architecture contract query failed with HTTP 400`)
comes from `scripts/remote-launch-architecture-contract.mjs` posting to
`https://api.supabase.com/v1/projects/{ref}/database/query/read-only`.
Initially suspected the `/read-only` suffix itself was an invalid
endpoint (never confirmed against Supabase's docs). Pulled the job logs
of the two prior successful runs on this branch (#212, #213, both
2026-09-19) and found the exact same endpoint suffix returning a clean
pass (`Remote launch-architecture contract passed through read-only
Supabase query endpoint`) against the same staging project with real
credentials — disproving the endpoint theory. A same-turn edit that
removed the suffix was reverted before commit once this came to light;
it was never pushed.

**Actual root cause, confirmed empirically**: commit `6fae1f6` ("fix:
unify remote launch-architecture checks into one shared source",
2026-09-28 — after the last successful run, before #214) expanded the
CI-run check from 9 checks to the full 24-check query. Three of the new
lines (the `architecture-one-time-topup-contract` check) wrote SQL like:

```sql
position("'purchase_credit'" in lower(pg_get_functiondef(...)))
```

PostgreSQL treats double-quoted text as an **identifier**, never a
string literal — so this parses as a reference to a column literally
named `'purchase_credit'` (quotes included), which doesn't exist.
Reproduced the exact failure against a disposable local Postgres 16
instance (native `service postgresql`, no Docker in this container):
`ERROR: column "'purchase_credit'" does not exist` — the same class of
database-side error Supabase's Management API surfaces as HTTP 400.
Verified the corrected, properly-escaped single-quoted form
(`'''purchase_credit'''`, and the two related `'recurring', false` /
`'auto_refill', false` lines) both parses and evaluates correctly
against a realistic function body containing that text. Grepped the
whole repo for the same double-quote-around-literal pattern; no other
instance exists.

**Fix**: `scripts/remote-launch-architecture-contract.mjs`, 3 lines,
commit `b87f642`. No workflow YAML, migration, or staging state
touched — this was a plain-script fix, squarely in allowed autonomous
scope.

**Still outstanding**: this fix has not yet been proven against real
staging by an actual rerun of `validate_prelaunch` — the local Postgres
reproduction confirms the SQL bug and the fix's correctness in
isolation, not that step 5 as a whole now passes end-to-end, or that
"Link project"/"Migration dry run" (the actual point of this preflight)
now execute and report correctly. That rerun is the next step once
approved.

## RLS gap fixed — migration 253 (structurally, by renumbering — see below)

**Hard rule, explicit: migration 254 (the billing-notification writer)
must never be applied to any real environment without 253 (the RLS
restriction) already applied ahead of it. This is not a preference —
applying 254 without 253 first reopens a live path for a client to read
an owner-facing notification about their own account, the moment that
notification is ever created.**

**Mechanism** (verified by reading the policy text and confirmed against
a real Postgres RLS engine, not just reasoning about the SQL — see below):
`client_read_own_notifications` (migration 133's original version) grants
`SELECT` to any `authenticated` row where `client_id` belongs to the
caller, with no `recipient_kind` check at all. `authenticated` also holds
a blanket table-level `SELECT` grant. The two client-facing pages built
this session (`ClientPortal.tsx`, `ClientNotificationPreferences.tsx`)
filter `recipient_kind = 'client'` in their own queries, but that filter
lives in application code, not the database — any other query against
the table with that same client's session (a different page, browser
devtools, a direct PostgREST call, or that one line of frontend code
simply being absent) reads every row for that `client_id`, owner-facing
rows included.

**Why migration 254 is the trigger, specifically**: 254 is the only place
in this codebase that ever writes a `recipient_kind='owner'` row with a
`client_id` set (`billing_processor_connection_required`,
`freeze_review_owner_attention`). Before 254 exists in a database, there
is no code path that creates such a row, so the RLS gap — real as it is —
has nothing to expose yet. The instant 254 is applied, the *capability*
to create an exposed row exists; the row itself only appears when a real
billing event later fires (e.g. the scheduled `advance_automatic_billing_lifecycle()`
job finds an overdue client, or `queue_due_billing_attempts()` hits a
disconnected processor).

**Fixed structurally by renumbering, not just by process discipline —
see "Local-file ordering fix — implemented" below.** These two
migrations were originally drafted the other way around (writer as 253,
restriction as 254), which meant `supabase db push`'s ascending-filename
apply order would always run the writer first — an interrupted run
between them would leave the writer live with the restriction absent.
Per your explicit approval, the two files were swapped (`git mv`, no
content changed): the RLS restriction is now 253 and the writer is now
254, so ascending order runs the restriction first, by construction. See
the next section for the full before/after and the updated verification
checklist — read that section for the actual current-state process, not
the historical description above of why the gap existed in the first
place.

**On current live data — explicitly not inspected, not claimed**: I have
not connected to staging or any other database and have not run any
query against live data for this task, as instructed. Everything above
about "nothing to leak yet" is an inference from this repository's own
migration history (neither 253 nor 254, under either their original or
current numbering, has ever been part of any `apply_all` run this session
has record of) — it is **not** a verified fact about any real database's
current contents. If either migration was ever applied to any environment
outside what this session can see, that inference would be wrong, and the
correct next step before trusting any of this is to actually query
`supabase_migrations.schema_migrations` on the real target database, not
assume from repo state alone.

**Proof of the fix itself** (not the live-data question above): ran a
focused test against a disposable local Postgres (native
`service postgresql`, no Docker in this container) using a real,
non-superuser `authenticated` Postgres role so RLS was actually enforced
by the engine, not simulated. First reproduced the bug under migration
133's original policy — a client's `SELECT *` returned both their own
client-facing row and an owner-facing row for the same `client_id`. Then
applied 253's exact policy replacement and confirmed: the client can
still read their own client-facing row; the client gets zero rows when
querying the owner-facing row's id directly; a full-table `SELECT`
returns count 1 (only their own); and the owner's `SELECT`, tested
separately, still returns count 2 (both rows, unaffected). All 4
assertions passed, re-run again after the renumbering with 253's final
(post-swap) file content and unchanged results. Database and the
temporary role were dropped afterward, Postgres stopped again, left as
found. Static validator
`scripts/validate-notification-recipient-kind-rls-contract.mjs` (8/8,
updated for the renumbering) checks the migration files themselves
haven't drifted from this.

## Read-only ordering plan (historical — Option A below was chosen; see "Local-file ordering fix — implemented" next)

Produced on request before any staging work and before the renumbering
below, to compare safe ways to guarantee the RLS fix is in force before
the billing-notification writer can ever create an owner-facing row.
Nothing was executed when this was written — analysis only, at the time.
Numbers below describe the migrations by role (writer / restriction)
rather than by number, since the two were renumbered afterward and this
section's original digits would otherwise read backwards against the
current file names.

**Mechanism**: `supabase db push` applies pending migrations in ascending
filename order. At the time this was written, the writer migration was
numbered lower than the restriction migration, so in any full run the
writer always applied first. Each migration file is applied as its own
transaction — standard, documented Supabase CLI behavior, though **not
independently confirmed in this environment** (no Docker daemon here to
run `supabase start` and observe it directly; see "what cannot be
verified" below). The real risk was not the brief moment between two
files committing in a clean run — nothing auto-fires inside a migration
transaction — it was an **interrupted run**: if `apply_all`/`db push`
applied the writer and then stopped (network drop, CI runner killed,
timeout) before reaching the restriction, the database would be left with
the writer's write-capable function live and the restriction absent, for
however long it took to notice and finish.

**Option A — Renumber so the restriction executes before the writer.**
Requires renumbering the already-drafted, already-reviewed migration
files. **This is the option you approved and it has now been
implemented** — see "Local-file ordering fix — implemented" below for
the result.

**Option B — One continuous run, with mandatory post-apply verification.**
Run `apply_all`/`db push` once, in a monitored session, so both apply
back-to-back with no manual action between them, then independently
query `supabase_migrations.schema_migrations` (or `supabase migration
list --linked`) to confirm **both** show as applied — not just "no error
was printed." If the run stops between them, treat it as an active
incident and re-run immediately. Still the correct *process* discipline
to follow even now that Option A closes the structural risk — belt and
suspenders, not a substitute.

**Option C — Same as B, plus a pre-apply safety net: pause the billing
automation schedule first, resume only after both are confirmed applied.**
The two functions that ever create an owner-facing row,
`advance_automatic_billing_lifecycle()` and `queue_due_billing_attempts()`,
both run on a schedule, not on demand. Pausing whatever triggers them
during the apply window remains good practice regardless of Option A.

**What was recommended at the time**: Option A, now implemented. Options
B and C remain valid *additional* process discipline for the actual
staging apply, whenever that's approved — they were never mutually
exclusive with A.

**What I cannot verify without staging access** (still true after the
renumbering):
- Whether this project's pinned Supabase CLI (`^2.107.0`) truly applies
  each migration file in its own transaction in practice — documented
  standard behavior, but not something observable from this container
  (no Docker daemon for `supabase start`, no staging credentials).
- What actually schedules `advance_automatic_billing_lifecycle()` and
  `queue_due_billing_attempts()` in the real deployment (pg_cron config,
  a Supabase scheduled function, or something else) — needed if Option C
  is also followed at apply time.
- Whether `schema_migrations` on the real target database already shows
  either migration as applied, under either its original or current
  number, from some prior run this session has no record of —
  unverifiable from repo state alone; only a live query settles it.
- Whether any owner-facing `notification_deliveries` row already exists
  on a real database right now — same caveat, not inspected, not claimed
  either way.

## Local-file ordering fix — implemented (Option A, renumbering)

Approved and implemented on this branch, repo-only — no staging
connection, no migration applied, no deploy.

**What changed**: the two migration files were swapped by `git mv`, with
no content dependency between them either way (verified: neither file's
SQL references anything the other creates — one only touches
`record_billing_notification()`, the other only touches the
`client_read_own_notifications` policy).
- `supabase/migrations/253_restrict_client_notification_recipient_kind.sql`
  — the RLS restriction (was drafted as 254)
- `supabase/migrations/254_deliver_billing_notification_events.sql` — the
  billing-notification writer (was drafted as 253)

**Why this closes the interrupted-run risk structurally**: `supabase db
push` applies pending migrations in ascending filename order. 253 < 254,
so the restriction now always applies before the writer can, by plain
numbering — not by relying on a monitored run or a paused schedule. If a
real apply run is interrupted after 253 but before 254, the only thing
live is the tightened, harmless RLS policy; the writer's capability to
create an exposed row does not exist yet, so there is nothing for the
original gap to expose during that window. This is a stronger guarantee
than Options B or C alone, which only reduce the *chance* of the bad
window mattering — this removes the bad window's contents entirely.

**Both migration files now say this in their own header comments** (253
explains it's numbered ahead of 254 specifically for this reason; 254
explains it's numbered behind 253 and was originally drafted the other
way around) — read either file directly for the authoritative, in-context
explanation, not just this summary.

**Explicitly, per instruction**: neither migration's applied status has
been independently verified against staging in this renumbering pass.
Nothing here confirms what any real database's `schema_migrations` table
currently shows for either file, under either its original or current
number. Before any real apply, query
`supabase_migrations.schema_migrations` (or `supabase migration list
--linked`) on the actual target database first — this repository's own
history is not a substitute for that check.

**Re-verified after the renumbering, not just before it**:
- `check-migration-integrity.mjs` — 221/221 (unchanged count, filenames
  renumbered not added/removed)
- `scripts/validate-notification-recipient-kind-rls-contract.mjs` —
  rewritten for the new filenames/numbers, 8/8
- Disposable-Postgres focused test re-run against 253's final (post-swap)
  file content specifically — same 4 assertions, same results: client
  reads their own row, client is denied the owner-facing row (0 rows),
  client's full-table count is 1, owner's count stays 2. Database and the
  temporary `authenticated` role dropped afterward, Postgres stopped
  again, left as found.
- Full local suite re-run: eslint, `tsc --noEmit`, `test:release` (69/69
  through the same credential-gated stop), `test:security`,
  `test:accessibility`, `test:lifecycle`, `simulate-autonomy-failures.mjs`,
  `npm run build` — see "Checks run this session" for exact counts.

## Canonical staging preflight plan (read-only — survives a new chat)

Produced on request, before any staging connection. This is the plan to
follow the next time someone (a future session or you directly) is ready
to move migrations 248–254 toward a real apply. Nothing in this section
has been executed — no staging connection, no migration applied, no
deploy, as of this writing.

**Step 0 — branch/HEAD/tree.** `git fetch origin
safe/checkpoint-autonomy-wave35-sales`, then `git rev-parse HEAD` must
match `git rev-parse origin/safe/checkpoint-autonomy-wave35-sales`
exactly, and `git status --short` must be clean, before doing anything
else. Do not trust a cached ref.

**Step 1 — the exact migration set and order**, confirmed against
`check-migration-integrity.mjs`'s file count (221):

| # | File | Note |
|---|------|------|
| 248 | `notify_client_on_website_setup_denial.sql` | independent |
| 249 | `notify_client_on_commerce_customer_request.sql` | independent |
| 250 | `notify_client_on_file_scan_completion.sql` | independent |
| 251 | `multi_location_self_serve_addon.sql` | needs 252 with it |
| 252 | `fix_location_addon_trigger_conflict.sql` | fixes 251 |
| 253 | `restrict_client_notification_recipient_kind.sql` | must land before 254 |
| 254 | `deliver_billing_notification_events.sql` | needs 253 already applied |

**Step 2 — check what's already applied, before anything else.** Use
this repo's existing `validate_prelaunch` action in
`.github/workflows/manual-supabase-stage.yml` — it already does exactly
this, read-only, with **no mutation-confirmation phrase required**:
`supabase link` → `supabase db push --dry-run --linked` (diffs local
migration files against the real `supabase_migrations.schema_migrations`
table on the linked project) → the `business-prelaunch` readiness
profile check (`check-runtime-stage-readiness-readonly.mjs
--profile=business-prelaunch`). Also request `supabase migration list
--linked` output specifically — it gives an explicit local-vs-remote
table, the clearest possible confirmation that none of 248–254 (under
either their current or, for 253/254, original pre-swap numbers) already
show as applied on the real target project. **Do not assume from this
repo's own history that none are applied** — only this live query
settles it.

**Step 3 — dry-run.** `supabase db push --dry-run --linked` (part of
`validate_prelaunch`) must show exactly 248→254 as the pending set, in
that order, nothing else unexpected pending or already applied.

**Step 4 — failure/recovery.** If the dry-run or a later real push is
interrupted mid-sequence: treat it as an active incident per "Local-file
ordering fix" above — re-run to completion immediately, or pause
whatever schedules `advance_automatic_billing_lifecycle()`/
`queue_due_billing_attempts()` until `supabase migration list --linked`
confirms 253 (and everything numbered before it) landed. Never leave a
partial apply for later.

**Step 5 — security.** Confirm the workflow's own gates fire correctly:
`npm run test:runtime-stage` (deployment manifest/auth-boundary check)
and the "Verify staging Edge secret names" step against the
`business-prelaunch` profile — both already part of `validate_prelaunch`,
just confirm green in the run output, no extra work needed.

**Step 6 — test, after a clean dry-run (still not applying).**
Re-confirm all local checks are green at the exact HEAD being staged
(routine re-run), review the dry-run's migration diff and the prelaunch
profile output line by line, then stop — real apply
(`apply_migrations`/`apply_all`) is a separate, later, explicitly
approved action, never bundled into this preflight.

**Step 7 — what access is actually needed, and from whom.** The real
credentials (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
`SUPABASE_DB_PASSWORD`) already live in GitHub's `nxq-staging`
environment as repo secrets — they never need to be pasted into chat or
set as container env vars here. Two ways to run `validate_prelaunch`:
the user dispatches it directly in the GitHub Actions UI and shares the
run's log/summary for review, or a Claude session dispatches it via the
GitHub MCP `actions_run_trigger` tool (only needs a one-time
tool-permission approval when prompted — still zero secret values pass
through chat either way). For the real `apply_all` later, the only
additional "access" is the exact confirmation phrase
(`APPLY-NXQ-SUPABASE-STAGING`) at dispatch time — a deliberate typed
gate, not a secret, and never to be pre-filled or guessed by a session.

## Final release-focused audit — 2026-09-29

A full launch-readiness pass against README/`LAUNCH_HARDENING_CHECKLIST.md`
and actual code, prioritized Business onboarding → deployed/maintained
site, then portals, Commerce, security, billing, notifications. Every
line below is evidence-checked (file/script named), not asserted from
memory. Status key: **VERIFIED** = code exists, wired, and a real local
check exercises it. **UNVERIFIED** = code exists and looks wired but
nothing runs it against a real Postgres, or it's staged/unapplied.
**BROKEN** = missing, disconnected, or a known bug. **OWNER** = blocked
purely on external setup/approval no local code work can resolve.

### 1. Business onboarding → deployed, maintained site
- **VERIFIED** Signup/intake (`handle_new_client_signup` migration 193,
  `submit_current_client_website_setup` migration 218)
- **VERIFIED** Owner APPROVE/DENY + cost-cap enforcement
  (`nxq_authorize_paid_capability`) — 69/69 paid-capability checks pass
- **UNVERIFIED** Denial client notification (migration 248) — staged only
- **VERIFIED** Lead-capture contract, build/preview pipeline (44/44 Edge
  type-checks), preview-ready + production-published client
  notifications (application code, live at HEAD, no migration needed)
- **VERIFIED** Domain reconciliation notifications (connected /
  DNS-action-required), guarded to fire once per transition
- **OWNER** Actual production deploy — needs 10 disposable external QA
  runs + owner signoff (`LAUNCH_HARDENING_CHECKLIST.md`)
- **OWNER** Real AI provider key, Resend, Cloudmersive malware provider —
  fail closed by design without secrets

### 2. Client & Owner portals
- **VERIFIED** All 113 distinct `supabase.rpc()` names used across `src/`
  resolve to a real migration-defined function (0 missing)
- **VERIFIED** All 33 `ClientXxx.tsx` / 20 `OwnerXxx.tsx` pages have real
  backing logic (RPC, direct RLS-scoped read, or Edge function invoke) —
  individually confirmed, no dead pages
- **FIXED THIS SESSION (was BROKEN)** `secure-client-file-access` and
  `secure-owner-file-access` had zero CORS/OPTIONS handling despite being
  invoked directly from the browser (`ClientFiles.tsx:134`,
  `OwnerFiles.tsx:104`) — same bug class already fixed once for
  `discover-sales-prospects` but missed here. Fixed by adding the same
  `requestOrigin`/`cors`/OPTIONS pattern used in 15+ sibling functions
  (e.g. `upload-commerce-request-reference`). No auth/RLS/scan logic
  changed. Verified: `test:edge` 44/44,
  `validate-client-file-domain-isolation-contract.mjs`, full
  `test:release` 69/69 through the same stop, `test:security` 19/19,
  build clean.
- **VERIFIED** Multi-Location RPC chain wired in `ClientBusinessLocations.tsx`

### 3. Commerce
- **VERIFIED** Public customer-request flow; test-only checkout path
  correctly isolated from real Stripe Payment Link purchases
- **UNVERIFIED** Commerce customer-request client notification
  (migration 249) — staged only
- **BROKEN (orphaned, not exploitable)** `commerce_cart_items` (migration
  036): granted to `authenticated`, zero RLS policy, zero references
  anywhere in `src/`/`supabase/functions/`. Fails closed today (RLS
  enabled + no policy = no access), so no live exposure — but dead schema.
  Needs a migration to drop or lock down; **not touched, awaiting your
  decision** (stop-and-ask gate).
- **VERIFIED** Commerce reference uploads — correct CORS, part of the
  69/69 paid-capability suite

### 4. Security
- **VERIFIED** SSRF guard (`requirePublicHttpsUrl`) in all 12 functions
  that need it; timing-safe worker-token comparison in all 22; Stripe
  webhook HMAC verification; `npm audit` 0 vulnerabilities;
  `check-migration-integrity.mjs` 219/219
- **OWNER** `validate-paid-capability-guards-staging.mjs` and everything
  after it in `test:release` — fails closed on missing
  `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`, confirmed the exact
  same stopping point, nothing newly broken or fixed before it
- **OWNER** Full local Postgres via `supabase start` — Docker binary
  exists but no daemon in this container; confirmed unchanged from prior
  session

### 5. Billing
- **VERIFIED** `online_billing_enabled` flag is a single, consistently
  read config key (migrations 100/177/227/251); billing-off gating is
  real, not decorative
- **BROKEN (dead channel)** `billing_notification_events` (migration
  100): every billing event (`payment_succeeded`, `payment_failed`,
  `past_due_reminder`, `billing_processor_connection_required` — all
  client-facing — and `freeze_review_owner_attention`, owner-facing) is
  written through the single choke point `record_billing_notification()`
  but **never read anywhere** in `src/` or `supabase/functions/`. Clients
  never get pushed a notification for any of these; they only see status
  if they open `ClientBillingStatus.tsx` themselves. **A concrete fix plan
  is below, awaiting your approval before drafting the migration**
  (stop-and-ask gate).
- **UNVERIFIED** Migrations 251/252 (Multi-Location add-on + trigger fix)
  — full RPC set and frontend wiring confirmed consistent, still staged.
  The disposable-Postgres proof from the prior session (9/9 assertions)
  remains valid evidence for the trigger logic; still does not cover
  RLS/grants or a real `supabase db push` run.
- **OWNER** Stripe test-mode lifecycle, real payout account

### 6. Notifications
- **VERIFIED** `dispatch-notifications` genuinely claims/dispatches
  `notification_deliveries` rows and fails open to in-app-only (never
  silently drops) when no external provider is configured
- **BROKEN (dead channel, previously logged, not re-opened here)**
  `automation_escalations` — 7 of 8 escalation types written are never
  read by any owner surface; only
  `internal_edge_dispatch_network_unreachable` reaches
  `OwnerExceptionCenter.tsx`. You have twice chosen to log rather than
  fix this — left as-is unless you ask again.
- **VERIFIED** In-app notification inserts already live at HEAD (preview-
  ready, production-published, domain reconciliation, privacy-request
  completion) — all application code, no migration dependency
- **UNVERIFIED** Migrations 248/249/250 (denial, commerce-request,
  file-scan client notifications) — staged only

### Systemic gaps (recurring patterns)
1. **Write-only/dead-channel pattern**: `automation_escalations` (7/8
   types) and `billing_notification_events` (entirely) are both tables
   written but never read by any owner/client surface. Same root cause
   each time — a visibility table whose reader was never wired.
2. **CORS-preflight-missing pattern**: found and fixed once already
   (`discover-sales-prospects`); the prior audit pass fixed the same gap
   in two more browser-invoked functions
   (`secure-client-file-access`/`secure-owner-file-access`). **Full sweep
   completed this session**: enumerated all 17 distinct Edge function
   names called via `supabase.functions.invoke()` anywhere in `src/`,
   checked each for OPTIONS handling + `Access-Control-Allow-Origin` +
   `Access-Control-Allow-Methods`. Found one more real gap:
   `provision-storefront` had OPTIONS handling and
   `Access-Control-Allow-Origin: "*"` (the accepted wildcard pattern for
   bearer-authenticated owner functions — confirmed it does check
   `auth.getUser` + `owner_users`, so the wildcard itself is fine and
   already passes `validate-runtime-security-hardening.mjs`'s "Wildcard
   CORS remains limited to bearer-authenticated owner functions" check)
   but was **missing `Access-Control-Allow-Methods` entirely** — the only
   one of 13 wildcard-CORS functions missing it; every sibling function
   (`discover-sales-prospects`, `check-preview-netlify-status`, etc.) has
   it. Without it, a real browser's preflight for the actual POST request
   from `OwnerStorefrontProvisioning.tsx:84` could be rejected. Fixed by
   adding the single missing header line, matching the sibling pattern
   exactly. All 17 functions now confirmed complete; this pattern is
   closed, not just spot-checked.
3. **Staged-but-unapplied migrations (248-252)**: internally consistent,
   integrity-clean, zero live effect until a guarded `apply_all` run.
4. **Everything past the credential-gated `test:release` stop, and
   anything needing Docker**: unchanged, reconfirmed, not newly resolved.

### `billing_notification_events` fix — implemented (migration 254, staged/unapplied)

*(Renumbered from its original draft number — see "Local-file ordering
fix — implemented" above. Everything below describes this migration's
content and proof, which is unchanged by the renumbering; only its
filename/number changed.)*

Approved, then re-verified before drafting per your explicit instruction,
which surfaced two real corrections to the plan as first proposed:

1. **Recipient mapping was wrong for one event.**
   `billing_processor_connection_required` is **not** client-facing —
   reading its actual call site
   (`100_automatic_billing_orchestration.sql:236-243`) shows it fires
   when NXQ's own payment processor isn't connected (something only NXQ
   can fix), and it's already paired there with an `automation_escalations`
   row meant for the owner. Corrected split: **3 client events**
   (`payment_succeeded`, `payment_failed`, `past_due_reminder`), **2
   owner events** (`billing_processor_connection_required`,
   `freeze_review_owner_attention`).
2. **No frontend anywhere reads `notification_deliveries`, for either
   recipient kind.** Confirmed by grep across all of `src/` — zero hits.
   Inserting owner-kind rows without a reader would recreate the exact
   dead-channel pattern being fixed. Closed the owner half concretely:
   added a "Billing notifications needing your attention" section to
   `src/pages/OwnerBillingLifecycle.tsx` reading
   `notification_deliveries` where `recipient_kind='owner'` and
   `template_key like 'billing_%'` (owners already have full RLS read
   access via the existing `owner_manage_all_notifications` policy,
   migration 133 — no migration needed for this part). The client half is
   **not** silently expanded to build a notification-center UI — that's a
   pre-existing, broader gap affecting every notification this codebase
   produces (preview-ready, production-published, domain-reconciliation,
   etc. are equally invisible in-app today), flagged as its own item
   below, not bundled into this fix.

**`supabase/migrations/254_deliver_billing_notification_events.sql`**
(staged, **not applied to any database**): extends the single existing
choke-point function `record_billing_notification()` (migration 100) to
also insert into `notification_deliveries` on a genuinely new event only
(uses the standard `xmax = 0` upsert-detection idiom so a retried call
with the same `idempotency_key` never duplicates a notification) — no new
table, no privilege change, `billing_notification_events` behavior
unchanged.

Verified against a disposable local Postgres (same technique as
migration 252's proof — native `service postgresql`, no Docker
available): all 3 client events land with `recipient_kind='client'`, both
owner events land with `recipient_kind='owner'` and a subject naming the
client, a replayed idempotency key does not duplicate a notification, and
`billing_notification_events` still records every call exactly as before
(5/5, 5/5 by recipient split, 1/1 no-duplicate). Database dropped and
Postgres stopped again afterward.

Also verified locally: `check-migration-integrity.mjs` (220 files),
`eslint --max-warnings=0`, `tsc --noEmit`, `test:edge` (44/44),
`test:release` (69/69 through the same credential-gated stop),
`test:security` (19/19), `test:accessibility` (19/19), all downstream
`validate-*.mjs` scripts, `simulate-autonomy-failures.mjs` (23/23),
`test:lifecycle` (21/21 + 10/10), `npm run build`.

**Client notification-center gap — partially closed this session.** You
chose to build the minimal read-only version now. Before implementing,
verified: `notification_deliveries` grants `authenticated` SELECT-only
(migration 133) — no UPDATE/INSERT/DELETE at all, regardless of RLS
policy shape — and there is **no "seen"/"read" tracking column anywhere
in the schema**. So "list your notifications" fits normal source-code
scope (zero migration needed, same RLS the client already has), but
"mark as seen" does not — it needs a new column plus a narrow RPC
(matching this codebase's established pattern of RPC-gated writes, not
direct table grants), which is a real migration decision.

Also found and correctly handled a real security-scoping detail: the
`client_read_own_notifications` RLS policy only checks `client_id`
ownership, **not** `recipient_kind` — so a naive client-side query would
also have surfaced owner-facing rows about that same client (e.g. the
`freeze_review_owner_attention` notification from migration 254, written
in owner-oriented language). The implementation explicitly filters
`recipient_kind = 'client'` in the query itself, not just relying on RLS.

**Implemented in two places now**: `src/pages/ClientNotificationPreferences.tsx`
(the existing `/client/notifications` page, previously preferences-only)
shows the read-only list, and — per your follow-up request — the same
minimal list was added directly to `src/pages/ClientPortal.tsx` (the main
dashboard), so it's visible on login, not only under Settings. Both scope
identically: the client's own `client_id` and `recipient_kind = 'client'`,
re-verified against the same grant/RLS facts before building the second
one. `ClientPortal.tsx`'s copy is wired into the existing
`loadClientPortalData()`/`resetDependentPortalData()` flow, fetched
alongside messages/files/domains using the already-loaded client row.

Focused validator `scripts/validate-client-notification-center-contract.mjs`
(14/14, auto-discovered by `run-release-gate.mjs`) now asserts the same
four scoping/security properties for **both** pages — client_id scoping,
the explicit `recipient_kind` filter, no owner-only columns requested, no
write call against the table — plus the route wiring, both pages'
fail-safe session checks, and that `ClientPortal.tsx`'s reset function
clears the new state. All local checks re-run clean; no migration
touched, no Supabase connection, no deploy.

**Still deferred, needs your decision if you want it**: "mark as
seen"/unread-count/bell-icon — the fuller notification-center feature —
requires a migration (new column + RPC) and is flagged here, not
drafted. The owner side of this same underlying gap was separately
closed in `OwnerBillingLifecycle.tsx` for billing events specifically
(see "`billing_notification_events` fix — implemented" above); this
client-side list is the general-purpose equivalent, not limited to
billing.

## Completed work since the prior handoff entry (2026-09-29, this session)

- Added `CLAUDE.md` and canonicalized this handoff document
  (`a94cc2e`).
- Ran `npm ci && npm run test:release` for the first time this session
  against a real HEAD. Found and fixed a genuine pre-existing bug:
  `validate-nxqx-brand-contract.mjs`'s "public plan cards use NXQ-* names"
  check was failing because `src/pages/PublicPlans.tsx` only contained the
  literal string `NXQ-Business`; the other seven family names render only
  dynamically through `ProductFamilySignupSelector`/`productCatalog.ts`.
  Added a "Coming next: …" line listing all eight names as visible static
  copy. Fixed in `e9a6fda`. Traced to a Sept 3 2026 import commit
  (`aab89f1`) — likely broken since that import, not a recent regression.
- Re-ran the full release gate after the fix: it now progresses past the
  brand contract cleanly and 8+ validator suites (hundreds of sub-checks,
  including tenant isolation, paid-capability enforcement, maintenance/
  recovery, growth/outreach, mega-autonomy, Netlify budget, NXQ identity)
  pass. It stops at `validate-paid-capability-guards-staging.mjs`, which
  requires live `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` to query the
  staging database directly and fails closed without them by design. This
  container has no staging credentials — correctly so, per the
  external-service stop-and-ask gate in `CLAUDE.md`. No attempt was made to
  source or fabricate credentials to get past it.
- Manually ran every remaining `validate-*.mjs` file that alphabetically
  follows the credential-gated one (23 files) directly, since
  `run-release-gate.mjs` cannot reach them while that check fails closed.
  Found and fixed three more real issues, all local-only (no staging
  credentials involved):
  - `validate-provider-plug-in-readiness-contract.mjs`: **a regression
    I introduced** in this same session — my first canonicalization pass
    compressed this file's one-time-setup/plug-in/future-hookup sections
    into a pointer to other docs, but the validator requires this file to
    literally contain the `## Future one-session provider hookup` heading
    and all twelve secret names. Restored the full original sections
    verbatim. Fixed in `d2c17e6`. Lesson: this file is a load-bearing
    contract target, not free-form prose — do not compress its required
    sections without checking which validators read it first
    (`grep -rn "NXQ_RUNTIME_HANDOFF" scripts/`).
  - `validate-zero-key-staging-contract.mjs`: a stale exact-spacing literal
    match against `src/pages/ClientFiles.tsx` (`||` with no surrounding
    spaces) that no longer matched the file's ESLint-formatted spacing. The
    guarded quarantine/scan-status logic itself was already correct on
    both client and owner sides — updated the check's expected string, not
    the security logic. Fixed in `859f200`.
  - `validate-stripe-readiness-contract.mjs`: `ClientCommerceLiveStore.tsx`
    had generic "protected credential" copy but not the literal
    `https://buy.stripe.com/` example format or the phrase "Stripe secret
    key" the check requires. This touches a Stripe-labeled file, so I
    stopped and asked before editing per the payments gate; approved as
    copy-only (no payment/billing logic changed). Fixed in `859f200`.
- Manually ran every credential-independent script the gate would
  otherwise reach after the failing validator: `npm run lint --
  --max-warnings=0`, `node scripts/check-migration-integrity.mjs`,
  `npm run test:security`, `npm run test:accessibility`, `npm run
  test:edge`, `npm run build`, `node scripts/check-production-bundle-budget.mjs`,
  `npm run test:routes`, `npm audit --omit=dev --audit-level=high`. All
  passed (0 high/critical prod vulnerabilities; 214 migrations valid; 44
  Edge functions type-check; 19/19 accessibility; 17/17 security; build
  and all 16 route smoke checks green).
- Ran the remaining credential-independent pieces of the release gate:
  `node scripts/check-runtime-stage-readiness.mjs` (9/9, including its own
  explicit self-deferral of the remote launch-architecture contract since
  staging credentials are absent), `node scripts/simulate-autonomy-failures.mjs`
  (23/23), and `npm run test:lifecycle` (21/21 deterministic scenarios plus
  10/10 clean onboarding-to-live replays; external provider evidence
  correctly reported as "not exercised" since it needs disposable
  Supabase/GitHub/Netlify runtime). No fixes needed — all passed cleanly.
- **Everything in `scripts/run-release-gate.mjs` that does not require live
  staging credentials is now confirmed green at HEAD `5f6adc5`**, run
  individually rather than through the chained script (which still stops
  at `validate-paid-capability-guards-staging.mjs`). The only pieces left
  unverified are that one validator and `npm run test:staging-evidence`,
  both of which need real `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`.
- Audited every claim in `docs/LAUNCH_HARDENING_CHECKLIST.md` against
  current code and validators (unlike the other docs checked earlier this
  session, this one held up — no false claims found). Verified: Turnstile
  server-side verification is real (`supabase/functions/ingest-business-lead/index.ts`,
  confirmed by `validate-business-generated-site-quality.mjs` 27/27),
  recovery/readiness (18/18), provider health (24/24), tenant isolation
  (28/28), growth/outreach (16/16), and staging readiness evidence (12/12)
  contracts all pass, and migration 231 (client-owned domain policy)
  exists in the tree. No edits to that file were needed.
- Audited `docs/NXQ_CAPABILITY_ROADMAP.md` (the AI-safety policy for what
  features the AI may promise clients) and found a real implementation
  gap, not a doc-staleness issue: `src/ai/capabilityRules.ts` fully
  implemented the roadmap's classification rules (9 rules, decision/risk
  ranking, the exact car-customizer/ecommerce/restricted-workflow
  examples from the doc) but was never imported anywhere in the app —
  dead code next to a doc describing it as live policy. Confirmed via
  `grep -rln "classifyCapabilityRequest|capabilityRules"` across
  `src/` and `supabase/functions/` before touching anything. Asked the
  user how to handle it (wire it in vs. log and move on); approved to
  wire it in. Fixed in `f2b18e4`:
  - Moved the rules to `supabase/functions/_shared/capability-rules.ts`
    (the only place anything currently reads it from — Edge Functions,
    not the frontend, since Deno and Vite don't share a module root
    here). `src/ai/` no longer exists.
  - `supabase/functions/classify-business-change-request/index.ts` now
    runs `classifyCapabilityRequest(title + description)` as a
    deterministic pre-filter before its existing deterministic-patch/AI
    branching. Any decision other than `approved_standard` (full
    checkout, vehicle/3D configurators, inventory/external sync,
    restricted legal/medical/financial workflows) is forced to
    `owner_review` immediately, bypassing the AI provider call entirely
    for those categories, with the matched rule name and decision
    recorded in `automation_plan` evidence for audit.
  - This is additive-only by construction: none of the existing rule
    keywords overlap with ordinary contact/service-list edits, so normal
    change requests are provably unaffected. Verified with a direct call
    (`node --input-type=module -e '...'`) showing a car-customizer
    request now returns `custom_quote_required` while a normal
    contact/testimonial request still returns `approved_standard`.
  - Re-ran the entire credential-independent release gate after this
    change (lint, `test:edge` — 44/44 Deno type-check — all 23
    downstream validators, `simulate-autonomy-failures.mjs` 23/23,
    `test:lifecycle` 21/21 + 10/10) — all still green, nothing regressed.
  - **This has not been deployed anywhere.** It is a local source change
    in the repo only; it takes effect on staging only after the normal
    guarded `manual-supabase-stage.yml` deployment action, which remains
    a separate explicit gate.
- Scanned `src/` and `supabase/functions/_shared/` for other files
  referenced nowhere else (the same pattern that found the capability-rules
  gap). Found one more: `src/services/paymentProviders.ts`, a client-side
  "activate subscription" stub from the same Sept 3 import commit,
  unreferenced anywhere. Unlike the capability rules, this one should
  **not** be wired in — its shape would require a Stripe secret key in the
  browser, which directly violates the project's own no-secrets-in-browser
  rule, and it's superseded by the real server-side implementation
  (`supabase/functions/ingest-stripe-webhook` + migration 227). Asked the
  user since it's payments-adjacent; approved to delete. Removed in
  `6ffc1ee`. No other unreferenced files found in either scan. Full
  release gate re-run after deletion: same clean stop at
  `validate-paid-capability-guards-staging.mjs`, nothing else regressed.
- Checked outstanding TODO/FIXME/HACK markers (none found), Edge function
  manifest coverage (already 44/44 confirmed by
  `check-runtime-stage-readiness.mjs`), and `console.error` usage in Edge
  functions (14 occurrences, all legitimate last-resort operational
  logging of `.message` strings when a DB write itself fails — no secrets,
  no defect). Checked whether any "planned" product family in
  `productCatalog.ts` is secretly fully built like Multi-Location was
  (Booking, Commerce, Menu, Property, Multi-Location, Membership all
  `planned`; Enterprise Systems `private`) — Commerce has substantial code
  but that's Commerce-as-a-module-inside-NXQ-Business, not a
  signup-ready standalone family; flipping any status to `available` is a
  real business/product decision, not a code defect, so left untouched.
- Ran `npm audit` (including dev dependencies, which the release gate's
  `--omit=dev` check doesn't cover) and found 2 real dev-only
  vulnerabilities (1 moderate, 1 high) in the `browserslist`/
  `baseline-browser-mapping` chain used only by build tooling, never
  shipped to users. Ran `npm audit fix` (no `--force`) — only
  `package-lock.json` changed, `package.json` untouched, no direct
  dependency added/removed/downgraded. `npm audit` now reports 0
  vulnerabilities. Verified with a clean build, clean lint, and a full
  release-gate re-run (same expected stop point). Fixed in `5a06296`.
- Checked all `dependencies` and `devDependencies` in `package.json` for
  usage anywhere in the codebase. Found `clsx` listed but never imported
  anywhere. Confirmed with the user before removing (dependency removal is
  a confirm-first action) — approved. `npm uninstall clsx`; only
  `package.json`/`package-lock.json` changed. Verified clean build, lint,
  and full release gate (same expected stop point). Fixed in `66f1d3b`.
  All `devDependencies` checked too (eslint, vite, typescript, deno,
  supabase CLI, etc. — all used via config/scripts, not direct imports;
  `jose` actively used in 8 Edge functions) — nothing else unused found.
- Checked `scripts/` for orphaned automation files not called by
  `package.json`, `run-release-gate.mjs`, or any workflow. Two initial
  hits (`remote-launch-architecture-contract.mjs`,
  `workflow-step-helper.mjs`) were false positives — both are shared
  modules imported by other scripts, confirmed with a repo-wide grep, not
  actually orphaned. No real orphans found. Also checked
  `templates/booking-v1/blueprint.json` (looked unreferenced at a glance)
  — it's a real, validator-tracked scaffold for the "planned" Booking
  family, not dead code.
- Verified the tier pricing model against the server-enforced economics:
  provider cost is capped at `(monthly_price − 40) × 100` cents
  (migration 229, line 359), so NXQ is guaranteed at least $40 gross
  margin per client on every tier — including Starter at $50/mo — before
  any referral credit is applied. Confirmed the Enterprise resource-policy
  row's `provider_cost_cents:11000` matches the formula exactly at
  $150/mo. No inconsistency found; this is sound by design.
- Audited every outbound `fetch` call across all 44 Edge functions for the
  same SSRF risk class as the earlier `generate-business-build-plan` fix
  (a config-supplied URL feeding an outbound request without the shared
  guard). Found and fixed a real gap:
  `supabase/functions/prepare-build-plan/index.ts` had its own weaker,
  hand-rolled `validateAdapterUrl` instead of the shared
  `requirePublicHttpsUrl` — missing cloud-metadata hostname blocks
  (`metadata.google.internal`, etc.), the `100.64.0.0/10` and
  `198.18.0.0/15` private ranges, `0.0.0.0`, IPv4-mapped IPv6, and
  `.internal`/`.local`/`.home`/`.lan` suffixes that the shared guard
  already covers. `NXQ_BUILD_PLAN_AI_ADAPTER_URL` is config-supplied and
  feeds directly into `fetch`, the same risk shape as the prior fix.
  Replaced the local implementation with the shared guard. This broke
  `validate-autonomy-ops-wave18-contract.mjs`, which hardcoded literal
  markers from the old regex implementation — updated that check to
  verify the shared guard is imported and used instead (a tightening,
  not a weakening, of the check). Every other outbound fetch in
  `supabase/functions/` was checked and uses either a hardcoded trusted
  host (`api.github.com`, `api.netlify.com`) or the project's own
  self-referential Supabase URL — no other gap found. Fixed in
  `e33ef28`, verified with lint, Deno type-check (44/44), the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Followed up on the same "audit every function for this bug class"
  pattern for the worker-token timing-attack fix a prior commit
  (`b7bd71d`) had started but not finished: that commit fixed 6 functions
  comparing `NXQ_AUTOMATION_WORKER_TOKEN` with plain `===`/`!==` instead
  of a constant-time comparison, but a full grep across all 44 Edge
  functions found 10 more with the identical gap:
  `apply-business-change-request`, `build-business-location-pages`,
  `build-business-seo-artifacts`, `check-provider-health`,
  `classify-business-change-request`, `dispatch-notifications`,
  `process-data-subject-request`, `run-backup-restore-drill`,
  `run-staging-evidence-suite`, `scan-client-file`. A plain string
  comparison leaks timing information proportional to how many leading
  characters match, theoretically letting an attacker recover a valid
  internal automation token byte-by-byte. Switched all 10 to the shared
  `constantTimeEqual`. (`provision-storefront` was correctly excluded —
  it already has its own equivalent timing-safe helper under a different
  name, `protectedTokenMatches`, not a vulnerability.) Fixed in
  `faab445`, verified with a direct sanity call on `constantTimeEqual`
  (match/mismatch/empty-string), Deno type-check (44/44), lint, the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Considered but declined a softer finding: 19 internal Edge functions
  (all already gated by worker-token or owner-login auth) parse request
  bodies with no explicit app-level size cap. Asked the user; no strong
  preference either way, so went with the recommendation to skip it —
  low confidence it's a real gap given the existing auth gates plus
  Supabase's own platform-level request size ceiling, and no single
  clean established pattern across the codebase to replicate
  consistently (unlike the SSRF/timing-attack fixes, which had one).
  Logging this here rather than acting on it; revisit only if a
  concrete reason to prioritize it shows up.
- Followed the "does every user of this shared guard actually use it
  correctly" question one step further: checked every function using
  `requirePublicHttpsUrl` for whether its actual `fetch()` call also
  blocks redirects (`redirect: "error"`). A URL can pass upfront
  validation and still be redirected by the far end to an internal
  address if the fetch silently follows 3xx responses — a classic
  SSRF-via-redirect bypass. 6 of 8 already had `redirect: "error"`
  (the correct, already-established pattern); `generate-business-build-plan`
  and `prepare-build-plan` — the same two functions already touched for
  SSRF this session — did not. Added `redirect: "error"` to both,
  matching the existing pattern exactly; no behavior change for a
  well-behaved provider. Fixed in `cb46ddb`, verified with Deno
  type-check (44/44), lint, the full release gate (same expected stop
  point), all 23 downstream validators, the failure simulator (23/23),
  and the 10-run lifecycle simulation.
- Ran a schema-level version of the same "pattern applied inconsistently"
  audit: checked every migration for a table created without RLS ever
  enabled anywhere (none found — clean), then checked every RLS-enabled
  table for whether it ever got an actual policy. Most "RLS enabled, zero
  policies" hits are the correct, deliberate lockdown pattern for
  internal/ops-only tables (`nxq_scale_modes`, `nxq_netlify_budget_settings`,
  `staging_readiness_evidence_runs`, etc. — service-role-only by design,
  not a bug). One stood out as different: **`commerce_cart_items`**
  (migration 036) was granted `select, insert, update, delete` to the
  `authenticated` role but never got an RLS policy, and — unlike the ops
  tables — is never referenced anywhere in `src/` or
  `supabase/functions/`. Traced the real checkout flow (migration 090
  `protected_commerce_checkout` onward): it takes cart contents as a
  stateless request payload directly into the checkout RPC, never
  persisting to a cart table at all. `commerce_cart_items` is leftover
  schema from an earlier design, superseded before this branch's current
  checkout flow existed.
  - **Not a security hole**: RLS enabled with no policies fails closed by
    default in Postgres — the `GRANT` alone gives no actual access without
    a matching policy, so this has effectively zero live exposure.
  - **Not touched**: fixing this means a new migration (drop or
    RLS-lock the table), which is a hard stop-and-ask gate. Asked the
    user; recommended logging it rather than drafting a migration given
    it's inert — approved. No migration was written or drafted.
  - **Action for later**: if/when a maintenance pass touches Commerce
    schema, consider a migration to drop `commerce_cart_items` (or add
    the missing policies if it turns out something still expects it to
    work) — needs explicit review and the normal guarded staging apply,
    not an autonomous change.
- Checked a different consistency angle: every Edge function the frontend
  calls directly via `supabase.functions.invoke` (17 total, found by
  grepping `src/` for that call). Since these are genuine cross-origin
  browser calls, each needs its own CORS handling (`OPTIONS` preflight +
  `Access-Control-Allow-*` headers) — Supabase's platform does not add
  this automatically. 16 of 17 had it; `discover-sales-prospects` had
  none at all. This isn't a security gap, it's a **functional bug**: the
  Owner Portal's "fictional discovery" button (`OwnerGrowthCenter.tsx`)
  would have its request blocked by the browser's own CORS preflight and
  could not have worked as shipped. Added the same `corsHeaders`/`OPTIONS`
  pattern already used consistently in the other 16 functions. Fixed in
  `731ce8d`, verified with Deno type-check (44/44), lint, the full
  release gate (same expected stop point), all 23 downstream validators,
  the failure simulator (23/23), and the 10-run lifecycle simulation.
- Ran a read-only end-to-end audit of the actual Business flow, at the
  user's explicit request: signup/intake → owner decision → build →
  deploy handoff → client portal → maintenance. Traced each joint by
  reading real code, not assuming:
  - **Signup/intake**: `PortalSignup.tsx` collects family/tier-specific
    project-fit answers and stores them as Supabase auth user metadata.
    The `handle_new_client_signup()` trigger (migration 193) only reads
    `business_name`/`contact_name`/`product_family_slug`/`product_tier_key`
    from that metadata — the richer answers (`intake_family_details`,
    `intake_family_answers`, `intake_service_area`, `intake_primary_goal`,
    `intake_tier_goal`) are never read again. Confirmed this is
    **intentional, not a bug**: the real, authoritative intake is a
    separate, far more thorough "website setup report" form inside
    `ClientPortal.tsx` (industry, services, pages, style, brand,
    competitors, lead-handling rules, AI assistant rules, typed
    signature) submitted via `submit_current_client_website_setup`,
    matching migration 218's own description of it as "authoritative
    intake evidence." The initial signup answers only route the
    family/tier selection. Worth a UX look someday (why ask detailed
    questions twice) but that is a product call, not a code gap.
  - **RPC/route integrity**: every `supabase.rpc(...)` call in `src/`
    (109 distinct names) resolves to a real function defined in
    `supabase/migrations/`; every page in `src/pages/` is registered in
    `src/App.tsx`. No broken buttons or dead routes found.
  - **Owner decision → build → deploy handoff**: `qa_only` enforcement
    (blocking disposable QA clients from real infrastructure/billing) is
    correctly centralized in database RPCs (`nxq_authorize_paid_capability`
    and siblings), not scattered per-function — the right architecture,
    confirmed by tracing the exact cost-cap formula rather than assuming.
    Role authorization (owner-only functions checking `owner_users`,
    client-facing ones checking `clients`) is consistently correct across
    all 17 browser-invoked functions.
  - **Client portal**: the live lead-capture contract between every
    generated client website (`templates/business-v1/lead-form.js`) and
    `ingest-business-lead` was checked field-by-field and matches exactly
    (`form_key`, `name`, `email`, `phone`, `message`, `service_area`,
    `utm`, `company_website`, `challenge_token` in, `{ok:true,accepted:true}`
    out) — this is the one contract that, if broken, would silently kill
    every client's contact form, and it's intact.
  - **Real gap found**: `promote-business-production` (the function that
    performs the actual first production launch) logs an internal
    `automation_audit_log` event (`business_website_published_automatically`)
    but never notified the client. The parallel, already-correct pattern
    for *ongoing* changes (migration 137's `notify_change_request_state`
    trigger) does notify the client the moment a change reaches
    `published` — the very first launch, arguably the single most
    important moment in the whole product, had no equivalent. Fixed by
    adding a `notification_deliveries` insert immediately after the
    existing audit-log insert, using the exact channel/recipient_kind
    pattern already established by five other insert sites (migrations
    137, 148, 154, 155, 159): `channel: "in_app"` (always deliverable,
    no external provider needed), `recipient_kind: "client"`,
    `template_key: "business_production_published"`, `priority: "high"`.
    Deliberately not error-checked, matching the audit-log insert right
    above it — the launch has already fully succeeded by that point, so
    a failed notification write must never make the launch report as
    failed. No migration or schema change needed;
    `notification_deliveries` and its dispatch worker already exist.
    Fixed in `51aced5`, verified with Deno type-check (44/44), lint, the
    full release gate (same expected stop point), every validator that
    references `promote-business-production` by name, all 23 downstream
    validators, the failure simulator (23/23), and the 10-run lifecycle
    simulation.
  - **Maintenance**: `run-website-maintenance` and its uptime/SSL/backup
    checks were already exhaustively covered by
    `validate-recovery-readiness-contract.mjs` (18/18) and
    `validate-mega-autonomy-contract.mjs` (45/45) earlier this session —
    not re-audited from scratch here, but nothing in the launch-handoff
    trace above surfaced anything wrong with how maintenance picks up a
    newly-published site (`bootstrap_live_website_maintenance` RPC runs
    unconditionally right before the notification fix above).
- Continued the same audit one stage earlier and found the identical gap:
  `build-business-website`'s `processPreviewCheck` updates a run to
  `status: "preview_ready"` / `current_step: "client_review"` — a state
  that explicitly means "the client needs to act" — but never notified
  the client either, for the same reason (no trigger on
  `website_automation_runs` beyond an `updated_at` touch). Arguably more
  important than the production-launch gap, since preview review is an
  action-required step, not just an FYI. Fixed the same way: a
  `notification_deliveries` insert (`template_key:
  "business_preview_ready"`) right after the existing `updateStep` call,
  placed after the deferred-retry early return so it fires exactly once
  per successful preview completion (a later rebuilt preview would
  correctly notify again). Fixed in `a75c1e8`, verified identically:
  Deno type-check (44/44), lint, the full release gate (same expected
  stop point), every validator referencing `build-business-website` by
  name, all 23 downstream validators, the failure simulator (23/23), and
  the 10-run lifecycle simulation. Also confirmed
  `scripts/patch-provider-capacity-preview.mjs` throwing when run
  directly is expected, deliberate behavior (a one-time code-patch
  script with an idempotency guard that refuses to re-apply an already-
  present change) — not a bug, and not part of `run-release-gate.mjs`
  (only `validate-*.mjs` files run there).
- Continued the audit to the owner-decision stage and found the third and
  highest-priority instance of the same gap: `deny_website_setup()`
  (migration 183) hard-stops a client's pipeline on denial but never
  notifies the client at all — no trigger on `owner_approval_requests`
  covers denial either (the only one, migration 109's
  `owner_approval_queue_storefront_provisioning`, only fires on the
  `accepted` path). A denied client currently has no way to learn their
  pipeline stopped except by manually checking their portal — arguably
  the most important of the three gaps, since it's a rejection notice.
  Unlike the two already-fixed gaps, closing this means changing a
  database function body, which only happens through a new migration —
  a hard stop-and-ask gate even though the fix itself is simple. Asked
  the user; approved to draft a migration for review rather than fix
  silently or just log it. Wrote
  `supabase/migrations/248_notify_client_on_website_setup_denial.sql`:
  re-defines `deny_website_setup()` identically to migration 183 except
  for one `notification_deliveries` insert on the newly-denied path only
  (never on the idempotent already-denied replay), using the same
  established pattern. **Not applied to any database** — staged in the
  repo for review only. Verified everything checkable without a live
  database: migration integrity (215 migrations), the full release gate
  (same expected stop point), all 23 downstream validators, the failure
  simulator (23/23, including 9/9 denial-hard-stop checks specifically),
  and the 10-run lifecycle simulation. Fixed/staged in `6812458`.
- Continued into the domain-connection stage and found a fourth instance:
  `reconcile-domain` never notified the client on either outcome that
  matters to them — the domain fully connecting (same magnitude as the
  already-fixed production-launch notification), or DNS action being
  required at their own registrar (arguably the single most actionable
  gap found this session — nothing progresses until the client manually
  updates DNS, and they had no way to know). This function is polled on
  a schedule (`next_check_at`/`recheck_minutes: 15`) until it succeeds,
  so both new notifications are guarded by a state-transition check
  against the pre-reconciliation `automation_state` fetched earlier in
  the same function, so they fire exactly once per transition, not on
  every 15-minute retry. The `dns_pending` sub-case (registrar already
  connected, just waiting on propagation, no client action needed)
  intentionally gets no notification, matching its own message. Pure
  application-code change, no migration needed. Fixed in `f4b9c40`,
  verified with Deno type-check (44/44), lint, the full release gate
  (same expected stop point), the domain-specific validator (14/14) and
  every other validator referencing `reconcile-domain`, all 23
  downstream validators, the failure simulator (23/23), and the 10-run
  lifecycle simulation.
- Checked the remaining owner-decision-stage communication path —
  `request_targeted_more_info()` (migration 182), the "owner needs more
  detail before approving" flow — and confirmed it is **not** a gap: it
  deliberately inserts into `client_messages` (a real in-portal inbox the
  client reads via `current_client_message_page`, confirmed rendered in
  `ClientPortal.tsx`), and its own code comment explicitly documents
  skipping an external notification as an intentional design choice for
  this pre-approval iterative flow. Good negative result — not every
  "no notification_deliveries insert" hit is a bug.
- Checked billing and maintenance escalation before moving to Commerce.
  Both are already correct, no gap: billing payment failures already
  call `record_billing_notification()` for the client on every failed
  attempt (migration 100); maintenance/uptime/SSL issues correctly
  escalate only to the *owner* internally (`automation_escalations`) —
  the client shouldn't be alarmed by routine infrastructure monitoring
  NXQ is supposed to absorb transparently. The "client isn't told about
  important things" pattern does not extend into these two areas.
- At the user's request, extended the audit into the **Commerce flow**.
  Found the fourth-class instance of the same notification gap:
  `submit_public_commerce_customer_request()` (migration 242's version)
  — the real "customer requests a custom order" form on a Commerce
  storefront — creates a genuine `commerce_customer_requests` row but
  never notifies the client, unlike the exactly parallel Business event
  (`ingest-business-lead` already sends `new_lead`/`urgent_new_lead`
  notifications). Before fixing anything, also checked
  `create_public_protected_commerce_checkout` (migrations 090/091) for
  the same gap and confirmed it is **intentionally excluded, not a bug**:
  it is an explicit test/protected checkout path (`is_test: true`,
  `payment_provider: 'protected_test'`,
  `metadata.no_customer_contact: true`, "no real payment was charged and
  no customer was contacted") — real Commerce purchases go through
  external Stripe Payment Links, not this RPC, so there is no real order
  event being silently missed there. Asked the user about the genuine
  gap (same migration stop-and-ask gate as `deny_website_setup`);
  approved to draft a migration for review. Wrote
  `supabase/migrations/249_notify_client_on_commerce_customer_request.sql`:
  re-defines the function identically except for one
  `notification_deliveries` insert (`template_key:
  "new_commerce_request"`) on the successful-submission path. **Not
  applied to any database** — staged in the repo for review only.
  Verified everything checkable without a live database: migration
  integrity (216 migrations), the full release gate (same expected stop
  point), the Commerce reference-upload contract validator, all 23
  downstream validators, the failure simulator (23/23), and the 10-run
  lifecycle simulation. Fixed/staged in `8424e3f`.
- At the user's request, extended the audit into the **sales/outreach
  flow** (`discover-sales-prospects`, `draft-sales-outreach-ai`,
  `OwnerGrowthCenter.tsx`, `OwnerSalesPipeline.tsx`, migration 230's
  Client Finder schema). Several good negative results plus one real,
  different-in-kind finding:
  - **Replies are intentionally owner-driven, not a gap**:
    `owner_record_sales_reply()` requires an authenticated owner to call
    it manually; no automated reply-classification Edge function exists
    anywhere. This matches the system's "review only" / owner-in-the-loop
    design — there is no missing "notify the owner" step because the
    owner is always the one triggering this path after reading their own
    mailbox externally.
  - **`emergency_stop` not being checked anywhere is not a bug**: there
    is no outreach-*sending* Edge function at all yet — only discovery
    and drafting exist as real functions. The full delivery-safety schema
    (bounce/complaint tracking, suppression, emergency stop) is built in
    advance for a feature `docs/GROWTH_AND_OUTREACH_LAUNCH_RUNBOOK.md`
    explicitly documents as pending ("External email delivery: Off...
    Required before enabling: OAuth mailbox, unsubscribe handling, DNS
    authentication, and owner decision"). Nothing to enforce yet because
    nothing sends yet — confirmed intentional, not investigated further.
  - **Real finding, different in kind from the notification gaps**:
    `draft-sales-outreach-ai` is a fully built, tested Edge Function
    (same owner-JWT auth pattern as the browser-invoked functions
    audited earlier) that is **never called from anywhere in `src/`**.
    The actual shipped `OwnerSalesPipeline.tsx` drafts messages with a
    local, deterministic `outreachTemplate()` function and a plain
    `owner_create_sales_outreach_draft` RPC — it never reaches the AI
    drafting function at all. `docs/GROWTH_AND_OUTREACH_LAUNCH_RUNBOOK.md`
    describes both "deterministic zero-key drafting" and "optional
    model-assisted drafting" as existing capabilities; only the
    deterministic path is actually wired into the UI. Same
    built-but-disconnected pattern as the capability-rules finding
    earlier this session, but for a product feature rather than a safety
    rule — wiring it in would mean adding a new UI flow (an "AI draft"
    option) to `OwnerSalesPipeline.tsx`, not a one-line backend insert,
    so this is more of a product decision than the notification fixes.
    Asked the user; chose to log it rather than touch the UI now. No
    code changed for this finding — logged here for a future, more
    deliberate product decision about whether/how to surface AI-assisted
    drafting in the Sales Pipeline UI.
- Continued into the **billing/subscription lifecycle** and found what is
  likely the most consequential gap of the whole session:
  `record_billing_notification()` (migration 100) writes every billing
  lifecycle event — `payment_succeeded`, `payment_failed`,
  `past_due_reminder`, `billing_processor_connection_required`,
  `freeze_review_owner_attention` — into a table called
  `billing_notification_events`. That table is **never read by
  anything**: not `dispatch-notifications` (which only ever reads
  `notification_deliveries`), not any client-facing page. Confirmed with
  a repo-wide grep for `billing_notification_events` outside the two
  migrations that write to it — zero hits. `ClientBillingStatus.tsx`
  does show the client's *current* `billing_status` if they think to
  check that page, so this isn't total silence, but there is no push
  notification at all for a failed payment, a past-due grace period
  starting, or a processor not being connected — unlike every other
  significant event elsewhere in the system (new leads, preview-ready,
  production-published, domain-connected, Commerce requests), which do
  push an in-app notification.
  - `freeze_review_owner_attention` is explicitly owner-facing by design
    ("only a human owner can freeze service" — the client cannot act on
    it directly), so any fix should leave that one alone and only add
    client notifications for the other four event types.
  - This is in the payments/billing domain (one of the explicit
    stop-and-ask categories) on top of also being a migration change, so
    I asked before doing anything, laying out the exact scope (which
    function, which 4 of 5 event types, what would stay owner-only).
    The user chose to log it rather than draft a migration, wanting to
    decide the exact billing-communication wording/scope themselves
    rather than have it drafted now. **No migration written, no code
    changed for this finding.**

## Owner operations / launch readiness audit (continued at user's request)

- Confirmed the `freeze_review_owner_attention` side of the billing gap
  above from the owner's perspective too: it is at least *discoverable*
  — `OwnerBillingLifecycle.tsx` shows a live "Human freeze decisions"
  count for clients in `freeze_review` status — but nothing pushes the
  owner toward it either; same underlying gap as above, not a separate
  decision, so not re-asked.
- Checked `OwnerLaunchReadiness.tsx`: it is a thin display layer over a
  real, evidence-backed `launch_readiness_checks` table and
  `qa_lifecycle_runs`, not hardcoded or stale. Consistent with the many
  "readiness"/"evidence" validators already confirmed passing this
  session. No issue found.
- **Real, separate finding**: traced every read of `automation_escalations`
  across the entire migration history (`grep -rn "from public\.automation_escalations"`)
  and found that **no owner-facing function or page ever surfaces
  billing escalations** (`billing_processor_not_connected`,
  `billing_payment_failed`, `billing_retry_exhausted` — all written by
  migration 100). `owner_exception_center()` (the function behind
  `OwnerExceptionCenter.tsx`) only reads `automation_jobs` and
  `website_maintenance_alerts`, never `automation_escalations`. The one
  function that does read `automation_escalations`
  (`owner_runtime_dispatch_incidents()`, migration 200) filters
  specifically to `escalation_type = 'internal_edge_dispatch_network_unreachable'`
  — an unrelated dispatch-watchdog concern. Every other read of
  `automation_escalations` in the codebase is an idempotency
  existence-check inside the same function that just wrote the row, not
  a display read. This is distinct from the client-notification gap
  above: this is about whether the **owner** ever sees these alerts at
  all in their own operational tooling, not about client communication.
  Asked the user (separate decision from the billing-notification one,
  since it's a different fix target — Owner Exception Center coverage,
  not customer-facing wording); chose to log it rather than draft a
  migration now. **No migration written, no code changed for this
  finding.**

## Privacy/GDPR flow audit (continued at user's request)

- Found and fixed the sixth instance of the notification-gap class:
  `process-data-subject-request` moves export requests to `ready`,
  consent-withdrawal/restriction requests to `completed`, and correction
  requests to a needs-more-info `ready` state, but never told the client
  any of it happened. Unlike the deny/Commerce-request/billing gaps,
  this one lives entirely in application code (an Edge Function), not a
  database function — no migration needed, so no stop-and-ask gate,
  matching the same autonomy scope as the preview-ready/production-
  published/domain-connection fixes made earlier. Added a
  `notification_deliveries` insert after the status update, guarded to
  only fire when the request has a `client_id` (data-subject requests
  scoped to a broader NXQ account with no Business client relationship
  have no existing client-scoped notification path — out of scope here,
  not fixed). Message varies by `request_type`. Fixed in `817af07`,
  verified with Deno type-check (44/44), lint, the full release gate
  (same expected stop point), every validator referencing
  `process-data-subject-request` by name, all 23 downstream validators,
  the failure simulator (23/23, including the privacy-deletion
  identity-verification check specifically), and the 10-run lifecycle
  simulation.

## File security / malware scanning audit (continued at user's request)

- Found the seventh instance of the notification-gap class, plus a third
  confirmation of the systemic owner-escalation-visibility gap:
  `complete_client_file_security_scan()` (migration 144) flips a scanned
  file's `quarantine_status` to `released` or `quarantined` and, for
  suspicious/infected results, writes a `client_file_security_alert` row
  to `automation_escalations` — but never told the client their own
  upload was released or quarantined. Checked whether the owner-facing
  escalation actually reaches anyone: confirmed it hits the exact same
  dead-end already found for billing escalations (no owner-facing
  function or page reads that escalation type either — this is now the
  third confirmed instance of that systemic gap, after billing and this
  one). This lives in a database function, a stop-and-ask gate; asked
  the user covering both angles (client notification + the recurring
  owner-visibility problem); approved to draft a migration for the
  client-notification fix only, explicitly leaving the broader owner-
  visibility problem as the same already-logged item rather than
  re-solving it piecemeal per table. Wrote
  `supabase/migrations/250_notify_client_on_file_scan_completion.sql`:
  re-defines the function identically to migration 144 except for one
  `notification_deliveries` insert (`client_file_released` or
  `client_file_quarantined` depending on outcome). **Not applied to any
  database** — staged in the repo for review only. Verified everything
  checkable without a live database: migration integrity (217
  migrations), the full release gate (same expected stop point), all 23
  downstream validators, the failure simulator (23/23), and the 10-run
  lifecycle simulation. Fixed/staged in `a3442df`.

## Consolidated `automation_escalations` audit (closing the recurring finding)

Having hit the same "owner escalation goes nowhere" pattern three times
(billing, file security, and by extension anything else that writes to
this table), did one comprehensive pass instead of continuing to
rediscover it domain by domain. Extracted every `escalation_type` value
ever inserted into `public.automation_escalations` across the full
migration history and checked each against every place that table is
read:

- **Written:** `billing_processor_not_connected`, `billing_payment_failed`,
  `billing_retry_exhausted`, `client_file_security_alert`,
  `client_file_scan_exhausted`, `automation_job_exhausted`,
  `infrastructure_queue_missing_project`,
  `internal_edge_dispatch_network_unreachable`.
- **Actually surfaced to the owner:** only
  `internal_edge_dispatch_network_unreachable`, via
  `owner_runtime_dispatch_incidents()` (migration 200), which
  `OwnerExceptionCenter.tsx` calls directly.
- **Never surfaced anywhere:** all seven of the others. Checked every
  version of `owner_exception_center()` across its full redefinition
  history (migrations 127, 161, 167, 198, 216) — none of them ever
  reference `automation_escalations` at all, **including migration 198**,
  whose name ("surface provider billing blockers in owner exceptions")
  directly implies it should. It appears the actual owner-exception
  surfacing mechanism was built around `automation_jobs`/
  `website_maintenance_alerts` directly (job failure text detection)
  rather than this table, and `automation_escalations` writes for
  billing/file-security/infrastructure concerns were left in place
  without ever being wired to a reader — likely dead by omission during
  a refactor, not a deliberate design choice like the maintenance-vs-
  client separation confirmed earlier this session.

This is now a single, complete, closed finding rather than three
separate rediscoveries. The user has twice chosen to log rather than
fix this pattern (for billing and file security specifically); consistent
with that, **no migration was drafted for this consolidated version
either, and no code was changed.** If/when the user wants to close this
gap, the cleanest fix is almost certainly extending
`owner_exception_center()` (or a sibling function) to also surface open
`automation_escalations` rows generically, rather than hand-wiring each
escalation_type into a separate reader one at a time.

## Completed work in the prior session (through 2026-09-29 checkpoint sync)

The prior handoff entry described the 2026-08-16 audit (migration 222,
classifier runtime v3). Since then, `safe/checkpoint-autonomy-wave35-sales`
has accumulated further hardening, most recently:

- Business-location schema/guard hardening: a run of `fix:` commits
  isolating and classifying Business-location constraint drift, RPC
  failures, write-path failures, and guard validation phases
  (`4336460`, `f66efbc`, `5cd0c55`, `37fbae7`, `f7716a9`, `c38c517`,
  `deb2d08`, `a9d05e4`, `0621650`, and related).
- Paid-capability guard hardening: transaction/rollback stabilization,
  authorization isolation, and economic margin ceiling enforcement
  (`77b8cca`, `a833fae`, `25e6365`, `8e9fd32`, `cb9d908`, `8e94dd3`,
  `369f249`, `79810e5`, `2b86917`).
- Provider health reclassified as control-plane infrastructure
  (`160b59d`), plus scoped CI for a provider-health-only staging deploy and
  a one-shot smoke check (`cc10a47`, `afbbc5f`).
- Latest 5 commits landed by fast-forward to the verified tip:
  - `c36568d` fix: close SSRF gap in generate-business-build-plan provider
    URL check
  - `b7bd71d` fix: centralize constantTimeEqual and use it for
    worker-token checks
  - `be9c2ad` fix: update three stale Commerce reference-upload contract
    checks
  - `ee0c5dc` fix: remove duplicated upstream/internal provider
    secret-name lists
  - `651d1c4` fix: share the workflowStep helper between two contract
    scripts

## Multi-Location status — corrected

A prior instruction in this session incorrectly assumed Multi-Location's
migration/frontend implementation was absent from this branch. That was
checked against the actual repository state and is **false**. As of HEAD
`c36568d`:

- `supabase/migrations/132_enterprise_multi_location_business_foundation.sql`
  (218 lines) defines `client_locations` and `client_location_services`,
  including RLS and constraints.
- `src/pages/ClientBusinessLocations.tsx` is a working client-facing page
  reading through `current_client_locations()`.
- Multiple contract validators actively assert Location schema, RLS, and
  guard behavior: `scripts/validate-tenant-isolation-contract.mjs`,
  `scripts/validate-autonomy-ops-wave25-contract.mjs`,
  `scripts/validate-paid-capability-enforcement-contract.mjs`.
- The most recent commit streak on this branch is active hardening of this
  exact feature (constraint drift classification, guard validation phases),
  not new construction of missing functionality.

**Implication:** Multi-Location does not need to be "rebuilt from a fresh
migration/security plan" — it exists and is under active, incremental
hardening. Any future change to it should be treated as modifying existing
guarded infrastructure (subject to the same migration/external-service
stop-and-ask gate as any other schema change), not as greenfield work.

## Multi-Location self-serve add-on — implemented

Built per a three-round-revised, explicitly user-approved plan ("ok
continue"). Rules implemented exactly as decided: Starter gets one
location; Growth and Intelligence can self-serve add extra locations at
$10/month each up to 10 total; Enterprise already includes multi-location
(cap 100) and is required above 10. Billing is off system-wide, so no
charge, no external connection, and no touch to `clients.monthly_price` or
`billing_subscriptions.amount` anywhere in this feature.

- **`supabase/migrations/251_multi_location_self_serve_addon.sql`** (staged,
  **not applied to any database**):
  - `client_location_addons` (one row per client, `enabled_units` 0-9,
    `unit_price_cents` fixed 1000) and `client_location_addon_events`
    (append-only enable/cancel audit trail) — both RLS-enabled,
    `authenticated` gets SELECT only, writes only via the RPCs below.
  - `enforce_client_location_limit()` — a `BEFORE INSERT OR UPDATE` trigger
    on `client_locations`, authoritative regardless of entry path. Closes a
    real gap found this session: `client_locations` grants direct
    insert/update/delete to `authenticated` with an RLS policy that checks
    ownership only, never quantity — a raw table write could previously
    bypass `current_client_create_location()`'s tier cap. The trigger only
    re-checks on inserts, reopens of a closed location, or client_id
    reassignment (not routine edits), using the existing
    `pg_advisory_xact_lock(hashtextextended(...))` convention keyed per
    client to stay safe under concurrent requests.
  - `current_client_create_location()` — same as migration 185 except the
    cap formula now adds enabled add-on units for Growth/Intelligence.
  - `current_client_close_location()` — new; there was no self-serve "close
    a location" capability before this. Never deletes, only sets
    `status='closed'`. Refuses to close the primary location while other
    active locations exist.
  - `current_client_enable_location_addon()` — self-serve, instant, no
    owner approval, one code path. Returns base/add-on/internal-total as
    plain numbers for display only; message text never says "purchased"
    and states the add-on has no charge until NXQ turns on live billing.
  - `current_client_cancel_location_addon()` — one code path only (the
    live-billing period-end branch was explicitly deferred by the user to
    the future reviewed billing-activation work, not built here untested).
    Cancels immediately, but refuses if the client's current active
    location count would exceed the new, lower cap — the client must close
    a location first. Never auto-closes or deletes a location.
  - `current_client_locations()` — extended (locations array and its
    `status <> 'closed'` filter unchanged from migration 132) to also
    return `tier_key`, `active_location_count`, `effective_cap`,
    `over_entitlement`, `enabled_addon_units`, `can_enable_addon`,
    `can_cancel_addon`, and the base/add-on/total cent amounts.
  - `owner_location_addon_overview()` — new owner-only RPC giving genuine
    visibility (not a repeat of the `automation_escalations`/
    `automation_audit_log` write-only pattern already found and logged
    elsewhere this session): per-client base/add-on/total, a live-computed
    `over_entitlement` list (catches Starter downgrades and any other path
    to being over cap — computed fresh every call, not a stored flag), and
    the most recent 50 enable/cancel events.
- **Frontend** (all read/write through the RPCs above, no direct table
  writes):
  - `src/pages/ClientBusinessLocations.tsx` — new "Location plan" panel
    showing active/cap counts, an over-entitlement warning banner, and
    base/add-on/internal-total amounts with an explicit "nothing is charged
    while billing is off" note; enable/cancel add-on buttons gated by the
    RPC-returned `can_enable_addon`/`can_cancel_addon`; a "Close location"
    button on every non-primary location.
  - `src/pages/ClientBillingStatus.tsx` — new "Location add-ons" section
    (shown only when at least one unit is enabled) showing base plan,
    add-on amount, and internal total as separate line items, explicitly
    labeled "not yet part of your billed amount."
  - `src/pages/OwnerBillingLifecycle.tsx` — new "Over entitlement",
    "Location add-ons", and "Recent location add-on activity" sections
    reading `owner_location_addon_overview()`.
- **Explicitly deferred, per user instruction:** folding the add-on amount
  into `billing_subscriptions.amount` (or any other real billing field) is
  a separate, explicitly reviewed activation/reconciliation step for
  whenever live billing turns on — nothing in this migration bridges to it.

## Migration 252 — trigger-conflict fix for the Multi-Location add-on

Found during a read-only release review of 248–251 (before either was ever
applied), fixed with your explicit approval as a forward-only migration
rather than amending unapplied 251 in place.

- **`supabase/migrations/252_fix_location_addon_trigger_conflict.sql`**
  (staged, **not applied to any database**): `create or replace`s
  `nxq_enforce_location_entitlement()` (originally migration 246) to add
  `client_location_addons.enabled_units` into its cap formula for
  Growth/Intelligence, while leaving its family (`business` only),
  status (`approved`/`active`/`overdue`), billing (`active`/`past_due`),
  and pipeline-stopped guards byte-for-byte unchanged. Its advisory lock
  now uses the same `'client-location-capacity:'` namespace as the
  add-on enable/cancel RPCs and 251's own trigger, closing a race where
  "enable add-on" and "insert second location" previously didn't
  serialize against each other. Also narrows `enforce_client_location_limit()`
  (251's trigger) to only fire on its two UPDATE cases (reopening a
  closed location, reassigning `client_id`) — the plain-INSERT case it
  also checked is now redundant since the revised 246 function is
  authoritative there.
- **`scripts/sql/validate-paid-capability-guards-staging.sql`**: added
  `'enforce_client_location_limit'` to the `location_no_unexpected_user_triggers`
  trigger allow-list (previously only `nxq_enforce_location_entitlement`
  and `queue_location_seo_refresh_from_location` were permitted — this
  staging guard would otherwise fail the moment 251 was ever applied
  anywhere, independent of the functional bug).
- **New database test**, added to the same guarded staging SQL (only
  actually runs against a live/staging Postgres with
  `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`, which this container
  doesn't have): a synthetic Growth-tier client (`client_growth_addon`)
  creates a primary location, is denied a second one with zero add-on
  units enabled (`location_addon_without_addon_denied`), enables one
  add-on unit (`location_addon_enabled`), then successfully creates a
  second location (`location_addon_second_location_permitted`), ending
  with `active_location_count = 2` (`location_addon_active_count_two`).
  Six new named checks were added; `scripts/validate-paid-capability-enforcement-contract.mjs`'s
  exact-count assertion on `current_client_create_location(` calls in
  that SQL file was updated from 2 to 5 to match.
- **Update — proven against a real, disposable Postgres (not staging).**
  This container has no Docker daemon, so the full `supabase start` stack
  (Postgres + Auth + Storage) isn't available here — but it does have a
  native Postgres 16 install (`service postgresql`, normally stopped).
  Started it, created a throwaway database
  (`nxq_scoped_trigger_test`), built a minimal hand-written schema (just
  the tables the fix touches: `clients`, `product_families`,
  `product_family_tiers`, `nxq_tier_entitlements`, `client_locations`,
  `client_location_addons`, `client_location_addon_events`,
  `automation_audit_log`, `nxq_provider_connections`), stubbed
  `auth.uid()`/`auth.role()` with the same GUC-based semantics Supabase
  uses, and loaded the **exact, unmodified function bodies** from
  migrations 251 and 252 (`current_client_create_location()`,
  `current_client_enable_location_addon()`,
  `nxq_enforce_location_entitlement()`, `enforce_client_location_limit()`
  plus both triggers) — copied, not retyped. Ran the actual scenario:
  - A Growth-tier client's first location succeeds; a second with **zero**
    add-on units is denied (`Current plan location limit reached (1).`).
  - The same client enables one add-on unit (`ok:true, enabled_units:1`),
    then a second location **succeeds** — this is the exact bug 252 fixes,
    now confirmed at runtime, not just by inspection.
  - `active_location_count = 2` afterward.
  - Regression checks: a Starter client is still capped at 1 regardless of
    add-ons; a client with `billing_status = 'cancelled'` is still denied
    with `Current subscription does not permit location creation.`
    (proves the billing guard from migration 246 survived the fix
    unweakened); a client with `pipeline_stopped_at` set is still denied
    by the RPC's own lifecycle check; exactly two triggers
    (`nxq_enforce_location_entitlement`, `enforce_client_location_limit`)
    exist on `client_locations` afterward, matching the updated staging
    allow-list. All nine assertions passed exactly as designed. The
    throwaway database was dropped and the Postgres service stopped again
    afterward (left exactly as found).
  - **What this does and doesn't prove**: this is strong evidence the
    trigger logic itself is correct — the actual function bodies ran, not
    a reimplementation. It does **not** prove RLS/grants (no policies were
    created in this minimal schema), does not exercise the real
    `auth`/`storage` schemas or GoTrue-issued JWTs, does not prove
    `supabase db push` applies 251→252 cleanly against the full 219-file
    migration history, and does not run
    `validate-paid-capability-guards-staging.mjs` itself (still blocked on
    missing staging credentials in this container, unchanged). A guarded
    staging run (or a Docker-capable environment able to run
    `supabase start`) is still the right final gate before ever applying
    251+252 to a real project. See "Next highest-priority safe tasks"
    below.

## Checks run this session

- Git-state verification: `git remote -v`, `git status --short --branch`,
  `git rev-parse HEAD`, `git rev-parse origin/<branch>`,
  `git ls-remote origin refs/heads/<branch>`, `git log --oneline
  --decorate`, followed by `git fetch` + `git merge --ff-only`.
- `npm ci` — clean install, 171 packages, 2 pre-existing `npm audit`
  findings (1 moderate, 1 high) not yet triaged. **Re-checked at HEAD
  `30bdee9`: `npm audit` now reports 0 vulnerabilities at any severity** —
  resolved by a dependency update somewhere between that install and this
  one; not something this session changed deliberately.
- `npm run test:release` (full local release gate) — run twice:
  1. First run: failed at `validate-nxqx-brand-contract.mjs`
     ("public plan cards use NXQ-* names"), 13/14 in that suite. All
     validators before it in alphabetical order passed in full.
  2. After the `e9a6fda` fix: that suite now passes 14/14, and the gate
     progresses through at least 8 more validator suites (Netlify budget,
     NXQ identity, mega-autonomy, maintenance/recovery, growth/outreach,
     launch-hardening, paid-capability enforcement, tenant isolation, and
     others) before stopping at `validate-paid-capability-guards-staging.mjs`
     — a live-Supabase-credential check that fails closed by design without
     `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`, which this container
     does not have.
- The 2026-08-16 entry's "67 contract validators / 189 migrations / 276
  SECURITY DEFINER functions / 35 Edge functions green" claim is still
  **not fully re-verified against live Supabase** — only the portion of
  the gate before the credential-gated validator has been confirmed green
  at current HEAD.
- **Now run and confirmed at HEAD `30bdee9`** (closing the previously
  open items in this list): `npx eslint . --max-warnings=0` (clean),
  `npx tsc --noEmit` (clean), `npm audit` (0 vulnerabilities), `npm run
  build` (production build succeeds, no errors), `npm run test:security`
  (19/19), `npm run test:accessibility` (19/19), every `validate-*.mjs`
  script that alphabetically follows the credential-gated one (23 files,
  all pass), `node scripts/simulate-autonomy-failures.mjs` (23/23), and
  `npm run test:lifecycle` (21/21 + 10/10 replays). No bundle-size budget
  script exists in `package.json` to run separately from `npm run build`.

## Current product decisions and hard rules in force

From `README.md` (unchanged, still authoritative):

- Signup creates a lead; completed intake creates one owner
  `APPROVE`/`DENY` decision. `DENY` creates no provider infrastructure.
- One `APPROVE` starts an idempotent backend lifecycle; provider retries
  reuse checkpointed resources.
- Supabase is the source of truth; browser code never receives
  service-role credentials or direct control-plane mutation authority.
- Preview and production are distinct; production promotion is
  exact-commit, fast-forward-only, and stays locked until verified.
- Tenant data (files, domains, messages) is read only through
  authenticated tenant-derived boundaries.
- Commerce remains a supported product family and must not be removed
  while Business automation evolves.

From `docs/LAUNCH_HARDENING_CHECKLIST.md` (unchanged):

- Clients purchase/own/renew their own domains; NXQ never holds registrar
  credentials.
- No live email, outreach, billing, provider mutation, or production
  deployment without its configured gate.
- Never use placeholder secrets or fabricated evidence to pass a readiness
  check.

From this session's explicit approval (now encoded in `CLAUDE.md`):

- Stop-and-ask gates: workflows, migrations, external services, secrets,
  deployments, payments, production, destructive actions, material
  compatibility risk.
- Never work directly on `main`.

## Confirmed blockers/risks

- **Production remains blocked**, per prior audits: requires 10 consecutive
  disposable external Business QA runs with real Supabase/GitHub/Netlify
  evidence, recovery proof, and explicit owner signoff. No change here
  alters that.
- **External-provider-dependent work stays blocked** per
  `docs/LAUNCH_HARDENING_CHECKLIST.md`: real AI provider key, real
  notification delivery, production-approved malware scanning, Stripe
  test-mode lifecycle, client-owned production domain DNS/SSL test, fresh
  Netlify build (credits were previously exhausted — do not assume they've
  been restored).
- **Stale git tracking refs are a demonstrated risk in this environment.**
  This session's own initial checkpoint report (`afbbc5f`) was wrong
  because a local `origin/<branch>` ref was stale; the real remote tip was
  `c36568d`. Always `git fetch` and compare against `git ls-remote` before
  reporting a checkpoint as verified.
- **Full local release gate cannot complete in this container without
  staging Supabase credentials.** `validate-paid-capability-guards-staging.mjs`
  fails closed on missing `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`
  by design (see Checks run above). Supplying those is an external-service
  action requiring an explicit decision, not something to do autonomously.
  Whether the gate is fully green beyond that point remains unverified.

## Next highest-priority safe tasks

1. **Decide the two deferred systemic gaps** (both explicitly the user's
   to bring back when ready, not something to draft speculatively):
   (a) client-facing billing notifications (payment succeeded/failed,
   past-due, processor-connection-required never reach the client
   through any channel — see "Owner operations / launch readiness
   audit"), and (b) the consolidated `automation_escalations`
   owner-visibility gap (7 of 8 escalation types written are never
   surfaced to the owner anywhere — see "Consolidated
   `automation_escalations` audit"). The cleanest fix for (b) is
   extending `owner_exception_center()` to read `automation_escalations`
   generically rather than one-off per escalation_type.
2. **Get the full guard SQL actually running, in a Docker-capable
   environment.** A scoped, disposable-Postgres test (this session, native
   `service postgresql`, no Docker available here) already confirmed the
   251/252 trigger logic itself behaves correctly at runtime — see
   "Migration 252 — trigger-conflict fix" above. What's still missing is
   running the *real* `scripts/sql/validate-paid-capability-guards-staging.sql`
   scenario (with real RLS, real `auth`/`storage` schemas, the full
   219-migration history applied via `supabase db push`) — that needs
   either a Docker-capable environment to run `supabase start` locally, or
   a throwaway Supabase branch/project, or a guarded staging run.
3. **Review and, if approved, apply all seven staged migrations.** Follow
   the "Canonical staging preflight plan" above step by step — it
   specifies exactly how to check what's already applied before touching
   anything, the dry-run, failure/recovery, security, and test steps, and
   what access is actually needed (no secrets in chat, ever).
   (`248_notify_client_on_website_setup_denial.sql`,
   `249_notify_client_on_commerce_customer_request.sql`,
   `250_notify_client_on_file_scan_completion.sql`,
   `251_multi_location_self_serve_addon.sql`,
   `252_fix_location_addon_trigger_conflict.sql`,
   `253_restrict_client_notification_recipient_kind.sql`, and
   `254_deliver_billing_notification_events.sql`) through the
   normal guarded staging workflow (`validate_prelaunch` / `apply_all`
   with the exact confirmation phrase), all in **one** run.
   **251 and 252 must be applied together, in that order** — 251 alone
   leaves the add-on feature functionally inert. **253 and 254 must be
   applied together, in that order (253 first — now guaranteed by
   ascending numbering, not just process discipline), with no
   interruption between them** — applying 254 without 253 already in
   place reopens a client-readable path to an owner-facing notification
   about that same client the moment such a notification is ever created;
   see "Local-file ordering fix — implemented" above for the exact
   mechanism and the verification checklist to run before and after the
   apply. Neither migration's applied status has been independently
   verified against staging — check
   `supabase_migrations.schema_migrations` on the real target database
   first. All seven are currently only staged in the repo, not applied
   anywhere. Once applied: denied clients, Commerce clients receiving new
   customer requests, and clients
   uploading files will get in-app notifications they don't currently
   receive; Growth/Intelligence clients will be able to self-serve
   enable/cancel Multi-Location add-ons for real (see "Multi-Location
   self-serve add-on — implemented" above); and billing events will
   deliver to the correct recipient with the RLS gap already closed.
4. Ask the user whether `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` for
   the staging project may be provided (as container env vars, never
   pasted into chat/source) so `validate-paid-capability-guards-staging.mjs`,
   `npm run test:staging-evidence`, and the remainder of
   `npm run test:release` can actually run to completion. This is a
   decision point, not an autonomous task — do not proceed past it without
   an explicit answer.
5. Consider drafting (only with explicit user approval, never
   autonomously) a migration to drop or properly lock down
   `commerce_cart_items` — orphaned schema found this session: granted to
   `authenticated` but no RLS policy ever written, unreferenced anywhere
   in `src/` or `supabase/functions/`, superseded by the stateless
   cart-payload checkout flow since migration 090. Not urgent (fails
   closed, no live exposure) but worth cleaning up in a future reviewed
   migration pass. Keep applying the audit technique that found five real
   fixes this session (2 SSRF gaps, a timing-attack gap across 10
   functions, a CORS bug, and 3 missing client notifications across the
   launch flow): pick an established safe pattern already used correctly
   somewhere in the codebase, then check every place that pattern
   *should* apply. Treat any remaining older doc claim as unverified
   until re-checked against current source, not as ground truth.

## Resume instruction for the next Claude session

Before doing anything else: read `CLAUDE.md` in the repository root for
standing operating rules, then this file for current state. Then verify
live git state yourself — do not trust this document's SHA blindly:
`git fetch origin safe/checkpoint-autonomy-wave35-sales`, compare
`git rev-parse HEAD` against `git rev-parse origin/safe/checkpoint-autonomy-wave35-sales`
and against `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`.
Once confirmed current, **first check run #218's actual outcome**
(see the progress ledger's last entry at the top of this file — do not
re-dispatch `validate_prelaunch` to get information a completed run
already has), report its migration-list and project-identity output if
not already reported, then resume from the "Next highest-priority safe
tasks" list below, honoring the stop-and-ask gates in `CLAUDE.md`.

## One-time staging setup

1. Review the latest safe checkpoint on the safe branch. Do not merge it to
   `main` yet.
2. Create a separate hosted Supabase staging project. Do not point
   `nxq-staging` at production.
3. Create the GitHub Environment named `nxq-staging` with:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_DB_PASSWORD`
4. Add the Edge secret names required by `business-prelaunch` to the
   staging Supabase project. This profile checks every Business launch
   secret except `NXQ_AI_MODEL_PROVIDER_TOKEN`. `NXQ_RUNTIME_ENVIRONMENT`
   must have the value `staging`. Print the exact names without values
   with:

   ```bash
   node scripts/edge-function-manifest.mjs --profile=business-prelaunch
   ```

   The local machine check is authoritative for manifest/auth consistency:

   ```bash
   npm run test:runtime-stage
   ```

   The shared AI model provider requires exactly these four protected Edge
   secret names:

   - `NXQ_AI_MODEL_PROVIDER_URL`
   - `NXQ_AI_MODEL_PROVIDER_TOKEN`
   - `NXQ_AI_MODEL_PROVIDER_MODEL`
   - `NXQ_AI_MODEL_PROVIDER_PROTOCOL`

   For an OpenAI Responses configuration, set the URL to the provider's
   Responses endpoint and the protocol to `openai_responses`. Store the API
   key only in Supabase Edge secrets; never paste it into chat, source,
   logs, workflow inputs, or a committed environment file. The selected
   model must support strict structured outputs.

   Provider readiness also uses two first-party, protected adapter
   functions. Point each adapter URL at the matching function in the same
   staging project and use a separate randomly generated adapter token.
   Never reuse the automation worker token or place any value in source,
   GitHub workflow inputs, or chat.

   Notification delivery requires:

   - `NXQ_NOTIFICATION_ADAPTER_URL` → the hosted `notification-provider-adapter` function
   - `NXQ_NOTIFICATION_ADAPTER_TOKEN`
   - `NXQ_RESEND_API_KEY`
   - `NXQ_NOTIFICATION_FROM_EMAIL`

   Malware scanning requires:

   - `NXQ_MALWARE_SCAN_ADAPTER_URL` → the hosted `malware-scan-provider-adapter` function
   - `NXQ_MALWARE_SCAN_ADAPTER_TOKEN`
   - `NXQ_CLOUDMERSIVE_API_KEY`

   The default Cloudmersive adapter limit is 3,500,000 bytes so the
   evaluation tier fails closed before an unsupported upload. A later paid
   plan may use the optional `NXQ_MALWARE_ADAPTER_MAX_BYTES`, capped by NXQ
   at 100 MiB. File access remains restricted unless the provider returns
   valid clean evidence and the independently computed SHA-256 matches.

   Merely adding these names cannot make readiness green. Notification
   readiness requires a real successful delivery within 30 days.
   File-security readiness requires real provider success plus a released
   clean scan within 30 days. The generic provider-health worker
   deliberately preserves those activity-owned statuses instead of
   fabricating health from configuration.

5. Before the real AI key is available, run **NXQ Manual Supabase Stage**
   with action `validate_prelaunch`. It links staging, dry-runs migrations,
   and proves every other launch secret name is present without changing
   the database.
6. Run `validate_zero_key` while the challenge, malware-scan, and external
   notification providers are intentionally unavailable. This validates
   the existing public analytics/lead endpoints and fingerprint salt
   without accepting fake adapter values. `validate_prelaunch` must
   continue to fail on those nine adapter/provider names until real
   providers are connected.
7. Run `validate_non_ai` while using the temporary staging fallback. Only
   after the real provider token is added should `validate` and
   `apply_all` be allowed to pass. `apply_all` requires confirmation
   `APPLY-NXQ-SUPABASE-STAGING`; confirm every pending migration is
   included before deploying the client portal and changed Edge functions.
8. Sign into the staging Owner Portal, open **Launch readiness**, and
   choose **Configure staging runtime routes**. Confirm the exact phrase
   shown by the dialog.
9. Refresh Provider Health and request checks for the configured
   providers. Missing provider secret names stay visible; no secret value
   is displayed.
10. Re-check provider capacity before retrying any pending preview. Do not
    blindly create a replacement site or deploy if Netlify build credits
    are exhausted.
11. Start one disposable DENY-path QA run and prove zero infrastructure.
12. Start disposable APPROVE-path QA runs one at a time until ten strict
    external runs pass. Do not count local simulations as external
    evidence.

## Plug-in-and-launch sequence

When Netlify production deployments resume and the model-provider token is
available:

1. Add or replace only `NXQ_AI_MODEL_PROVIDER_TOKEN` in protected Supabase
   Edge secrets. Never place it in GitHub, chat, source, logs, or workflow
   inputs.
2. Run `validate`; it must pass the strict `business-external-qa` profile.
3. Run `apply_all` with the exact staging confirmation, then configure
   staging runtime routes from Owner Launch Readiness.
4. Prove a real provider call and healthy worker/provider evidence.
5. Complete one DENY-path run and ten consecutive APPROVE-path external
   runs without duplicate infrastructure, crossed tenant data, or manual
   rescue.
6. Review the production change, provide explicit owner signoff, and make
   a separate production launch decision. No earlier step merges or
   publishes production.

## Future one-session provider hookup

NXQ can remain safely staged until the provider accounts are available.
The Owner Portal **Launch readiness** page now carries the same
secret-name-only checklist. It does not collect, store, or display any
secret value.

Prepare the accounts in this order:

1. Under separate staging-mutation authorization, run
   `configure_internal_provider_adapters` with the exact workflow
   confirmation. It derives the four first-party function URLs and
   generates four independent adapter tokens. It sets
   `NXQ_NOTIFICATION_ADAPTER_URL`, `NXQ_NOTIFICATION_ADAPTER_TOKEN`,
   `NXQ_MALWARE_SCAN_ADAPTER_URL`, `NXQ_MALWARE_SCAN_ADAPTER_TOKEN`,
   `NXQ_PROVIDER_HEALTH_ADAPTER_URL`, `NXQ_PROVIDER_HEALTH_ADAPTER_TOKEN`,
   `NXQ_BUILD_PLAN_AI_ADAPTER_URL`, and `NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN`
   together without printing their values. The temporary secret file is
   removed before the job ends. Because the provider-health scheduler may
   begin read-only GitHub/Netlify checks after configuration, do not run
   this action without explicit authorization for those resulting calls.
2. Notification delivery: verify the sender domain and obtain a
   sending-only key. Add only `NXQ_RESEND_API_KEY` and
   `NXQ_NOTIFICATION_FROM_EMAIL` directly to protected Supabase staging
   Edge secrets.
3. Malware scanning: obtain a file-scanning key. Add only
   `NXQ_CLOUDMERSIVE_API_KEY` directly to protected Supabase staging Edge
   secrets.
4. AI classification and planning: choose a strict-structured-output
   model. Add only `NXQ_AI_MODEL_PROVIDER_URL`, `NXQ_AI_MODEL_PROVIDER_TOKEN`,
   `NXQ_AI_MODEL_PROVIDER_MODEL`, and `NXQ_AI_MODEL_PROVIDER_PROTOCOL`
   directly to protected Supabase staging Edge secrets.

Then configure staging runtime routes from Owner Launch Readiness, open
Provider Health, and recheck the connections. Real notification, scanning,
AI, evidence, or QA activity remains a separate explicitly authorized step.
Never put a provider value in chat, source, logs, workflow inputs, or a
committed environment file.

## Production remains blocked

Production still requires the ten strict external staging runs,
healthy provider/worker evidence, recovery proof, owner signoff, a separate
production change review, and an explicit production deployment decision.
The staging workflow cannot merge a branch, publish Netlify production,
change DNS, enable billing, or mark QA evidence passed.
