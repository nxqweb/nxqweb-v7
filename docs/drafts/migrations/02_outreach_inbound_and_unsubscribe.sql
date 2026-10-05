-- DRAFT (not applied). Outreach opt-out and inbound reply handling. Additive only: one index and two
-- service-role functions. See docs/OUTREACH_MIGRATION_PLAN.md. search_path includes "extensions" so
-- digest() resolves wherever pgcrypto is installed.
create index if not exists nxq_sales_delivery_jobs_provider_message_idx
  on public.nxq_sales_delivery_jobs(provider_message_id) where provider_message_id is not null;

-- Idempotent and service-role only. Returns ok for an unknown prospect so callers cannot probe for addresses.
create or replace function public.nxq_sales_register_opt_out(
  target_prospect_id uuid, target_reason text, target_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
  if p.contact_email is not null and btrim(p.contact_email) <> '' then
    insert into public.nxq_sales_suppressions(scope, normalized_hash, reason, permanent, prospect_id, evidence)
    values ('email', encode(digest(lower(btrim(p.contact_email)), 'sha256'), 'hex'), target_reason, true, p.id,
            coalesce(target_evidence, '{}'::jsonb))
    on conflict (scope, normalized_hash) do nothing;
  end if;
  update public.nxq_sales_delivery_jobs set status = 'cancelled', updated_at = now()
    where prospect_id = p.id and status in ('queued', 'reserved');
  update public.nxq_sales_outreach_drafts set status = 'cancelled', updated_at = now()
    where prospect_id = p.id and status in ('draft', 'needs_review', 'approved');
  insert into public.nxq_sales_outreach_events(prospect_id, event_type, evidence)
    values (p.id, 'opt_out_recorded', jsonb_build_object('reason', target_reason) || coalesce(target_evidence, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'matched', true);
end $$;

-- Inbound reply, deduplicated by the provider event id. Intent comes from the deterministic classifier in
-- supabase/functions/_shared/outreach-compliance.ts (unsubscribe | complaint | auto_reply | other).
create or replace function public.nxq_sales_record_inbound_reply(
  target_provider_event_id text, target_from_email text, target_reply_text text, target_intent text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p public.nxq_sales_prospects%rowtype; reply_id uuid; cls text; review boolean; email_norm text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if target_intent not in ('unsubscribe', 'complaint', 'auto_reply', 'other') then raise exception 'Invalid reply intent.'; end if;
  if length(btrim(coalesce(target_provider_event_id, ''))) not between 1 and 200 then raise exception 'A provider event id is required.'; end if;
  email_norm := lower(btrim(coalesce(target_from_email, '')));
  if email_norm = '' then return jsonb_build_object('ok', true, 'matched', false); end if;
  select * into p from public.nxq_sales_prospects where lower(btrim(contact_email)) = email_norm limit 1 for update;
  if not found then return jsonb_build_object('ok', true, 'matched', false); end if;
  cls := case target_intent when 'unsubscribe' then 'unsubscribe' when 'complaint' then 'unsubscribe'
                            when 'auto_reply' then 'out_of_office' else 'unknown' end;
  review := target_intent in ('complaint', 'other');
  insert into public.nxq_sales_reply_events(prospect_id, provider_event_id, reply_text, classification, confidence, requires_owner_review, metadata)
    values (p.id, left(target_provider_event_id, 200), left(coalesce(target_reply_text, ''), 10000), cls,
            case when target_intent in ('unsubscribe', 'complaint') then 1 else null end, review,
            jsonb_build_object('intent', target_intent, 'source', 'inbound_webhook'))
    on conflict (provider_event_id) do nothing returning id into reply_id;
  if reply_id is null then return jsonb_build_object('ok', true, 'matched', true, 'duplicate', true); end if;
  if target_intent in ('unsubscribe', 'complaint') then
    perform public.nxq_sales_register_opt_out(p.id, case when target_intent = 'complaint' then 'complaint' else 'opt_out' end,
                                              jsonb_build_object('reply_id', reply_id));
  elsif target_intent = 'other' then
    update public.nxq_sales_prospects set status = 'replied', updated_at = now()
      where id = p.id and status not in ('do_not_contact', 'won', 'lost', 'archived');
    insert into public.nxq_sales_outreach_events(prospect_id, event_type, evidence)
      values (p.id, 'reply_recorded', jsonb_build_object('reply_id', reply_id));
  end if;
  return jsonb_build_object('ok', true, 'matched', true, 'duplicate', false, 'reply_id', reply_id,
                            'suppressed', target_intent in ('unsubscribe', 'complaint'));
end $$;

revoke all on function public.nxq_sales_register_opt_out(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.nxq_sales_record_inbound_reply(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nxq_sales_register_opt_out(uuid, text, jsonb) to service_role;
grant execute on function public.nxq_sales_record_inbound_reply(text, text, text, text) to service_role;
