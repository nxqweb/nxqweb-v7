# Tier test sheet (written 2026-10-24)

**What this is.** A live check, on staging, that each Business tier shows what it promises and locks what it should. The repo's contract checks only confirm the rules exist in the source text; they are not proof of what a client sees. This sheet is how you get that proof.

**Who does it.** The owner, in a browser (desktop is fine). Claude cannot log in or reach staging from the sandbox. Send screenshots and Claude records the results in `docs/NXQ_RUNTIME_HANDOFF.md`.

**Rules.** Use disposable test clients only, never a real client. No real card, no real money. Never put a password, key or secret in a screenshot or in chat. If a step does not match the "Expected" column, do NOT work around it: write what you saw in the Result column. A mismatch is a finding, not a failure of the test.

## What "expected" means here
Every Expected cell below comes from reading the code: `supabase/migrations/130_server_side_tier_entitlements.sql`, `src/lib/productCatalog.ts` and the portal pages. **None of it has been seen live yet.** Where the code does not make the wording clear, the cell says "write down what you see".

## 0. Set up four test clients
1. Sign up one test client per tier (use four different test emails you control): `/portal/signup?family=business&tier=starter`, then `tier=growth`, `tier=intelligence`, `tier=enterprise`, all on https://nxqweb-v9-staging.netlify.app.
2. Enterprise is priced "$300+/mo" and may not be selectable at signup. If it is not, write that down as a finding and test the other three first.
3. Approve each client from the owner screen and follow the existing steps in `docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md` (including the complimentary billing block if you use it). Do not invent a new flow.
4. Log in as each client in turn (a private window per client avoids mixing sessions).

## 1. Tier matrix (what the entitlement rules say)

| Feature | Starter $50 | Growth $100 | Intelligence $150 | Enterprise $300+ |
|---|---|---|---|---|
| Managed website, client portal, hosting monitoring, basic SEO, lead capture | yes | yes | yes | yes |
| Advanced analytics (page views, clicks, scroll summaries) | **no** | yes | yes | yes |
| Advanced SEO | **no** | **no** | yes | yes |
| Mouse tracking / heat points (consent required, 90 days) | **no** | **no** | yes | yes |
| Locations | 1 | 1 | 1 | up to 100 (multi-location) |

Not built, so do NOT expect it on any tier: a heat-map picture (heat points are collected, the picture does not exist), AI-written reports, email sending.

## 2. Per-client checks
Run every row for every client. Mark each Result PASS, FAIL (with what you saw) or N/A.

| # | Page (after `https://nxqweb-v9-staging.netlify.app`) | Starter | Growth | Intelligence | Enterprise |
|---|---|---|---|---|---|
| T1 | `/client/business` (workspace) | Loads, no error | Loads | Loads | Loads |
| T2 | `/client/business/analytics` | Shows "Advanced analytics is not included in" the plan (page views, clicks, scroll are not shown as data) | Page views, clicks, scroll depth shown; heat points show **Plan locked** | Page views, clicks, scroll shown; heat point count shown (may be 0 on a new site) | Same as Intelligence |
| T3 | `/client/business/seo` | Page opens (core SEO status is for every tier; the page has no tier check) | Opens | Opens | Opens |
| T3b | The SEO button on `/client/business` | Says "SEO · Core · Plan upgrade for advanced SEO" | Same as Starter | Says "SEO · Advanced" | Says "SEO · Advanced" |
| T4 | `/client/business/locations` | One location; a note says location add-ons are available on Growth and Intelligence and Enterprise includes multi-location | One location; add-on option visible | One location; add-on option visible | Multiple locations allowed |
| T5 | `/client/business/funnel` | Write down what you see | Write down | Write down (lead-source and funnel insight is promised here) | Write down |
| T6 | `/client/business/reports` | Write down | Write down (monthly report promised, only once the site is live) | Write down | Write down |
| T7 | `/client/business/leads` | Loads | Loads | Loads | Loads |
| T8 | `/client/business/changes` (update requests) | Loads, a request can be sent | same | same | same |
| T9 | `/plans` shows the same price and feature list for that tier | $50 | $100 | $150 | $300+ |

