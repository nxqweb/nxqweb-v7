# NXQ-Web handoff — upload this file to a new chat (written 2026-10-15, end of a long session)

Repository `nxqweb/nxqweb-v7` · work ONLY on branch `safe/checkpoint-autonomy-wave35-sales` (never `main`).
Owner style: gen-z, nice, honest, smart, helpful; concise; no long outros; real forks offered as Option A/B/C (or the AskUserQuestion pop-up).

## First steps for the new session (do these before anything else)
1. Read `CLAUDE.md` (standing rules) and `docs/NXQ_RUNTIME_HANDOFF.md` (live state; canonical launch checklist near the top; the newest dated entries for 2026-10-15 are right above the "LATEST UPDATE — 2026-10-05" heading).
2. Verify git yourself, do not trust a stale checkout: `git fetch origin safe/checkpoint-autonomy-wave35-sales`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/safe/checkpoint-autonomy-wave35-sales`. Last verified tip before this handoff commit: `6a27bdd7bd672597fba7d7161b05990e1f6f463a` (the handoff commit sits on top of it). Working tree was clean.
3. Ask the owner for news first: has the candle friend signed up? Is it Oct 22 or later (Netlify credits reset)?
4. Never ask for or accept secret values in chat.

## What this project is (one paragraph)
NXQX-Web: a Vite+React+TS app on Netlify (`nxqweb-v9-staging`) with a Supabase staging project (`nxqweb-staging`) and GitHub Actions for guarded staging changes. Clients sign up, get a website built (Business plans) or an online store (Commerce plans). The owner has NO payment card, so anything needing one is blocked (verified email domain, paid plans, AI key, Stripe billing).

## Where things stand (2026-10-15)
**Migrations 248–268 are all applied to staging.** 268 (shopper accounts) was applied today: dry run #257 listed exactly 268, apply #258 log shows "Applying migration 268_shopper_accounts.sql... Finished supabase db push." Remaining drafts in `docs/drafts/migrations/` (the older `01_outreach_inbound_and_unsubscribe` and `02_owner_client_directory_v2` are also still unpromoted): `03_journey_nxqx_wording` (visible text NXQ→NXQX + new support address; tested, awaiting owner approval, would be the next number) and `04_store_order_number_prefix` (customer-facing order numbers use the store's own prefix instead of `NXQ-`; tested; **owner chose to HOLD it until the candle client is set up; do not promote or apply without a fresh explicit yes**).

**Commerce works end to end (owner rehearsal on test client "Email Test Tree Service 2", `nxqweb+client2@protonmail.com`, now on NXQX-Commerce · Growth):** plan change approved → setup → product → live store with a fake Stripe link → store page → cart → order → "Continue to Stripe" → order shown in the client's Orders. Test order `NXQ-9E963B25` is still New/Pending and holds 1 unit of stock (cancel it in Orders if tidying).

**Code built and pushed today (all tested, NONE deployed — needs the Oct 22+ main-site deploy):**
- Commerce launch guide: the Tutorial page is now a replayable 6-step guide (setup, product, live store, open store, practice order, confirm payments) with a dashboard reminder (`src/lib/commerceLaunchGuide.ts`).
- White-label: public store pages never name NXQX except a small "Website by NXQX-Web" line at the bottom (`StoreCredit`).
- Shopper accounts (optional, off by default per store): `/store/<slug>/account`, autofilled checkout, order history, owner on/off switch on `/client/commerce/live`. Signed-in calls live in `src/lib/shopperApi.ts` (NOT inside `Public*` pages; see lessons).
- Per-order payment links (`src/lib/paymentLinks.ts`): PayPal.me and Venmo links carry the exact total; Stripe links carry order number + email but Stripe cannot take an amount.

**Candle-business friend (the real first Commerce client, free of charge):** the owner SENT her the signup message with `https://nxqweb-v9-staging.netlify.app/portal/signup`. She signs up with her own official email (keeps the account at launch), confirms email, picks a Business plan (Commerce is not publicly selectable; the owner switches her), fills the setup sheet. The owner is waiting for her. When she signs up, walk the owner through, ONE click/statement at a time: (1) Supabase Auth → Users shows her confirmed email; (2) approve her website setup in the owner portal (never edit `clients.status` by hand); (3) complimentary billing per `docs/OWNER_COMPLIMENTARY_BILLING_ACTIVATION.md` (owner pastes the SQL block; one statement at a time; QA-only clients cannot be activated); (4) approve her plan change to Commerce Growth at `/owner/plan-changes` with $0 one-time fee and an owner note; (5) she follows the launch guide. Her store is only reachable on the staging address until the main-site deploy.

