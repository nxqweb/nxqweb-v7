-- Migration 273: "Get more reviews" (Reviews collector v1). Promoted from draft 05 on 2026-10-17 (owner said "promote reviews" in chat). NOT applied to staging: applying is a separate guarded step (validate_foundation, then apply_migrations with the owner's exact confirmation phrase and Approve click).
--
-- What it does: a client saves ONE public review link (Google, Yelp, Facebook, Trustpilot or any https page) and, optionally, the name
-- to print on their review card. The portal then builds a printable card with a QR code and ready-to-send messages from that link.
-- Nothing is public, nothing is sent, nobody is emailed: the QR code and the messages point straight at the client's own review page.
--
-- What it adds: one small table (RLS on, no direct grants) and two owner-only functions.
--   get_my_review_settings()                           the signed-in client reads their own settings
--   save_my_review_settings(review_url, business_name) saves them; an empty link removes the settings
-- No public/anon function exists on purpose: there is no public endpoint to abuse in v1.
--
-- Validation keeps junk and markup out: https only, no spaces/quotes/angle brackets/backticks, no user:password@, max 500 characters,
-- a real dotted host; the business name is plain text, max 80 characters, no angle brackets.

create table if not exists public.client_review_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  review_url text not null check (length(review_url) between 12 and 500 and review_url ~* '^https://[^\s<>"''`@]+$'),
  business_name text check (business_name is null or (length(business_name) between 1 and 80 and business_name !~ '[<>]')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_review_settings enable row level security;
revoke all on table public.client_review_settings from public, anon, authenticated;

create or replace function public.get_my_review_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  row_value public.client_review_settings%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select * into row_value from public.client_review_settings where client_id = client_uuid;
  if row_value.client_id is null then
    return jsonb_build_object('has_settings', false, 'review_url', null, 'business_name', null);
  end if;
  return jsonb_build_object('has_settings', true, 'review_url', row_value.review_url, 'business_name', row_value.business_name);
end;
$$;

create or replace function public.save_my_review_settings(
  review_url_value text default null,
  business_name_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  clean_url text := nullif(btrim(coalesce(review_url_value, '')), '');
  clean_name text := nullif(regexp_replace(btrim(coalesce(business_name_value, '')), '\s+', ' ', 'g'), '');
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  -- An empty link means "remove my review settings".
  if clean_url is null then
    delete from public.client_review_settings where client_id = client_uuid;
    return public.get_my_review_settings();
  end if;

  if length(clean_url) > 500 then raise exception 'The review link must be 500 characters or fewer.'; end if;
  if clean_url !~* '^https://[^\s<>"''`@]+$' then raise exception 'Enter a review link that starts with https:// and has no spaces.'; end if;
  if clean_url !~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:[0-9]{1,5})?([/?#].*)?$' then raise exception 'That does not look like a web address.'; end if;
  if clean_name is not null and (length(clean_name) > 80 or clean_name ~ '[<>]') then raise exception 'The business name must be 80 characters or fewer with no < or > characters.'; end if;

  insert into public.client_review_settings (client_id, review_url, business_name)
  values (client_uuid, clean_url, clean_name)
  on conflict (client_id) do update
    set review_url = excluded.review_url, business_name = excluded.business_name, updated_at = now();

  return public.get_my_review_settings();
end;
$$;

revoke all on function public.get_my_review_settings() from public, anon;
revoke all on function public.save_my_review_settings(text, text) from public, anon;
grant execute on function public.get_my_review_settings() to authenticated;
grant execute on function public.save_my_review_settings(text, text) to authenticated;

comment on table public.client_review_settings is 'One public review link per client for the printable review card (no public endpoint; owner-only functions).';
