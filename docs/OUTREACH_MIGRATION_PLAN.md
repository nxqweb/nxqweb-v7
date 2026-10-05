# Outreach: migration and deployment plan (reply handling, unsubscribe, sender schedule)

Status: **PLAN ONLY (2026-10-05).** No file was added to `supabase/migrations/`, nothing was
applied, deployed, scheduled or configured. The SQL below is a reviewed sketch in a document so it
cannot be picked up or applied by accident. Every step marked (gate) needs the owner's explicit
approval and, for staging changes, the guarded workflow with the confirmation phrase. Not legal
advice; a lawyer should review the email templates and unsubscribe wording before any real send.

## 1. What already exists (verified in the code)

- Tables: `nxq_sales_prospects`, `nxq_sales_contact_permissions`, `nxq_sales_outreach_drafts`,
  `nxq_sales_delivery_jobs`, `nxq_sales_suppressions`, `nxq_sales_reply_events`,
  `nxq_sales_outreach_events`, `nxq_sales_outreach_settings` (migrations 129-130 era and the
  "guarded AI client finder" migration). All have RLS, owner read policies, service-role writes.
- Service-role RPCs: `nxq_queue_sales_delivery`, `nxq_reserve_sales_delivery`,
  `nxq_record_sales_delivery_event` (hard bounce and complaint add a permanent suppression and set
  do-not-contact; bounce/complaint rates over the configured percentages switch on the emergency
  stop), `nxq_create_due_sales_followup_drafts`.
- Owner-only RPC: `owner_record_sales_reply` (records a reply, revokes permission and adds a
  suppression on "unsubscribe"). It checks `is_nxq_owner()` so a background worker cannot call it.
- Safe defaults: `emergency_stop = true`, `automation_mode = review_only`,
  `external_delivery_enabled = false`, daily cap 20 (max 50), send window 09:00-16:30 weekdays.
- Local code (commits 7cb617a, fbff8bd; not deployed): `_shared/outreach-compliance.ts`,
  `_shared/outreach-dispatch.ts` and their offline tests.

## 2. The three gaps

1. **Unsubscribe is not automatic.** The footer currently tells people to reply "unsubscribe", but
   nothing reads replies. Compliance needs an opt-out that works without a human.
2. **Provider events are not ingested.** Bounces and spam complaints reach the database only through
   `nxq_record_sales_delivery_event`, which nothing calls yet.
3. **Nothing wakes the sender.** There is no Edge function and no cron entry for it.

Design choice: make the **signed unsubscribe link** the primary opt-out (automatic, one click,
works with mail-client unsubscribe buttons). Reply ingestion becomes optional; until it exists,
replies are handled by the owner with the existing `owner_record_sales_reply`, and the footer
wording must say so truthfully.

## 3. Proposed migration (now numbered 258 or later; 257 is the pgcrypto repair) - `outreach_inbound_and_unsubscribe` (gate)

Additive only: one index and two service-role functions. No table or column is changed, so existing
callers cannot break. Final SQL must pass the local full-schema test, the RPC argument-name
contract check, the trigger-field check and the Data API grant audit before it is proposed.

