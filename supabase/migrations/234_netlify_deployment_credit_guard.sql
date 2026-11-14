-- Proactive Netlify build guard. Provider calls must reserve an idempotent
-- server-side budget slot before a new preview or production build starts.

create table if not exists public.nxq_netlify_budget_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  emergency_stop boolean not null default false,
  billing_cycle_anchor_day smallint not null default 23 check (billing_cycle_anchor_day between 1 and 28),
  max_builds_per_cycle integer not null default 4 check (max_builds_per_cycle between 0 and 1000),
  max_qa_builds_per_cycle integer not null default 2 check (max_qa_builds_per_cycle between 0 and 1000),
  check (max_qa_builds_per_cycle <= max_builds_per_cycle),
  updated_at timestamptz not null default now()
);

insert into public.nxq_netlify_budget_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.nxq_netlify_build_reservations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  reservation_key text not null unique check (length(trim(reservation_key)) between 8 and 240),
  build_kind text not null check (build_kind in ('preview','production','seo_preview','seo_production','manual_production')),
  qa_only boolean not null,
  cycle_start date not null,
  status text not null default 'reserved' check (status in ('reserved','started','completed','released')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nxq_netlify_build_reservations_cycle_idx
  on public.nxq_netlify_build_reservations(cycle_start,status,qa_only,created_at);

alter table public.nxq_netlify_budget_settings enable row level security;
alter table public.nxq_netlify_build_reservations enable row level security;
revoke all on public.nxq_netlify_budget_settings, public.nxq_netlify_build_reservations from public,anon,authenticated;

create or replace function public.nxq_reserve_netlify_build(
  target_client_id uuid,
  target_project_id uuid,
  target_build_kind text,
  target_reservation_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  settings_row public.nxq_netlify_budget_settings%rowtype;
  client_qa boolean;
  anchor date;
  total_used integer;
  qa_used integer;
  reservation_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Netlify build reservations are service-role only.';
  end if;
  if target_build_kind not in ('preview','production','seo_preview','seo_production','manual_production') then
    raise exception 'Unsupported Netlify build kind.';
  end if;
  if length(trim(coalesce(target_reservation_key,''))) not between 8 and 240 then
    raise exception 'A stable Netlify reservation key is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('nxq-netlify-budget'));
  select * into settings_row from public.nxq_netlify_budget_settings where singleton=true;
  if not found or not settings_row.enabled then
    raise exception 'NETLIFY_BUDGET_BLOCKER: Netlify deployment reservations are disabled.';
  end if;
  if settings_row.emergency_stop then
    raise exception 'NETLIFY_BUDGET_BLOCKER: Netlify emergency stop is active.';
  end if;

  select coalesce(c.qa_only,false) into client_qa
  from public.clients c where c.id=target_client_id;
  if not found then raise exception 'Client not found for Netlify reservation.'; end if;
  if not exists(select 1 from public.projects p where p.id=target_project_id and p.client_id=target_client_id) then
    raise exception 'Project/client mismatch for Netlify reservation.';
  end if;

  select r.id into reservation_id
  from public.nxq_netlify_build_reservations r
  where r.reservation_key=trim(target_reservation_key);
  if reservation_id is not null then
    return jsonb_build_object('ok',true,'reused',true,'reservation_id',reservation_id);
  end if;

  anchor:=make_date(extract(year from current_date)::integer,extract(month from current_date)::integer,settings_row.billing_cycle_anchor_day);
  if current_date < anchor then anchor:=(anchor-interval '1 month')::date; end if;

  select count(*) filter(where status<>'released'),
         count(*) filter(where status<>'released' and qa_only)
  into total_used,qa_used
  from public.nxq_netlify_build_reservations
  where cycle_start=anchor;

  if total_used >= settings_row.max_builds_per_cycle then
    raise exception 'NETLIFY_BUDGET_BLOCKER: Cycle build limit reached (%).',settings_row.max_builds_per_cycle;
  end if;
  if client_qa and qa_used >= settings_row.max_qa_builds_per_cycle then
    raise exception 'NETLIFY_BUDGET_BLOCKER: Disposable QA build limit reached (%).',settings_row.max_qa_builds_per_cycle;
  end if;

  insert into public.nxq_netlify_build_reservations(
    client_id,project_id,reservation_key,build_kind,qa_only,cycle_start,metadata
  ) values (
    target_client_id,target_project_id,trim(target_reservation_key),target_build_kind,client_qa,anchor,coalesce(target_metadata,'{}'::jsonb)
  ) returning id into reservation_id;

  return jsonb_build_object(
    'ok',true,'reused',false,'reservation_id',reservation_id,
    'cycle_start',anchor,'cycle_used_after',total_used+1,
    'cycle_limit',settings_row.max_builds_per_cycle,
    'qa_used_after',qa_used+case when client_qa then 1 else 0 end,
    'qa_limit',settings_row.max_qa_builds_per_cycle
  );
end;
$$;

revoke all on function public.nxq_reserve_netlify_build(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.nxq_reserve_netlify_build(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.owner_update_netlify_budget_settings(
  target_enabled boolean,
  target_emergency_stop boolean,
  target_max_builds_per_cycle integer,
  target_max_qa_builds_per_cycle integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  if target_max_builds_per_cycle not between 0 and 100 then raise exception 'Cycle build limit must be between 0 and 100.'; end if;
  if target_max_qa_builds_per_cycle not between 0 and target_max_builds_per_cycle then raise exception 'QA build limit must be between 0 and the cycle build limit.'; end if;
  update public.nxq_netlify_budget_settings
  set enabled=target_enabled,
      emergency_stop=target_emergency_stop,
      max_builds_per_cycle=target_max_builds_per_cycle,
      max_qa_builds_per_cycle=target_max_qa_builds_per_cycle,
      updated_at=now()
  where singleton=true;
  return jsonb_build_object('ok',true,'enabled',target_enabled,'emergency_stop',target_emergency_stop,'max_builds_per_cycle',target_max_builds_per_cycle,'max_qa_builds_per_cycle',target_max_qa_builds_per_cycle);
end;
$$;

create or replace function public.owner_netlify_budget_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  s public.nxq_netlify_budget_settings%rowtype;
  anchor date;
begin
  if not public.is_nxq_owner() then raise exception 'Owner access required.'; end if;
  select * into s from public.nxq_netlify_budget_settings where singleton=true;
  anchor:=make_date(extract(year from current_date)::integer,extract(month from current_date)::integer,s.billing_cycle_anchor_day);
  if current_date < anchor then anchor:=(anchor-interval '1 month')::date; end if;
  return jsonb_build_object(
    'settings',to_jsonb(s),
    'cycle_start',anchor,
    'reserved_builds',(select count(*) from public.nxq_netlify_build_reservations where cycle_start=anchor and status<>'released'),
    'reserved_qa_builds',(select count(*) from public.nxq_netlify_build_reservations where cycle_start=anchor and status<>'released' and qa_only)
  );
end;
$$;

revoke all on function public.owner_update_netlify_budget_settings(boolean,boolean,integer,integer),public.owner_netlify_budget_status() from public,anon;
grant execute on function public.owner_update_netlify_budget_settings(boolean,boolean,integer,integer),public.owner_netlify_budget_status() to authenticated;

comment on table public.nxq_netlify_build_reservations is
  'Idempotent pre-provider reservations that prevent retries or rapid QA runs from consuming unbounded Netlify deployment credits.';
