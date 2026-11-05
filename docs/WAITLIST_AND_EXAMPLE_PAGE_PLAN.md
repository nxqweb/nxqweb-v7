# Waitlist for planned families, and a "see a real example" page - plans only

Written 2026-10-05. **Nothing here is built.** Both items need a product decision from the owner; the
waitlist also needs a migration, so it is a stop-and-ask gate. Not legal advice; the privacy wording
needs a lawyer's review before launch.

## 1. Waitlist for planned families (NXQ-Booking, Commerce, Menu, Property, Multi-Location, Membership)

**Why:** the home and plans pages show planned families but signup is closed. A waitlist turns that
interest into a list without opening a family early (the database trigger that blocks non-Business
families going public stays untouched).

**Collect the minimum:** email, family slug, optional business name. No phone number, no free text
(free text is where abuse and personal data sneak in). Show the purpose and a one-line consent
statement next to the button. Retention: delete or anonymize after the family opens or after 24 months.

**Abuse and privacy design**
- Double opt-in: a confirmation email must be clicked before the row counts (needs the email provider, which
  is blocked on the owner having a payment method). Until then the form must stay off.
- Same bot check as signup; rate limit per address and per source; the response is identical whether or not
  the address is already on the list (no enumeration).
- Server-only write path: a service-role function or a security-definer RPC with `anon` execute limited to
  that one function; the table itself has RLS on, no direct anon access, owner read only.
- One-click removal link in every message; the row is erased, not just flagged.

**Sketch (for the future migration, not a file in `supabase/migrations/`)**
`nxq_family_waitlist(id, family_slug, email_hash, email_encrypted_or_plain, business_name, confirmed_at,
created_at, removed_at)` with a unique index on `(family_slug, lower(email))`, RLS enabled, owner select policy,
RPC `join_family_waitlist(family_slug text, email text)`. Draft it under `docs/drafts/migrations/` with a sidecar
test first, like the other drafts.

**Order of work:** owner approves the data collected -> privacy inventory (`docs/PRIVACY_DATA_INVENTORY.md`)
updated -> draft SQL + test -> guarded staging apply -> function/form -> UI (the form slot already fits in
the families section) -> enable only after the email provider exists.

## 2. "See a real example" page

**Requirement:** one finished client site AND that client's written permission. Today there is no finished
client site, and the niche packs in `templates/business-v1/niches/` are demo-only (`demo_only: true`,
`launch_enabled: false`), so they must be labeled as demos, never as client work.

**Options**
- **Option A (recommended now):** a clearly labeled demo page ("Example build, fictional business") using a niche
  pack, with the same honesty rule as the Trusted-by strip. Gives sales something to show without any invented claim.
- **Option B (later):** a real client case study after permission, with only verified figures
  (`src/lib/socialProof.ts` is the single place they are added; it ships empty).
- **Option C:** skip until the first real launch.

**Build notes if A or B is chosen:** a new `/examples` route needs `scripts/smoke-built-routes.mjs` and the route
list updated in the same change. Embed the example as screenshots first; a live iframe must use `sandbox` and
point only at a site NXQ controls. Keep the page inside the public premium look (`.px` classes).

## 3. Trusted-by strip (already built, empty by design)

`src/components/TrustedBy.tsx` renders nothing until `src/lib/socialProof.ts` has entries. Rule written in that
file: add an entry only with the client's written agreement and a verifiable figure.
