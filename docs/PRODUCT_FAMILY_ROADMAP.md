# Product family roadmap (audit written 2026-10-16)

What exists in the repository today for each NXQX product family, what is missing, and the next safe step. Facts come from
`src/lib/productCatalog.ts`, `supabase/migrations/`, `src/pages/`, and `git ls-remote` (no `safe/family/*` branches exist on origin).
Nothing here changes any status or launches anything; every public-status change, migration apply, or deploy still needs the owner's approval.

| Family | Catalog status | Intake questions | Database | Client pages | Public/signup | Honest state |
|---|---|---|---|---|---|---|
| NXQX-Business | available | 4 | Full (leads, builds, workers, billing) | Full portal | Open signup | The only launched family |
| NXQX-Commerce | planned | yes | Catalog, inventory, orders, storefront rows; migration 269 (store profile) written, not applied | 14 client pages + public `/store/<slug>` | Signup falls back to Business; plan switch is owner-approved | Built and locally tested; staging apply + deploy pending |
| NXQX-Booking | planned | 4 | Scaffold only (migration 188: workspaces, services, staff, availability rules, appointment requests; no public endpoint) | None | None | Schema scaffold, no UI |
| NXQX-Menu | planned | 4 | Migration 271 (menu mode for a store: view-only items, contact to order); builds on 270 | None of its own: a store set to "Menu only" on `/client/commerce/live`, shown at `/store/<slug>` | None | v1 built locally (migrations 270 and 271 written, not applied); no signup path, no categories/hours fields yet (hours go in About) |
| NXQX-Property | planned | 4 | None | None | None | Catalog copy only |
| NXQX-Multi-Location | planned | 4 | None (Business has `ClientBusinessLocations` for its own use) | None | None | Catalog copy only |
| NXQX-Membership | planned | 4 | None | None | None | Catalog copy only |
| NXQX-Enterprise Systems | private | 4 | Identity/privacy hooks only (migration 140) | None | Invite only | Sales-led, not self-serve |

## Findings

1. Commerce is the only non-Business family with real product surface. Booking has a schema and nothing else. The other five exist as
   catalog entries that feed the intake form and the owner's family list.
2. `planned` families cannot be chosen at signup (migration 193 only allows `available`/`beta`), so a client who picks one silently becomes a
   Business client. That is safe, but it should be communicated on the plans page (owner decision, see below).
3. No family has a launch-readiness gate row of its own in `docs/LAUNCH_HARDENING_CHECKLIST.md`; `nxq_product_family_blueprints` (migration
   188) is the intended place, and requires 10 clean QA runs before `launch_enabled` can be true.

## Suggested order (reasoning: reuse what Commerce just proved)

1. **Commerce**: finish staging apply of 269, deploy after Oct 22, run `docs/COMMERCE_TEST_PLAN.md`. Biggest gain, nearly done.
2. **Menu** (restaurants, cafes): v1 is built as a store mode (see above). Next steps: sections by category, an hours field, and a signup path
   once Commerce has proven itself. Promote 06 to a real migration (271) only with the owner's approval; when promoting, update the 270 regression
   test because 06 changes the wording of the unknown-mode error and the default list of modes.
3. **Booking**: schema exists; next safe step is a draft migration for owner-facing RPCs (list/save services, availability) plus a client
   page, with a request-only public form (no payments, no reminders until an email domain exists).
4. **Membership**, **Property**, **Multi-Location**: need product decisions (payments for membership, listing source for property, routing
   rules for multi-location) before any build.
5. **Enterprise Systems**: stays private and sales-led.

## Owner decisions this needs (none taken yet)

- Option A: Build Menu next as a draft-only family (drafts in `docs/drafts/migrations/`, nothing applied). Option B: build Booking RPC drafts
  first. Option C: stay on Commerce until it has a real customer, then pick.
- Whether the plans page should say "coming soon, you will start on Business until then" for planned families.

## Not done on purpose

No catalog status changed, no migration written into `supabase/migrations/`, no workflow edited, no branch created.