```sql
create index if not exists nxq_sales_delivery_jobs_provider_message_idx
  on public.nxq_sales_delivery_jobs(provider_message_id) where provider_message_id is not null;

-- Idempotent, service-role only. Never reveals whether an address exists (returns ok either way).
create or replace function public.nxq_sales_register_opt_out(
  target_prospect_id uuid, target_reason text, target_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.nxq_sales_prospects%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if target_reason not in ('opt_out','complaint') then raise exception 'Invalid opt-out reason.'; end if;
  select * into p from public.nxq_sales_prospects where id = target_prospect_id for update;
  if not found then return jsonb_build_object('ok', true, 'matched', false); end if;
  update public.nxq_sales_prospects set status = 'do_not_contact',
    do_not_contact_reason = 'Recipient ' || target_reason,
    do_not_contact_at = coalesce(do_not_contact_at, now()), updated_at = now() where id = p.id;
  update public.nxq_sales_contact_permissions set status = 'revoked',
    revoked_at = coalesce(revoked_at, now()), updated_at = now()
    where prospect_id = p.id and status <> 'revoked';
  if p.contact_email is not null then
    insert into public.nxq_sales_suppressions(scope, normalized_hash, reason, permanent, prospect_id, evidence)
    values ('email', encode(digest(lower(btrim(p.contact_email)), 'sha256'), 'hex'),
            target_reason, true, p.id, coalesce(target_evidence, '{}'::jsonb))
    on conflict (scope, normalized_hash) do nothing;
  end if;
  update public.nxq_sales_delivery_jobs set status = 'cancelled', updated_at = now()
    where prospect_id = p.id and status in ('queued','reserved');
  update public.nxq_sales_outreach_drafts set status = 'cancelled', updated_at = now()
    where prospect_id = p.id and status in ('draft','needs_review','approved');
  insert into public.nxq_sales_outreach_events(prospect_id, event_type, evidence)
    values (p.id, 'opt_out_recorded', jsonb_build_object('reason', target_reason) || coalesce(target_evidence, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'matched', true);
end $$;

-- Inbound reply, deduplicated by the provider event id. Intent comes from the deterministic
-- classifier in _shared/outreach-compliance.ts (unsubscribe | complaint | auto_reply | other).
create or replace function public.nxq_sales_record_inbound_reply(
  target_provider_event_id text, target_from_email text, target_reply_text text, target_intent text)
returns jsonb language plpgsql security definer set search_path = public as $$
-- find prospect by lower(btrim(contact_email)); insert into nxq_sales_reply_events with
-- ON CONFLICT (provider_event_id) DO NOTHING; map intent -> classification
-- (unsubscribe/complaint -> 'unsubscribe', auto_reply -> 'out_of_office', other -> 'unknown');
-- requires_owner_review = intent not in ('unsubscribe','auto_reply'); on unsubscribe/complaint
-- call nxq_sales_register_opt_out; otherwise set prospect status 'replied'. Duplicate events
-- return {ok:true,duplicate:true}. Unknown sender returns {ok:true,matched:false}.
$$;

revoke all on function public.nxq_sales_register_opt_out(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.nxq_sales_record_inbound_reply(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nxq_sales_register_opt_out(uuid, text, jsonb) to service_role;
grant execute on function public.nxq_sales_record_inbound_reply(text, text, text, text) to service_role;
```
Open detail: pgcrypto's `digest` schema. Follow whatever resolution the existing outreach
migrations and the local full-schema test accept (migration "repair_commerce_pgcrypto_schema_resolution"
shows this has bitten before).

**Update 2026-10-05:** the SQL for 257 now exists as a tested DRAFT in
`docs/drafts/migrations/01_outreach_inbound_and_unsubscribe.sql` (with its sidecar test), using
`set search_path = public, extensions`. It is not in `supabase/migrations/` and is not applied. A suspected
pgcrypto path problem in 7 existing functions (including the three sales delivery functions this plan
depends on) is described in the handoff; the repair is now committed as migration 257 (approved to add; not applied).

## 4. Edge functions to add (code, then a guarded deploy) (gate)

| Function | Auth | Job |
|---|---|---|
| `dispatch-sales-outreach` | worker token | Thin wrapper over `runOutreachDispatch` using the existing RPCs; holds unless all switches are on |
| `sales-unsubscribe` | public, signed token | RFC 8058 one-click (POST) plus a confirm page (GET). Token = HMAC of prospect id; constant-time check; calls `nxq_sales_register_opt_out`; same response whether or not the address exists; rate limited |
| `ingest-sales-email-events` | provider webhook signature | Maps bounce -> `hard_bounce`, complaint -> `complaint`, looks the job up by `provider_message_id`, calls `nxq_record_sales_delivery_event`. Verify the provider's actual signature scheme from its docs first |

