# NXQ runtime handoff (canonical)

This is the live, authoritative handoff document for `nxqweb-v7`. Read
`CLAUDE.md` first for standing operating rules, then this file for current
state. Update this file, not a new one, at every handoff.

> **Archive:** long historical sections (past audits, the run #214 root-cause trail, the migration
> 252/253 ordering work, the 2026-09-29 release audit and session reports, Multi-Location build notes) were
> moved verbatim to `docs/archive/NXQ_HANDOFF_HISTORY.md` on 2026-10-05. Where text below says "above" or
> "below" about one of those headings, look there. The run ledger, canonical launch checklist, staging
> preflight plan, decisions, blockers, next tasks and setup sections stay in this file.

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

- **Run #232 (`apply_migrations`, HEAD `117d4e6`), 2026-10-05 — APPLIED migration 257 only to `nxqweb-staging`.**
  Owner confirmed the staging project and authorized `apply_migrations` for migration 257 only with the
  exact phrase. Pre-check: owner queries showed 223 applied versions, latest 256 (rows 001-233 matched
  the repo exactly). Dry run: "Would push these migrations: 257_repair_pgcrypto_search_path.sql" (only).
  Apply: "Applying migration 257_repair_pgcrypto_search_path.sql... Finished supabase db push". No
  function deploys, no secrets, no billing. Job result: success. Follow-up: the owner's `pg_proc` query confirmed all seven functions now carry
  `search_path=public, extensions`. Not yet verified by a runtime call.

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

**B. Migrations 248-257 — all applied to staging (`nxqweb-staging`): 248-254
in run #220, 255 in run #223, 256 in run #228, 257 in run #232. Not applied to production
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
- [x] 257 — repairs the pinned `search_path` of 7 functions that call pgcrypto unqualified (pgcrypto is in
  the `extensions` schema on staging); applied to staging in run #232 (dry run listed only 257; apply
  succeeded). **Setting verified on staging** (owner's read-only `pg_proc` query, 2026-10-05: all seven
  functions show `search_path=public, extensions`). Not yet exercised by calling the functions.

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
  batch pushes and pause builds in between. **Builds were set to "Stopped" by the
  user on 2026-10-02** (Project configuration > Developer settings > Build
  settings > Build status); to publish later, set "Active builds", let the
  safe-branch deploy build, then "Publish deploy". Do not use the Netlify
  "Claude Agent" box on the project overview. Remaining items shown on the pages
  are stale (pre-migration-233 `pd.published_url` errors, old
  Netlify-credit/backup alerts) or expected (AI provider not configured).

**Reading this honestly**: section A is essentially complete for what's
been built. Section B is applied to staging (248-256). Section C is the real
distance to launch, and none of it is something local code work can close —
it is credentials, external provider setup, and the 10-run QA/signoff
process, all requiring your action outside this session.

## Code organization + security check (2026-10-05, local only)

- Shared display formatters in `src/lib/format.ts` replace 13 local copies (tested equivalent; routes
  67/67 OK; frontend only reaches the live site on the next Netlify publish).
- Session-guard sharing was deliberately NOT done (about 8 different shapes, lockout-risk zone). Instead
  `npm run test:auth-guards` pins the access guards (owner routes wrapped, owner check shape, client
  redirects, no service-role key in `src/`); mutation-checked.
- `docs/SECURITY_CHECK_2026-10-05.md`: results, residual risks, and the owner-lockout analysis (owner
  access = sign-in + an `owner_users` row; billing is never consulted). Recommended follow-ups there:
  owner-run authenticated login test on staging after the next publish; optional anon revokes (needs a
  migration and approval); a backup owner account (later, with approval).
- Release gate unchanged: 1,273 PASS, stops at `protected-staging-configuration`.

## Client IDs / NXQX account plan and UI redesign exploration (2026-10-05, docs + draft only)

- Client ID idea: the IDs already exist (`clients.client_code` `WEB-...`, `nxq_accounts.nxq_id` `NXQ-...`,
  migration 125). Gap: the owner list does not show/search them. Drafted + locally tested (not applied):
  `docs/drafts/migrations/02_owner_client_directory_v2.sql`. Plan and the "external login later" option:
  `docs/CLIENT_ID_AND_NXQ_ACCOUNT_PLAN.md`. Do NOT change `OwnerPortal.tsx` to call v2 before the migration
  is applied. Local harness 13/13.
