-- Enforce notification preference integrity even for direct RLS writes.

create or replace function public.validate_client_notification_preferences()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.digest_mode not in ('off','hourly','daily','weekly') then raise exception 'Unsupported digest mode.'; end if;
  if new.digest_hour not between 0 and 23 then raise exception 'Digest hour must be between 0 and 23.'; end if;
  if new.quiet_hours_start is not null and new.quiet_hours_start not between 0 and 23 then raise exception 'Quiet-hours start must be between 0 and 23.'; end if;
  if new.quiet_hours_end is not null and new.quiet_hours_end not between 0 and 23 then raise exception 'Quiet-hours end must be between 0 and 23.'; end if;
  new.timezone:=btrim(coalesce(new.timezone,''));
  if new.timezone='' or not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Unsupported timezone.'; end if;
  new.updated_at:=now();
  return new;
end;
$$;

drop trigger if exists validate_client_notification_preferences on public.client_notification_preferences;
create trigger validate_client_notification_preferences
before insert or update on public.client_notification_preferences
for each row execute function public.validate_client_notification_preferences();

revoke all on function public.validate_client_notification_preferences() from public,anon,authenticated;

create or replace function public.prepare_notification_digests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; batch_uuid uuid; digest_count integer:=0; digest_key_value text; subject_value text; body_value text; delivery_uuid uuid; local_now timestamp; cadence_due boolean; digest_channel text;
begin
  for r in
    select p.*, d.client_id,
           array_agg(d.id order by d.created_at) as delivery_ids,
           count(*) as delivery_count,
           string_agg(coalesce(d.subject,d.template_key), E'\n• ' order by d.created_at) as subjects
    from public.notification_deliveries d
    join public.client_notification_preferences p on p.client_id=d.client_id
    where d.status='queued'
      and d.priority in ('low','normal')
      and d.recipient_kind='client'
      and d.channel in ('email','push')
      and d.template_key <> 'notification_digest'
      and p.digest_mode <> 'off'
      and (p.email_enabled or p.push_enabled)
      and d.run_after <= now()
    group by p.id,p.client_id,p.email_enabled,p.sms_enabled,p.push_enabled,p.in_app_enabled,p.digest_mode,p.digest_hour,p.quiet_hours_start,p.quiet_hours_end,p.timezone,p.allow_critical_override,p.created_at,p.updated_at,d.client_id
    having count(*)>0
    limit 100
  loop
    batch_uuid:=null; delivery_uuid:=null;
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
    digest_channel:=case when r.email_enabled then 'email' when r.push_enabled then 'push' else null end;
    if digest_channel is null then continue; end if;

    insert into public.notification_digest_batches(client_id,digest_key,status,delivery_count,delivery_ids,subject,body,scheduled_for)
    values(r.client_id,digest_key_value,'open',r.delivery_count,r.delivery_ids,subject_value,body_value,now())
    on conflict(digest_key) do nothing
    returning id into batch_uuid;
    if batch_uuid is null then continue; end if;

    insert into public.notification_deliveries(client_id,channel,recipient_kind,template_key,subject,body,priority,status,metadata)
    values(r.client_id,digest_channel,'client','notification_digest',subject_value,body_value,'normal','queued',jsonb_build_object('digest_batch_id',batch_uuid,'source_delivery_ids',r.delivery_ids))
    returning id into delivery_uuid;

    update public.notification_digest_batches set status='queued',queued_delivery_id=delivery_uuid,updated_at=now() where id=batch_uuid;
    update public.notification_deliveries set status='cancelled',updated_at=now(),metadata=metadata||jsonb_build_object('batched_into_digest',batch_uuid)
    where id=any(r.delivery_ids) and status='queued';
    digest_count:=digest_count+1;
  end loop;
  return jsonb_build_object('ok',true,'digests_queued',digest_count,'ran_at',now());
end;
$$;

comment on function public.validate_client_notification_preferences() is 'Database-level guard preventing invalid timezone/hour data from breaking the autonomous notification worker.';
