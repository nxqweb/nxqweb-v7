-- DRAFT 12: test clients stop counting as revenue. LOCAL ONLY, NOT promoted, NOT applied. Written 2026-10-26 (owner chose "Draft it").
--
-- Why: the owner dashboard's Active MRR and Pipeline value come from owner_portal_summary() (migration 217), which adds up monthly_price for every client with
-- billing_status 'active' (MRR) and every client that is not archived, denied or dormant (pipeline). The owner screen's "Activate billing (no charge)" button calls the SAME
-- function as recording a real by-hand payment (owner_set_client_billing_state, provider "manual"), so a test client that was activated for free looked exactly like a paying
-- customer: with four test clients active the dashboard showed about $600/mo of revenue that does not exist.
--
-- What this does (no new tables or columns; billing_provider is a free text column that no code compares and that has no allowed-values rule):
--  1. Redefines owner_portal_summary() so a client whose billing_provider is 'complimentary' is left out of active_monthly_revenue and pipeline_monthly_value. Same signature, same
--     owner-only check, same grants. total_clients and active_clients still COUNT those accounts (they are real accounts; only the money is excluded).
--  2. Labels the four staging test clients created on 2026-10-25 as complimentary, by exact business name, only while their billing is active and they are not qa_only
--     (qa_only clients can never be activated by design). Safe to re-run: a second run changes nothing, and on a database without those names it changes nothing.
-- The app change that goes with this (already in the repo, harmless on its own) makes the owner's "Activate billing (no charge)" button write provider 'complimentary' from now on.
--
-- NOT in this file, on purpose: back-filling the missing website style on clients that submitted before the 2026-10-26 form fix. That makes the onboarding check (which re-runs on a
-- schedule for every approved client) move those clients forward, so it is a separate owner decision: docs/OWNER_STYLE_BACKFILL.md, with a preview query to run first.

create or replace function public.owner_portal_summary()
returns table (
  total_clients bigint,
  active_clients bigint,
  active_monthly_revenue numeric,
  pipeline_clients bigint,
  pipeline_monthly_value numeric,
  unread_client_messages bigint,
  pending_approvals bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  return query
  select
    (select count(*) from public.clients)::bigint,
    (select count(*) from public.clients c where c.billing_status::text = 'active')::bigint,
    coalesce((select sum(c.monthly_price) from public.clients c where c.billing_status::text = 'active' and coalesce(c.billing_provider, '') <> 'complimentary'), 0)::numeric,
    (select count(*) from public.clients c where c.status::text not in ('archived', 'denied', 'dormant'))::bigint,
    coalesce((select sum(c.monthly_price) from public.clients c where c.status::text not in ('archived', 'denied', 'dormant') and coalesce(c.billing_provider, '') <> 'complimentary'), 0)::numeric,
    (select count(*) from public.client_messages m where m.sender_type::text = 'client' and m.owner_seen_at is null)::bigint,
    (select count(*) from public.owner_approval_requests a where a.status::text = 'pending')::bigint;
end;
$$;

revoke all on function public.owner_portal_summary() from public, anon;
grant execute on function public.owner_portal_summary() to authenticated, service_role;

comment on function public.owner_portal_summary() is
  'Owner-only global portal metrics. Clients whose billing_provider is complimentary (free test clients) are excluded from active_monthly_revenue and pipeline_monthly_value but still counted as accounts. The UI depends on this stable contract instead of deriving company totals from a paged client list.';

-- One-time label for the staging test clients (exact names; idempotent).
update public.clients
   set billing_provider = 'complimentary', updated_at = now()
 where business_name in ('Tier Test Starter', 'Tier Test Growth', 'Tier Test Intelligence', 'Tier Test Enterprise')
   and billing_status::text = 'active'
   and coalesce(qa_only, false) = false
   and coalesce(billing_provider, '') <> 'complimentary';
