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
- Changing what signup/setup stores touches the database and a public contract: any migration is a stop-and-ask gate, and nothing here may break the 22nd deploy day (272-275 only).
- Photo placement should be deterministic ("My work" uploads fill the gallery in upload order, owner can reorder), NOT decided by an AI: pictures can carry claims (awards, licenses) and an AI cannot verify them.
- Pay-before-build needs the payment step to exist. Until Stripe is allowed, the gate is "owner marked the client paid", and the Request button says so in plain words.

## Proposed phases (each is its own approval; nothing here is applied)
- **Phase 1, front-end only, no migration, safe before the 22nd:** one "Your business" profile collected at signup (stored the way it is today), a short "Website brief" at Request time (style words, pages, light/dark, SEO, smooth scroll, photos) with EVERYTHING else prefilled, one submit that is the approval request (the owner approves once). "Redesign my website" reopens the same brief prefilled.
- **Phase 2, needs a migration (gated, after the 22nd):** store the brief and the photo roles as real columns/tables instead of text in the notes; a payment-confirmed gate on Request.
- **Phase 3, template work:** light mode, SEO switch, optional smooth scroll, "My work" gallery section filled from tagged uploads.
- **Phase 4, other product lines:** a shared "product flow" config so Commerce, Booking, Menu, etc. get the same one-form flow.

## Decisions waiting on the owner
See the questions asked in chat on 2026-10-18 (payment gate, where the questions live, what to build first). This file is updated when they are answered.
