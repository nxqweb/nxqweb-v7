-- Keep disposable QA clients outside the automatic billing artifact path.
-- The QA billing guards remain fail-closed; this prevents the older client-sync
-- trigger from attempting the forbidden insert in the first place.

begin;

create or replace function public.sync_client_billing_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.qa_only, false) then
    return new;
  end if;

  insert into public.billing_subscriptions (
    client_id, provider, amount, currency, next_charge_at, processor_connected, automation_enabled
  ) values (
    new.id,
    coalesce(nullif(new.billing_provider, ''), 'manual'),
    greatest(coalesce(new.monthly_price, 0), 0),
    'USD',
    new.billing_due_at,
    false,
    true
  )
  on conflict (client_id) do update
  set amount = greatest(coalesce(excluded.amount, 0), 0),
      provider = case
        when public.billing_subscriptions.processor_connected then public.billing_subscriptions.provider
        else excluded.provider
      end,
      next_charge_at = coalesce(excluded.next_charge_at, public.billing_subscriptions.next_charge_at),
      updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_client_billing_subscription()
from public, anon, authenticated;

comment on function public.sync_client_billing_subscription() is
  'Synchronizes billing only for real clients; permanent QA clients never enter a billing artifact path.';

commit;
