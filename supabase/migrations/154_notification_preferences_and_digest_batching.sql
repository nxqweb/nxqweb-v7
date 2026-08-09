-- Notification preferences + digest batching.
-- Urgent/high priority remains immediate; normal/low may be deferred into a client-configured digest window.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.client_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  digest_mode text not null default 'daily' check (digest_mode in ('off','hourly','daily','weekly')),
  digest_hour smallint not null default 8 check (digest_hour between 0 and 23),
  quiet_hours_start smallint default 21 check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint default 7 check (quiet_hours_end between 0 and 23),
  timezone text not null default 'UTC',
  allow_critical_override boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_digest_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  digest_key text not null unique,
  status text not null default 'open' check (status in ('open','queued','delivered','cancelled')),
  delivery_count integer not null default 0 check (delivery_count >= 0),
  delivery_ids uuid[] not null default '{}'::uuid[],
  subject text,
  body text,
  scheduled_for timestamptz,
  queued_delivery_id uuid references public.notification_deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_notification_preferences enable row level security;
alter table public.notification_digest_batches enable row level security;
revoke all on table public.client_notification_preferences from public,anon;
revoke all on table public.notification_digest_batches from public,anon;
grant select,insert,update on public.client_notification_preferences to authenticated;
grant select on public.notification_digest_batches to authenticated;
grant select,insert,update,delete on public.client_notification_preferences to service_role;
grant select,insert,update,delete on public.notification_digest_batches to service_role;

create policy client_manage_own_notification_preferences on public.client_notification_preferences
for all to authenticated
using (exists(select 1 from public.clients c where c.id=client_notification_preferences.client_id and c.auth_user_id=auth.uid()))
with check (exists(select 1 from public.clients c where c.id=client_notification_preferences.client_id and c.auth_user_id=auth.uid()));

create policy client_read_own_notification_digests on public.notification_digest_batches
for select to authenticated
using (exists(select 1 from public.clients c where c.id=notification_digest_batches.client_id and c.auth_user_id=auth.uid()));

create policy owner_manage_notification_preferences on public.client_notification_preferences
for all to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_read_notification_digests on public.notification_digest_batches
for select to authenticated
using (exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

insert into public.client_notification_preferences(client_id)
select c.id from public.clients c
on conflict(client_id) do nothing;

create or replace function public.ensure_client_notification_preferences()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.client_notification_preferences(client_id) values(new.id)
  on conflict(client_id) do nothing;
  return new;
end; $$;

drop trigger if exists ensure_client_notification_preferences on public.clients;
create trigger ensure_client_notification_preferences
after insert on public.clients for each row execute function public.ensure_client_notification_preferences();

create or replace function public.notification_should_send_immediately(
  target_client_id uuid,
  target_priority text,
  target_template_key text,
  target_channel text
)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare p public.client_notification_preferences%rowtype;
declare channel_enabled boolean;
begin
  if target_client_id is null then return true; end if;
  select * into p from public.client_notification_preferences where client_id=target_client_id;
  if not found then return target_priority in ('high','urgent'); end if;
  channel_enabled := case target_channel when 'email' then p.email_enabled when 'sms' then p.sms_enabled when 'push' then p.push_enabled when 'in_app' then p.in_app_enabled else true end;
  if not channel_enabled then return false; end if;
  if target_priority in ('high','urgent') then return true; end if;
  if target_template_key like 'security_%' and p.allow_critical_override then return true; end if;
  return p.digest_mode='off';
end; $$;

revoke all on function public.notification_should_send_immediately(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.notification_should_send_immediately(uuid,text,text,text) to service_role;

create or replace function public.prepare_notification_digests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; batch_uuid uuid; digest_count integer:=0; digest_key_value text; subject_value text; body_value text; delivery_uuid uuid;
begin
  for r in
    select d.client_id,
           array_agg(d.id order by d.created_at) as delivery_ids,
           count(*) as delivery_count,
           min(d.created_at) as first_created,
           max(d.created_at) as last_created,
           string_agg(coalesce(d.subject,d.template_key), E'\n• ' order by d.created_at) as subjects
    from public.notification_deliveries d
    join public.client_notification_preferences p on p.client_id=d.client_id
    where d.status='queued'
      and d.priority in ('low','normal')
      and d.recipient_kind='client'
      and d.channel in ('email','push')
      and p.digest_mode <> 'off'
      and d.run_after <= now()
    group by d.client_id
    having count(*) > 0
    limit 100
  loop
    digest_key_value := 'digest:'||r.client_id::text||':'||to_char(now(),'YYYYMMDDHH24');
    subject_value := case when r.delivery_count=1 then 'Your NXQ update' else 'Your NXQ updates ('||r.delivery_count::text||')' end;
    body_value := 'Here are your latest NXQ updates:'||E'\n• '||left(coalesce(r.subjects,''),6000);

    insert into public.notification_digest_batches(client_id,digest_key,status,delivery_count,delivery_ids,subject,body,scheduled_for)
    values(r.client_id,digest_key_value,'open',r.delivery_count,r.delivery_ids,subject_value,body_value,now())
    on conflict(digest_key) do update set delivery_count=excluded.delivery_count,delivery_ids=excluded.delivery_ids,subject=excluded.subject,body=excluded.body,updated_at=now()
    returning id into batch_uuid;

    insert into public.notification_deliveries(client_id,channel,recipient_kind,template_key,subject,body,priority,status,metadata)
    values(r.client_id,'email','client','notification_digest',subject_value,body_value,'normal','queued',jsonb_build_object('digest_batch_id',batch_uuid,'source_delivery_ids',r.delivery_ids))
    returning id into delivery_uuid;

    update public.notification_digest_batches set status='queued',queued_delivery_id=delivery_uuid,updated_at=now() where id=batch_uuid;
    update public.notification_deliveries set status='cancelled',updated_at=now(),metadata=metadata||jsonb_build_object('batched_into_digest',batch_uuid)
    where id=any(r.delivery_ids) and id<>delivery_uuid and status='queued';
    digest_count:=digest_count+1;
  end loop;
  return jsonb_build_object('ok',true,'digests_queued',digest_count,'ran_at',now());
end; $$;

revoke all on function public.prepare_notification_digests() from public,anon,authenticated;
grant execute on function public.prepare_notification_digests() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-prepare-notification-digests') then perform cron.unschedule('nxq-prepare-notification-digests'); end if;
end $$;
select cron.schedule('nxq-prepare-notification-digests','*/15 * * * *',$$select public.prepare_notification_digests();$$);

comment on table public.client_notification_preferences is 'Per-client notification policy. Critical/high-priority notices can remain immediate while normal updates may be batched.';