## 3. Things that must be true for every tier
| # | Check | Expected |
|---|---|---|
| E1 | First login shows the portal tutorial once; after finishing, it does not come back on refresh | Shown once |
| E2 | The tutorial mentions your NXQX ID and the action-required domain behaviour | Yes |
| E3 | A locked page never shows another client's data and never shows a raw error | Plain locked message |
| E4 | Log in as client A, paste client B's `/client/business/...` page, nothing of B shows | Only A's own data |
| E5 | The public site for each client loads in a private window | Loads |

## 4. Results log (fill in, then send Claude screenshots)
| Client / tier | Date | Rows PASS | Rows FAIL or surprising | Screenshot names |
|---|---|---|---|---|
| Starter | | | | |
| Growth | | | | |
| Intelligence | | | | |
| Enterprise | | | | |

## 4b. Results recorded so far
| Date | Client / tier | Row | Result | Note |
|---|---|---|---|---|
| 2026-10-25 | Starter (`nxqweb+starter@protonmail.com`) | Setup flow | PASS | Signup, email verify, owner `Activate billing (no charge)`, client Request your website, owner Approve card, all worked. Approval card showed the Starter package scope. |
| 2026-10-25 | Starter | T2 analytics | PASS | "Advanced analytics is not included in starter plan"; text says Growth adds page, click and scroll summaries and Intelligence adds consent-gated coarse heatmap insights. |
| 2026-10-25 | Starter | T3b dashboard labels | PASS | Analytics "Plan upgrade", SEO "Core · Plan upgrade for advanced SEO", Locations "Plan upgrade for Multi-location"; tier shows `starter`; no "Last 14 days" card. |
| 2026-10-25 | Growth (`nxqweb+growth@protonmail.com`) | Setup flow | PASS | Same flow as Starter; approval card showed Growth, $100/mo, up to 5 pages, monthly report line. |
| 2026-10-25 | Growth | T2 analytics | PASS | Page views, Clicks, Max scroll shown (all 0 on a new site); Heatpoints **Plan locked**; profile says mouse heatmaps not enabled, consent required. |
| 2026-10-25 | Growth | T3b dashboard labels | PASS | Analytics "Active" (plus a "Last 14 days" card), SEO "Core · Plan upgrade for advanced SEO", Locations "Plan upgrade for Multi-location"; tier shows `growth`. |
| 2026-10-25 | Growth | Onboarding reminder | FINDING | After the request form was completed and approved, the portal says "Complete the missing onboarding information: contact_phone, desired_style" (migration 245 reads the structured intake row; the form writes style into the report text). Not fixed; needs a migration decision. |
| 2026-10-25 | Growth | Wording conflict | FIXED IN CODE, NOT DEPLOYED | The owner approval card said Growth does not include click/scroll reporting, but /plans and the live Analytics page include it. Changed the one line in `src/pages/ClientPortal.tsx`. Takes effect on the next site deploy. |
| 2026-10-25 | Starter | T3 SEO page | CORRECTED | The original sheet said locked. The page shows the core SEO center (0 issues, nothing published yet) because it has no tier check. Sheet fixed; T3b (dashboard label) still to check. |

**Finding to decide on:** `advanced_seo` is defined for Intelligence and Enterprise but, in the code, only changes the dashboard button label. Nothing else is gated on it, and the public /plans text does not promise "advanced SEO" by name. Not a bug by itself, but do not tell a client that Intelligence has extra SEO tools until something real sits behind the label.

## 5. After the run
- Claude records the results (exact PASS/FAIL, not "looks fine") in `docs/NXQ_RUNTIME_HANDOFF.md`.
- Any FAIL becomes a fix task. Wording gaps are cheap; anything that shows data to the wrong tier or the wrong client is a stop-the-line issue.
- A full pass proves the tiers behave on staging. It does NOT make the product launch-ready: live Stripe, email, an AI key, a production project and legal review are still open (see `docs/REAL_LAUNCH_GATE.md`).
