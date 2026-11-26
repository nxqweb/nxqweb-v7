# Own background for every store (plan, decided 2026-11-23)

Goal: every store gets its own website background (not a shared template and never the logo itself). Premium sites should look made for the client.

## Two ways to get a background (owner decision, 2026-11-23: offer both)
- **Upload their own:** same plumbing as the logo upload in `docs/LOGO_UPLOAD_PLAN.md` (private storage, the existing writer rules, a rights tick, size limits, the existing file scan). Extra rules for a background: shrink for phones, and a readability guard so text on top of a busy or dark picture stays legible (dim or frost it automatically).
- **Generate one:** Phase 2 below, behind the limits.
- Both end in the same place: one saved background per store, shown behind the logo and glass cards. Build the upload path first; the generator reuses its storage, save step and screen.

## Phase 1: by hand (first clients)
- Build the request text with `buildBackgroundPrompt` (`src/lib/backgroundPrompt.ts`): it takes the business type, a mood and the store's own colors, and always forbids text, logos, people and objects.
- The owner makes the picture in an image tool, checks it by eye, and it is added to that store's files. No key, no database change.

## Phase 2: automatic, with limits (after launch; every step below needs the owner's explicit approval first)
- A server-side generator (Edge Function) that asks `checkBackgroundRequest` (`src/lib/backgroundLimits.ts`) before every run.
- Limits are counted in pictures, set by the owner: a per-store allowance per period, a hard monthly ceiling for all stores, a short wait between requests, and one master off switch. A limit that cannot be read means "do not run".
- The picture is generated once, shown to the owner for approval, and only then goes live. Nothing unreviewed ships.
- A redesign request regenerates the background and may rearrange a few sections; it is an add-on the owner prices. Pricing is decided in chat and is not written here.
- Needs (all gated): an image provider account with its own spending cap, the provider key stored as a server secret (never in chat, source, logs or workflow inputs), a small database counter per store (migration), and a deploy. Current provider prices must be looked up and shown to the owner before choosing.
- Shipped pictures are stored in the store's own files and shrunk for phones.

## Not doing
- A shared library of backgrounds (it reads as a template).
- Code-drawn backgrounds: tried twice on 2026-11-23, clearly weaker than a generated picture.

## Built so far (pure code, unwired, tested)
- `src/lib/backgroundPrompt.ts`: request text from business type, mood and store colors.
- `src/lib/backgroundLimits.ts`: per-store allowance, monthly ceiling, wait time, master switch.
- `src/lib/backgroundRules.ts`: upload rules (PNG/JPEG/WEBP only, 10 MB, stored at most 2400 px, size advice, rights tick) and the readability guard (how much white to lay over a dark or busy picture).
- `src/lib/backgroundGenerator.ts`: runs limits, then a provider, then checks the result. Always ends "waiting for owner approval". Default provider makes nothing. A real provider is one object with `generate(prompt, size)`.
- Tests: `scripts/test-background-generation.mjs`, `scripts/test-background-upload-and-generator.mjs`.

## Draft 11 (2026-11-24): the server side, built and tested. UPDATE 2026-11-24: promoted to migration 299 (and draft 10 to 298), NOT applied; the owner screens and the client button are applied in the source (not deployed)
`docs/drafts/migrations/11_store_background_generation.sql` (+ sidecar test, passes in `npm run test:local-full-schema` 66/66, with a control run that breaks the switch rule and fails): limits table (switch OFF, allowance 0, monthly ceiling 0, so it fails closed), request log, the gate (same rules as `backgroundLimits.ts`, failed and rejected tries count), service-role-only claim and finish, and the owner's list and approve-or-reject. Nothing generated can go live without the owner's approval. Requires draft 10.
The owner's limits screen and approval screen are BUILT as parked patch `docs/drafts/patches/11_background_owner_screens.patch` (browser-checked, 13 checks). The client's "Make me a background" button is BUILT as parked patch `docs/drafts/patches/12_background_request_button.patch`: the client calls `request_my_store_background` (draft 11; checks every limit, one request at a time per store, cleaned text, mood from a fixed list) and the server's `nxq_background_take_next` hands the request to the maker. Still missing for the maker itself: a provider account and its key as a server secret, and an Edge function that takes the next request, builds the prompt (`buildBackgroundPrompt`), calls the provider, uploads the picture to the store's branding folder and calls `nxq_background_finish`.

## The Edge function (2026-11-24): written and tested, parked as a draft
`docs/drafts/functions/generate-store-background/` (see `docs/drafts/functions/README.md`): `index.ts` (worker-token auth, one request per run, answers "not configured" and takes nothing when its settings are missing), `core.ts` (the job, with every outside thing handed in), `provider.ts` (the ONLY place that knows the picture service), `prompt.ts` (a copy of `src/lib/backgroundPrompt.ts`, checked identical by a test). Tested with fakes only (`scripts/test-generate-store-background.mjs`, 32 checks): strict reply reading (only one base64 PNG, JPEG or WEBP, typed by its own bytes, 10 MB cap), provider text and keys never returned, every failure after a request is taken is reported as a failed try so a store is never stuck, and a saved picture is removed again if the result cannot be recorded. Draft 11 gained `nxq_background_expire_stuck` for a crashed run.
- **UNVERIFIED:** the request and reply shapes in `provider.ts` come from general knowledge of the provider's public image API; its docs site was unreachable from the build session. The model name and image size are required settings (`NXQ_IMAGE_MODEL`, `NXQ_IMAGE_SIZE`), nothing is hard-coded, and any unexpected reply fails closed. Before switching it on: read the provider's CURRENT docs, confirm the endpoint, request fields and reply shape, and run one live test. Pictures are saved with a fixed default softening of 0.2 (decoding images inside the function is not done); the owner sees each picture before approving.
- **Settings it needs (names only):** `NXQ_IMAGE_PROVIDER_API_KEY` (secret), `NXQ_IMAGE_MODEL`, `NXQ_IMAGE_SIZE`; optional `NXQ_IMAGE_PROVIDER_HOST` (only the one allowed host is accepted). It also needs the existing worker token and Supabase secrets.
- **Adoption** (all gated): the dry run showed it needs exactly: draft 10 and 11 promoted and applied first, the folder copied to `supabase/functions`, a manifest entry, a `verify_jwt = false` config line, and a scheduler entry to call it (a migration or owner step, not written yet).

## Still to do for Jun 16 (all gated: owner approves each)
1. Migration: private storage for backgrounds, a saved-background field on the store look, the per-store counter.
2. Upload screen (and approval screen for generated pictures) plus the showcase layout reading the saved background, with the readability overlay.
3. Edge function that wraps `generateBackground` with a real provider, its key stored as a server secret, and the provider's own spending cap.
4. Owner decides the limits and the redesign add-on in chat.
