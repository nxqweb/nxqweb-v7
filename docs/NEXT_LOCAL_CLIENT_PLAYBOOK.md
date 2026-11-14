# Next local client playbook (owner side, written 2026-10-19)

For the first Business client after the Oct 22 deploy (a tree service, granite shop, plumber, etc.). Use it after the deploy-day proof has passed.
Rule: nothing here needs a new migration, a secret, or a paid service. Anything that does is a stop-and-ask.

## 0. Before you talk to anyone
- [ ] Oct 22 checklist done, AI Desk switched on, practice order cancelled.
- [ ] Photos stay OFF until you have checked Scanii usage (trial: 50 scans). Tell clients "send me your photos by message for now".
- [ ] Decide the price you are quoting and say it out loud before they sign up (billing is confirmed by hand while Stripe is parked).

## 1. What you tell them (30 seconds)
"Go to the signup link, pick Business, tell it what kind of business you are and where you work. Takes 3 minutes. Then you get a Request your website button. Fill the short form, it is already filled in with what you told signup. Pick light, dark or both for your site. You do not need to know anything technical."

## 2. What happens, step by step
| Step | Who | What you see | Your action |
|---|---|---|---|
| Signup | Client | New client in the owner portal (status `lead`) | Nothing yet |
| Payment | You + client | Request card says plan "Not active yet" | Confirm the payment by hand, then set their billing to active (the way you did for the candle client). The send button unlocks only when billing is active or past due |
| Request | Client | A setup report arrives, approval card appears (shows Billing, colour mode, SEO, smooth scrolling, signup answers) | Read it. Missing something? Use the "more info" request, do not guess |
| Approve | You | Approve on the card | You click. The pipeline prepares the build plan within about a minute |
| AI Desk | You | AI Desk panel shows the task for this client | Copy AI task -> paste into the AI Desk chat -> copy reply -> Paste and check -> Save to project |
| Build | Pipeline | Preview site is built | Open the preview, check it on your phone in light and dark |
| Changes | Client | "Redesign my website" link appears once approved | They send what to change, you handle it as a design change |

## 3. Quick quality check before you show the client
- [ ] Business name, area and services are right (no invented awards, years, reviews, prices).
- [ ] Phone and email are the client's real ones.
- [ ] Looks fine on a phone, in the colour mode they picked.
- [ ] SEO matches what they chose (on = listed in search, off = hidden).
- [ ] Nothing says "trusted", "best", "licensed" etc. unless the client wrote it themselves.

## 4. If a step is stuck
- Send button stays locked: billing is not active yet.
- No AI Desk task after about 2 minutes: press **Check again**; if still nothing, message Claude with the client name.
- AI Desk says the answer was refused: press **Copy fix request** or copy the task again, and ask the chat again.
- Anything unclear: use the Report a problem button or tell Claude. Do not paste SQL or secrets anywhere.

## 5. After the first client is live
- [ ] Ask them what confused them (3 questions: where did you get stuck, what did you expect, what would you remove).
- [ ] Tell Claude "wrap up client #2" so the friction list in `docs/NXQ_RUNTIME_HANDOFF.md` is updated.
- [ ] Only then decide: photos (needs the Scanii check), Phase 4 deeper (needs a migration decision), or the next client.

*Items marked "the way you did for the candle client" are not re-verified against the owner screen's button names; check them on the day and tell Claude if the wording differs so this page can be corrected.*