## Hard rules in force (see CLAUDE.md for the full list)
- Stop and ask before: workflows, migrations (promote AND apply), external services (Supabase/Netlify/GitHub/Stripe/DNS/providers), secrets, deploys, payments/billing, destructive actions. **Treat ambiguous replies ("IDC", "alrt bet") as NOT approval** — today the harness blocked me for writing "owner approved" into a repo file after "IDC"; I had to ask a clear question. Get an explicit yes tied to the specific action.
- Workflow dispatch is allowed only for an action the owner approved in the current chat: always read-only `validate_foundation` first, read the "Migration dry run" log yourself, apply only if it lists EXACTLY the approved migration(s), then `apply_migrations` with confirmation phrase `APPLY-NXQ-SUPABASE-STAGING`. Give the owner the direct run URL; the owner clicks "Review deployments → nxq-staging → Approve and deploy" each run (never do or work around it). Read the log afterwards and report the "Applying migration" lines, not just the green check.
- Before EVERY push: `set -o pipefail; npm run test:ci-parity` (64 commands) and check the exit code. Also run the local schema harness after any change that adds or moves an `.rpc(` call or a migration: `pg_ctlcluster 16 main start; NXQ_LOCAL_PG_OS_USER=postgres node scripts/test-local-full-schema.mjs` (currently 29/29). CI parity does NOT include the harness; today I pushed shopper pages that failed it and only noticed later (fixed in `131250f`).
- Every new test gets a negative control (plant the bug, watch it fail, restore).
- Public store pages: no "NXQ" wording except the credit line; no card details anywhere; guest checkout must never depend on accounts.
- Migration routine: draft in `docs/drafts/migrations/` + sidecar test → harness with negative control → promote to `supabase/migrations/NNN_*.sql` + test to `scripts/sql/local-full-schema/regression/` → `node scripts/check-migration-integrity.mjs` (currently 235) → parity → push → read-only validate → apply.
- Report after each task: exact files, exact check results, commit SHA + push result, uncertainties, checklist movement only if a real row changed. End chats pointing at the canonical launch checklist in `docs/NXQ_RUNTIME_HANDOFF.md` (never invent a percentage) plus a short done/left checklist.

## Netlify and deploys (read before promising anything live)
Free plan, 300 credits/month; a production deploy costs 15; the cycle resets **Oct 22**; production deploys are paused (credits exhausted: 21 deploys / 315; the remaining credits only keep sites online). Branch previews are free (proven twice): owner clicks "Activate builds" on `nxqweb-v9-staging` (Auto Publishing stays Locked), Claude pushes ONE commit, owner opens the Preview link on the "Branch deploy" line, owner clicks "Stop builds"; never "Publish deploy" unless planning a real deploy. **Always get a FRESH credit reading from the owner**; an old number caused a mistake earlier.