- UI redesign exploration: `docs/UI_REDESIGN_PLAN.md` + static prototype `docs/design/premium-home/`
  (not in the build, no `src/` changes). Waiting on the owner's review of the direction.

## Premium UI is now IN THE CODE (2026-10-05, committed on the safe branch; NOT published)

- Owner approved the "Obsidian & Champagne" direction and asked for it to replace the UI while every button keeps
  its destination. Done in `src/`: new `PublicHome.tsx` and `PublicPlans.tsx`, restyled
  `ProductFamilySignupSelector.tsx`, new `PremiumBackdrop` (pulsing NXQX emblem, mounted in `App.tsx` for every
  route except `/store/*`), `PortalPreviewDemo` (illustrative sample data, no backend), `SecurityBand`,
  `TrustedBy` (empty by design, fed by `src/lib/socialProof.ts`), hooks in `src/lib/premiumMotion.ts` and
  `usePageWipe.ts`, and one stylesheet `src/styles/premium-v2.css` loaded last. The same file holds an "app skin"
  for the portals and sign-in pages (dark theme only; light theme and its toggle are unchanged). No routing,
  guard, data-access or form-handling file was touched. Old stylesheets are still in place (validators pin them).
- Checks (all pass): `npm run lint`, `tsc -b`, build, `npm run test:premium-ui` (24 checks: every old
  destination preserved, no guarantee/certification claims, Trusted-by empty, light-theme escape hatch, backdrop
  not on storefronts), `test:auth-guards`, `test:routes`, `test:accessibility` (19/19), brand and launch-truth
  validators, bundle budget, `test:security`; browser check of 68 routes: 0 errors, 0 horizontal overflow.
  Release gate unchanged (1,273 PASS, stops at `protected-staging-configuration`).
- It is NOT live. Netlify builds are stopped; to see it live: set Active builds, let one safe-branch deploy build,
  Publish deploy, stop builds again. After publishing, the owner should do one login test.
- Not done: authenticated portal pages were only checked unauthenticated (their data states), not with real data.
  A real-time chart inside the client portal needs a data source and is a later, approved step.
  Plans for the waitlist and the example page: `docs/WAITLIST_AND_EXAMPLE_PAGE_PLAN.md` (no code).
- **PUBLISHED (owner, 2026-10-04 11:39 PM local):** the safe-branch branch deploy `@3581cf1` (premium UI, owner Log out
  button, client "at a glance" graph) was published as the live `nxqweb-v9-staging.netlify.app`. Builds were set back
  to STOPPED. Still to do by the owner: lock the published deploy; one owner login + client login test on the live
  site. Roll back = Publish deploy on the earlier `main@77e9455` deploy. Do not merge PR #11 until intended.
- **Promise audit written (`docs/PROMISE_AUDIT.md`):** every public claim mapped to code. Owner's rule: whatever the site
  promises must be delivered. Gaps: lead-source/funnel insights not found; "live view" is only a table today; preview
  should be labeled as the Growth-plan view. Planned next: real client dashboard from existing tables (no migration needed).
- **Owner requests logged for the next session (2026-10-05, nothing built yet):** (1) owner-portal header: replace the empty
  left area with a real-data graph (clients, income, site views); check owner read access to analytics rollups first (an
  owner RPC would be a migration = gate). (2) Client "Request export" ended `failed` (DSR-D75E4C4ED446); the worker
  `process-data-subject-request` stores `data_subject_requests.last_error` - read it (owner SQL) before fixing; the staging
  dispatcher is also failing, so the worker may not be woken. Verify every function on Security & privacy. (3) Password and
  email change call `supabase.auth.updateUser` with NO current-password check (`ClientSettings.tsx`): add re-authentication
  with the current password first (frontend; Supabase "secure password change" setting is an external-service gate). (4) Owner
  idea "export only after 5 years" - advised against (privacy-law access/portability rights, trust, own domain policy);
  alternatives: free export + paid migration/handoff service, annual prepay, setup fee. Needs a decision + lawyer review.
- **Enterprise public price changed to $300+/mo (owner decision, code only, NOT published):** `productCatalog.ts` now says
  `$300+/mo` and lists "Everything in Intelligence" first; two validators and the capability summary updated. The database
  floor (`nxq_enforce_enterprise_price_floor`, migration 246) is still $150 - raising it is an optional migration (gate).
  Clients now also see their NXQ ID and client ID (with Copy) in the portal "At a glance" card, from the existing health RPC.
