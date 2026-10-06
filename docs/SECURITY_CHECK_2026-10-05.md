# Security check - 2026-10-05

Scope: local repository at the safe branch tip plus the owner's read-only staging queries. Method:
existing audits, new static access-guard tests, and targeted greps. **Not** a penetration test, not a
review of every RLS policy's logic, and no authenticated browser session was used. Evidence for each line
is the command or test named.

## Results

| Area | Result | Evidence |
|---|---|---|
| Dependencies | 0 known vulnerabilities (dev and prod) | `npm audit` |
| Secrets in the repo | None found (only `.env.example` is tracked) | `git grep` for key shapes; `test:security` |
| Service-role key in browser code | Not referenced anywhere in `src/` | `scripts/test-auth-guards.mjs` |
| Owner pages | All 20 owner elements render inside `OwnerProtectedRoute`; unknown `/owner/*` redirects to the guarded page; `/owner/login` redirects to sign-in | `test:auth-guards` (mutation-checked: removing one wrapper fails it) |
| Owner check | Decided only by an `owner_users` row for the signed-in user; errors and missing rows deny; it reads no billing, plan or payment state | `test:auth-guards` |
| Client pages | 32 of 33 redirect to sign-in; `ClientBusinessDashboard` has no redirect but only calls `current_client_*` RPCs that the database refuses without a session | `test:auth-guards` |
| Row-level security | Enabled on 178/178 public tables; no front-end gap | `test:data-api-grants` (static) |
| Edge function boundaries | 44 functions: 17 JWT-verified, 27 gateway-open each with its own source-level boundary (worker token 12, trusted worker or owner 6, adapter tokens 5, Stripe signature 1, public ingest/form keys 2, upload ticket 1) | `test:edge`, `test:runtime-stage` |
| Outbound requests (SSRF) | Shared guard on 12 functions; the others call fixed provider hosts; verifier refuses redirects and private hosts | `test:security`; code review |
| CORS | Wildcard only on bearer-token (not cookie) functions; public ingest reflects only allowlisted origins | `test:security` |
| Database functions | 278 RPC call sites checked against real EXECUTE grants and argument names | local full-schema test |
| Runtime bug class found and fixed | 7 functions could not resolve pgcrypto on staging; repaired by migration 257 (applied; setting verified on staging) | owner queries, run #232 |
| Prompt injection | Build plan and classifier use strict schemas and allowlists; outreach drafts pass a validator; auto-approval engine uses no AI and no free text | offline tests |

## Residual risks and recommendations (nothing below was changed)

1. **No authenticated browser tests.** Static checks prove the guards exist, not that a real owner/client
   session behaves. Recommended: owner-run login test on staging after the next publish (needs the owner's
   login; never share credentials).
2. **Anonymous table grants (7 tables)** have no anonymous policy, so RLS blocks them today; revoking is
   defense in depth. Needs a migration and approval. **Update 2026-10-06:** draft migration `docs/drafts/migrations/05_revoke_anon_table_grants.sql` written and locally tested (not applied; needs approval). (activity_logs, client_intakes, client_messages,
   clients, owner_ai_messages, owner_approval_requests, projects.)
3. **RLS policy logic** is checked for presence (178/178) and by earlier tenant-isolation validators, not
   re-reviewed line by line today.
4. **Wildcard CORS** on bearer-token functions is accepted by design; could be narrowed to the site's
   origins later (low).
5. **Edge functions are not type-checked locally** (no Deno here); changes are syntax-checked and tested
   with fakes only, and take effect only after a guarded deploy.
6. **Third-party hosting settings** (Supabase auth settings, GitHub environment secrets, Netlify) were not
   inspected and cannot be from here.
7. **Outreach** remains disabled by default (emergency stop on, review-only, delivery off); a lawyer must
   review templates before any real send.

## Lockout analysis (owner access)

Owner access depends only on (a) being able to sign in at `/portal/login` with the owner email and (b) a row
in `owner_users` for that auth user. Billing, plan, Stripe and client status are not consulted. Ways it could
be lost: losing access to the owner email account, deleting the auth user or the `owner_users` row, or
changing Supabase auth settings. Recommendations: keep the email account's recovery options current, and
later (with approval) add a second owner account as a backup. No refactor in this session touched the
owner guard; `test:auth-guards` now fails if its shape changes.
