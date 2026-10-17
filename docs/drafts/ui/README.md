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
