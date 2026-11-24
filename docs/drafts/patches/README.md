# Parked front-end patches (NOT applied)

A patch here is finished, tested screen work that calls database functions which only exist in a draft migration.
The CI rule "every source RPC call has a captured migration definition" (correctly) refuses such calls in `src/`,
so the screens wait here until the owner approves promoting the draft.

| Patch | Needs draft | What it adds |
|---|---|---|
| `08_store_shipping_frontend.patch` | `docs/drafts/migrations/08_store_shipping_fee.sql` | Store page: shipping line, free-over hint, pickup choice. Live store page: the owner's Shipping fee card. Tests for both. |
| `10_store_media_frontend.patch` | `docs/drafts/migrations/10_store_media.sql` | Client portal, Live store page: the "Logo and background" card (choose a picture, size advice, rights tick, save, remove). Reuses `src/lib/storeMedia.ts`, `logoRules.ts`, `backgroundRules.ts`. |
| `11_background_owner_screens.patch` | `docs/drafts/migrations/11_store_background_generation.sql` (needs draft 10 first) | Owner portal: the "Automatic backgrounds" page (`/owner/backgrounds`): set the limits (switch, pictures per store, period, monthly ceiling, wait) and approve or reject each generated picture. Route in `src/App.tsx`, link in `src/pages/OwnerPortal.tsx`. Reuses `src/lib/backgroundOwner.ts`. Browser-checked against a mocked backend (13 checks). |
| `12_background_request_button.patch` | `docs/drafts/migrations/11_store_background_generation.sql` (needs draft 10 first) | Client portal, Live store page: the "Make me a background" card (pick a feel, say what you sell, request; hidden until the owner switches the maker on). Reuses `src/lib/backgroundRequest.ts`. Browser-checked in a throwaway test page against a mocked backend (10 checks). |

To apply after the draft is promoted to a real migration: `git apply docs/drafts/patches/<name>.patch`, then `npm run test:ci-parity`.
If the patch no longer applies because the files changed, re-make the same edits by hand; the patch is the reference.

A patch goes stale whenever the pages it touches change. `scripts/test-parked-patches.mjs` fails as soon as that happens (and every patch must be listed in it). To refresh: commit your work, run `git apply --3way docs/drafts/patches/<name>.patch`, fix any conflict, run the store tests (two shipping checks fail on purpose while the screens are wired), write the new diff of the parked files over the patch, then take the screens out again with `git apply -R`.

Patch 09 (late payment button) was applied on 2026-11-18 when draft 09 became migration 295, and deleted.

Patch 10 note: after applying it, three older tests that say "nothing in the app uses these rules yet" become false on purpose and must be flipped to "the card uses them": `scripts/test-logo-rules.mjs` (last-but-one check), `scripts/test-background-upload-and-generator.mjs` and `scripts/test-background-generation.mjs` (the "nothing in the app uses these" checks, for `backgroundRules`). Patches 08 and 10 both edit `src/pages/ClientCommerceLiveStore.tsx` in different places; they were checked to apply together (08 first, then 10).

Patch 11 note: patches 08, 10 and 11 were checked to apply together and to compile and lint together (2026-11-24). Patch 11 edits `src/App.tsx` and `src/pages/OwnerPortal.tsx` (two one-line additions each) and adds `src/pages/OwnerBackgrounds.tsx`.

Patch 12 note: its import line sits at the END of `src/pages/ClientCommerceLiveStore.tsx` on purpose, so it never shares lines with patches 08 and 10, which edit the same page. Patches 08, 10, 11 and 12 were checked to apply together in three different orders and to compile and lint together (2026-11-24).
