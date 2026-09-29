-- Closes the billing_notification_events dead channel found in the final
-- release-focused audit: every billing event (payment_succeeded,
-- payment_failed, past_due_reminder, billing_processor_connection_required,
-- freeze_review_owner_attention) was written through the single choke
-- point record_billing_notification() (migration 100) but never read
-- anywhere in src/ or supabase/functions/ -- a dead write-only table.
--
-- Recipient audit before drafting this migration corrected an assumption:
-- billing_processor_connection_required is NOT client-facing. Reading its
-- call site (migration 100, queue_due_billing_attempts()) shows it fires
-- when NXQ's own payment processor isn't connected -- something only NXQ
-- can act on -- and it is already paired there with an
-- automation_escalations row meant for the owner. So three events are
-- client-facing (payment_succeeded, payment_failed, past_due_reminder)
-- and two are owner-facing (billing_processor_connection_required,
-- freeze_review_owner_attention), not four-and-one.
--
-- This migration only extends record_billing_notification() to also
-- insert into the already-existing, already-working notification_deliveries
-- table -- the same channel/recipient_kind pattern already established for
-- migrations 248/249/250. No new table, no privilege change. The
-- billing_notification_events insert/upsert behavior is unchanged; the new
-- notification_deliveries insert only fires on a genuinely new event (not
-- an idempotent replay of the same idempotency_key), using the standard
-- `xmax = 0` upsert-detection idiom so retried calls never duplicate a
-- notification.
--
-- Honest scope note: as with every other in-app notification already in
-- this schema, inserting a notification_deliveries row gets the event
-- recorded and dispatched (marked delivered, or actually sent if an
-- external email/SMS provider is ever configured) -- but no page in this
-- app currently renders notification_deliveries content proactively to a
-- client. That is a pre-existing, broader gap affecting every notification
-- this codebase produces, not something this migration alone can or
-- should fix. The owner side is different: owners already have blanket
-- read access to notification_deliveries via the existing
-- owner_manage_all_notifications policy (migration 133), so a frontend-only
-- read (no migration needed) is enough to make the two owner-facing events
-- genuinely visible in the Owner Portal -- added separately alongside this
-- migration in OwnerBillingLifecycle.tsx.
--
-- This migration is staged for review; it has not been applied to any
-- database.

create or replace function public.record_billing_notification(
  target_client_id uuid,
  target_event_type text,
  target_idempotency_key text,
  target_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
  is_new_event boolean;
  business_name_value text;
  recipient text;
  template_key_value text;
  subject_text text;
  body_text text;
  priority_text text := 'normal';
  amount_text text;
begin
  with upsert as (
    insert into public.billing_notification_events (
      client_id, event_type, idempotency_key, payload
    ) values (
      target_client_id,
      target_event_type,
      target_idempotency_key,
      coalesce(target_payload, '{}'::jsonb)
    )
    on conflict (idempotency_key) do update
      set idempotency_key = excluded.idempotency_key
    returning id, (xmax = 0) as inserted
  )
  select id, inserted into saved_id, is_new_event from upsert;

  if is_new_event then
    select business_name into business_name_value from public.clients where id = target_client_id;
    amount_text := '$' || to_char(coalesce((target_payload->>'amount')::numeric, 0), 'FM999999990.00');

    case target_event_type
      when 'payment_succeeded' then
        recipient := 'client';
        template_key_value := 'billing_payment_succeeded';
        subject_text := 'Payment received';
        body_text := 'NXQ received your payment of ' || amount_text || '. Your account is active.';
      when 'payment_failed' then
        recipient := 'client';
        template_key_value := 'billing_payment_failed';
        subject_text := 'Payment could not be processed';
        body_text := 'NXQ could not process your payment of ' || amount_text || '. Please check your payment method; NXQ will retry automatically.';
        priority_text := 'high';
      when 'past_due_reminder' then
        recipient := 'client';
        template_key_value := 'billing_past_due_reminder';
        subject_text := 'Your account is past due';
        body_text := 'Your NXQ billing is past due. Your website service remains available during the grace period while this is resolved.';
        priority_text := 'high';
      when 'billing_processor_connection_required' then
        recipient := 'owner';
        template_key_value := 'billing_processor_connection_required';
        subject_text := 'Billing processor not connected: ' || coalesce(business_name_value, 'a client');
        body_text := coalesce(business_name_value, 'A client') || ' had a billing charge attempt of ' || amount_text || ' blocked because no real payment processor is connected. No charge was attempted.';
      when 'freeze_review_owner_attention' then
        recipient := 'owner';
        template_key_value := 'billing_freeze_review_owner_attention';
        subject_text := 'Billing freeze review needed: ' || coalesce(business_name_value, 'a client');
        body_text := coalesce(business_name_value, 'A client') || '''s grace period has ended. A human freeze decision is needed; NXQ has not frozen the account automatically.';
        priority_text := 'high';
      else
        recipient := null;
    end case;

    if recipient is not null then
      insert into public.notification_deliveries (
        client_id, channel, recipient_kind, template_key, subject, body, priority, metadata
      ) values (
        target_client_id, 'in_app', recipient, template_key_value, subject_text, body_text, priority_text,
        jsonb_build_object('billing_notification_event_id', saved_id, 'event_type', target_event_type) || coalesce(target_payload, '{}'::jsonb)
      );
    end if;
  end if;

  return saved_id;
end;
$$;

comment on function public.record_billing_notification(uuid, text, text, jsonb) is
  'Records a billing_notification_events row and, on a genuinely new event (not an idempotent replay), also delivers it through notification_deliveries -- client-facing for payment_succeeded/payment_failed/past_due_reminder, owner-facing for billing_processor_connection_required/freeze_review_owner_attention. Identical to migration 100''s version otherwise.';
