# Owner runbook: activate billing for a complimentary / test client (no charge)

Written 2026-10-05. Tested on a local copy of the full schema (`scripts/test-local-full-schema.mjs` database), NOT on staging.

## Why this exists
A client must have `billing_status` `active` (or `past_due`) **and** `status` `approved`/`active`/`overdue` before the server accepts any
file upload or paid capability (`nxq_authorize_storage_upload`, `nxq_authorize_paid_capability`). A brand-new signup starts as
`status = lead`, `billing_status = not_configured`. `/owner/billing` has no control to move a client from `not_configured` to `active`, although the
guarded owner function allows it. QA-only clients (`qa_only = true`, e.g. "NXQ QA Tree Service 02") can NEVER be activated by design.

## Two separate gates (do both, in this order)
1. **Approval (status).** Use the normal owner approval in the owner portal (accept the website setup review). Do NOT edit `clients.status` by hand:
   the `bootstrap_client_automation_after_approval` trigger starts automation (provisioning/build jobs) and a direct status edit is explicitly
   "not an approval substitute".
2. **Billing (this runbook).** Flip billing to `active` with no charge, using the existing guarded owner function. It only changes the billing flag; it does
   not call Stripe, charge money, or change the project stage.

## Find the ids (Supabase SQL editor, staging project only)
```sql
select id, business_name, status, billing_status, qa_only from public.clients order by created_at desc limit 20;
select auth_user_id from public.owner_users;   -- your owner login's auth user id
```
Only use a client whose `qa_only` is false and whose `billing_status` is `not_configured` or `activation_pending`.

## The block (replace both ids; run once)
```sql
do $$
declare
  owner_id uuid := 'PASTE-OWNER-AUTH-USER-ID';
  target   uuid := 'PASTE-CLIENT-ID';
  res jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  res := public.owner_set_client_billing_state(target, 'active'::public.billing_status, 'manual', 'Complimentary test client, no charge');
  raise notice 'RESULT: %', res;
end $$;
```
Expected notice: `... billing changed from not configured to active.` with `"success": true`.

## Verified refusals (so mistakes are safe)
- QA-only client: `QA-only clients are permanently non-billable.`
- Caller not in `owner_users`: `Owner access required.`
- Already active: no change.

## Undoing it
You cannot set a client back to `not_configured`. Allowed moves from `active` are `past_due` (then `freeze_review`/`cancelled`) or `cancelled` (needs a note of at least 8 characters).
So use this only for genuine complimentary or test clients.

## Then
With status approved AND billing active, the client can upload; scans are woken by the dispatcher
(run `NXQ Staging Worker Dispatcher` manually from the safe branch until the `nxq-staging` environment allows `main`).
