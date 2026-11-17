-- Draft 07: tell the shop owner when a real order comes in (added 2026-11-17). Additive only: one function + one trigger on commerce_orders.
-- Writes ONE in-app notification with fixed wording (no shopper name, email, address or order text is copied), so nothing a shopper types can reach an email.
-- Email copy is produced later by the shared allow-list ("new_order"); it stays inert while NXQ_EMAIL_NOTIFICATIONS_ENABLED is off.
-- Test orders (is_test) never notify. A notification failure must never block an order, so errors are swallowed.

create or replace function public.queue_new_order_owner_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_test is true then return new; end if;
  begin
    insert into public.notification_deliveries(client_id, channel, recipient_kind, template_key, subject, body, priority, metadata)
    values (new.client_id, 'in_app', 'client', 'new_order', 'New store order',
            'You have a new order. Sign in to your NXQX portal to see it and confirm payment.',
            'high', jsonb_build_object('order_id', new.id));
  exception when others then
    null; -- never block a shopper's order because a notification failed
  end;
  return new;
end;
$$;

revoke all on function public.queue_new_order_owner_notification() from public, anon, authenticated;

drop trigger if exists queue_new_order_owner_notification_trigger on public.commerce_orders;
create trigger queue_new_order_owner_notification_trigger
  after insert on public.commerce_orders
  for each row execute function public.queue_new_order_owner_notification();
