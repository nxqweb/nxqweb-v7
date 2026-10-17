-- DRAFT 06: Booking v1, "request an appointment" (request-only). NOT a real migration; promotion and apply are stop-and-ask gates.
--
-- What it does: builds the first usable layer on the Booking tables from migration 188 without weakening any of its guards.
--   * The business sets a public page name, a short intro, services (name + length) and weekly opening hours, then switches the page on.
--   * A visitor opens /book/<slug>, picks a service and a time inside the opening hours, and sends a REQUEST (name + email or phone + optional note).
--   * The business sees the request in the portal and follows up themselves (call, text, email). Nothing is confirmed automatically, nothing is paid,
--     nothing is emailed or texted (no reminders, no confirmations): v1 is deliberately request-only.
--
-- Guards kept as they are: the 188 triggers still forbid 'confirmed' / 'completed' / 'no_show' unless the workspace is launched and a provider confirmed it, so
-- owner functions here can only set 'requested', 'needs_review', 'declined' or 'cancelled'. launch_enabled is never touched (it stays false).
--
-- New columns on booking_workspaces: public_slug, public_enabled, display_name, intro (all additive).
-- Owner functions (signed-in client): ensure/get setup, save settings, save service, save hours, switch the public page on/off, list/update/delete requests.
-- Public functions (anyone): get_public_booking_page(slug) and submit_public_booking_request(...), the only public write surface in this family.
--
-- Public write safety (it is a public form, so it is treated like the store checkout): the page must be on and ready; the service must be active; the time must be
-- inside the weekly hours in the workspace's own time zone, on a 5-minute mark, after the lead time and before the advance limit; name/email/phone/note are
-- length- and character-checked (no < or >); a hidden "website" field catches simple bots (they get a fake success and nothing is stored); at most 30 requests
-- per workspace per hour and 3 open requests per email per day; the same idempotency key never creates a second request.
-- Honest limits of the public form (read before launch): the caps are a spam BRAKE, not protection. One determined person can still send up to 30 requests an hour
-- to a business (each from a new email) and crowd out real customers; a real fix needs a rate limit or CAPTCHA at the edge, which needs a provider key (owner decision).
-- Visitor details (name, email, phone, note) are kept until the business deletes the request; there is no automatic purge yet (owner decision, see docs/drafts/ui/README.md).
-- Weekday numbering follows the 188 table (0 = Sunday ... 6 = Saturday), the same as Postgres extract(dow).

