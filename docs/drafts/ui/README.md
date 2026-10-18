# Draft UI wiring (not compiled, not in src/)

CI rejects any `.rpc("name")` in `src/` or `supabase/functions/` whose function is not in a real migration (`supabase/migrations/`). Draft migrations are
not real yet, so the pieces that talk to draft functions live here until the owner approves the migration. Everything else (pages, helpers, tests) is already
in `src/` and `scripts/`, fully tested, and **not reachable by any route or menu link** until the steps below are done.

## Reviews collector ("Get more reviews"): PROMOTED 2026-10-17 (owner said "promote reviews")
Done: draft 05 became migration `supabase/migrations/273_reviews_collector.sql` (test in `scripts/sql/local-full-schema/regression/273_reviews_collector.test.sql`); the real connection is `src/lib/reviewsSupabaseGateway.ts`; the route `/client/reviews` is wired through `src/pages/ClientReviewsRoute.tsx` (signed-out visitors go to the login page); the client portal header has a "Get reviews" link. Tests: `scripts/test-reviews.mjs`, `scripts/test-qr-code.mjs`; browser checks `scripts/manual/reviews-e2e.mjs` (harness) and `scripts/manual/reviews-route-e2e.mjs` (the real route, mocked Supabase).
Still needed, each an owner decision/approval:
1. Apply migration 273 to staging with the guarded `apply_migrations` run (validate_foundation first). `supabase db push` applies ALL pending migrations, so this ALSO applies 272 (referral credit on invoices: service-role functions, dormant unless `NXQ_REFERRAL_CREDITS_ENABLED`, a Stripe secret key and the referral program are switched on). Owner chose to apply both together on deploy day (2026-10-17, "A. i think"); recorded as a plan, the apply still needs its own approval steps that day.
2. Deploy the site AFTER the apply. If the site is deployed first the page loads but shows a calm "could not be loaded" message until 273 exists.
3. Decide which plans include it (open question in `docs/NEXT_PRODUCT_PLANS.md`).

## Booking v1 ("Appointment requests", request-only)
Database draft: `docs/drafts/migrations/06_booking_requests.sql` (+ `.test.sql`, passes the local full-schema harness; 8 planted bugs caught). Built on the migration-188 Booking tables; none of the 188 guards are weakened:
the owner functions can only set `requested`, `needs_review`, `declined` or `cancelled` (the 188 trigger still forbids `confirmed`), and `launch_enabled` is never touched.
Built and tested: `src/pages/ClientBooking.tsx` (manager), `src/pages/PublicBooking.tsx` (request page), `src/lib/{bookingTime,bookingForm,bookingGateway}.ts`,
`scripts/test-booking-time.mjs`, `scripts/test-booking.mjs`, browser check `scripts/manual/booking-e2e.mjs` (harness `scripts/manual/harness/booking.html`, shared in-memory database, full customer-to-business flow).
To go live (each step is an owner decision/approval):
1. Approve promoting draft 06 to the next migration number, then the guarded `apply_migrations` run (validate_foundation first). Draft 06 builds on 188 (applied earlier) and needs a `projects` row for the client (it refuses with a plain message when there is none).
2. Copy `docs/drafts/ui/bookingSupabaseGateway.ts` to `src/lib/bookingSupabaseGateway.ts`.
3. In `src/App.tsx` add two lazy routes: `/book/:slug` (public, renders `<PublicBooking slug gateway={createPublicBookingGateway(supabase)} />`) and `/client/booking` (renders `<ClientBooking gateway={createOwnerBookingGateway(supabase)} />`, pass `null` when Supabase is not configured); add a portal link; add `/book/` to the public route list and the sitemap/route tests.
4. Product decisions first: which plans include it; whether a business may mark a request "confirmed" by hand (that needs the 188 guard changed, a deliberate governance change); how long request data is kept (privacy text); whether an email alert to the business is wanted (needs the verified email domain).
5. Re-run `npm run test:ci-parity`, `node scripts/manual/booking-e2e.mjs`, the axe scan, and a security review of `submit_public_booking_request` (the only public write surface).


## Membership (draft 08)

Page `src/pages/ClientMembership.tsx` and `src/lib/membershipGateway.ts` are built and tested but NOT routed. The real connection is `membershipSupabaseGateway.ts` here (copy it to `src/lib/` only after migration 08 is promoted and applied). Wiring: route `/client/members` in `src/App.tsx` (`named(() => import("./pages/ClientMembershipRoute"), ...)`, mirror `ClientReviewsRoute`), a "Members" link in `ClientPortal.tsx`, then update `scripts/test-membership.mjs` (`notRouted` and `noSrcRpc` expectations).

## AI Desk save-to-project (draft 09)

Built and tested: panel `src/components/OwnerAiDesk.tsx` (already on the owner screen in its no-server mode: copies a browser-built task and only CHECKS the reply), types + safe parser `src/lib/aiDeskGateway.ts`, the worker side in `supabase/functions/prepare-build-plan` + `supabase/functions/_shared/ai-desk-plan.mjs` (already in source; tolerant of the table not existing, so deploying functions BEFORE the migration is harmless: it behaves exactly as before). Tests: `scripts/test-ai-desk.mjs`, `scripts/test-ai-desk-plan.mjs` (fake database), `scripts/test-ai-desk-gateway.mjs`, browser checks `scripts/manual/ai-desk-e2e.mjs` and `ai-desk-server-e2e.mjs`.
To go live (each step is an owner decision/approval):
1. Approve promoting draft 09 to the next migration number (276 if nothing else lands first), move its test to `scripts/sql/local-full-schema/regression/`, and add it to the guarded `apply_migrations` run. `apply_migrations` applies ALL pending, so on deploy day the dry run would then list 272, 273, 274, 275 AND 276; update `expectedPendingMigrations` in `scripts/preflight-deploy-day.mjs` and `docs/OCT22_DEPLOY_DAY_CHECKLIST.md` in the same commit, and the owner must approve the new list.
2. `deploy_functions` (ships the worker change; nothing happens until the table exists).
3. Copy `docs/drafts/ui/aiDeskSupabaseGateway.ts` to `src/lib/aiDeskSupabaseGateway.ts` and pass `gateway={supabase ? createAiDeskGateway(supabase) : null}` to `<OwnerAiDesk>` in `src/pages/OwnerPortal.tsx`; flip the "no gateway until promotion" expectations in `scripts/test-ai-desk-gateway.mjs`.
4. Re-run `npm run test:ci-parity`, both `ai-desk*-e2e.mjs`, and prove it on staging with the candle client or a QA client: Approve, wait for the task, copy, paste into the AI Desk chat, paste the reply back, Save, and read the worker log for "ai_source: owner_ai_desk".

## Website photos (draft 10)
Built and tested: panel `src/components/ClientSitePhotos.tsx` (in the brief and in the redesign form, only when the one switch is on), rules `src/lib/sitePhotos.ts`, uploader `src/lib/sitePhotoUpload.ts` (uses only functions that already exist), switch `src/lib/sitePhotosConfig.ts` (null now), worker side in `supabase/functions/build-business-website` + `_shared/site-photos.mjs`. The real connection is `sitePhotosSupabaseGateway.ts` here. Exact steps, gates and rollback: `docs/PHOTO_BACKEND_RUNBOOK.md`. Tests: `scripts/test-site-photos.mjs`, `scripts/test-site-photos-ui.mjs`; browser: `scripts/manual/site-photos-e2e.mjs`.

