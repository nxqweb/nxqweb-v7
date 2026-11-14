-- NXQ usage/quota/reporting foundation.

create extension if not exists pgcrypto;

create table if not exists public.client_usage_counters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_family_slug text not null default 'business',
  usage_key text not null,
  period_start date not null,
  period_end date not null,
  quantity numeric not null default 0 check(quantity >= 0),
  soft_limit numeric,
  hard_limit numeric,
  unit text not null default 'count',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(client_id,product_family_slug,usage_key,period_start)
);
create index if not exists client_usage_counters_client_period_idx on public.client_usage_counters(client_id,period_start desc,usage_key);

create table if not exists public.client_monthly_business_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  report_month date not null,
  status text not null default 'draft' check(status in ('draft','ready','delivered','archived')),
  uptime_summary jsonb not null default '{}'::jsonb,
  seo_summary jsonb not null default '{}'::jsonb,
  analytics_summary jsonb not null default '{}'::jsonb,
  lead_summary jsonb not null default '{}'::jsonb,
  maintenance_summary jsonb not null default '{}'::jsonb,
  security_summary jsonb not null default '{}'::jsonb,
  change_summary jsonb not null default '{}'::jsonb,
  usage_summary jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,report_month)
);

create table if not exists public.client_improvement_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  recommendation_key text not null,
  category text not null check(category in ('seo','conversion','performance','content','accessibility','security','maintenance','analytics','leads','other')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  title text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  proposed_action jsonb not null default '{}'::jsonb,
  status text not null default 'open' check(status in ('open','queued','implemented','dismissed','expired')),
  auto_safe boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,recommendation_key,status)
);

alter table public.client_usage_counters enable row level security;
alter table public.client_monthly_business_reports enable row level security;
alter table public.client_improvement_recommendations enable row level security;
revoke all on table public.client_usage_counters from public,anon;
revoke all on table public.client_monthly_business_reports from public,anon;
revoke all on table public.client_improvement_recommendations from public,anon;
grant select on public.client_usage_counters to authenticated;
grant select on public.client_monthly_business_reports to authenticated;
grant select on public.client_improvement_recommendations to authenticated;
grant select,insert,update,delete on public.client_usage_counters to service_role;
grant select,insert,update,delete on public.client_monthly_business_reports to service_role;
grant select,insert,update,delete on public.client_improvement_recommendations to service_role;

create policy client_read_own_usage on public.client_usage_counters for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy client_read_own_reports on public.client_monthly_business_reports for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy client_read_own_recommendations on public.client_improvement_recommendations for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy owner_manage_usage on public.client_usage_counters for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_manage_reports on public.client_monthly_business_reports for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_manage_recommendations on public.client_improvement_recommendations for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create or replace function public.increment_client_usage(
  target_client_id uuid,
  target_usage_key text,
  target_quantity numeric default 1,
  target_unit text default 'count',
  target_product_family_slug text default 'business'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  start_date date := date_trunc('month',now())::date;
  end_date date := (date_trunc('month',now()) + interval '1 month - 1 day')::date;
  row_value public.client_usage_counters%rowtype;
begin
  if target_quantity < 0 then raise exception 'Usage increment must be non-negative.'; end if;
  insert into public.client_usage_counters(client_id,product_family_slug,usage_key,period_start,period_end,quantity,unit)
  values(target_client_id,target_product_family_slug,target_usage_key,start_date,end_date,target_quantity,target_unit)
  on conflict(client_id,product_family_slug,usage_key,period_start) do update
  set quantity=public.client_usage_counters.quantity+excluded.quantity,updated_at=now()
  returning * into row_value;
  return to_jsonb(row_value);
end; $$;
revoke all on function public.increment_client_usage(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.increment_client_usage(uuid,text,numeric,text,text) to service_role;

create or replace function public.current_client_business_summary()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  client_uuid uuid; project_uuid uuid; payload jsonb;
begin
  select id into client_uuid from public.clients where auth_user_id=auth.uid() order by created_at desc limit 1;
  if client_uuid is null then raise exception 'Client account not found.'; end if;
  select id into project_uuid from public.projects where client_id=client_uuid order by created_at desc limit 1;
  select jsonb_build_object(
    'client_id',client_uuid,
    'project_id',project_uuid,
    'leads',jsonb_build_object(
      'new',count(*) filter(where status='new'),
      'qualified',count(*) filter(where status='qualified'),
      'won',count(*) filter(where status='won'),
      'urgent',count(*) filter(where urgency in ('urgent','emergency'))
    ),
    'open_change_requests',(select count(*) from public.website_change_requests r where r.client_id=client_uuid and r.status not in ('published','cancelled','failed')),
    'open_recommendations',(select count(*) from public.client_improvement_recommendations r where r.client_id=client_uuid and r.status='open'),
    'generated_at',now()
  ) into payload
  from public.client_leads l where l.client_id=client_uuid;
  return payload;
end; $$;
revoke all on function public.current_client_business_summary() from public,anon;
grant execute on function public.current_client_business_summary() to authenticated,service_role;

comment on table public.client_usage_counters is 'Unified monthly usage/quota counters for tier enforcement and upgrade guidance.';
comment on table public.client_monthly_business_reports is 'Evidence-backed monthly Business reports assembled from maintenance, SEO, analytics, leads, security and changes.';