# Client flow v2: "fill it out once" (owner request 2026-10-18; PLAN ONLY, nothing built yet)

## What the owner wants (in the owner's words, tidied)
1. **Fill out information once.** A client picks a product line (Business now; Commerce, Booking and the others later), fills in their business information, and their account is created. Inside the account there is a **Request a website** button that REUSES everything already typed. No second form that asks the same things again, and no second approval round.
2. **Pay before the build.** The website is built only after the client has paid and pressed Request a website. (Owner's first thought: pay even before the account exists; "but that's alright" if it is before the build.)
3. After the website is built the client enters their domain and uploads whatever else is needed. Nothing is asked twice.
4. **Better questions, clearly optional vs required.** More customization: SEO on/off, **light mode / dark mode**, smooth scroll, and a free-text description of the look they want. Photos are uploaded in the SAME step as the request (one box), so the owner approves once.
5. **Later changes = "Redesign / update my website"**: the same form comes back prefilled, they change what they want, upload new pictures, re-describe the design, submit.
6. **"My work" photos.** For a tree service or granite maker: a spot to upload examples of past jobs; those pictures land automatically in a "My work" section on the site.
7. The same clean flow for **every product line** (Commerce, Booking, ...), so the whole thing feels like a big company.
8. Separately (already built, 2026-10-18): once the AI key exists, the owner's only click is **Approve**; until then it is Approve -> Copy AI task -> paste into the AI Desk chat -> paste reply -> Save (see `docs/AI_DESK_KIT.md`).

## What exists today (checked in the code, 2026-10-18)
- `src/pages/PortalSignup.tsx` asks: business name, contact name, email, password, service area, primary goal, tier goal, and 4 product-specific questions (`intakeQuestions` in `src/lib/productCatalog.ts`: services, best customers, main visitor action, proof). It saves them as account metadata (`intake_*`).
- `src/pages/ClientPortal.tsx` then shows a **website setup sheet** of about 19 more fields (industry, hours, pages needed, style, brand notes, competitors, lead rules, assistant rules, signature...). Only THREE values are prefilled from signup (`src/lib/signupPrefill.ts`: services, area, email). So yes: the client re-types a lot, and the owner approves a second time.
- Photos: a separate Files page (`ClientFiles`) with its own upload; nothing ties a photo to a website section.
- The Business site template (`templates/business-v1`) has four DARK themes only, no light mode, no gallery section, no SEO on/off. Smooth scroll is always on. So light mode, "My work" gallery and the SEO switch are template work, not just form work.
- Payment: Stripe live is parked (spending hold to about July 2027), so "paid" is confirmed by the owner by hand for now (billing status), not by a card form.

## Honest constraints
- Changing what signup/setup stores touches the database and a public contract: any migration is a stop-and-ask gate, and nothing here may break the 22nd deploy day (272-275, plus 276 website photos, promoted 2026-10-18 on the owner's go).
- Photo placement should be deterministic ("My work" uploads fill the gallery in upload order, owner can reorder), NOT decided by an AI: pictures can carry claims (awards, licenses) and an AI cannot verify them.
- Pay-before-build needs the payment step to exist. Until Stripe is allowed, the gate is "owner marked the client paid", and the Request button says so in plain words.

## Proposed phases (each is its own approval; nothing here is applied)
- **Phase 1, front-end only, no migration, safe before the 22nd:** one "Your business" profile collected at signup (stored the way it is today), a short "Website brief" at Request time (style words, pages, light/dark, SEO, smooth scroll, photos) with EVERYTHING else prefilled, one submit that is the approval request (the owner approves once). "Redesign my website" reopens the same brief prefilled.
- **Phase 2, needs a migration (gated, after the 22nd):** store the brief and the photo roles as real columns/tables instead of text in the notes; a payment-confirmed gate on Request.
- **Phase 3, template work:** light mode, SEO switch, optional smooth scroll, "My work" gallery section filled from tagged uploads.
- **Phase 4, other product lines:** a shared "product flow" config so Commerce, Booking, Menu, etc. get the same one-form flow.

## Owner decisions (2026-10-18)
- Pay at **Request a website** (client can fill the brief first; SENDING is locked until NXQX marks the plan active; payment is confirmed by hand while Stripe is parked).
- The website questions live in the **setup brief** (not at signup). Light/dark is for the CLIENT'S WEBSITE, not their portal: Dark / Light / Both (visitors can switch) / NXQX recommends.
- Build **Phase 1 now** (Business only).

## Phase 1: BUILT 2026-10-18 (local, pushed, NOT deployed, no migration)
- Signup asks "What kind of business is it?" (required) and an optional business phone; both are saved with the account and prefill the brief.
- Portal: a **Request your website** card (3 steps: account, plan, request) opens the brief. The brief is prefilled (industry, services, area, email, phone), shows the signup answers back (best customers, main action, proof, goal) and writes them into the report so nothing is asked twice. New **Your website's look** block: colour mode, SEO on/off, smooth scrolling on/off (written into the same signed setup report). Optional lead/assistant rules stay collapsed. What is typed is kept per client on this device (never the signature or agreement) and cleared after sending.
- Payment lock is on the SEND button only, with a plain explanation. The owner screen only DISPLAYS billing (a CI test, `scripts/test-owner-billing-safety.mjs`, forbids the owner screen from being blocked by billing).
- **Redesign my website** (link appears once approved) opens the changes page with a guided form that sends one **design** change request (what to change, style, pages, the same look options). No migration: it reuses `submit_current_client_change_request`.
- Owner approval card groups the new labels (Website colour mode, SEO, Smooth scrolling, "From signup") and shows a Billing label.
- Tests: `scripts/test-website-brief.mjs` (in `npm run test:store`, with planted-bug controls), browser checks `scripts/manual/request-website-e2e.mjs` and `scripts/manual/funnel-e2e.mjs` (updated).

## What Phase 1 could NOT do (honest, found while building)
- **Photos in the same box are blocked by the SERVER.** `nxq_authorize_storage_upload` (migration 246) only allows uploads when the client's status is approved/active/overdue AND billing is active/past_due, so a brand-new client cannot upload before approval. That rule exists to stop free accounts abusing storage. Because the plan is now "pay first", it can safely be relaxed for clients whose billing is already active: a Phase 2 migration (gated, after the 22nd).
- ~~Light mode / Both not built~~ **BUILT 2026-10-18 (Phase 3a)**: see the Phase 3 section below.
- **"My work" photos filling a gallery automatically** needs both of the above.
- **Redesign with new pictures in the same form** has the same upload restriction, so for now it points to the Files card.
- **Redesign through the setup form** is impossible server-side after approval (`submit_current_client_website_setup` only accepts lead / intake_received / needs_owner_review clients), which is why it uses the change-request path.
- The AI Desk task does not yet read the colour-mode line (the template could not honour it anyway); wire it when Phase 3 lands.

## Next phases (each its own approval)
- **Phase 2 (migration, gated, after the 22nd):** allow uploads for paid-but-not-yet-approved clients (storage quota unchanged), photo roles ("Website photo" / "My work") stored as real data, brief stored as columns instead of notes text, a server-side paid check on Request.
- **Phase 3 (template):** light mode + Both switch, SEO on/off, smooth-scroll toggle, a "My work" gallery section filled from tagged uploads (deterministic, in upload order, owner can reorder; never AI-placed).
- **Phase 4:** the same one-flow for Commerce, Booking, Menu and the rest through one shared product-flow config.

## Phase 3a/3b: BUILT 2026-10-18 (local, pushed, NOT deployed, no migration)
- **Site template (`templates/business-v1`)**: light mode (a real palette for all four themes, accent colours darkened for contrast), **Both** with a visitor switch (remembers the choice, starts from the visitor's system setting), **SEO on** = Open Graph tags + LocalBusiness structured data from the client's own facts only, **SEO off** = `noindex, nofollow` and nothing extra, **smooth scrolling** on/off, and an **"Our work" gallery** (config-driven, max 12, only `./gallery/<name>.(jpg|jpeg|png|webp)` paths, captions as plain text, accessible large view). Lead-form inputs follow the theme. Trust strip no longer shows an empty cell with 3 points. axe: 0 WCAG A/AA violations in dark, light, all four themes and the gallery; no sideways scroll at 390/360px.
- **Meaning of the SEO switch (my call, change if you disagree):** On = "list my site and add the search basics"; Off = "ask search engines not to list it". The brief says so in plain words.
- **Plumbing:** the brief's three options travel signed report -> `prepare-build-plan` (`plan.site_options`, set on every plan so changing them never needs a new AI answer) -> `build-business-website` (`design.colorMode`, `site.smoothScroll`, `seo.enabled`) via `supabase/functions/_shared/site-options.mjs`. "NXQX recommends" builds dark until a smarter choice exists. Example sites regenerate with SEO off (fictional businesses).
- Tests: `scripts/test-site-options.mjs` (drift between brief text and the Edge helper, worker/builder wiring with planted bugs, template safety rules) and `scripts/manual/site-options-e2e.mjs` (real browser, axe in every mode).

## Phase 2 (photos at setup): BUILT and PROMOTED as migration 276 on 2026-10-18 (owner: "lets do all of that"); NOT applied/deployed/switched on. Owner runs the backend: `docs/PHOTO_BACKEND_RUNBOOK.md`
- Migration `supabase/migrations/276_site_photos.sql` (+ regression test, 12 planted bugs caught): paid clients in setup may upload images before approval, the storage-allowance policy is created when billing turns active, photo roles/alt text/captions/order (12 in Our work, 24 in all), and a service-role-only read that returns only clean + released photos.
- Panel `ClientSitePhotos` (brief + redesign form, off until promoted), uploader that shrinks big photos in the browser, and a builder step (live in `supabase/functions/build-business-website`) that downloads each clean photo, checks its real type from its bytes and that its SHA-256 equals the scan's, commits it as `gallery/work-NN.ext`, deletes gallery files it did not write, and writes the gallery block in `site.config.js`.
- **Hard dependency found:** photos only publish after the malware scan (Scanii free trial, owner secrets, `deploy_functions`). Without the scanner they stay "Being checked" forever.
- Not done (honest): "Other photos" are kept for the NXQX team; the template has no slot for them yet. Old gallery files are not deleted from a client's repo when a photo is removed (the config simply stops listing them). HEIC (iPhone default) is refused with a tip.
