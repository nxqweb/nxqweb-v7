# Parked front-end patches (NOT applied)

A patch here is finished, tested screen work that calls database functions which only exist in a draft migration.
The CI rule "every source RPC call has a captured migration definition" (correctly) refuses such calls in `src/`,
so the screens wait here until the owner approves promoting the draft.

| Patch | Needs draft | What it adds |
|---|---|---|
| `08_store_shipping_frontend.patch` | `docs/drafts/migrations/08_store_shipping_fee.sql` | Store page: shipping line, free-over hint, pickup choice. Live store page: the owner's Shipping fee card. Tests for both. |

To apply after the draft is promoted to a real migration: `git apply docs/drafts/patches/<name>.patch`, then `npm run test:ci-parity`.
If the patch no longer applies because the files changed, re-make the same edits by hand; the patch is the reference.
