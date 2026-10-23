# Website Q&A assistant (no AI): plan, status and promotion checklist (2026-10-22)

**What it is.** A business types the questions its customers ask and the answers in its client portal ("My assistant"). A small "Ask a question" button on its website
shows visitors the matching answer, or says it is not sure and points to the contact form. It is **not AI**: it can only say what the business wrote, it costs $0 to
run, and it behaves the same every time. When an AI key exists later, only the matching step changes; the tables, the portal page and the widget stay.

**Status: BUILT AS A DRAFT. Nothing is applied, deployed, routed or switched on.** Every client site and the live portal are byte-for-byte unchanged.

## What exists (all local)
| Piece | Where | Tested by |
|---|---|---|
| Answer matcher (plain word overlap, refuses to guess) | `supabase/functions/_shared/assistant-match.mjs` (+ `src/types/assistant-match.d.ts`) | `scripts/test-assistant-match.mjs` (planted-bug controls) |
| Database (draft migration 11): settings, up to 50 answers, unanswered-question list (max 100, never personal details), client functions, two service-role functions | `docs/drafts/migrations/11_site_assistant.sql` | `11_site_assistant.test.sql` in the local full-schema harness; 11 of 13 planted bugs caught locally, the other 2 (grant lines) are covered by the static test below |
| Public answer function (origin check, per-form and per-visitor hourly limits, bot trap, plan/billing gate, never returns the answer list) | `docs/drafts/functions/answer-site-question/index.ts` (type-checks with `deno check`) | `scripts/test-site-assistant-draft.mjs` (static rules + planted controls) |
| Site widget (one file, own styles, text-only rendering, keyboard and screen-reader support) | `docs/drafts/site/assistant.js` | `scripts/manual/assistant-widget-e2e.mjs` (32 checks, axe in dark and light, 360/390px, 7 planted bugs caught) |
| Portal page "My assistant" (answers, on/off, greeting, "Try it", unanswered questions) | `src/pages/ClientAssistant.tsx`, `src/lib/siteAssistant.ts` | `scripts/test-site-assistant-ui.mjs`, `scripts/manual/site-assistant-e2e.mjs` (34 checks, axe, 360/390px, planted bugs caught) |
| Draft real gateway for the portal page | `docs/drafts/ui/siteAssistantSupabaseGateway.ts` | type-checked |

## Decisions I made (change any of them)
1. **Same front door as the contact form.** The widget uses the client's lead-form key, the form's allowed origins and hourly limits, and the same plan and billing gate (`lead_capture`). A client whose contact form is not allowed has no assistant either.
2. **Unanswered questions are kept** (so the business can add answers), as counts per wording, max 100 per client, with no IP address and no visitor identity. Anything that looks like an email address, a long number or a web link is NOT stored. This is a privacy surface: the Privacy page needs one sentence about it before launch (legal review is parked).
3. **No web links in answers** (they could be abused to send visitors to bad sites); answers are plain text, up to 600 characters.
4. **The assistant starts OFF** and cannot be turned on with no answers; deleting the last answer switches it off.
5. **Greeting and not-sure message are fetched live when the panel opens**, so edits show without a website rebuild. The button itself needs a rebuild to appear or disappear.
6. **Two equally good matches are never guessed between**: the visitor gets the not-sure message and the business is told how to fix it in "Try it".

## Owner decisions still open
- **Which plans get it?** Today: any client with an allowed contact form. Gating by tier needs a feature entitlement row (a migration).
- **Keep the unanswered-questions list?** It is the most useful part for the business and the only privacy-sensitive part.
- **Where does the button sit and what does it say?** Default: bottom-right, "Ask a question", uses the site's own colours.
- **Usage limits and paid extras** are NOT part of this version (there is no per-answer cost). They matter only once real AI answers exist.

## Promotion checklist (each step needs the owner's approval; migrations, deploys and the site rebuild are stop-and-ask)
1. **Migration:** promote draft 11 as the next number (278 if nothing else lands first), move `11_site_assistant.test.sql` to `scripts/sql/local-full-schema/regression/`, update `expectedPendingMigrations` in `scripts/preflight-deploy-day.mjs` and the deploy-day list; apply with the guarded workflow (dry run must list exactly that file).
2. **Function:** move `answer-site-question` to `supabase/functions/`, change its import to `../_shared/assistant-match.mjs`, add it to the function manifest and `supabase/config.toml` (no JWT, like `ingest-business-lead`), satisfy the auth-boundary validators, then `deploy_functions`.
3. **Widget:** copy `docs/drafts/site/assistant.js` to `templates/business-v1/assistant.js`; add `<script type="module" src="./assistant.js"></script>` to `index.html`; add the file to `blueprintFiles` in `build-business-website` and to `requiredFiles` in `run-staging-evidence-suite`; strip it from the example sites (`scripts/build-example-sites.mjs`, they have no backend); keep the generated-site quality validator green; regenerate `public/examples`.
4. **Builder:** write `assistant: { enabled, endpoint, formKey, title }` into each client's `site.config.js` only when that client turned the assistant on; every client site that should show the button needs one rebuild (Netlify credits: 15 each on a production deploy).
5. **Portal:** move the draft gateway to `src/lib/siteAssistantSupabaseGateway.ts`, add `src/lib/siteAssistantConfig.ts` (one switch, null until applied), add the `/client/assistant` route and a "My assistant" link beside "Get reviews", then publish the site.
6. **Words:** one sentence in the Privacy page about unanswered questions; Terms line that the business is responsible for the answers it writes.
7. **Proof:** a disposable test client through the whole flow on staging (add answers, turn on, rebuild, ask from a phone-size browser), then a second independent review of the live function before the first real client.

## What the first real AI version would change (later, needs the AI key)
Only `matchQuestion` in the function: it would first try the exact word match, and when that is not clear it could ask the AI to pick the best of the business's own answers (never to write new ones), counting the cost against the plan's AI budget. The portal page, tables and widget stay as they are.
