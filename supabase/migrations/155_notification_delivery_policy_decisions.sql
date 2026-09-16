-- Enforce notification preferences at delivery time.
-- Decisions are explicit so workers never guess: immediate, digest, defer, or blocked.

create or replace function public.notification_delivery_decision(target_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  d public.notification_deliveries%rowtype;
  p public.client_notification_preferences%rowtype;
  channel_enabled boolean:=true;
  local_now timestamp;
  local_hour integer;
  quiet boolean:=false;
  next_local timestamp;
  next_utc timestamptz;
begin
  select * into d from public.notification_deliveries where id=target_delivery_id;
  if not found then raise exception 'Notification delivery not found.'; end if;
  if d.client_id is null or d.recipient_kind <> 'client' then
    return jsonb_build_object('decision','immediate','reason','non_client_delivery');
  end if;
  select * into p from public.client_notification_preferences where client_id=d.client_id;
  if not found then
    return jsonb_build_object('decision',case when d.priority in ('high','urgent') then 'immediate' else 'digest' end,'reason','default_policy');
  end if;

  channel_enabled := case d.channel
    when 'email' then p.email_enabled
    when 'sms' then p.sms_enabled
    when 'push' then p.push_enabled
    when 'in_app' then p.in_app_enabled
    else true end;
  if not channel_enabled then return jsonb_build_object('decision','blocked','reason','channel_disabled'); end if;

  if d.priority in ('high','urgent') or (d.template_key like 'security_%' and p.allow_critical_override) then
    return jsonb_build_object('decision','immediate','reason','priority_or_critical_override');
  end if;

  local_now := timezone(p.timezone,now());
  local_hour := extract(hour from local_now)::integer;
  if p.quiet_hours_start is not null and p.quiet_hours_end is not null then
    quiet := case
      when p.quiet_hours_start = p.quiet_hours_end then false
      when p.quiet_hours_start < p.quiet_hours_end then local_hour >= p.quiet_hours_start and local_hour < p.quiet_hours_end
      else local_hour >= p.quiet_hours_start or local_hour < p.quiet_hours_end end;
  end if;

  if quiet then
    next_local := date_trunc('day',local_now) + make_interval(hours=>p.quiet_hours_end);
    if next_local <= local_now then next_local := next_local + interval '1 day'; end if;
    next_utc := next_local at time zone p.timezone;
    return jsonb_build_object('decision','defer','reason','quiet_hours','next_run_after',next_utc);
  end if;

  if p.digest_mode <> 'off' and d.channel in ('email','push') and d.priority in ('low','normal') and d.template_key <> 'notification_digest' then
    return jsonb_build_object('decision','digest','reason','digest_preference');
  end if;
  return jsonb_build_object('decision','immediate','reason','preference_allows_immediate');
end;
$$;

revoke all on function public.notification_delivery_decision(uuid) from public,anon,authenticated;
grant execute on function public.notification_delivery_decision(uuid) to service_role;

create or replace function public.prepare_notification_digests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; batch_uuid uuid; digest_count integer:=0; digest_key_value text; subject_value text; body_value text; delivery_uuid uuid; local_now timestamp; cadence_due boolean;
begin
  for r in
    select p.*, d.client_id,
           array_agg(d.id order by d.created_at) as delivery_ids,
           count(*) as delivery_count,
           min(d.created_at) as first_created,
           string_agg(coalesce(d.subject,d.template_key), E'\n• ' order by d.created_at) as subjects
    from public.notification_deliveries d
    join public.client_notification_preferences p on p.client_id=d.client_id
    where d.status='queued'
      and d.priority in ('low','normal')
      and d.recipient_kind='client'
      and d.channel in ('email','push')
      and d.template_key <> 'notification_digest'
      and p.digest_mode <> 'off'
      and d.run_after <= now()
    group by p.id,p.client_id,p.email_enabled,p.sms_enabled,p.push_enabled,p.in_app_enabled,p.digest_mode,p.digest_hour,p.quiet_hours_start,p.quiet_hours_end,p.timezone,p.allow_critical_override,p.created_at,p.updated_at,d.client_id
    having count(*)>0
    limit 100
  loop
    local_now := timezone(r.timezone,now());
    cadence_due := case r.digest_mode
      when 'hourly' then extract(minute from local_now)::integer < 15
      when 'daily' then extract(hour from local_now)::integer = r.digest_hour and extract(minute from local_now)::integer < 15
      when 'weekly' then extract(isodow from local_now)::integer = 1 and extract(hour from local_now)::integer = r.digest_hour and extract(minute from local_now)::integer < 15
      else false end;
    if not cadence_due then continue; end if;

    digest_key_value := 'digest:'||r.client_id::text||':'||r.digest_mode||':'||to_char(local_now,case r.digest_mode when 'hourly' then 'YYYYMMDDHH24' when 'daily' then 'YYYYMMDD' else 'IYYYIW' end);
    subject_value := case when r.delivery_count=1 then 'Your NXQ update' else 'Your NXQ updates ('||r.delivery_count::text||')' end;
    body_value := 'Here are your latest NXQ updates:'||E'\n• '||left(coalesce(r.subjects,''),6000);

    insert into public.notification_digest_batches(client_id,digest_key,status,delivery_count,delivery_ids,subject,body,scheduled_for)
    values(r.client_id,digest_key_value,'open',r.delivery_count,r.delivery_ids,subject_value,body_value,now())
    on conflict(digest_key) do nothing
    returning id into batch_uuid;
    if batch_uuid is null then continue; end if;

    insert into public.notification_deliveries(client_id,channel,recipient_kind,template_key,subject,body,priority,status,metadata)
    values(r.client_id,case when r.email_enabled then 'email' else 'push' end,'client','notification_digest',subject_value,body_value,'normal','queued',jsonb_build_object('digest_batch_id',batch_uuid,'source_delivery_ids',r.delivery_ids))
    returning id into delivery_uuid;

    update public.notification_digest_batches set status='queued',queued_delivery_id=delivery_uuid,updated_at=now() where id=batch_uuid;
    update public.notification_deliveries set status='cancelled',updated_at=now(),metadata=metadata||jsonb_build_object('batched_into_digest',batch_uuid)
    where id=any(r.delivery_ids) and status='queued';
    digest_count:=digest_count+1;
  end loop;
  return jsonb_build_object('ok',true,'digests_queued',digest_count,'ran_at',now());
end;
$$;

comment on function public.notification_delivery_decision(uuid) is 'Server-side notification policy authority. Handles disabled channels, quiet-hour deferral, digest routing and critical immediate delivery.';
