# NXQX Web Pro ($500/month): how to make it real (written 2026-10-18)

Source: the owner's "NXQX Everything Summary" notes (2026-10-16): *"$500/month, built after Web launches; AI receptionist minutes have a fair-use cap: AI receptionist,
missed-call text-back, review requests, Google Business Profile, local SEO, lead dashboard, booking and payments, monthly report."* Prices in those notes are "directions, not final".
Today it is shown on `/plans` as a **coming-soon** card only (not buyable). This plan is what it takes to turn it into something clients can really pay for.

**Nothing in this document is built, applied or deployed. No outside service was contacted.** Facts about outside providers are general knowledge and MUST be re-checked with each
provider's own documents (and a lawyer for the legal rows) before anything is promised to a client.

## 1. The honest feature map: what already exists vs what is missing

| Web Pro feature | What exists in this repo today | What is missing | Needs an outside service? | Size |
|---|---|---|---|---|
| Local SEO | Service-area/local SEO structure in Growth and Intelligence tiers | Nothing new for a v1: "Pro" can include it by definition | No | S |
| Lead dashboard | `/client/business/funnel`, lead intelligence + source tables (migrations 244, 259) | A polish pass and a clearer name | No | S |
| Monthly report | Monthly report job that covers the previous month (migration 260) | Pro-specific sections (calls, reviews) once those exist | No | S |
| Review requests | Reviews collector (273): review link, QR, printable card, ready-made messages the client sends by hand | AUTOMATIC sending after a job (needs a customer list + a sender) | Email or SMS sender (verified email domain is already an open item) | M |
| Google Business Profile | A provider-agnostic reputation table (`nxq_reputation_items`, 244), nothing connected | Reading reviews / hours / posts from Google | Google Business Profile API access (an application to Google plus OAuth app verification) | L |
| Booking | Booking v1 is REQUEST-ONLY and still a draft (06): visitors send requests, the owner replies by hand | Promotion of 06, confirmations, reminders | Email/SMS for reminders | M |
| Payments (inside booking) | None. Store checkout uses the client's own payment links | Taking money for bookings = Stripe Connect / payouts (a gated area: payments, billing, payout configuration) | Stripe (Connect) | L |
| Missed-call text-back | Nothing | A phone number per client, call forwarding, an SMS sender, opt-out handling | Telephony + SMS provider; US carrier registration for business texting (often called A2P 10DLC) must be done or messages get blocked | L |
| AI receptionist | Nothing for voice. An AI routing/guard framework exists for text features | Answering calls, collecting leads, booking, handing off | A voice-AI + telephony provider, an AI model key (`NXQ_AI_MODEL_PROVIDER_TOKEN` is not set today), per-minute cost control, the fair-use cap | XL |

**Order that adds real value fastest with the least risk:** (1) bundle what exists (local SEO, lead dashboard, monthly report, manual review requests), (2) Booking promotion,
(3) automatic review requests, (4) missed-call text-back, (5) Google Business Profile, (6) AI receptionist, (7) payments for bookings. A "Pro v1" could honestly be sold as
**"everything in Intelligence + the lead dashboard, monthly report and review tools, with phone features arriving as they ship"** at a price below $500, with $500 reached when the phone features are live.
(That is a product choice, not a technical one: see the questions at the end.)

## 2. Legal and trust rows (not legal advice; the lawyer review should cover these)
- **Recording or transcribing calls:** some US states require every party's consent. The AI receptionist must announce itself and the recording/transcription at the start of every call (the owner's notes already say "designed to the strictest state laws").
- **Texting customers:** marketing and automated texts need prior consent and a working STOP; the missed-call text-back replies to someone who just called the business, but the rules still need a lawyer's read.
- **The AI must never promise prices, give medical/legal/financial advice or invent availability.** Same refusal rule as the rest of NXQX; hand off to the owner when unsure.
- **Fair-use cap:** the AI receptionist's monthly minutes need a visible cap, a visible counter for the client, and a hard stop so one client cannot create an unlimited bill.
- **Promise audit:** nothing on the site may say a feature is live until it is (`docs/PROMISE_AUDIT.md`).

## 3. Three ways to make it a real plan (the architecture decision)

The tier key is a fixed list of four values (`starter`, `growth`, `intelligence`, `enterprise`) written into database CHECK constraints in at least migrations 026, 192, 229 and 243, into
the entitlement/capability seeds in 130, 186 and 246, into the plan-change and pricing-sync functions (030, 033, 034, 040) and into the front-end catalog. The "launch architecture freeze" (243/244) was
built around those four.

| | A: a real fifth tier (`pro`) | B: a paid add-on on top of Intelligence | C: sell it as an Enterprise package (Recommended for now) |
|---|---|---|---|
| Idea | New tier key, price $500 | "Web Pro add-on" like the Multi-Location add-on (migration 251): Intelligence $150 + a $350 add-on line | Key stays `enterprise`; the owner approves a client's monthly price of $500 in the plan-change screen (the resolver already accepts `approved_monthly_price`), and the page calls the package "NXQX Web Pro" |
| Database change | Large: widen at least 6 CHECK constraints, add entitlement rows for every capability, economics row, pricing sync, plan-change functions; re-run every tier test | Medium: a new add-on table + RPCs + entitlement hooks (copy of 251's shape); billing stays separate from `monthly_price` | None for the first clients. Later: a `package` label column or a per-client capability list |
| Risk to the Oct 22 plan | High if rushed; do NOT do before the 22nd | Medium | Lowest |
| Client sees | A new row in the plan dropdown | A new add-on card | "Contact us" (it is not self-serve), the owner approves the plan change |
| Fits "coming soon" | Yes, flip it on later | Yes | Yes, and no code is needed to START selling it by hand |
| Downside | Biggest change in the most-tested area | Add-on billing is not merged into the real billed amount by design (251's note) | Enterprise semantics (custom, multi-location) are broader than Pro's list; capabilities must be switched per client by the owner |

**Recommendation: C now, B or A later.** Selling "NXQX Web Pro" as an owner-approved $500 Enterprise package needs no migration, so it cannot disturb deploy day, and it lets you sign a first Pro
client by hand while the phone features are built. Once 3+ clients are on it, promote it to a real tier or add-on (A or B) with real usage data.

## 4. What I can build next, per option (all local first, nothing live)
- **C:** a "Package" display name for Enterprise clients in the owner screens; a one-page Pro order form checklist; the per-client capability checklist (which Pro features are switched on for that client); update the `/plans` card's button to "Request NXQX Web Pro" feeding the existing plan-change request.
- **B:** draft migration `NN_web_pro_addon.sql` (add-on table, owner RPCs, tests, planted bugs), UI card on the client plan screen, draft only.
- **A:** the full constraint-widening draft with a test that proves all four existing tiers still behave exactly as before. Largest effort; schedule after the 22nd.
- **Feature work (any option):** phase 1 bundle (S items), then Booking promotion, then automatic review requests once a verified email domain exists.

## 5. Questions that need the owner (multiple choice when asked)
1. Which architecture: A, B or C (recommended: C now)?
2. Sell Pro now as a smaller "v1" (below $500, no phone features) or hold until the phone features are live?
3. Which phone provider type do you prefer to look at first (all need an account, which is an external-service gate): one all-in-one voice-AI vendor, or telephony + your own AI model?
4. Who is the first Pro client (an existing client, or one found for it)?
5. Fair-use cap: how many AI-receptionist minutes per month are included before it stops or the client buys more?