alter table public.booking_workspaces
  add column if not exists public_slug text,
  add column if not exists public_enabled boolean not null default false,
  add column if not exists display_name text,
  add column if not exists intro text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_workspaces_public_slug_check') then
    alter table public.booking_workspaces add constraint booking_workspaces_public_slug_check
      check (public_slug is null or (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_slug) between 3 and 60));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_workspaces_display_name_check') then
    alter table public.booking_workspaces add constraint booking_workspaces_display_name_check
      check (display_name is null or (length(display_name) between 2 and 80 and display_name !~ '[<>]'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_workspaces_intro_check') then
    alter table public.booking_workspaces add constraint booking_workspaces_intro_check
      check (intro is null or (length(intro) <= 600 and intro !~ '[<>]'));
  end if;
end $$;
create unique index if not exists booking_workspaces_public_slug_unique on public.booking_workspaces(public_slug) where public_slug is not null;

create index if not exists booking_appointment_requests_workspace_created_idx on public.booking_appointment_requests(workspace_id, created_at desc);

-- ---- internal helpers (never callable by clients)
-- An account may run a public booking page only while it is in good standing: approved/active/overdue and not frozen, cancelled or archived.
create or replace function public.nxq_booking_client_ok(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    where c.id = client_uuid and c.status::text in ('approved', 'active', 'overdue')
      and coalesce(c.billing_status::text, '') not in ('frozen', 'cancelled')
  )
$$;
revoke all on function public.nxq_booking_client_ok(uuid) from public, anon, authenticated;

-- Control characters, invisible/zero-width characters and text-direction overrides are refused in anything a visitor or business types (new lines are allowed in notes only).
create or replace function public.nxq_booking_bad_chars(value text, allow_newlines boolean default false)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case when allow_newlines
    then coalesce(value, '') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]'
    else coalesce(value, '') ~ '[\x01-\x1F\x7F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]' end
$$;
revoke all on function public.nxq_booking_bad_chars(text, boolean) from public, anon, authenticated;

-- One identity per mailbox for the daily cap: lower-case, no "+tag", and no dots for Gmail-style addresses.
create or replace function public.nxq_booking_email_key(email text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when email is null then null else
    case when split_part(lower(email), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') || '@gmail.com'
      else split_part(split_part(lower(email), '@', 1), '+', 1) || '@' || split_part(lower(email), '@', 2) end
  end
$$;
revoke all on function public.nxq_booking_email_key(text) from public, anon, authenticated;

-- ---- internal helper: the signed-in client's workspace (never callable by clients directly)
create or replace function public.nxq_my_booking_workspace()
returns public.booking_workspaces
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid := public.current_client_id();
  workspace public.booking_workspaces%rowtype;
begin
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select * into workspace from public.booking_workspaces where client_id = client_uuid;
  return workspace;
end;
$$;
revoke all on function public.nxq_my_booking_workspace() from public, anon, authenticated;

create or replace function public.nxq_booking_setup_json(workspace_id_value uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'has_workspace', true,
    'status', w.status,
    'timezone', w.timezone,
    'public_slug', w.public_slug,
    'public_enabled', w.public_enabled,
    'display_name', w.display_name,
    'intro', w.intro,
    'minimum_lead_minutes', w.minimum_lead_minutes,
    'maximum_advance_days', w.maximum_advance_days,
    'cancellation_policy', w.cancellation_policy,
    'services', coalesce((select jsonb_agg(jsonb_build_object('service_key', s.service_key, 'name', s.name, 'duration_minutes', s.duration_minutes, 'active', s.active) order by s.created_at) from public.booking_service_definitions s where s.workspace_id = w.id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'start', to_char(r.start_local, 'HH24:MI'), 'end', to_char(r.end_local, 'HH24:MI')) order by r.weekday, r.start_local) from public.booking_availability_rules r where r.workspace_id = w.id and r.staff_profile_id is null and r.active), '[]'::jsonb),
    'new_requests', (select count(*) from public.booking_appointment_requests q where q.workspace_id = w.id and q.status = 'requested')
  )
  from public.booking_workspaces w where w.id = workspace_id_value
$$;
revoke all on function public.nxq_booking_setup_json(uuid) from public, anon, authenticated;

-- ---- owner functions
create or replace function public.get_my_booking_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare workspace public.booking_workspaces%rowtype;
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then return jsonb_build_object('has_workspace', false); end if;
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

create or replace function public.ensure_my_booking_workspace(timezone_value text default 'America/Los_Angeles')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid := public.current_client_id();
  workspace public.booking_workspaces%rowtype;
  project_uuid uuid;
  zone text := coalesce(nullif(btrim(timezone_value), ''), 'America/Los_Angeles');
begin
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is not null then return public.nxq_booking_setup_json(workspace.id); end if;

  if not exists (select 1 from pg_timezone_names where name = zone) then raise exception 'Choose a valid time zone.'; end if;
  select id into project_uuid from public.projects where client_id = client_uuid and website_status <> 'cancelled' order by created_at desc limit 1;
  if project_uuid is null then raise exception 'Your website project is not set up yet.'; end if;

  insert into public.booking_workspaces (client_id, project_id, timezone) values (client_uuid, project_uuid, zone) returning * into workspace;
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

create or replace function public.save_my_booking_settings(
  display_name_value text default null,
  intro_value text default null,
  timezone_value text default null,
  minimum_lead_minutes_value integer default null,
  maximum_advance_days_value integer default null,
  cancellation_policy_value text default null,
  public_slug_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  clean_name text := nullif(regexp_replace(btrim(coalesce(display_name_value, '')), '\s+', ' ', 'g'), '');
  clean_intro text := nullif(btrim(coalesce(intro_value, '')), '');
  clean_policy text := nullif(btrim(coalesce(cancellation_policy_value, '')), '');
  clean_slug text := nullif(lower(btrim(coalesce(public_slug_value, ''))), '');
  zone text := nullif(btrim(coalesce(timezone_value, '')), '');
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;

  if clean_name is not null and (length(clean_name) not between 2 and 80 or clean_name ~ '[<>]' or public.nxq_booking_bad_chars(clean_name)) then raise exception 'The page name must be 2 to 80 characters with no < or > characters.'; end if;
  if clean_intro is not null and (length(clean_intro) > 600 or clean_intro ~ '[<>]' or public.nxq_booking_bad_chars(clean_intro, true)) then raise exception 'The intro must be 600 characters or fewer with no < or > characters.'; end if;
  if clean_policy is not null and (length(clean_policy) > 600 or clean_policy ~ '[<>]' or public.nxq_booking_bad_chars(clean_policy, true)) then raise exception 'The cancellation note must be 600 characters or fewer with no < or > characters.'; end if;
  if clean_slug is not null and (clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(clean_slug) not between 3 and 60) then raise exception 'The page address must be 3 to 60 letters, numbers and single dashes.'; end if;
  if clean_slug is not null and clean_slug in ('admin', 'api', 'client', 'owner', 'portal', 'store', 'book', 'login', 'signup', 'privacy', 'terms', 'about', 'contact') then raise exception 'That page address is reserved. Choose another.'; end if;
  if clean_slug is not null and exists (select 1 from public.booking_workspaces where public_slug = clean_slug and id <> workspace.id) then raise exception 'That page address is already taken. Choose another.'; end if;
  if zone is not null and not exists (select 1 from pg_timezone_names where name = zone) then raise exception 'Choose a valid time zone.'; end if;
  if minimum_lead_minutes_value is not null and minimum_lead_minutes_value not between 0 and 43200 then raise exception 'The notice time must be between 0 minutes and 30 days.'; end if;
  if maximum_advance_days_value is not null and maximum_advance_days_value not between 1 and 365 then raise exception 'How far ahead people can ask must be between 1 and 365 days.'; end if;

  update public.booking_workspaces set
    display_name = coalesce(clean_name, display_name),
    intro = case when intro_value is null then intro else clean_intro end,
    timezone = coalesce(zone, timezone),
    minimum_lead_minutes = coalesce(minimum_lead_minutes_value, minimum_lead_minutes),
    maximum_advance_days = coalesce(maximum_advance_days_value, maximum_advance_days),
    cancellation_policy = case when cancellation_policy_value is null then cancellation_policy else clean_policy end,
    public_slug = coalesce(clean_slug, public_slug)
  where id = workspace.id;
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

create or replace function public.save_my_booking_service(
  service_key_value text,
  name_value text,
  duration_minutes_value integer,
  active_value boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  clean_key text := lower(btrim(coalesce(service_key_value, '')));
  clean_name text := regexp_replace(btrim(coalesce(name_value, '')), '\s+', ' ', 'g');
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;
  if clean_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(clean_key) > 60 then raise exception 'The service code must be letters, numbers and single dashes.'; end if;
  if length(clean_name) not between 2 and 120 or clean_name ~ '[<>]' or public.nxq_booking_bad_chars(clean_name) then raise exception 'The service name must be 2 to 120 characters with no < or > characters.'; end if;
  if duration_minutes_value is null or duration_minutes_value not between 5 and 480 then raise exception 'A service must last between 5 minutes and 8 hours.'; end if;
  if (select count(*) from public.booking_service_definitions where workspace_id = workspace.id) >= 40
     and not exists (select 1 from public.booking_service_definitions where workspace_id = workspace.id and service_key = clean_key) then raise exception 'You can have up to 40 services.'; end if;

  insert into public.booking_service_definitions (workspace_id, client_id, project_id, service_key, name, duration_minutes, active)
  values (workspace.id, workspace.client_id, workspace.project_id, clean_key, clean_name, duration_minutes_value, coalesce(active_value, true))
  on conflict (workspace_id, service_key) do update
    set name = excluded.name, duration_minutes = excluded.duration_minutes, active = excluded.active, updated_at = now();
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

-- Replaces the whole weekly schedule. hours_value is an array like [{"weekday":1,"start":"09:00","end":"17:00"}]. An empty array clears it.
create or replace function public.save_my_booking_hours(hours_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  item jsonb;
  day_value integer;
  start_value time;
  end_value time;
  seen jsonb := '[]'::jsonb;
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;
  if hours_value is null or jsonb_typeof(hours_value) <> 'array' then raise exception 'Opening hours must be a list.'; end if;
  if jsonb_array_length(hours_value) > 28 then raise exception 'You can have up to 28 opening periods.'; end if;

  -- validate everything first so a bad row changes nothing
  for item in select * from jsonb_array_elements(hours_value) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'Each opening period must have a day, a start and an end.'; end if;
    begin
      day_value := (item ->> 'weekday')::integer;
      start_value := (item ->> 'start')::time;
      end_value := (item ->> 'end')::time;
    exception when others then raise exception 'Each opening period must have a day, a start and an end.'; end;
    if day_value not between 0 and 6 then raise exception 'The day must be from 0 (Sunday) to 6 (Saturday).'; end if;
    if start_value >= end_value then raise exception 'Each opening period must end after it starts.'; end if;
    if mod(extract(minute from start_value)::integer, 5) <> 0 or mod(extract(minute from end_value)::integer, 5) <> 0 or extract(second from start_value) <> 0 or extract(second from end_value) <> 0 then raise exception 'Opening times must be on a 5-minute mark (for example 09:00 or 09:05).'; end if;
    if exists (select 1 from jsonb_array_elements(seen) s where (s ->> 'weekday')::integer = day_value and (s ->> 'start')::time < end_value and (s ->> 'end')::time > start_value) then raise exception 'Opening periods on the same day cannot overlap.'; end if;
    seen := seen || jsonb_build_array(jsonb_build_object('weekday', day_value, 'start', start_value::text, 'end', end_value::text));
  end loop;

  delete from public.booking_availability_rules where workspace_id = workspace.id and staff_profile_id is null;
  insert into public.booking_availability_rules (workspace_id, client_id, project_id, weekday, start_local, end_local)
  select workspace.id, workspace.client_id, workspace.project_id, (s ->> 'weekday')::smallint, (s ->> 'start')::time, (s ->> 'end')::time from jsonb_array_elements(seen) s;

  -- a page with no opening hours cannot stay on
  if not exists (select 1 from public.booking_availability_rules where workspace_id = workspace.id and active) and workspace.public_enabled then
    update public.booking_workspaces set public_enabled = false, status = 'paused' where id = workspace.id;
  end if;
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

create or replace function public.set_my_booking_public(enabled_value boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare workspace public.booking_workspaces%rowtype;
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;
  if coalesce(enabled_value, false) then
    if workspace.status not in ('setup', 'paused', 'ready') then raise exception 'Booking is not available for your account right now. Please contact us.'; end if;
    if not public.nxq_booking_client_ok(workspace.client_id) then raise exception 'Booking is not available for your account right now. Please contact us.'; end if;
    if workspace.public_slug is null then raise exception 'Choose a page address first.'; end if;
    if workspace.display_name is null then raise exception 'Add a page name first.'; end if;
    if not exists (select 1 from public.booking_service_definitions where workspace_id = workspace.id and active) then raise exception 'Add at least one service first.'; end if;
    if not exists (select 1 from public.booking_availability_rules where workspace_id = workspace.id and active and staff_profile_id is null) then raise exception 'Add your opening hours first.'; end if;
    update public.booking_workspaces set public_enabled = true, status = 'ready' where id = workspace.id;
  else
    update public.booking_workspaces set public_enabled = false, status = case when status = 'ready' then 'paused' else status end where id = workspace.id;
  end if;
  return public.nxq_booking_setup_json(workspace.id);
end;
$$;

create or replace function public.list_my_booking_requests(status_value text default null, limit_value integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  wanted text := nullif(btrim(coalesce(status_value, '')), '');
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then return '[]'::jsonb; end if;
  if wanted is not null and wanted not in ('requested', 'needs_review', 'declined', 'cancelled') then raise exception 'Unknown request filter.'; end if;
  return coalesce((
    select jsonb_agg(row_json order by created_at desc) from (
      select q.created_at, jsonb_build_object(
        'id', q.id, 'request_code', q.request_code, 'status', q.status,
        'service_name', s.name, 'requested_start_at', q.requested_start_at, 'requested_end_at', q.requested_end_at, 'timezone', q.timezone,
        'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'notes', q.notes,
        'owner_note', q.metadata ->> 'owner_note', 'created_at', q.created_at) as row_json
      from public.booking_appointment_requests q
      left join public.booking_service_definitions s on s.id = q.service_definition_id
      where q.workspace_id = workspace.id and (wanted is null or q.status = wanted)
      order by q.created_at desc
      limit least(greatest(coalesce(limit_value, 50), 1), 200)
    ) latest
  ), '[]'::jsonb);
end;
$$;

-- The owner can only move a request among the states that need no provider: requested, needs_review, declined, cancelled.
create or replace function public.update_my_booking_request(request_id_value uuid, status_value text, owner_note_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  clean_note text := nullif(btrim(coalesce(owner_note_value, '')), '');
  changed integer;
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;
  if status_value is null or status_value not in ('requested', 'needs_review', 'declined', 'cancelled') then raise exception 'You can mark a request as new, in progress, declined or cancelled.'; end if;
  if clean_note is not null and (length(clean_note) > 500 or clean_note ~ '[<>]' or public.nxq_booking_bad_chars(clean_note, true)) then raise exception 'Your note must be 500 characters or fewer with no < or > characters.'; end if;

  update public.booking_appointment_requests
  set status = status_value,
      metadata = case when owner_note_value is null then metadata else jsonb_set(metadata, '{owner_note}', to_jsonb(coalesce(clean_note, '')), true) end
  where id = request_id_value and workspace_id = workspace.id;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Request not found.'; end if;
  return jsonb_build_object('ok', true, 'status', status_value);
end;
$$;

-- Privacy: a business can erase a request (name, email, phone and note) at any time.
create or replace function public.delete_my_booking_request(request_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  removed integer;
begin
  workspace := public.nxq_my_booking_workspace();
  if workspace.id is null then raise exception 'Set up booking first.'; end if;
  delete from public.booking_appointment_requests where id = request_id_value and workspace_id = workspace.id;
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'Request not found.'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- public functions
create or replace function public.get_public_booking_page(slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'display_name', w.display_name,
    'intro', w.intro,
    'timezone', w.timezone,
    'minimum_lead_minutes', w.minimum_lead_minutes,
    'maximum_advance_days', w.maximum_advance_days,
    'cancellation_policy', w.cancellation_policy,
    'services', coalesce((select jsonb_agg(jsonb_build_object('service_key', s.service_key, 'name', s.name, 'duration_minutes', s.duration_minutes) order by s.created_at) from public.booking_service_definitions s where s.workspace_id = w.id and s.active), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'start', to_char(r.start_local, 'HH24:MI'), 'end', to_char(r.end_local, 'HH24:MI')) order by r.weekday, r.start_local) from public.booking_availability_rules r where r.workspace_id = w.id and r.staff_profile_id is null and r.active), '[]'::jsonb)
  )
  from public.booking_workspaces w
  where w.public_slug = lower(btrim(coalesce(slug_value, ''))) and w.public_enabled and w.status = 'ready' and public.nxq_booking_client_ok(w.client_id)
$$;

create or replace function public.submit_public_booking_request(
  slug_value text,
  service_key_value text,
  requested_start_value timestamptz,
  contact_name_value text,
  contact_email_value text default null,
  contact_phone_value text default null,
  notes_value text default null,
  idempotency_key_value text default null,
  website_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace public.booking_workspaces%rowtype;
  service public.booking_service_definitions%rowtype;
  existing public.booking_appointment_requests%rowtype;
  created public.booking_appointment_requests%rowtype;
  clean_name text := regexp_replace(btrim(coalesce(left(contact_name_value, 200), '')), '\s+', ' ', 'g');
  clean_email text := nullif(lower(btrim(coalesce(left(contact_email_value, 300), ''))), '');
  clean_phone text := nullif(btrim(coalesce(left(contact_phone_value, 100), '')), '');
  clean_notes text := nullif(btrim(coalesce(left(notes_value, 1100), '')), '');
  clean_key text := btrim(coalesce(left(idempotency_key_value, 200), ''));
  email_key text;
  phone_key text;
  payload_hash text;
  local_start timestamp;
  local_end timestamp;
begin
  -- a hidden field real visitors never fill in: bots get a fake success and nothing is stored
  if nullif(btrim(coalesce(website_value, '')), '') is not null then
    return jsonb_build_object('ok', true, 'request_code', 'BOOK-RECEIVED', 'status', 'requested');
  end if;

  select * into workspace from public.booking_workspaces
  where public_slug = lower(btrim(coalesce(slug_value, ''))) and public_enabled and status = 'ready' and public.nxq_booking_client_ok(client_id);
  if workspace.id is null then raise exception 'This booking page is not open right now.'; end if;

  if length(clean_name) not between 2 and 120 or clean_name ~ '[<>]' or public.nxq_booking_bad_chars(clean_name) or clean_name ~ '^[=+@-]' then raise exception 'Please enter your name (2 to 120 characters, no < or > characters, and not starting with = + - or @).'; end if;
  if clean_email is null and clean_phone is null then raise exception 'Please give an email or a phone number so the business can reach you.'; end if;
  if clean_email is not null and (length(clean_email) > 254 or clean_email !~ '^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or clean_email ~ '\.\.' or clean_email ~ '(^|@)[.-]' or clean_email ~ '[.-](@|$)') then raise exception 'Please enter a valid email address.'; end if;
  if clean_phone is not null and (length(clean_phone) > 40 or clean_phone !~ '^[0-9+()\-. ]+$' or length(regexp_replace(clean_phone, '\D', '', 'g')) < 7) then raise exception 'Please enter a valid phone number.'; end if;
  if clean_notes is not null and (length(clean_notes) > 1000 or clean_notes ~ '[<>]' or public.nxq_booking_bad_chars(clean_notes, true)) then raise exception 'Your note must be 1000 characters or fewer with no < or > characters.'; end if;
  -- the form sends a long random key; short or odd keys are refused so keys cannot be guessed
  if length(clean_key) not between 20 and 160 or clean_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'Something went wrong with your request. Please reload the page and try again.'; end if;

  email_key := public.nxq_booking_email_key(clean_email);
  phone_key := nullif(right(regexp_replace(coalesce(clean_phone, ''), '\D', '', 'g'), 10), '');
  payload_hash := md5(concat_ws('|', lower(btrim(coalesce(service_key_value, ''))), requested_start_value::text, clean_name, coalesce(clean_email, ''), coalesce(clean_phone, ''), coalesce(clean_notes, '')));

  -- one submission at a time per business, so the caps below cannot be raced past
  perform pg_advisory_xact_lock(hashtext('booking:' || workspace.id::text));

  -- sending the same form twice (same key AND same details) never creates a second request; the same key with different details is refused
  select * into existing from public.booking_appointment_requests where workspace_id = workspace.id and idempotency_key = clean_key;
  if existing.id is not null then
    if existing.metadata ->> 'payload_hash' is distinct from payload_hash then raise exception 'Something went wrong with your request. Please reload the page and try again.'; end if;
    return jsonb_build_object('ok', true, 'request_code', existing.request_code, 'status', 'requested');
  end if;

  select * into service from public.booking_service_definitions where workspace_id = workspace.id and service_key = lower(btrim(coalesce(service_key_value, ''))) and active;
  if service.id is null then raise exception 'Please choose one of the listed services.'; end if;

  if requested_start_value is null then raise exception 'Please choose a time.'; end if;
  if requested_start_value < now() + make_interval(mins => workspace.minimum_lead_minutes) then raise exception 'That time is too soon. Please choose a later time.'; end if;
  if requested_start_value > now() + make_interval(days => workspace.maximum_advance_days) then raise exception 'That time is too far ahead. Please choose an earlier time.'; end if;

  -- the time must sit inside the weekly opening hours, in the business's own time zone, on a 5-minute mark
  local_start := requested_start_value at time zone workspace.timezone;
  local_end := local_start + make_interval(mins => service.duration_minutes);
  if extract(second from local_start) <> 0 or mod(extract(minute from local_start)::integer, 5) <> 0 then raise exception 'Please choose a time on a 5-minute mark.'; end if;
  if local_end::date <> local_start::date
     or not exists (
       select 1 from public.booking_availability_rules r
       where r.workspace_id = workspace.id and r.staff_profile_id is null and r.active
         and r.weekday = extract(dow from local_start)::integer
         and r.start_local <= local_start::time and r.end_local >= local_end::time
         and (r.effective_from is null or r.effective_from <= local_start::date)
         and (r.effective_until is null or r.effective_until >= local_start::date)
     ) then raise exception 'That time is outside the business''s opening hours.'; end if;

  -- spam brakes (see the header: these slow abuse down, they do not stop a determined sender)
  if (select count(*) from public.booking_appointment_requests where workspace_id = workspace.id and created_at > now() - interval '1 hour') >= 30 then raise exception 'There are a lot of requests right now. Please try again later.'; end if;
  if email_key is not null and (select count(*) from public.booking_appointment_requests where workspace_id = workspace.id and metadata ->> 'email_key' = email_key and created_at > now() - interval '1 day') >= 3 then raise exception 'You already have several open requests. Please wait to hear back.'; end if;
  if phone_key is not null and (select count(*) from public.booking_appointment_requests where workspace_id = workspace.id and metadata ->> 'phone_key' = phone_key and created_at > now() - interval '1 day') >= 3 then raise exception 'You already have several open requests. Please wait to hear back.'; end if;

  insert into public.booking_appointment_requests
    (workspace_id, client_id, project_id, service_definition_id, idempotency_key, status, requested_start_at, requested_end_at, timezone, contact_name, contact_email, contact_phone, notes, metadata)
  values
    (workspace.id, workspace.client_id, workspace.project_id, service.id, clean_key, 'requested', requested_start_value, requested_start_value + make_interval(mins => service.duration_minutes), workspace.timezone, clean_name, clean_email, clean_phone, clean_notes,
     jsonb_strip_nulls(jsonb_build_object('payload_hash', payload_hash, 'email_key', email_key, 'phone_key', phone_key)))
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into created;
  if created.id is null then
    select * into created from public.booking_appointment_requests where workspace_id = workspace.id and idempotency_key = clean_key;
  end if;

  return jsonb_build_object('ok', true, 'request_code', created.request_code, 'status', 'requested');
end;
$$;

-- Retention (owner decision 2026-10-17: keep booking requests 90 days, then delete). Callable ONLY by the service role (a scheduled job); no API role can run it.
-- It deletes requests of any status older than the retention, at most 5000 per call so one run can never lock the table for long (run again for more).
-- Retention below 30 days is refused so a typo cannot wipe recent requests. NOTHING SCHEDULES THIS: a daily job (pg_cron or the existing dispatcher) is an owner-approved,
-- separate step, so until then requests are NOT deleted automatically and the pages must not say they are.
create or replace function public.purge_old_booking_requests(retention_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  if retention_days is null or retention_days < 30 or retention_days > 3650 then raise exception 'Retention must be between 30 and 3650 days.'; end if;
  with doomed as (
    select id from public.booking_appointment_requests where created_at < now() - make_interval(days => retention_days) order by created_at limit 5000
  )
  delete from public.booking_appointment_requests q using doomed d where q.id = d.id;
  get diagnostics removed = row_count;
  return jsonb_build_object('deleted', removed, 'retention_days', retention_days);
end;
$$;

revoke all on function public.get_my_booking_setup() from public, anon;
revoke all on function public.ensure_my_booking_workspace(text) from public, anon;
revoke all on function public.save_my_booking_settings(text, text, text, integer, integer, text, text) from public, anon;
revoke all on function public.save_my_booking_service(text, text, integer, boolean) from public, anon;
revoke all on function public.save_my_booking_hours(jsonb) from public, anon;
revoke all on function public.set_my_booking_public(boolean) from public, anon;
revoke all on function public.list_my_booking_requests(text, integer) from public, anon;
revoke all on function public.update_my_booking_request(uuid, text, text) from public, anon;
revoke all on function public.delete_my_booking_request(uuid) from public, anon;
revoke all on function public.get_public_booking_page(text) from public;
revoke all on function public.submit_public_booking_request(text, text, timestamptz, text, text, text, text, text, text) from public;
revoke all on function public.purge_old_booking_requests(integer) from public, anon, authenticated;
grant execute on function public.purge_old_booking_requests(integer) to service_role;
grant execute on function public.get_my_booking_setup() to authenticated;
grant execute on function public.ensure_my_booking_workspace(text) to authenticated;
grant execute on function public.save_my_booking_settings(text, text, text, integer, integer, text, text) to authenticated;
grant execute on function public.save_my_booking_service(text, text, integer, boolean) to authenticated;
grant execute on function public.save_my_booking_hours(jsonb) to authenticated;
grant execute on function public.set_my_booking_public(boolean) to authenticated;
grant execute on function public.list_my_booking_requests(text, integer) to authenticated;
grant execute on function public.update_my_booking_request(uuid, text, text) to authenticated;
grant execute on function public.delete_my_booking_request(uuid) to authenticated;
grant execute on function public.get_public_booking_page(text) to anon, authenticated;
grant execute on function public.submit_public_booking_request(text, text, timestamptz, text, text, text, text, text, text) to anon, authenticated;

comment on function public.submit_public_booking_request(text, text, timestamptz, text, text, text, text, text, text) is
  'Public appointment REQUEST (never a confirmation). Checks opening hours, lead time, characters, a honeypot field, rate caps and idempotency; stores nothing for bots.';
