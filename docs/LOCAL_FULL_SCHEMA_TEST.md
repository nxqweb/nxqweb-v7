# Local full-schema test (disposable Postgres)

`node scripts/test-local-full-schema.mjs` (also `npm run test:local-full-schema`)

Builds a throwaway database from **every file in `supabase/migrations`**, runs focused
contract checks against it, then drops the database. It is a local development aid. It is
**not** a reproduction of staging, **not** external QA, and **not** part of `test:release`.
Passing it says nothing about live behavior.

## Running it

- Needs a running local PostgreSQL (14 or newer) with the contrib extensions `pgcrypto`,
  `uuid-ossp` and `pg_trgm`, and a role that may create databases and roles.
- Connection: standard libpq variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`). If you run
  it as root, set `NXQ_LOCAL_PG_OS_USER=postgres` to run `psql` through `su postgres`.
- It never starts or stops a server and never touches any remote host.
- Exit code: `0` all checks passed, `1` a check or migration failed, `2` environment problem.
- Typical run time: about 12 seconds for 223 migrations.

## Coverage (7 checks)

| # | Check | What it proves | What it does not |
|---|---|---|---|
| 1 | All migrations apply to a fresh database | Every migration file runs, in order, on an empty database (with the stand-ins below) | That the same SQL runs against a database with real data or a different history |
| 2 | Trigger functions reference only existing fields | For every trigger on a public table (96 today), each `new.x` / `old.x` names a column of that table | Fields read through dynamic SQL, `to_jsonb(new)`, or nested function calls |
| 3 | Detector self-test | A scratch schema reproduces the migration-132 defect shape; the check flags it and the insert really fails with SQLSTATE 42703 while a control table works | Other defect shapes |
| 4 | RPC call arguments and EXECUTE grants | Every literal `.rpc("name", {...})` in `src/` and `supabase/functions/` (281 sites) names a function that exists, passes only declared argument names, passes every required one, and the calling role (service role for `admin`/`guardAdmin`/`rpcClient`, `authenticated` for `userClient`, `anon` for `Public*` pages, otherwise `authenticated`) may EXECUTE it | Non-literal argument objects (3 skipped); argument types; behavior |
| 5 | `provision-storefront` static regression | The `nxq_reserve_netlify_build` call passes `target_reservation_key` and not `target_idempotency_key` | That the deployed function matches this source |
| 6 | `nxq_reserve_netlify_build` runtime regression | With fixtures and a service-role claim, the new key returns `ok: true`; the old key raises SQLSTATE 42883 | Netlify, credits, or any real build |
| 7 | Client location insert (migration 256) | A client can call `current_client_create_location` without the 42703 raised by `queue_location_seo_refresh()` | Other location rules beyond what that call exercises |

Check 2 has one allow-listed hit, with a written reason in the script:
`enforce_and_record_commerce_usage` reads `new.file_size` inside an IF branch that only executes
for `commerce_product_media`, and PL/pgSQL resolves fields per statement when it first runs.

## Stand-ins and exactly how this differs from staging

Applied from `scripts/sql/local-full-schema/stubs.sql` into the disposable database only:

- `pg_cron`, `pg_net`, `supabase_vault`: the migrations' `create extension` statements for these
  three are replaced **in memory** by no-ops (the migration files are not edited): 22, 13 and 17
  statements today. `cron.schedule` and `net.http_post` do nothing. `vault.secrets` is a plain-text
  table. No scheduled job ever runs and nothing is encrypted or sent.
- `auth` and `storage`: minimal tables and the functions `auth.uid()`, `auth.role()`, `auth.jwt()`
  (read from `request.jwt.claim.*` settings) and `storage.foldername()`. Real Supabase auth, storage
  policies, and PostgREST request handling are absent.
- `extensions.digest` wraps pgcrypto's `digest()`.
- Roles `anon`, `authenticated`, `service_role`, `authenticator` are created if missing and dropped
  afterward **only if this run created them**. Roles that already existed are left alone.

### Migration 197 (explicit Vault dependency)

Migration 197 requires two Vault secrets that exist only in a configured Supabase project:
`nxq_automation_edge_url` and `nxq_automation_worker_token`. It cannot succeed on an empty database.
The script does **not** skip it. It seeds two clearly marked placeholder secrets immediately before
197 (`https://disposable-local-placeholder.supabase.co/...` and a fake token), applies 197 as written,
and prints that it did so. Consequence: 197's *structure* (the Vault route rows it writes) is applied,
but every route value points at the placeholder host and is not staging's. Nothing in this script reads
or needs any real secret.

## Not covered at all

Row-level security behavior under real PostgREST and real JWTs; storage policies; Vault encryption;
cron and `net` behavior; Edge Function runtime and deployment state; extension and Postgres versions
on Supabase (local is whatever you run; development used 16); migrations applied in a different order
or on existing data; the default privileges Supabase applies to new tables; any provider (GitHub,
Netlify, Stripe, Resend, Cloudmersive, AI). The 10 clean external QA runs and owner sign-off are not
replaced by this.

## Cleanup behavior

The script drops its database and any roles it created, and verifies the database is gone. It leaves no
files outside the repository. It does not stop the Postgres server it ran against. If it is
interrupted (Ctrl-C) it attempts the same teardown.
