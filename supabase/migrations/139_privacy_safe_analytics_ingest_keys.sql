-- Public analytics ingest keys and abuse-control metadata.
-- Keys identify a configured analytics profile; they do not authorize reads.

alter table public.website_analytics_profiles
  add column if not exists public_ingest_key text,
  add column if not exists allowed_origins text[] not null default '{}'::text[],
  add column if not exists hourly_event_limit integer not null default 5000;

update public.website_analytics_profiles
set public_ingest_key = 'AN-' || lower(replace(gen_random_uuid()::text,'-',''))
where public_ingest_key is null;

create unique index if not exists website_analytics_profiles_ingest_key_idx
  on public.website_analytics_profiles(public_ingest_key)
  where public_ingest_key is not null;

alter table public.website_analytics_profiles
  add constraint website_analytics_profiles_hourly_event_limit_check
  check(hourly_event_limit between 100 and 100000) not valid;
alter table public.website_analytics_profiles validate constraint website_analytics_profiles_hourly_event_limit_check;

create table if not exists public.website_analytics_ingest_windows (
  analytics_profile_id uuid not null references public.website_analytics_profiles(id) on delete cascade,
  window_start timestamptz not null,
  event_count integer not null default 0 check(event_count >= 0),
  updated_at timestamptz not null default now(),
  primary key(analytics_profile_id,window_start)
);

alter table public.website_analytics_ingest_windows enable row level security;
revoke all on table public.website_analytics_ingest_windows from public,anon,authenticated;
grant select,insert,update,delete on public.website_analytics_ingest_windows to service_role;

comment on column public.website_analytics_profiles.public_ingest_key is 'Public write-only site identifier for the protected analytics Edge endpoint; never grants analytics reads.';