- **Founding-client program (owner decision, text-only section built, NOT published):** 5 testers at 50% off for 12 months,
  10 free founding spots under written terms, closes when filled or at 10,000 clients. See
  `docs/FOUNDING_CLIENT_PROGRAM_PLAN.md`. No counter or automatic discount exists; terms need a lawyer; billing, a grants
  migration and free-spot budget handling are later gated steps.
- Netlify (owner, 2026-10-04 evening): builds were ACTIVATED and auto publishing UNLOCKED on `nxqweb-v9-staging`;
  a "Production: main@HEAD" deploy published `main` (old look). Production branch is `main`: merging PR #11 would
  publish everything in it immediately. When done viewing, the owner should Stop builds and Lock the published deploy.
  A safe-branch push builds a Deploy Preview (not published) to view the new look.
- Found while testing (pre-existing, now fixed by CSS only): `.portal-grid` had no rules and link-panels were
  inline, so the Business workspace tiles overlapped.

## Routing, auto-approval engine, drafted SQL, and a suspected pgcrypto runtime bug (local only, 2026-10-05)

- Pure libraries with offline tests, wired into the release gate, NOT deployed, NOT called by any
  function: `_shared/ai-routing.ts` (`npm run test:ai-routing`, 26 checks; tiers, plan gating for
  premium work, cost ceiling, escalate-once, provider failover; reference prices only) and
  `_shared/auto-approval.ts` (`npm run test:auto-approval`, 34 checks; rules only, no AI or free text;
  off/shadow/live modes; `shadowReadiness` for the rollout decision).
- Draft SQL (NOT migrations) in `docs/drafts/migrations/`: `01_repair_pgcrypto_search_path.sql` and
  `02_outreach_inbound_and_unsubscribe.sql`, each with a sidecar test run by
  `scripts/test-local-full-schema.mjs` (now 13 checks, all passing).
- **pgcrypto search_path bug: staging layout CONFIRMED, repair added as migration 257, NOT yet applied.**
  The owner ran `select extname, extnamespace::regnamespace from pg_extension where extname='pgcrypto';`
  on `nxqweb-staging`: result `pgcrypto | extensions`. 7 committed functions pin `search_path = public`
  and call pgcrypto unqualified, so those code paths fail at runtime on staging:
  `nxq_flag_referral_payment_reversal`, `nxq_queue_sales_delivery`, `nxq_record_sales_delivery_event`,
  `nxq_reserve_sales_delivery`, `owner_create_fictional_sales_source_run`, `owner_record_sales_reply`,
  `submit_public_commerce_customer_request` (the upload-ticket branch). Not yet proven by calling the
  functions on staging; reproduced in the local simulation with pgcrypto moved to `extensions`.
  `supabase/migrations/257_repair_pgcrypto_search_path.sql` only runs `alter function ... set search_path =
  public, extensions` on those seven (no body, grant, owner or signature change). Regression test:
  `scripts/sql/local-full-schema/regression/257_repair_pgcrypto_search_path.test.sql` (negative control
  fails with the old path, passes with the new). Adding the file was approved by the owner on 2026-10-05;
  **APPLIED to staging in run #232 (2026-10-05, owner-authorized with the confirmation phrase; head
  `117d4e6`)**: the dry run listed only `257_repair_pgcrypto_search_path.sql` and the apply step reported
  "Applying migration 257_repair_pgcrypto_search_path.sql... Finished supabase db push". Pre-check: staging
  had 223 migrations, latest 256 (the owner's query). Local harness: 11/11 pass; release gate unchanged (1,273 PASS, stops at
  `protected-staging-configuration`).
- The outreach SQL stays a draft: `docs/drafts/migrations/01_outreach_inbound_and_unsubscribe.sql`
  (final number 258 or later on approval; the schedule migration would follow it).

## Outreach delivery orchestration (stage 1, sender logic) — local only, NO Edge function, NOT deployed (2026-10-05)

- New `supabase/functions/_shared/outreach-dispatch.ts`: `runOutreachDispatch` (injected
  dependencies), `buildOutboundEmail` (plain text + sender identity + postal address + opt-out
  line + List-Unsubscribe header), `createResendSender` (fixed host `api.resend.com`, no
  redirects, idempotency key, injected fetch). Uses the EXISTING service-role RPCs
  (`nxq_queue_sales_delivery`, `nxq_reserve_sales_delivery`, `nxq_record_sales_delivery_event`)
  as the authority; adds fail-closed holds, a second compliance check, and cap <= 50.
