# Draft UI wiring (not compiled, not in src/)

CI rejects any `.rpc("name")` in `src/` or `supabase/functions/` whose function is not in a real migration (`supabase/migrations/`). Draft migrations are
not real yet, so the pieces that talk to draft functions live here until the owner approves the migration. Everything else (pages, helpers, tests) is already
in `src/` and `scripts/`, fully tested, and **not reachable by any route or menu link** until the steps below are done.

## Reviews collector ("Get more reviews")
Database draft: `docs/drafts/migrations/05_reviews_collector.sql` (+ `.test.sql`, passes the local full-schema harness).
Built and tested: `src/pages/ClientReviews.tsx`, `src/components/ReviewQr.tsx`, `src/lib/{qrCode,reviewLink,reviewCard,reviewsGateway}.ts`, `scripts/test-reviews.mjs`, `scripts/test-qr-code.mjs`,
browser check `scripts/manual/reviews-e2e.mjs` (harness page `scripts/manual/harness/reviews.html`).
To go live (each step is an owner decision/approval):
1. Approve promoting draft 05 to the next migration number, then the guarded `apply_migrations` run (validate_foundation first).
2. Copy `docs/drafts/ui/reviewsSupabaseGateway.ts` to `src/lib/reviewsSupabaseGateway.ts`.
3. In `src/App.tsx` add a lazy route `/client/reviews` that renders `<ClientReviews gateway={createReviewsGateway(supabase)} />` when Supabase is configured (pass `null` otherwise), and add a "Get more reviews" link on the client portal.
4. Decide which plans include it (open question in `docs/NEXT_PRODUCT_PLANS.md`), then deploy the site.
5. Re-run `npm run test:ci-parity`, `node scripts/manual/reviews-e2e.mjs`, and the axe scan.

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
