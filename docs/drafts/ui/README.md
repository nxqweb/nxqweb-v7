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
