-- DRAFT (not applied). Team hours v1 for the "Team hours" add-on pack (draft 04). Plan: docs/BUSINESS_SUITE_PLAN.md and docs/TEAM_HOURS_PLAN.md.
-- A business adds workers; a worker claims a one-time invite with their own sign-in, then taps Clock in / Clock out. The business sees hours per person and can
-- correct an entry; every correction is logged and kept. TRACKING ONLY, never payroll.
-- Owner decision (2026-11-05): NO location of any kind in v1. These tables have no location columns, and the sidecar test fails if one is ever added.
-- Depends on draft 04 (client_addon_packs). Every function requires the pack to be switched on for the business. Times come from the database clock, never from the phone.
-- Cross-tenant rule: a business sees only its own workers and hours; a worker sees only their own rows; anon sees nothing; nobody writes tables directly.
create table if not exists public.team_workers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  auth_user_id uuid references auth.users(id) on delete set null,
  invite_hash text check (invite_hash is null or invite_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((invite_hash is null) = (invite_expires_at is null))
);
create unique index if not exists team_workers_one_person_per_business on public.team_workers (client_id, auth_user_id) where auth_user_id is not null;
create unique index if not exists team_workers_invite_hash_unique on public.team_workers (invite_hash) where invite_hash is not null;
create index if not exists team_workers_client_idx on public.team_workers (client_id);
create index if not exists team_workers_auth_idx on public.team_workers (auth_user_id) where auth_user_id is not null;

create table if not exists public.team_time_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  worker_id uuid not null references public.team_workers(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);
create unique index if not exists team_time_entries_one_open_per_worker on public.team_time_entries (worker_id) where clock_out is null;
create index if not exists team_time_entries_client_time_idx on public.team_time_entries (client_id, clock_in desc);
create index if not exists team_time_entries_worker_time_idx on public.team_time_entries (worker_id, clock_in desc);

