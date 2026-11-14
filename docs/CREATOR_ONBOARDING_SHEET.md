# Creator onboarding sheet: one page per creator (written 2026-11-04)

**Status: DRAFT checklist for the owner.** It reuses the existing client flow (`docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md`) and the precedent set by the candle client, who is onboarded as a no-charge ("complimentary") client (`docs/OWNER_COMPLIMENTARY_BILLING_ACTIVATION.md`). Nothing here needs a new migration, secret or paid service; anything that does is a stop-and-ask. Offer wording lives in `docs/CREATOR_OFFER_ONE_PAGER.md`.

## Decide first (once, owner)
- **Do creators use the founding-client spots?** `docs/FOUNDING_CLIENT_PROGRAM_PLAN.md` already says 10 founding spots (free service under written terms) and 5 testing spots (50% off for 12 months). If creators are those spots, they are counted against the 10. If you want more free creator sites than that, it is a new product decision; write it down here.
- **The written terms:** free spots need terms (service may end if NXQ Web stops operating, no uptime promise, fair use, data return on end, who owns the domain). The plan says a lawyer should confirm the wording; until then, keep it to a short plain-language agreement the creator confirms by message, and tell them it is a draft.

## Per creator
| # | Step | Who | Done |
|---|---|---|---|
| 1 | Send the offer one-pager and the agreed terms; get a "yes" in writing (message or email is fine) | Owner | [ ] |
| 2 | Creator signs up at `/portal/signup` with their own official email and picks Business | Creator | [ ] |
| 3 | Run the by-hand no-charge billing step so the Request button unlocks; the client should show as complimentary so it is left out of revenue | Owner | [ ] |
| 4 | Creator fills the website request; read it; use "more info" instead of guessing | Creator + owner | [ ] |
| 5 | Approve; AI Desk task -> copy -> reply -> check -> Save to project | Owner | [ ] |
| 6 | Preview check on a phone (light and dark), using the quality list in the playbook section 3 | Owner | [ ] |
| 7 | Creator approves; publish; one change request practice if they want it | Creator + owner | [ ] |
| 8 | Written permission, per item, before showing their site or name anywhere (`src/lib/socialProof.ts` rule) | Owner | [ ] |

## What to collect from a creator
Brand or business name; what they make or offer, in their own words; the colors and mood they like (the form has light, dark, both, and own colors); links to their profiles; a logo if they have one; their real contact email and phone; the domain they own, if any (until then the site lives on a free address). Never ask for passwords, payment details or API keys.

## Photos
The photo panel is ON, and each uploaded photo uses one malware scan. The Scanii free trial is 50 scans in total and about 46 were left on 2026-10-18 (check Scanii -> Account -> Usage before promising anything). Until a paid scanner plan exists, ask each creator for a small set (for example 6 photos) and keep a running count here: used ___ of 46.

## Quality check before showing them (from the playbook)
No invented awards, years, reviews or prices; the contact details are theirs; fine on a phone in their chosen mode; SEO matches their choice; nothing says "trusted", "best" or "licensed" unless they wrote it.

## If a creator leaves
Use the Cancel + take-down to-do in `/owner/client-lifecycle` (migration 285). Remember it records the to-do; it does not switch the site off by itself (decision B1 in `docs/REAL_LAUNCH_GATE.md` is still open), so tell the creator plainly what will happen to the site.

## Tracking sheet columns
Creator | wave or date | signed up | billing set | request in | approved | AI Desk saved | preview sent | published | photos used | permission to show (yes/no) | notes and what confused them