- Holds everything (queues, reserves and sends nothing) unless: not emergency-stopped, mode
  `guarded`, database `external_delivery_enabled`, a separate server delivery switch, and an
  email provider configured. A reserved job always ends sent/failed; a crash leaves it reserved,
  which cannot send twice. Outcome-recording failure stops the run.
- `npm run test:outreach-dispatch` (30 checks, in-memory fakes) wired into the release gate.
- **Deliberately NOT added:** the Edge function wrapper. Registering a new function in
  `scripts/edge-function-manifest.mjs` / `supabase/config.toml` would make the staging
  "workers_deployed" check expect it before it exists remotely. Add the wrapper together with a
  guarded deploy, a cron schedule (migration) and the secrets.
- **Gaps needing a migration (stop-and-ask):** inbound reply ingestion and automated
  unsubscribe handling (`owner_record_sales_reply` is owner-only, so a service worker cannot call
  it), a cron schedule for the sender, and the Claude readiness widening. Still needed outside
  code: sending domain with SPF/DKIM/DMARC, email provider account, lawyer review of templates.

## Outreach compliance layer, stage 1 groundwork — local only, NOT deployed, NOT wired to sending (2026-10-05)

- New `supabase/functions/_shared/outreach-compliance.ts` (pure functions): draft validator
  (links/domains, markup, deceptive subjects, guarantees, false urgency, claimed prior
  relationship, unverifiable claims, payment terms, prompt/model leaks), audit-finding
  sanitiser (website content is untrusted input), deterministic reply triage
  (unsubscribe / complaint / auto-reply; over-suppresses on purpose), US-only region rule, and a
  send-eligibility evaluator (emergency stop, guarded mode, delivery switch, approved email draft,
  active permission, suppression, do-not-contact, region, sender identity, daily cap <= 50,
  weekday send window in the business timezone; fails closed).
- `draft-sales-outreach-ai` now sanitises findings and validates drafts: a failing AI draft is
  replaced by the deterministic draft; a draft that still fails is blocked (HTTP 422). It never
  sends (`messages_sent: 0`). Takes effect only when that function is redeployed (guarded step).
- `npm run test:outreach-compliance` (47 checks) added and wired into `run-release-gate.mjs`.
- Still NOT built: the sender function, unsubscribe processing, reply ingestion, bounce/complaint
  handling, a sending domain and email provider. Reading of the code found no function that uses
  the delivery, suppression or reply tables. Any real send is an external-service gate.
- Plan: `docs/AI_ROUTING_AND_AUTONOMY_PLAN.md`.

## Claude (Anthropic Messages) protocol added to the AI workers — local only, NOT deployed (2026-10-05)

- New shared helper `supabase/functions/_shared/anthropic-messages.ts` and a new protocol value
  `anthropic_messages` accepted by `generate-business-build-plan` and
  `classify-business-change-request` (set `NXQ_AI_MODEL_PROVIDER_PROTOCOL=anthropic_messages`,
  `NXQ_AI_MODEL_PROVIDER_URL=https://api.anthropic.com/v1/messages`, plus token and model, as
  Supabase secrets by the owner; never in chat). OpenAI protocols unchanged. No new env names.
- Offline test `npm run test:ai-protocols` (22/22) added and wired into `run-release-gate.mjs`.
  Edge functions were syntax-checked only (no Deno in this container); not exercised against a
  live provider.
- **Open gate:** migration 179's readiness function only treats `openai_responses` and
  `openai_chat_completions` as a proven protocol (`provider_protocol_proven`). With
  `anthropic_messages` the workers function, but the AI-readiness check would not become ready
  until a new migration widens that list (stop-and-ask gate: migration + guarded staging apply).
  Redeploying the two functions is also a separate guarded step. The 20s/15s request timeouts
  may need raising for slower thinking models.

## Cloudmersive status (2026-10-03/04) — malware-scanner key still not obtained

- Free-tier signup worked, but the portal showed "Free-Tier Key Creation Limit Reached" with
  no keys on the account, then "User Blocked ... activity not in compliance with our usage
  policy" after the user submitted a support request. Cause unknown. Two support requests
  submitted (2026-10-02 and 2026-10-03/04); no reply yet. User will not use phone contact.
  Email verification attempted; no change.
