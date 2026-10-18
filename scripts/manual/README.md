# Manual browser checks (not run by CI)

These scripts drive the real app in a headless browser against a MOCKED Supabase (every network call is intercepted, nothing real is
contacted). They found real bugs on 2026-10-16 (dialog closing itself in dev mode, a link with a wrong ARIA role, a blank dashboard on
malformed data). They need Playwright and a browser, so they are not part of `npm run test:ci-parity`; run them by hand before a release.

## Run

1. Start the app with fake Supabase settings (any URL works because the scripts intercept it):
   `VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock-anon-key npx vite --port 5199 --host 127.0.0.1`
2. In another shell (the Playwright in `/node-tools` and Chromium in `/opt/pw-browsers` exist in the cloud container; elsewhere set
   `PW_FROM=<dir containing node_modules/playwright>/` and `CHROMIUM=<path to chrome>`):
   - `node scripts/manual/store-e2e.mjs` : 24 behaviour checks on the public store (dialog, keyboard, stock limits, cart memory, deep link,
     form help, calm errors, order). Exit code 1 if any fail.
   - `node scripts/manual/a11y-scan.mjs <path to axe.min.js> '<json list of pages>'` : axe-core accessibility scan. Install axe once in a temp
     folder (`npm i axe-core`), never in this repo. Example pages: `[{"path":"/store/x","width":390},{"path":"/client/commerce","signedIn":true,"width":390}]`.
   - `node scripts/manual/mobile-overflow.mjs <output folder>` : screenshots and sideways-overflow check of every client Commerce page at
     390px and 360px with a mocked signed-in client.

Do not point these at a real project: they only make sense with the mocked responses built into each script.

- `store-email-e2e.mjs`: order-by-email checkout in a real browser. `MENU=1` runs the menu-mode store, `NO_MODE=1` runs a database without the feature. `SHOT=file.png` saves a screenshot.
- `portal-help-e2e.mjs`: the portal assistant, Report a problem and the "?" help words in a real browser (needs the dev server and a mocked backend, like the other scripts here).
- `reviews-e2e.mjs`: the "Get more reviews" page via the in-memory harness `harness/reviews.html` (no network at all). Set `ZXING_DIR=<folder where you ran pip install --target . zxing-cpp numpy pillow, with the packages under a pyqr/ subfolder>` to also DECODE the QR code drawn on screen and compare it with the link.
- `booking-e2e.mjs`: the Booking request page and the business manager via `harness/booking.html` (one shared in-memory database, so a customer's request shows up on the manager page). Covers validation, double-click, honeypot, filters, delete, setup from scratch, closed/off pages, calm failures, 360px width.
- `shopper-journey-e2e.mjs`: the whole shop journey in real browsers over ONE shared in-memory store (no network): a shopper orders (price and stock come from the 'database', not the browser), the signed-in owner sees the order, confirms payment, adds tracking and sees it after a Refresh, the next shopper sees the reduced stock and cannot oversell, sold-out and duplicate-line refusals, and the email-ordering mode (prepared email, nothing reserved). `SHOT=dir` saves screenshots. The mock copies what the real order function does; the SQL has its own tests.
- `membership-e2e.mjs`: the Members page via `harness/membership.html` (in-memory database that copies the SQL rules): empty start, tiers, members, duplicates, edit, remove, filters, search, calm failures, 360/390px, `AXE=` scan.
- `../smoke-live-site.mjs` (`npm run smoke -- <https address> [store-slug]`): READ-ONLY check of a LIVE site (GET only, no login): public pages, built assets and their types, every netlify.toml security header with the same value, no caching of the home page. `--self-test` (also `npm run test:smoke-script`) plants bugs to prove each check fails. Rehearse it locally against `serve-dist.mjs`.
- `examples-e2e.mjs`: `/examples` and the five example sites in a real browser. Run it against a PRODUCTION build served with `serve-dist.mjs` (the dev server answers `/examples/<name>/` with the app's home page; Netlify serves the real static pages). Checks the cards, screenshots, banner, theme, noindex, 360px, CSP-blocked resources and axe. `example-thumbs.mjs` regenerates the screenshots.
- `funnel-e2e.mjs`: the "stranger becomes a client" walk against a mocked Supabase: home, plans, signup (every plain-language error, then a good signup with its payload), check-email, referral link, login, the legal pages, anchors, 360px overflow. `AXE=<path to axe.min.js>` adds an accessibility scan per page.
- The harness pages (`scripts/manual/harness/*`) are served only by the dev server and are never part of the production build. Start the dev server first (see Run above), then run the script.
- `reviews-route-e2e.mjs`: the REAL `/client/reviews` route against a mocked Supabase (signed-out redirect, the exact database call and argument names, saving, the card, the portal link, axe with `AXE=`).
- `serve-dist.mjs` + `prod-rehearsal.mjs`: deploy-day rehearsal. Build a copy of the site against a mocked Supabase (`VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock-anon-key npx vite build --outDir /some/folder --emptyOutDir`), serve it with `node scripts/manual/serve-dist.mjs /some/folder 5300` (single-page fallback plus the exact security headers from `netlify.toml`, including the Content-Security-Policy the dev server does NOT apply), then `BASE_URL=http://127.0.0.1:5300 node scripts/manual/prod-rehearsal.mjs` opens ~36 public and signed-in pages and fails on any blocked script/style/connection or page error (`ONLY=/plans` limits it). The other browser scripts also accept `BASE_URL` and pass against this production build. `npm run preflight` runs all of it in one go.
- The accessibility scanner is loaded with `page.evaluate`, not an inline script tag, because a production Content-Security-Policy correctly blocks inline scripts.
