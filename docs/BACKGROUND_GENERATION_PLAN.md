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

## Draft 11 (2026-11-24): the server side, built and tested, not applied
`docs/drafts/migrations/11_store_background_generation.sql` (+ sidecar test, passes in `npm run test:local-full-schema` 66/66, with a control run that breaks the switch rule and fails): limits table (switch OFF, allowance 0, monthly ceiling 0, so it fails closed), request log, the gate (same rules as `backgroundLimits.ts`, failed and rejected tries count), service-role-only claim and finish, and the owner's list and approve-or-reject. Nothing generated can go live without the owner's approval. Requires draft 10.
Still missing for the maker itself: a provider account and its key as a server secret, an Edge function that wraps `generateBackground` and calls claim and finish, the owner's limits screen and approval screen (parked patch), and the client's request button.

## Still to do for Jun 16 (all gated: owner approves each)
1. Migration: private storage for backgrounds, a saved-background field on the store look, the per-store counter.
2. Upload screen (and approval screen for generated pictures) plus the showcase layout reading the saved background, with the readability overlay.
3. Edge function that wraps `generateBackground` with a real provider, its key stored as a server secret, and the provider's own spending cap.
4. Owner decides the limits and the redesign add-on in chat.
