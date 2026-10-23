-- DRAFT 11: Website Q&A assistant v1 (NO AI). LOCAL ONLY, NOT promoted, NOT applied.
--
-- What it is: a business types the questions its customers ask (and the answers) in its portal; a small widget on its website shows the matching answer to
-- visitors, or offers the contact form when nothing matches clearly. The matching runs in an Edge function (supabase/functions/_shared/assistant-match.mjs), so
-- it can only ever say what the business wrote. When an AI key exists later, only the matching step changes; these tables and the portal page stay.
--
-- Adds (all deny-by-default: RLS on, no policies, no direct grants; every access goes through the functions):
--  * client_assistant_settings   one row per client: on/off (default OFF), greeting, fallback text
--  * client_assistant_entries    up to 50 per client: question, up to 5 other wordings, answer, on/off
--  * client_assistant_unanswered visitor questions nobody answered, counted per wording, max 100 rows per client. Questions that look like they hold personal
--                                details (an email address, a long number, a web link) are NOT stored at all. No IP address, no visitor identity.
--  * client functions (signed-in client, own data only): get_my_assistant, save_my_assistant_settings, save_my_assistant_entry, delete_my_assistant_entry,
--    dismiss_my_assistant_question
--  * service-role-only functions used by the public Edge function: site_assistant_lookup, site_assistant_record_unanswered
--
-- Not in this draft (owner decisions, see docs/SITE_ASSISTANT_PLAN.md): which plan tiers get the assistant (today: any client whose lead form is active),
-- usage counting and paid extras for AI answers (needs the AI key first), and the builder step that writes the widget settings into a client's site config.

create table if not exists public.client_assistant_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default false,
  greeting text check (greeting is null or length(greeting) <= 200),
  fallback_text text check (fallback_text is null or length(fallback_text) <= 300),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_assistant_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  question text not null check (length(btrim(question)) between 3 and 160),
  alt_phrasings jsonb not null default '[]'::jsonb check (jsonb_typeof(alt_phrasings) = 'array' and jsonb_array_length(alt_phrasings) <= 5),
  answer text not null check (length(btrim(answer)) between 2 and 600),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_assistant_entries_client_idx on public.client_assistant_entries (client_id, sort_order, created_at);

create table if not exists public.client_assistant_unanswered (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  question text not null check (length(question) between 3 and 200),
  times_asked integer not null default 1 check (times_asked >= 1),
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  unique (client_id, question)
);
create index if not exists client_assistant_unanswered_recent_idx on public.client_assistant_unanswered (client_id, last_asked_at desc);

alter table public.client_assistant_settings enable row level security;
alter table public.client_assistant_entries enable row level security;
alter table public.client_assistant_unanswered enable row level security;
revoke all on table public.client_assistant_settings from public, anon, authenticated;
revoke all on table public.client_assistant_entries from public, anon, authenticated;
revoke all on table public.client_assistant_unanswered from public, anon, authenticated;

-- Plain-text rules shared by questions, wordings and answers (same as the portal and the matcher): no control characters, no HTML tags.
create or replace function public.nxq_assistant_text_ok(value text)
returns boolean
language sql
immutable
as $$ select value is not null and value !~ '[[:cntrl:]]' and value !~ '<[^>]*>'; $$;

create or replace function public.nxq_assistant_client()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare client_uuid uuid := public.current_client_id();
begin
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  return client_uuid;
end;
$$;