- Decision (user): Option A — wait until about Wednesday/Thursday (2026-10-07/08), meanwhile
  compare alternative scanners; switch only if no resolution. Do not create a second account
  or use a VPN. Uploads stay safely blocked without a scanner (fails closed); nothing else
  is blocked.
- Switching providers means rewriting `malware-scan-provider-adapter` + provider setup text
  and a guarded staging deploy (external-service gate). Options and trade-offs:
  `docs/UNIT_ECONOMICS_AND_SCALE.md` section 5 (unverified, from memory).

## Owner access and own-site billing (read-only code review, 2026-10-02)

- Owner access is the `owner_users` row for the auth user (`OwnerProtectedRoute.tsx`);
  it does not depend on billing, plan, or Stripe. A client's billing state cannot lock
  the owner out of `/owner/*`.
- A client's own capabilities (builds, etc.) are gated by billing state (paid-capability
  guards, migration 246). Billing is a manual state machine (`manual` provider): the
  owner can set a client's state to `active` (`owner_set_client_billing_state`) or record
  a manual payment (`record_manual_payment_and_restore`, "no card or bank account will be
  charged") from `/owner/billing`. The 14-day job only moves past-due accounts into
  *freeze review*; it never freezes automatically.
- There is no dedicated "comped/free own site" flag. QA-only clients are non-billable but
  disposable. Open product decision: add an explicit owner-owned/complimentary client
  flag (needs a migration -> approval gate) or use manual `active` state.
- Not verified live; code review only. Stripe test mode is still not configured.

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

## Next highest-priority safe tasks (rewritten 2026-10-05; the 2026-10-01 version is in the archive)

Already done since the old list: the two systemic gaps are closed (client billing notifications via
migrations 253/254; `automation_escalations` now read by the Owner Exception Center), and migrations
248-256 are applied to staging (runs #220, #223, #228). `provision-storefront` was redeployed (run #231).

**Waiting on outside parties or the owner (no Claude action possible):**
- Malware scanner key: Cloudmersive support requests sent 2026-10-02 and 2026-10-03/04, account
  showed "User Blocked". Decide around 2026-10-07/08 whether to switch (Scanii has a free trial with
  no card; see `docs/UNIT_ECONOMICS_AND_SCALE.md` section 5).
- **The owner has no payment card.** Anything that needs one is blocked: buying a domain (needed for
  sending email), paid Supabase/Netlify plans, prepaid AI API credits, and similar. Free tiers that
  take no card are fine.
- AI provider key, email domain + Resend, Stripe test mode, Netlify credits, 10 clean external QA
  runs and owner signoff, company name/domain decision, lawyer review of outreach templates.
- Netlify builds are STOPPED by the owner. To publish current code: set "Active builds", let one
  safe-branch deploy build, click "Publish deploy", then stop builds again.

**Safe local work available now (no gate), suggested order:**
1. Final SQL for outreach migration 257, tested only in the disposable local database; NOT added to
   `supabase/migrations/` until approved (`docs/OUTREACH_MIGRATION_PLAN.md`).
2. Pure model-routing library (tiers, escalate-once, cost estimate) + tests
   (`docs/AI_ROUTING_AND_AUTONOMY_PLAN.md` section 1).
3. Rule-based auto-approval engine as pure functions + tests (shadow mode later needs a migration).
4. Code organization steps 3-5 (`docs/CODE_ORGANIZATION_PLAN.md`). `scripts/patch-*` must stay
   where they are: workflows reference them.
5. Waitlist plan (docs only).

**Gated (explicit approval + guarded workflow where applicable):** applying any migration (257, 258,
widening migration 179 for `anthropic_messages`), deploying any function (the AI workers and
`draft-sales-outreach-ai` changed locally), Netlify builds/publish, secrets, any real email, billing.

## Resume instruction for the next Claude session

Read `CLAUDE.md`, then this file. Verify live git state yourself (`git fetch origin
safe/checkpoint-autonomy-wave35-sales`, compare `git rev-parse HEAD`, `origin/<branch>` and
`git ls-remote`). Ask the owner for any news first (did the scanner provider reply? was anything
purchased or configured?). Do not re-dispatch `validate_prelaunch` until a missing key has actually
been set. Then take the first item from "Safe local work available now", honoring the stop-and-ask
gates in `CLAUDE.md`. Run `npm run lint`, `npx tsc -b`, the `test:*` scripts and
`node scripts/run-release-gate.mjs` (expected stop: `protected-staging-configuration`, 1,273 PASS lines
as of 2026-10-05) before pushing code changes.

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
