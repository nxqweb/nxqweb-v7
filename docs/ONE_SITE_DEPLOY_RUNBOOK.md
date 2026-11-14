# The ONE site deploy: runbook (written 2026-10-28)

One production build costs 15 of your 300 Netlify credits, so everything waits and ships together. Staging database is already up to date (migrations through 285, 45 functions deployed). This deploy only puts the new SCREENS on the site.

## Before you start (nothing here costs credits)
- [ ] OPTIONAL: the candle helper has added products, photos, payment link and Website content. Not required first: products load live with no build, so the site can deploy before them (the store says "opening soon" until they are switched live).
- [ ] Netlify credits: you have at least 15 left (Netlify -> Team -> Billing).
- [ ] You tell Claude "ready to deploy". Claude then: fetches `origin`, confirms the branch tip, runs `npm run test:ci-parity` (must be 73/73) and `node scripts/preflight-deploy-day.mjs` (the only allowed failure is a dirty tree before the trigger commit).

## The four steps
1. **You:** Netlify -> the site -> Site configuration -> Build & deploy -> turn builds back ON (auto-publish stays however you left it).
2. **Claude:** pushes ONE trigger commit to `safe/checkpoint-autonomy-wave35-sales`. Netlify starts one build (15 credits).
3. **You:** when the build is green, open Deploys -> Publish deploy (if auto-publish is off).
4. **You:** Netlify -> turn builds OFF again. Tell Claude "builds stopped".

## What appears on the site after publishing
Client side: "My assistant", "Where visitors look", Booking, Members, "Customer requests", the paused/cancelled notice. Public side: the store page with her Website content, "Request a custom order", the paused-store notice, `/book/<slug>`. Owner side: `/owner/client-lifecycle` (Pause, Cancel, take-down to-do, free first month).

## Smoke test right after (Claude checks the first four with you, 5 minutes)
- [ ] `/store/<her-slug>` loads, products and photos show, no "paused" notice.
- [ ] Add a product to the cart and reach checkout; the payment link opens (do NOT pay).
- [ ] `/store/request?store=<her-slug>` loads and the picture/link box works.
- [ ] `/owner/client-lifecycle` loads for you with no red error (it shows empty lists at first, that is correct).
- [ ] Pause test (reversible): Pause a TEST client with a reason, open that test store: banner shows, no cart; Resume: normal again. Never pause her.
- [ ] One real practice order on her store, then tell her to mark it done.

## If something looks wrong
Do not rebuild (credits). Tell Claude exactly what you see (screenshot); most fixes are one batched commit, built only when you decide.

## Still owner-only after this deploy (not blocked by it)
Resend email account (no automatic emails to clients or shoppers yet), live Stripe, AI key, production Supabase, production malware-scanner key (not needed for staging: Scanii already works there), lawyer review, ten clean end-to-end runs, a bigger Netlify plan.

## Deploy log
- 2026-10-29: the ONE build was triggered by the commit that added this line (after migrations 285 and 286 were applied to staging; Netlify showed 225 credits before the build, so expect about 210 after). Owner publishes by hand (Auto Publishing is locked), then turns builds OFF.