create or replace function public.get_my_assistant()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare client_uuid uuid := public.nxq_assistant_client();
begin
  return jsonb_build_object(
    'settings', coalesce((select jsonb_build_object('enabled', s.enabled, 'greeting', s.greeting, 'fallback_text', s.fallback_text)
                          from public.client_assistant_settings s where s.client_id = client_uuid),
                         jsonb_build_object('enabled', false, 'greeting', null, 'fallback_text', null)),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'question', e.question, 'alt_phrasings', e.alt_phrasings, 'answer', e.answer, 'enabled', e.enabled)
                                          order by e.sort_order, e.created_at)
                         from public.client_assistant_entries e where e.client_id = client_uuid), '[]'::jsonb),
    'unanswered', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'question', u.question, 'times_asked', u.times_asked, 'last_asked_at', u.last_asked_at)
                                              order by u.times_asked desc, u.last_asked_at desc)
                            from (select * from public.client_assistant_unanswered x where x.client_id = client_uuid order by x.times_asked desc, x.last_asked_at desc limit 100) u), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_my_assistant_settings(enabled_value boolean, greeting_value text, fallback_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid := public.nxq_assistant_client();
  clean_greeting text := nullif(btrim(coalesce(greeting_value, '')), '');
  clean_fallback text := nullif(btrim(coalesce(fallback_value, '')), '');
begin
  if enabled_value is null then raise exception 'Choose on or off.'; end if;
  if clean_greeting is not null and (length(clean_greeting) > 200 or not public.nxq_assistant_text_ok(clean_greeting)) then raise exception 'The greeting must be plain text, 200 characters or fewer.'; end if;
  if clean_fallback is not null and (length(clean_fallback) > 300 or not public.nxq_assistant_text_ok(clean_fallback)) then raise exception 'The "not sure" message must be plain text, 300 characters or fewer.'; end if;
  if clean_greeting ~* '(https?://|www\.)\S+' or clean_fallback ~* '(https?://|www\.)\S+' then raise exception 'Messages cannot contain web links.'; end if;
  -- Turning it on needs at least one answer, so a visitor never meets an empty assistant.
  if enabled_value and not exists (select 1 from public.client_assistant_entries e where e.client_id = client_uuid and e.enabled) then
    raise exception 'Add at least one answer before turning the assistant on.';
  end if;
  insert into public.client_assistant_settings (client_id, enabled, greeting, fallback_text, updated_at)
  values (client_uuid, enabled_value, clean_greeting, clean_fallback, now())
  on conflict (client_id) do update set enabled = excluded.enabled, greeting = excluded.greeting, fallback_text = excluded.fallback_text, updated_at = now();
  return jsonb_build_object('enabled', enabled_value);
end;
$$;

create or replace function public.save_my_assistant_entry(entry_id_value uuid, question_value text, alt_value jsonb, answer_value text, enabled_value boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid := public.nxq_assistant_client();
  clean_question text := btrim(coalesce(question_value, ''));
  clean_answer text := btrim(coalesce(answer_value, ''));
  alts jsonb := coalesce(alt_value, '[]'::jsonb);
  clean_alts jsonb;
  entry_uuid uuid;
begin
  if length(clean_question) < 3 or length(clean_question) > 160 then raise exception 'The question must be 3 to 160 characters.'; end if;
  if length(clean_answer) < 2 or length(clean_answer) > 600 then raise exception 'The answer must be 2 to 600 characters.'; end if;
  if not public.nxq_assistant_text_ok(clean_question) or not public.nxq_assistant_text_ok(clean_answer) then raise exception 'Please use plain text only (no HTML tags).'; end if;
  if clean_answer ~* '(https?://|www\.)\S+' then raise exception 'Answers cannot contain web links.'; end if;
  if enabled_value is null then raise exception 'Choose on or off.'; end if;
  if jsonb_typeof(alts) <> 'array' then raise exception 'Other ways of asking must be a list.'; end if;
  if jsonb_array_length(alts) > 5 then raise exception 'Use at most 5 other ways of asking it.'; end if;
  if exists (select 1 from jsonb_array_elements(alts) a where jsonb_typeof(a) <> 'string' or length(btrim(a #>> '{}')) > 160 or not public.nxq_assistant_text_ok(a #>> '{}')) then
    raise exception 'Each other way of asking must be plain text, 160 characters or fewer.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(btrim(a #>> '{}'))), '[]'::jsonb) into clean_alts from jsonb_array_elements(alts) a where length(btrim(a #>> '{}')) > 0;

  perform pg_advisory_xact_lock(hashtextextended('assistant-entries:' || client_uuid::text, 0));

  if entry_id_value is null then
    if (select count(*) from public.client_assistant_entries where client_id = client_uuid) >= 50 then raise exception 'You can have up to 50 answers.'; end if;
    insert into public.client_assistant_entries (client_id, question, alt_phrasings, answer, enabled, sort_order)
    values (client_uuid, clean_question, clean_alts, clean_answer, enabled_value,
            coalesce((select max(sort_order) + 1 from public.client_assistant_entries where client_id = client_uuid), 0))
    returning id into entry_uuid;
  else
    update public.client_assistant_entries
       set question = clean_question, alt_phrasings = clean_alts, answer = clean_answer, enabled = enabled_value, updated_at = now()
     where id = entry_id_value and client_id = client_uuid
    returning id into entry_uuid;
    if entry_uuid is null then raise exception 'Answer not found.'; end if;
  end if;

  -- The assistant cannot stay on with nothing to say.
  if not exists (select 1 from public.client_assistant_entries e where e.client_id = client_uuid and e.enabled) then
    update public.client_assistant_settings set enabled = false, updated_at = now() where client_id = client_uuid;
  end if;
  return jsonb_build_object('id', entry_uuid);
end;
$$;

create or replace function public.delete_my_assistant_entry(entry_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare client_uuid uuid := public.nxq_assistant_client(); removed integer;
begin
  delete from public.client_assistant_entries where id = entry_id_value and client_id = client_uuid;
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'Answer not found.'; end if;
  if not exists (select 1 from public.client_assistant_entries e where e.client_id = client_uuid and e.enabled) then
    update public.client_assistant_settings set enabled = false, updated_at = now() where client_id = client_uuid;
  end if;
  return jsonb_build_object('removed', true);
end;
$$;

create or replace function public.dismiss_my_assistant_question(question_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare client_uuid uuid := public.nxq_assistant_client(); removed integer;
begin
  delete from public.client_assistant_unanswered where id = question_id_value and client_id = client_uuid;
  get diagnostics removed = row_count;
  return jsonb_build_object('removed', removed > 0);
end;
$$;

-- Service role only (the public Edge function): everything a visitor's question needs, for one lead form. Nothing is returned unless the form is active and the
-- business turned the assistant on.
create or replace function public.site_assistant_lookup(target_form_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare form_row record; settings_row record;
begin
  select f.id, f.client_id into form_row from public.business_lead_forms f where f.form_key = btrim(coalesce(target_form_key, '')) and f.status = 'active';
  if form_row.id is null then return null; end if;
  select s.enabled, s.greeting, s.fallback_text into settings_row from public.client_assistant_settings s where s.client_id = form_row.client_id;
  if settings_row.enabled is distinct from true then return null; end if;
  return jsonb_build_object(
    'client_id', form_row.client_id,
    'form_id', form_row.id,
    'greeting', coalesce(settings_row.greeting, 'Hi! Ask me a question about our business.'),
    'fallback_text', coalesce(settings_row.fallback_text, 'I am not sure about that. Please use the contact form and we will get back to you.'),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'question', e.question, 'alt_phrasings', e.alt_phrasings, 'answer', e.answer) order by e.sort_order, e.created_at)
                         from public.client_assistant_entries e where e.client_id = form_row.client_id and e.enabled), '[]'::jsonb)
  );
end;
$$;

-- Service role only: remember a question nobody could answer, so the business can add an answer. Never stores anything that looks like personal details.
create or replace function public.site_assistant_record_unanswered(target_form_key text, visitor_question text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  looked jsonb := public.site_assistant_lookup(target_form_key);
  client_uuid uuid;
  cleaned text := regexp_replace(lower(btrim(coalesce(visitor_question, ''))), '\s+', ' ', 'g');
begin
  if looked is null then return false; end if;
  client_uuid := (looked ->> 'client_id')::uuid;
  if length(cleaned) < 3 or length(cleaned) > 200 then return false; end if;
  if cleaned ~ '[[:cntrl:]]' or cleaned ~ '<[^>]*>' then return false; end if;
  -- Looks like personal details (email address, a run of digits such as a phone number, or a web link): do not keep it.
  if cleaned ~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]]+' or cleaned ~ '[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9]' or cleaned ~ '(https?://|www\.)' then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('assistant-unanswered:' || client_uuid::text, 0));
  -- clock_timestamp() (not now()) so "most recent" is real even for several questions in one transaction.
  insert into public.client_assistant_unanswered (client_id, question, first_asked_at, last_asked_at) values (client_uuid, cleaned, clock_timestamp(), clock_timestamp())
  on conflict (client_id, question) do update set times_asked = public.client_assistant_unanswered.times_asked + 1, last_asked_at = clock_timestamp();
  -- Keep only the 100 most recent wordings per client.
  delete from public.client_assistant_unanswered
   where id in (select id from public.client_assistant_unanswered where client_id = client_uuid order by last_asked_at desc, id offset 100);
  return true;
end;
$$;

revoke all on function public.nxq_assistant_text_ok(text) from public, anon, authenticated;
revoke all on function public.nxq_assistant_client() from public, anon, authenticated;
revoke all on function public.get_my_assistant() from public, anon;
revoke all on function public.save_my_assistant_settings(boolean, text, text) from public, anon;
revoke all on function public.save_my_assistant_entry(uuid, text, jsonb, text, boolean) from public, anon;
revoke all on function public.delete_my_assistant_entry(uuid) from public, anon;
revoke all on function public.dismiss_my_assistant_question(uuid) from public, anon;
revoke all on function public.site_assistant_lookup(text) from public, anon, authenticated;
revoke all on function public.site_assistant_record_unanswered(text, text) from public, anon, authenticated;
grant execute on function public.get_my_assistant() to authenticated;
grant execute on function public.save_my_assistant_settings(boolean, text, text) to authenticated;
grant execute on function public.save_my_assistant_entry(uuid, text, jsonb, text, boolean) to authenticated;
grant execute on function public.delete_my_assistant_entry(uuid) to authenticated;
grant execute on function public.dismiss_my_assistant_question(uuid) to authenticated;
grant execute on function public.site_assistant_lookup(text) to service_role;
grant execute on function public.site_assistant_record_unanswered(text, text) to service_role;
