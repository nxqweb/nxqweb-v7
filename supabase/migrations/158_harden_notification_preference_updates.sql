-- Narrow client RPC for notification preferences with timezone and hour validation.

create or replace function public.current_client_update_notification_preferences(
  target_email_enabled boolean,
  target_sms_enabled boolean,
  target_push_enabled boolean,
  target_in_app_enabled boolean,
  target_digest_mode text,
  target_digest_hour integer,
  target_quiet_hours_start integer,
  target_quiet_hours_end integer,
  target_timezone text,
  target_allow_critical_override boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare client_uuid uuid; normalized_timezone text;
begin
  select id into client_uuid from public.clients where auth_user_id=auth.uid() order by created_at desc limit 1;
  if client_uuid is null then raise exception 'Client account not found.'; end if;
  if target_digest_mode not in ('off','hourly','daily','weekly') then raise exception 'Unsupported digest mode.'; end if;
  if target_digest_hour not between 0 and 23 then raise exception 'Digest hour must be between 0 and 23.'; end if;
  if target_quiet_hours_start not between 0 and 23 or target_quiet_hours_end not between 0 and 23 then raise exception 'Quiet hours must be between 0 and 23.'; end if;
  normalized_timezone:=nullif(btrim(target_timezone),'');
  if normalized_timezone is null or not exists(select 1 from pg_timezone_names where name=normalized_timezone) then raise exception 'Unsupported timezone.'; end if;

  insert into public.client_notification_preferences(
    client_id,email_enabled,sms_enabled,push_enabled,in_app_enabled,digest_mode,digest_hour,
    quiet_hours_start,quiet_hours_end,timezone,allow_critical_override,updated_at
  ) values(
    client_uuid,target_email_enabled,target_sms_enabled,target_push_enabled,target_in_app_enabled,target_digest_mode,target_digest_hour,
    target_quiet_hours_start,target_quiet_hours_end,normalized_timezone,target_allow_critical_override,now()
  )
  on conflict(client_id) do update set
    email_enabled=excluded.email_enabled,
    sms_enabled=excluded.sms_enabled,
    push_enabled=excluded.push_enabled,
    in_app_enabled=excluded.in_app_enabled,
    digest_mode=excluded.digest_mode,
    digest_hour=excluded.digest_hour,
    quiet_hours_start=excluded.quiet_hours_start,
    quiet_hours_end=excluded.quiet_hours_end,
    timezone=excluded.timezone,
    allow_critical_override=excluded.allow_critical_override,
    updated_at=now();

  return jsonb_build_object('ok',true,'client_id',client_uuid,'timezone',normalized_timezone,'digest_mode',target_digest_mode);
end;
$$;

revoke all on function public.current_client_update_notification_preferences(boolean,boolean,boolean,boolean,text,integer,integer,integer,text,boolean) from public,anon;
grant execute on function public.current_client_update_notification_preferences(boolean,boolean,boolean,boolean,text,integer,integer,integer,text,boolean) to authenticated;
