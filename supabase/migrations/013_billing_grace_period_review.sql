-- Move clients from past due into owner freeze review after 14 days.
-- This function never freezes a client automatically.
-- Project stages and launch status are never changed.

create or replace function public.advance_billing_grace_period()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_count integer := 0;
begin
  with moved_clients as (
    update public.clients
    set
      billing_status = 'freeze_review',
      billing_updated_at = now(),
      updated_at = now()
    where billing_status = 'past_due'
      and billing_overdue_since is not null
      and billing_overdue_since <= now() - interval '14 days'
    returning
      id,
      business_name,
      billing_provider,
      billing_overdue_since
  ),
  logged_events as (
    insert into public.activity_logs (
      client_id,
      actor_type,
      action,
      details
    )
    select
      moved_clients.id,
      'system',
      'billing_freeze_review',
      jsonb_build_object(
        'previous_billing_status', 'past_due',
        'billing_status', 'freeze_review',
        'billing_provider', moved_clients.billing_provider,
        'billing_overdue_since', moved_clients.billing_overdue_since,
        'grace_period_days', 14,
        'source', 'advance_billing_grace_period'
      )
    from moved_clients
    returning client_id
  )
  select count(*)
  into moved_count
  from logged_events;

  return jsonb_build_object(
    'success', true,
    'clients_moved_to_freeze_review', moved_count,
    'message',
      moved_count::text ||
      ' client(s) moved from past due to freeze review.'
  );
end;
$$;

revoke all
on function public.advance_billing_grace_period()
from public;

revoke all
on function public.advance_billing_grace_period()
from anon;

revoke all
on function public.advance_billing_grace_period()
from authenticated;

grant execute
on function public.advance_billing_grace_period()
to service_role;