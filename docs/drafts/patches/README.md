# Parked front-end patches (NOT applied)

A patch here is finished, tested screen work that calls database functions which only exist in a draft migration.
The CI rule "every source RPC call has a captured migration definition" (correctly) refuses such calls in `src/`,
so the screens wait here until the owner approves promoting the draft.

| Patch | Needs draft | What it adds |
|---|---|---|
| `08_store_shipping_frontend.patch` | `docs/drafts/migrations/08_store_shipping_fee.sql` | Store page: shipping line, free-over hint, pickup choice. Live store page: the owner's Shipping fee card. Tests for both. |
| `09_late_payment_frontend.patch` | `docs/drafts/migrations/09_confirm_late_direct_payment.sql` | Orders page: a button on an automatically cancelled order, 'The money arrived: reopen and mark paid'. Test for it. |

To apply after the draft is promoted to a real migration: `git apply docs/drafts/patches/<name>.patch`, then `npm run test:ci-parity`.
If the patch no longer applies because the files changed, re-make the same edits by hand; the patch is the reference.

A patch goes stale whenever the pages it touches change. `scripts/test-parked-patches.mjs` fails as soon as that happens (and every patch must be listed in it). To refresh: commit your work, run `git apply --3way docs/drafts/patches/<name>.patch`, fix any conflict, run the store tests (two shipping checks fail on purpose while the screens are wired), write the new diff of the parked files over the patch, then take the screens out again with `git apply -R`.