## Waiting / blocked / open
- **Oct 22+:** owner reads fresh Netlify credits; then (a) one Supabase `deploy_functions` run for pending function fixes (Netlify `stop_builds` for Business/Commerce in `provision-project-infrastructure` and `provision-storefront`, claim-free copy, analytics-ingest path privacy), (b) one main-site production deploy for today's pages, (c) retry QA run #4 (`QA-16A49D9B4A3E`, job `provision_project_infrastructure` queued 1/5; **do NOT dispatch workers before the function deploy**), then QA runs 5–10 (1 of 10 clean so far).
- Shopper accounts before real shoppers: add the shopper account URL pattern to Supabase Auth → URL Configuration (owner's setting; otherwise the confirm link lands on the main site), keep "Confirm email" ON, and Supabase's built-in confirmation email is rate-limited (needs the verified email domain = card). Shopper "forgot password" is built (2026-10-16, not deployed): the reset email returns to the same account URL, so the SAME Supabase redirect entry covers sign-up confirmation and reset; the reset email is also sent by the rate-limited built-in mailer.
- Stripe amount: Payment Links cannot carry an amount; the guide/Live page tell the owner to use the "customers choose what to pay" option if the account offers it. UNVERIFIED wording/availability; check in her Stripe dashboard.
- Known product friction (from the rehearsal): putting the Stripe link in the Primary product image box made "Make visible" fail with only a generic error (root cause found 2026-10-16: migration 114 only accepts photos the client uploaded on the Photos page; fixed in code, not deployed; owner may want the box removed entirely); Live-store name is separate from the setup-form name; generic red errors hide the real reason.
- `NXQ-` still appears in customer order numbers until the held migration is applied.
- Remove the temporary "Activate billing (no charge)" button on `/owner/billing` before launch (see `docs/LAUNCH_HARDENING_CHECKLIST.md`).
- Card-blocked: verified email domain (Resend delivers only to the owner's exact address until then), AI provider key, Stripe, paid Netlify plan. Real GitHub template repo `nxq-business-template` still needs the claim-free copy + path-only analytics (external-service change, owner approval).
- Owner hardening: GitHub passkey done; secondary email, recovery codes, and checking team lists for the lost Proton address on GitHub/Netlify/Supabase/Resend are still open. Recovered, usable: NXQweb@protonmail.com (owner login, support address), Nxqwebtester@protonmail.com.

## Next 3 highest-priority safe tasks
1. **When the candle friend signs up:** run the five-step onboarding above, one click at a time; write friction found into the handoff.
2. **On Oct 22 or later (after the owner reads fresh credits):** the deploy sequence above, then a real shopper sign-up/sign-in test in a private window and set the Supabase redirect URL (owner's decision).
3. **Safe local work while waiting:** (done: shopper forgot-password flow, real reason on Live-store errors) (done: image-box root cause found and fixed in code); (only with a fresh yes) promote/apply `03_journey_nxqx_wording`.

## Done / left (this chat)
- [x] Commerce rehearsal passed end to end; friction list written
- [x] Commerce launch guide, white-label credit line, shopper accounts + owner switch, per-order payment links (all pushed, none deployed)
- [x] Migration 268 promoted and applied to staging (log verified)
- [x] Order-number prefix migration drafted and tested; owner chose to hold it
- [x] Harness check broken by my shopper pages found and fixed
- [ ] Candle friend signs up → onboarding
- [ ] Oct 22: fresh Netlify credits → deploy everything
- [x] Shopper forgot-password flow built (local, not deployed)
- [x] Supabase redirect URLs (2026-10-16, owner, seen in a screenshot): `https://nxqweb-v9-staging.netlify.app`, `.../**` (already there, covers every path) and `.../store/**` (added today, redundant but harmless); Site URL unchanged
- [ ] Real shopper sign-up and reset test in a private window (after the deploy)
- [ ] Order-number migration (held), journey-wording migration (awaiting approval), remove temp billing button before launch

## New chat starter (paste this)
"Read CLAUDE.md and docs/HANDOFF_FOR_NEW_CHAT.md in nxqweb/nxqweb-v7, verify live git against origin on safe/checkpoint-autonomy-wave35-sales, then ask me whether my candle friend signed up or if it's Oct 22 yet."
