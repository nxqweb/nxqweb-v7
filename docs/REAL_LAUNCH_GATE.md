# Real Launch Gate (written 2026-10-22, after the staging deploy)

**What this is.** The list of everything between "pilot on staging with a few local clients" (today) and "hands-off launch: the owner clicks Approve and the client goes through the whole workflow by itself". Each row says what it is, who has to do it, what it costs, and what it unlocks. It is built from `docs/NXQ_RUNTIME_HANDOFF.md` (canonical launch checklist), the 2026-10-22 promise audit, and `docs/ZERO_SPEND_PLAN.md`. Prices marked (unverified) came from search results or memory; check the vendor page before budgeting.

**Where things stand (2026-10-22).** Code is built and tested locally. Staging has migrations through 277, all 44 functions, and the new site (`aa72bd0`). Billing is by hand, the AI work is done by hand through the AI Desk, email sending is off, photos are off. Not proven live yet: a real monthly report, a client's change request reaching a live site, lead emails, domains, a real client through the whole flow.

## A. Things only the owner can unlock (accounts, money, decisions)
| # | Item | What it needs | Rough cost | What it unlocks |
|---|---|---|---|---|
| A1 | **Live Stripe** | Live Stripe account, payout account, owner enters keys by hand; run refund, dispute and restore-to-active tests (only paid and failed-payment are proven) | no monthly fee; per-payment fee about 2.9% + $0.30 (unverified) | billing updates itself; the manual "set billing active" step disappears |
| A2 | **A real AI key** | Pick a provider, owner enters the key by hand; the code supports OpenAI-style APIs and a Claude option exists in source but is not deployed | about $3-14 per site build and a few dollars per client per month (unverified, from planning notes) | build plans, change-request classification and the AI-written monthly review run by themselves; the AI Desk copy-paste goes away |
| A3 | **Email delivery** | Resend account and a verified sending domain, then set `NXQ_EMAIL_NOTIFICATIONS_ENABLED` | free to about 3k emails a month, then about $20 (unverified) | lead emails (code is ready, off), billing emails, file-quarantine emails |
| A4 | **Production Supabase project** | Create it, apply migrations 1-277, deploy functions, repoint the site; nothing is on production today | Supabase Pro $25/mo (unverified) | a real production environment separate from staging |
| A5 | **Legal review** | A lawyer: Terms (cancelling, late payment, liability, governing law), Privacy (retention periods have no purge job yet) | owner's call | the draft banners can come off the public pages |
| A6 | **Production malware scanning** | Scanii paid plan (trial has 50 scans total) | per Scanii pricing | client file and photo uploads at volume; the photo panel |
| A7 | **Netlify plan** | Free plan gives 300 credits a month, a production deploy costs 15. Personal $9 (1,000 credits) or Pro $20 (3,000 credits) (unverified) | $9-20/mo | roughly 20 deploys a month on free, 66 on Personal, 200 on Pro |
| A8 | **10 clean end-to-end runs with your sign-off** | Disposable test clients through Supabase, GitHub and Netlify with evidence (your own checklist rule) | time | permission to call it launched |

## B. Product decisions (no money, but the owner must choose)
| # | Decision | Why it matters |
|---|---|---|
| B1 | **What does "cancel" do to a live site?** Switch it off, keep it, or hand it over | Today a client can only *request* cancelling (a message to the owner). Nothing switches a site off, and hosting keeps costing money after a cancel. |
| B2 | **How does deletion work?** Who verifies identity, what is erased | A delete request has no owner screen and no automated processor. |
| B3 | **Free first month and founding discounts** | Nothing tracks or enforces them; the owner must remember not to invoice until day 30. A tracker needs a migration. |
| B4 | **Which product lines to sell** | Booking, Membership and Property: do not sell yet. Commerce and Menu: request-only (email orders or payment links, not online checkout). |
| B5 | **Real SSL-expiry check** | Not possible inside an Edge function. Options: a read-only call to the Netlify API (external service, owner approval) or a certificate log. |

## C. Things the owner can ask Claude to build (some need an approved migration)
| # | Item | Needs a migration? |
|---|---|---|
| C1 | **Website visitor chatbot.** Not built. Plan: a no-AI Q&A bot first (the client types answers in their portal, visitors get the matching answer, otherwise the contact form), then real AI when A2 exists. Needs a widget in the site template, a client "My assistant" page, a public answering function with spam protection, and usage counting against the tier's AI budget (the database already has per-tier budgets of $5, $10 and $15 and tables for extra purchased usage; no page to buy extra usage exists yet). | yes (knowledge table) |
| C2 | First-month tracker and invoice-due reminder | yes |
| C3 | Owner screens: all-sites up/down board, pause client, delete client, privacy requests | some |
| C4 | Fuller data export (site content, leads, files, messages) and automated delete | maybe |
| C5 | Heat-map picture (today the portal shows only a number) and a writer for the Improvement queue | no / yes |
| C6 | Commerce and Booking on the same one-flow as Business (look options, photos, plan lock) | yes |
| C7 | Booking pages routed and its migration promoted | yes |
| C8 | Turn the AI Desk "Save to project" on (owner says "277 is applied, switch the AI Desk on"; needs one site deploy) | no |
| C9 | Turn the photo panel on (after A6 and a Scanii usage check) | no |

## D. Recommended order
1. **Now (pilot, no spend):** finish the candle store practice order, then onboard 2-5 local clients by hand using `docs/NEXT_LOCAL_CLIENT_PLAYBOOK.md`. Promise only what exists: "I build it, host it, handle changes for you, you see your leads in your portal, the first month is free."
2. **First paid step, once there is revenue:** A1 (live Stripe) and A3 (email). These remove the two manual chores that hurt most (billing and lead notices).
3. **Then A2 (AI key)**, then C1 (chatbot), C8 (AI Desk save switch), and the AI-written monthly review.
4. **Before the public launch:** A4 (production), A5 (legal), A6 (scanner), B1/B2 decisions, A8 (10 clean runs and your sign-off).

## E. What not to say to clients yet
- "Cancel in one click." (It is a request to the owner.)
- "AI chatbot on your site." (Not built.)
- "Heat maps." (Data is collected; no map yet.)
- "Monthly optimization by AI." (The monthly report is automatic and rule-based, no AI.)
- "Book online / members only / property listings." (Not built.)

## F. Capacity today (estimates, not measurements)
The software is not the limit; the accounts are. Netlify credits (about 20 production deploys a month on the free plan) and the database build guard (`max_builds_per_cycle`, default 4 per cycle, raised by a small owner-approved change) cap new client sites at roughly 4-12 a month. Manual billing and the AI Desk are owner time: about 1-2 minutes per client for the AI Desk. Running cost at about 10 clients is roughly $110 a month, falling to about $7 per client at 100 (assumptions: $100 plan, 1.5 deploys per client per month, about $3 AI per client, card fee 2.9% + $0.30).
