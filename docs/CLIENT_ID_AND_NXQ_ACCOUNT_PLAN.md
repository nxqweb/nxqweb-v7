# Client IDs and the NXQX account - plan

Written 2026-10-05. **Nothing was applied or changed in `supabase/migrations/` or `src/`.**

## What already exists (migration 125 `nxq_universal_identity_foundation`, applied on staging)

- `nxq_accounts.nxq_id` - automatic account ID, e.g. `NXQ-90FCF718904840DB` (16 hex).
- `clients.client_code` - automatic NXQ-Web client ID, e.g. `WEB-F4C7065F0E80` (12 hex).
- `nxq_products`, `nxq_product_memberships` - an account can hold NXQ-Web (and later other products).
- `nxq_verification_claims` and per-product verification requirements - the foundation for "verify who
  you really are" before sensitive access.
- `nxq_organizations`, `enterprise_identity_connections` (SAML/OIDC/SCIM hooks) for enterprise sign-in.
- Clients already see both IDs on their website health page.

## Gap

The owner directory (`owner_client_directory_page`) does not return or search by these IDs.

## Option A - owner sees and searches IDs (drafted, tested locally, NOT applied)

`docs/drafts/migrations/02_owner_client_directory_v2.sql` adds `owner_client_directory_page_v2`: identical
to v1 plus `client_code` and `nxq_id`, searchable by either. Additive: v1 is untouched, so the current owner
page cannot break. Its sidecar test (13/13 local checks) proves: identifiers present and well formed, search
by lower-case code and by partial `nxq_id`, v2 matches v1 on every original column, cursor pagination, the
owner-only rule, no anon access.

Order if approved: (1) promote to a numbered migration and apply with the guarded workflow (owner
confirmation phrase); (2) only then change `OwnerPortal.tsx` to call v2 and show the IDs; (3) publish on
Netlify. Do not do step 2 before step 1: the page would call a function that does not exist yet.

## Option B - friendlier numbers

Optional display number (for example `WEB-000123`) from a sequence. Random IDs are harder to guess; if
wanted, show a short form of the existing code instead. Product decision.

## Option C - external login linked to Supabase (later, after launch)

Goal: a separate NXQX identity provider whose users map to Supabase accounts, with real-identity
verification for sensitive actions. Constraints:
- Touches every user's sign-in, so it is the main lockout risk. Needs a safe rollout: link by verified
  email, keep the existing password sign-in during migration, and keep a break-glass owner account.
- Supabase supports external identity providers (OIDC/SAML/third-party auth); SAML/SSO and some options may
  require a paid plan (verify at the time).
- Real-name/identity verification means a third-party service, cost and privacy duties (see
  `docs/PRIVACY_DATA_INVENTORY.md`).
- Do not start before launch gates are met and the owner has a payment method for the provider.
