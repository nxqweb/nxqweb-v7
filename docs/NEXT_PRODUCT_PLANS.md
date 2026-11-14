# Next product plans: Reviews collector and Booking (written 2026-10-16, plans only, nothing built or applied)

Owner has no next clients picked yet, so this is a menu, not a schedule. Each plan: who pays, the smallest useful first version (v1), what it needs,
rough size, and risks. Recommendation at the bottom.

## Plan 1: Reviews collector ("Get more reviews")

**Who pays:** any local business (salons, contractors, restaurants, shops). Reviews are the thing most owners know they should do and don't.

**Smallest useful v1 (no email, no card needed):**
1. Client pastes their Google review link once (a normal https link).
2. The portal shows a ready-to-print review card with a QR code, plus a copy-paste text message ("Thanks for choosing us! Would you leave a quick review? <link>").
3. Client can add a few real customer quotes by hand (name, quote, optional star count), and they show in a Testimonials section on the client's website.
Nothing is sent automatically, so there is no spam risk and no email provider is needed.

**Needs:** a small table for testimonials (draft migration, owner approval to promote), a portal page, a QR renderer (client-side, no service). A safe link rule (https only).
**Does NOT need:** a card, a verified email domain, an AI key.
**Size:** about 2 to 3 focused sessions (draft SQL + test, portal page, tests, QR card print layout).
**Risks:** fake-review rules (Google forbids paying for or filtering reviews, so the page must say "ask every customer, do not pick only happy ones"); never claim reviews improve rankings.
**v2 later (needs verified email domain = card):** automatic review requests by email or text after a job; the NXQX assistant could draft the message.

## Plan 2: Booking (appointments)

**Who pays:** salons, barbers, trainers, tutors, clinics, cleaners, anyone who answers "are you free Tuesday?" all day.

**What exists today:** a database scaffold (migration 188: booking workspaces, service definitions, staff profiles, availability rules, appointment requests; no public endpoint, no portal pages, no UI).

**Smallest useful v1 (request-only, no payments, no reminders):**
1. Client lists services (name, length, optional price) and weekly opening hours in the portal.
2. A public page `/book/<slug>` (same pattern as `/store/<slug>`) lets a customer pick a service and a preferred day/time window and send a REQUEST (name, email or phone, note).
3. Client sees requests in the portal and confirms or declines them (by phone or email themselves). No automatic calendar locking in v1.
Honest label everywhere: "request", never "booked", until the client confirms.

**Needs:** draft migration(s) for owner functions (list/save services and hours, list/answer requests) and one public function with strict limits (rate limit, length caps, no personal data leaked), two portal pages, one public page, tests.
**Does NOT need (v1):** a card or verified domain. **Needs for v2:** reminders and confirmations by email/text (verified domain, card), calendar sync, deposits (payments).
**Size:** about 5 to 7 focused sessions. Biggest risk is the public endpoint (spam and privacy), so it needs the same care as the store checkout, plus a security review.
**Risks:** double booking if v2 auto-confirms; time zones; cancellation rules (a product decision, not a technical one).

## Comparison
| | Reviews collector | Booking |
|---|---|---|
| Value to a local business | High, easy to explain | Very high, bigger need |
| Needs a card / email domain for v1 | No | No |
| New public attack surface | None | Yes (public request form) |
| Size | Small | Medium to large |
| Reuses what we have | Testimonials section, portal patterns | Scaffold 188, store page pattern |

## Recommendation
Do **Reviews collector v1 first** (small, safe, sellable, no public endpoint), then **Booking v1**, because Booking is the bigger win but also the bigger risk
and should be built after one more real client has used Commerce. Neither starts until the owner picks one. Any database part stays a draft until the owner approves.

## Questions for the owner (none urgent)
1. Which business types do you expect first? (Salon and trades point to Booking; restaurants and shops point to Reviews and Menu.)
2. Should Reviews and Booking be part of the Business tiers (Growth and up), or sold as separate NXQX products?
3. Are you OK with a plain "request" flow for Booking v1, even though competitors confirm instantly?
