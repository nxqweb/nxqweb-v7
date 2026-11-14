-- DRAFT (not applied). Pre-launch waitlist: emails only, no sites are built for these people yet.
-- Plan: docs/WAITLIST_AND_EXAMPLE_PAGE_PLAN.md and docs/LAUNCH_PLAN_JUNE16.md.
-- Design rules (from the plan): collect the minimum (email, a source tag, the consent wording version);
-- the same answer whether or not an address is already listed (no probing); the write path is service-role
-- only, so a future Edge function adds the bot check and rate limit in front of it; removal ERASES the row;
-- people are invited in waves (the platform builds only a few sites a month), oldest confirmed first.
create table if not exists public.nxq_waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (
    length(email) between 5 and 254 and email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  source text not null default 'direct' check (length(source) between 1 and 60 and source ~ '^[a-z0-9_-]+$'),
  consent_version text not null check (length(btrim(consent_version)) between 1 and 40),
  consent_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'invited', 'joined')),
  wave integer check (wave is null or wave >= 1),
  removal_token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('invited', 'joined')) = (wave is not null))
);
create unique index if not exists nxq_waitlist_signups_email_key on public.nxq_waitlist_signups (email);
create index if not exists nxq_waitlist_signups_queue_idx on public.nxq_waitlist_signups (confirmed_at, id) where status = 'confirmed';
create unique index if not exists nxq_waitlist_signups_token_key on public.nxq_waitlist_signups (removal_token);

alter table public.nxq_waitlist_signups enable row level security;
revoke all on table public.nxq_waitlist_signups from public, anon, authenticated;
-- The owner reads everything EXCEPT the removal token (column grant); only service_role touches the rest.
grant select (id, email, source, consent_version, consent_at, status, wave, confirmed_at, invited_at, created_at, updated_at)
  on table public.nxq_waitlist_signups to authenticated;
grant select, insert, update, delete on table public.nxq_waitlist_signups to service_role;
create policy owner_read_waitlist on public.nxq_waitlist_signups for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));

-- Join: idempotent, identical answer for new and existing addresses. Service role only.
create or replace function public.nxq_waitlist_join(target_email text, target_source text, target_consent_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare email_value text := lower(btrim(coalesce(target_email, '')));
        source_value text := lower(btrim(coalesce(nullif(target_source, ''), 'direct')));
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if email_value !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or length(email_value) > 254 then
    raise exception 'A valid email address is required.'; end if;
  if source_value !~ '^[a-z0-9_-]{1,60}$' then source_value := 'direct'; end if;
  if length(btrim(coalesce(target_consent_version, ''))) not between 1 and 40 then
    raise exception 'The consent wording version is required.'; end if;
  insert into public.nxq_waitlist_signups(email, source, consent_version)
    values (email_value, source_value, btrim(target_consent_version))
    on conflict (email) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Confirm by the emailed token (the future email function reads the token with the service role).
create or replace function public.nxq_waitlist_confirm(target_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  -- clock_timestamp(), not now(): the invite order is "oldest confirmed first", and now() is frozen inside a transaction.
  update public.nxq_waitlist_signups set status = 'confirmed', confirmed_at = clock_timestamp(), updated_at = now()
    where removal_token = target_token and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;

-- Removal ERASES the row (not just a flag). Unknown tokens answer the same way.
create or replace function public.nxq_waitlist_remove(target_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  delete from public.nxq_waitlist_signups where removal_token = target_token;
  return jsonb_build_object('ok', true);
end $$;

-- Owner: invite the next N confirmed people (oldest first) as one wave. Cap 100 per call.
create or replace function public.owner_waitlist_invite_wave(target_wave integer, target_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null
     or not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.'; end if;
  if target_wave is null or target_wave < 1 then raise exception 'The wave number must be 1 or higher.'; end if;
  if target_count is null or target_count not between 1 and 100 then raise exception 'Invite between 1 and 100 people per call.'; end if;
  with picked as (
    select id from public.nxq_waitlist_signups where status = 'confirmed'
    order by confirmed_at, id limit target_count for update skip locked)
  update public.nxq_waitlist_signups w set status = 'invited', wave = target_wave, invited_at = now(), updated_at = now()
    from picked where w.id = picked.id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'invited', n, 'wave', target_wave);
end $$;

-- Owner: counts only (no addresses), by status and by source.
create or replace function public.owner_waitlist_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' or auth.uid() is null
     or not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.'; end if;
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from public.nxq_waitlist_signups group by status) s), '{}'::jsonb),
    'by_source', coalesce((select jsonb_object_agg(source, c) from (select source, count(*) c from public.nxq_waitlist_signups group by source) s), '{}'::jsonb));
end $$;

revoke all on function public.nxq_waitlist_join(text, text, text) from public, anon, authenticated;
revoke all on function public.nxq_waitlist_confirm(uuid) from public, anon, authenticated;
revoke all on function public.nxq_waitlist_remove(uuid) from public, anon, authenticated;
revoke all on function public.owner_waitlist_invite_wave(integer, integer) from public, anon;
revoke all on function public.owner_waitlist_summary() from public, anon;
grant execute on function public.nxq_waitlist_join(text, text, text) to service_role;
grant execute on function public.nxq_waitlist_confirm(uuid) to service_role;
grant execute on function public.nxq_waitlist_remove(uuid) to service_role;
grant execute on function public.owner_waitlist_invite_wave(integer, integer) to authenticated;
grant execute on function public.owner_waitlist_summary() to authenticated;