Each new function must be registered in `scripts/edge-function-manifest.mjs`, `supabase/config.toml`
and the runtime secret profiles, and added to the Vault route list only if cron wakes it. Doing this
before the function is deployed makes the staging `workers_deployed` check fail, so registration and
the guarded deploy happen in the same step.

New secret names (values set by the owner only, never in chat or source), subject to your choice:
`NXQ_SALES_DELIVERY_ENABLED` (server switch), `NXQ_SALES_UNSUBSCRIBE_SECRET`,
`NXQ_SALES_EMAIL_WEBHOOK_SECRET`, and a **separate** email API key for sales mail so cold-outreach
reputation cannot damage the transactional notification sender.

The email footer gains an unsubscribe link on **our own domain** (added by `buildOutboundEmail`,
never by the AI, so the draft validator's no-links rule stays intact) and the header
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

## 5. Proposed migration 258 - `schedule_sales_outreach_dispatch` (gate)

Follows the existing notification pattern (`145_schedule_notification_dispatcher`): a Vault route
`nxq_sales_dispatch_url` and a cron job `nxq-sales-outreach-dispatch` that calls the function only
when due work exists (approved drafts without a job, or queued jobs due), every 10 minutes, weekdays.
**Apply only after `dispatch-sales-outreach` is deployed**, otherwise cron posts to a missing
function and creates escalation noise. Even when scheduled, the function holds while emergency stop
is on, so scheduling alone sends nothing.

## 6. Order of operations

1. Finish function code and tests locally (no gate). Local checks: lint, types, build, all `test:*`
   scripts, the disposable-database full-schema test with migration 257 added, RPC contract and
   Data API grant audits.
2. Owner reviews this plan and the final SQL (approval).
3. Guarded `apply_migrations` for 257 on staging (confirmation phrase), then read-only validators.
4. Guarded deploy of the three functions plus manifest/config changes.
5. Owner sets secrets; separate sending domain with SPF, DKIM, DMARC; provider account.
6. Dry run with emergency stop **on**: confirm every hold reason reports correctly.
7. Apply migration 258 (cron). Still held.
8. First real send: a seeded prospect that is the owner's own address, `review_only` -> `guarded`,
   daily cap 1-5, emergency stop off for that test only. Test unsubscribe link, bounce, complaint.
9. Lawyer-approved templates, then raise the cap gradually. Never SMS. US only.

## 7. Risks and mitigations

- Missed opt-out: link-based opt-out is automatic and global; the classifier over-suppresses; owner
  keeps `owner_record_sales_reply` for manual cases; cancelled jobs and drafts cannot send.
- Unsubscribe abuse or guessing: HMAC token, constant-time compare, no existence leak, rate limit.
- Reply text is untrusted: stored as data, shown to the owner as text, never given to an AI with tools.
- Duplicate sends: queue key `sales-delivery:<draft>`, send key `sales-send:<job>`, a job can only be
  reserved once, a crash leaves it reserved (never resent).
- Deliverability: separate sending domain, warm-up caps, automatic emergency stop on bounce/complaint
  rates (already in the database).
- Migration risk: additive only; no changed signatures, tables or policies.

## 8. Rollback

Drop the two new functions and the index; unschedule `nxq-sales-outreach-dispatch`; turn
`emergency_stop` on (one setting) at any time. No data is deleted by any step.

## 9. Decisions needed from the owner

1. Approve migration 257 and the three-function design (or request changes).
2. Email provider and a sending domain for sales mail (separate from transactional).
3. Whether to keep reply-ingestion out of scope for now (recommended) and say "unsubscribe via the
   link below" in the footer instead of "reply unsubscribe".
4. Sales mail API key as a separate secret (recommended).
5. Lawyer review of templates before step 8.
