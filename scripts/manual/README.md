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