-- Append-only trail of owner corrections: what it was, what it became, who, why.
create table if not exists public.team_time_entry_edits (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.team_time_entries(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  edited_by uuid not null,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  before_clock_in timestamptz not null,
  before_clock_out timestamptz,
  after_clock_in timestamptz not null,
  after_clock_out timestamptz,
  edited_at timestamptz not null default now()
);
create index if not exists team_time_entry_edits_entry_idx on public.team_time_entry_edits (entry_id, edited_at desc);

alter table public.team_workers enable row level security;
alter table public.team_time_entries enable row level security;
alter table public.team_time_entry_edits enable row level security;
revoke all on table public.team_workers, public.team_time_entries, public.team_time_entry_edits from public, anon, authenticated;
-- The invite hash is never readable by signed-in users (column grant leaves it out), so select * fails for them on purpose: list the columns.
grant select (id, client_id, display_name, auth_user_id, invite_expires_at, active, created_at, updated_at) on public.team_workers to authenticated;
grant select on public.team_time_entries, public.team_time_entry_edits to authenticated;
grant select, insert, update, delete on public.team_workers, public.team_time_entries to service_role;
grant select, insert on public.team_time_entry_edits to service_role;

create policy owner_read_team_workers on public.team_workers for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_read_own_team_workers on public.team_workers for select to authenticated
  using (exists (select 1 from public.clients c where c.id = team_workers.client_id and c.auth_user_id = auth.uid()));
create policy worker_read_own_team_worker on public.team_workers for select to authenticated
  using (auth_user_id = auth.uid());

create policy owner_read_team_entries on public.team_time_entries for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_read_own_team_entries on public.team_time_entries for select to authenticated
  using (exists (select 1 from public.clients c where c.id = team_time_entries.client_id and c.auth_user_id = auth.uid()));
create policy worker_read_own_team_entries on public.team_time_entries for select to authenticated
  using (exists (select 1 from public.team_workers w where w.id = team_time_entries.worker_id and w.auth_user_id = auth.uid()));

create policy owner_read_team_edits on public.team_time_entry_edits for select to authenticated
  using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_read_own_team_edits on public.team_time_entry_edits for select to authenticated
  using (exists (select 1 from public.clients c where c.id = team_time_entry_edits.client_id and c.auth_user_id = auth.uid()));
create policy worker_read_own_team_edits on public.team_time_entry_edits for select to authenticated
  using (exists (select 1 from public.team_time_entries e join public.team_workers w on w.id = e.worker_id
                 where e.id = team_time_entry_edits.entry_id and w.auth_user_id = auth.uid()));

-- Internal helper: the signed-in business account with the pack switched on, or an error. Not callable by users.
create or replace function public._team_require_client() returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then raise exception 'Sign in required.'; end if;
  select id into cid from public.clients where auth_user_id = auth.uid();
  if cid is null then raise exception 'Business account required.'; end if;
  if not exists (select 1 from public.client_addon_packs where client_id = cid and pack_key = 'team_hours' and enabled) then
    raise exception 'Team hours is not switched on for this business.'; end if;
  return cid;
end $$;

-- Internal helper: the signed-in worker row (must be the caller's own, active, with the pack on), or an error.
create or replace function public._team_require_worker(target_worker_id uuid) returns public.team_workers language plpgsql security definer set search_path = public as $$
declare w public.team_workers%rowtype;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then raise exception 'Sign in required.'; end if;
  select * into w from public.team_workers where id = target_worker_id and auth_user_id = auth.uid();
  if not found then raise exception 'Worker not found.'; end if;
  if not w.active then raise exception 'This worker is switched off.'; end if;
  if not exists (select 1 from public.client_addon_packs where client_id = w.client_id and pack_key = 'team_hours' and enabled) then
    raise exception 'Team hours is not switched on for this business.'; end if;
  return w;
end $$;
revoke all on function public._team_require_client() from public, anon, authenticated;
revoke all on function public._team_require_worker(uuid) from public, anon, authenticated;

-- Business adds a worker and gets a one-time invite token (shown once; only its hash is stored). Up to 50 workers per business.
create or replace function public.client_add_team_worker(worker_name text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := public._team_require_client(); token text; w public.team_workers%rowtype;
begin
  if worker_name is null or length(btrim(worker_name)) not between 1 and 80 then raise exception 'Give the worker a name (1 to 80 characters).'; end if;
  perform pg_advisory_xact_lock(hashtextextended('team-workers:' || cid::text, 0));
  if (select count(*) from public.team_workers where client_id = cid) >= 50 then raise exception 'A business can have up to 50 workers.'; end if;
  token := encode(gen_random_bytes(18), 'hex');
  insert into public.team_workers(client_id, display_name, invite_hash, invite_expires_at)
    values (cid, btrim(worker_name), encode(digest(token, 'sha256'), 'hex'), now() + interval '7 days') returning * into w;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'invite_token', token, 'invite_expires_at', w.invite_expires_at);
end $$;

-- Business issues a fresh invite for a worker who has not joined yet (lost link). A worker who already joined cannot be re-invited.
create or replace function public.client_reissue_team_invite(target_worker_id uuid) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := public._team_require_client(); token text; w public.team_workers%rowtype;
begin
  select * into w from public.team_workers where id = target_worker_id and client_id = cid for update;
  if not found then raise exception 'Worker not found.'; end if;
  if w.auth_user_id is not null then raise exception 'This worker has already joined.'; end if;
  if not w.active then raise exception 'This worker is switched off.'; end if;
  token := encode(gen_random_bytes(18), 'hex');
  update public.team_workers set invite_hash = encode(digest(token, 'sha256'), 'hex'), invite_expires_at = now() + interval '7 days', updated_at = now() where id = w.id;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'invite_token', token, 'invite_expires_at', now() + interval '7 days');
end $$;

create or replace function public.client_set_team_worker_active(target_worker_id uuid, target_active boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public._team_require_client();
begin
  if target_active is null then raise exception 'Say whether the worker is on or off.'; end if;
  update public.team_workers set active = target_active, updated_at = now() where id = target_worker_id and client_id = cid and active is distinct from target_active;
  return jsonb_build_object('ok', true, 'changed', found);
end $$;

-- A signed-in person claims an invite. Wrong, used and expired tokens all give the same answer (no guessing aid).
create or replace function public.team_claim_invite(invite_token text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare w public.team_workers%rowtype;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then raise exception 'Sign in required.'; end if;
  if invite_token is null or length(invite_token) not between 20 and 100 then raise exception 'This invite is not valid.'; end if;
  select * into w from public.team_workers where invite_hash = encode(digest(invite_token, 'sha256'), 'hex') for update;
  if not found or w.active is not true or w.invite_expires_at is null or w.invite_expires_at < now() then raise exception 'This invite is not valid.'; end if;
  begin
    update public.team_workers set auth_user_id = auth.uid(), invite_hash = null, invite_expires_at = null, updated_at = now() where id = w.id;
  exception when unique_violation then
    raise exception 'You are already on this team.';
  end;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'display_name', w.display_name);
end $$;

-- Clock in / out: the time is the database clock. One open entry per worker at a time.
create or replace function public.team_clock_in(target_worker_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.team_workers%rowtype; eid uuid; at_time timestamptz;
begin
  w := public._team_require_worker(target_worker_id);
  perform pg_advisory_xact_lock(hashtextextended('team-worker:' || w.id::text, 0));
  if exists (select 1 from public.team_time_entries where worker_id = w.id and clock_out is null) then raise exception 'Already clocked in.'; end if;
  insert into public.team_time_entries(client_id, worker_id, clock_in) values (w.client_id, w.id, clock_timestamp()) returning id, clock_in into eid, at_time;
  return jsonb_build_object('ok', true, 'entry_id', eid, 'clock_in', at_time);
end $$;

create or replace function public.team_clock_out(target_worker_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.team_workers%rowtype; e public.team_time_entries%rowtype;
begin
  w := public._team_require_worker(target_worker_id);
  perform pg_advisory_xact_lock(hashtextextended('team-worker:' || w.id::text, 0));
  update public.team_time_entries set clock_out = greatest(clock_timestamp(), clock_in + interval '1 millisecond')
    where worker_id = w.id and clock_out is null returning * into e;
  if not found then raise exception 'Not clocked in.'; end if;
  return jsonb_build_object('ok', true, 'entry_id', e.id, 'clock_in', e.clock_in, 'clock_out', e.clock_out);
end $$;

-- The business corrects an entry. A reason is required, the old values are kept, and the shift can be at most 24 hours and not in the future.
create or replace function public.client_correct_team_entry(target_entry_id uuid, new_clock_in timestamptz, new_clock_out timestamptz, reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public._team_require_client(); e public.team_time_entries%rowtype;
begin
  select * into e from public.team_time_entries where id = target_entry_id and client_id = cid for update;
  if not found then raise exception 'Entry not found.'; end if;
  if reason is null or length(btrim(reason)) not between 3 and 300 then raise exception 'Say why you are changing it (3 to 300 characters).'; end if;
  if new_clock_in is null then raise exception 'A start time is required.'; end if;
  if new_clock_in > now() + interval '5 minutes' or (new_clock_out is not null and new_clock_out > now() + interval '5 minutes') then raise exception 'A time cannot be in the future.'; end if;
  if new_clock_out is not null and new_clock_out <= new_clock_in then raise exception 'The end must be after the start.'; end if;
  if new_clock_out is not null and new_clock_out - new_clock_in > interval '24 hours' then raise exception 'A shift can be at most 24 hours.'; end if;
  if new_clock_out is null and exists (select 1 from public.team_time_entries where worker_id = e.worker_id and clock_out is null and id <> e.id) then
    raise exception 'This worker already has another open shift.'; end if;
  if e.clock_in = new_clock_in and e.clock_out is not distinct from new_clock_out then return jsonb_build_object('ok', true, 'changed', false); end if;
  insert into public.team_time_entry_edits(entry_id, client_id, edited_by, reason, before_clock_in, before_clock_out, after_clock_in, after_clock_out)
    values (e.id, cid, auth.uid(), btrim(reason), e.clock_in, e.clock_out, new_clock_in, new_clock_out);
  update public.team_time_entries set clock_in = new_clock_in, clock_out = new_clock_out where id = e.id;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- Hours per worker over a window (at most a year). An open shift counts up to now. Tracking only: a number, never pay.
create or replace function public.client_team_hours_summary(range_from timestamptz, range_to timestamptz) returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public._team_require_client(); result jsonb;
begin
  if range_from is null or range_to is null or range_to <= range_from or range_to - range_from > interval '366 days' then raise exception 'Choose a date range of at most one year.'; end if;
  select coalesce(jsonb_agg(row_to_json(s) order by s.display_name, s.worker_id), '[]'::jsonb) into result from (
    select w.id as worker_id, w.display_name, w.active, count(e.id)::int as entries,
           coalesce(sum(extract(epoch from (least(coalesce(e.clock_out, now()), range_to) - greatest(e.clock_in, range_from)))), 0)::bigint as seconds,
           coalesce(bool_or(e.clock_out is null), false) as clocked_in
      from public.team_workers w
      left join public.team_time_entries e on e.worker_id = w.id and e.clock_in < range_to and coalesce(e.clock_out, now()) > range_from
     where w.client_id = cid group by w.id, w.display_name, w.active) s;
  return jsonb_build_object('ok', true, 'workers', result);
end $$;

revoke all on function public.client_add_team_worker(text), public.client_reissue_team_invite(uuid), public.client_set_team_worker_active(uuid, boolean),
  public.team_claim_invite(text), public.team_clock_in(uuid), public.team_clock_out(uuid),
  public.client_correct_team_entry(uuid, timestamptz, timestamptz, text), public.client_team_hours_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.client_add_team_worker(text), public.client_reissue_team_invite(uuid), public.client_set_team_worker_active(uuid, boolean),
  public.team_claim_invite(text), public.team_clock_in(uuid), public.team_clock_out(uuid),
  public.client_correct_team_entry(uuid, timestamptz, timestamptz, text), public.client_team_hours_summary(timestamptz, timestamptz) to authenticated;
