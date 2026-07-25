-- Guarded client requests for tier upgrades, downgrades, and product-family changes.

create table if not exists public.client_plan_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  current_product_family_id uuid references public.product_families(id) on delete set null,
  current_product_tier_id uuid references public.product_family_tiers(id) on delete set null,
  requested_product_family_id uuid not null references public.product_families(id) on delete restrict,
  requested_product_tier_id uuid not null references public.product_family_tiers(id) on delete restrict,
  requested_monthly_price numeric(10,2),
  one_time_change_fee numeric(10,2),
  client_note text,
  status text not null default 'pending_owner_review'
    check (status in ('pending_owner_review','approved','denied','cancelled','completed')),
  owner_approval_request_id uuid references public.owner_approval_requests(id) on delete set null,
  owner_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (requested_monthly_price is null or requested_monthly_price >= 0),
  check (one_time_change_fee is null or one_time_change_fee >= 0)
);

create index if not exists client_plan_change_requests_client_created_idx
  on public.client_plan_change_requests(client_id, created_at desc);

create unique index if not exists client_plan_change_requests_one_pending_idx
  on public.client_plan_change_requests(client_id)
  where status = 'pending_owner_review';

alter table public.client_plan_change_requests enable row level security;

revoke all on table public.client_plan_change_requests from public, anon;
grant select, insert, update, delete on table public.client_plan_change_requests to authenticated;

drop policy if exists client_read_own_plan_change_requests on public.client_plan_change_requests;
create policy client_read_own_plan_change_requests
on public.client_plan_change_requests
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = client_plan_change_requests.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists owner_manage_plan_change_requests on public.client_plan_change_requests;
create policy owner_manage_plan_change_requests
on public.client_plan_change_requests
for all
to authenticated
using (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid())
);

create or replace function public.request_client_plan_change(
  requested_family_slug text,
  requested_tier_key text,
  client_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_client public.clients%rowtype;
  target_family public.product_families%rowtype;
  target_tier public.product_family_tiers%rowtype;
  new_request_id uuid;
  approval_id uuid;
  summary_text text;
begin
  select * into current_client
  from public.clients
  where auth_user_id = auth.uid()
  limit 1;

  if current_client.id is null then
    raise exception 'Client workspace not found.';
  end if;

  if exists (
    select 1 from public.client_plan_change_requests
    where client_id = current_client.id
      and status = 'pending_owner_review'
  ) then
    raise exception 'A plan change request is already awaiting owner review.';
  end if;

  select * into target_family
  from public.product_families
  where slug = requested_family_slug
    and is_active = true
    and public_status <> 'private'
  limit 1;

  if target_family.id is null then
    raise exception 'Requested product family is unavailable.';
  end if;

  select * into target_tier
  from public.product_family_tiers
  where product_family_id = target_family.id
    and tier_key = requested_tier_key
    and is_active = true
    and public_status <> 'private'
  limit 1;

  if target_tier.id is null then
    raise exception 'Requested tier is unavailable.';
  end if;

  if current_client.product_family_id = target_family.id
     and current_client.product_tier_id = target_tier.id then
    raise exception 'That is already the current plan.';
  end if;

  summary_text := format(
    'Client requested a plan change to %s %s. New monthly price: %s. One-time website change fee must be confirmed by the owner before approval.',
    target_family.name,
    target_tier.name,
    coalesce(target_tier.price_label, 'Custom')
  );

  insert into public.owner_approval_requests (
    client_id,
    request_type,
    title,
    summary,
    recommended_action,
    risk_level,
    options
  ) values (
    current_client.id,
    'client_plan_change',
    'Client plan change request',
    summary_text,
    'Review scope, set any one-time change fee, then approve or deny.',
    case when current_client.product_family_id is distinct from target_family.id then 'high'::public.risk_level else 'medium'::public.risk_level end,
    '["accept","deny","edit","ask_more"]'::jsonb
  ) returning id into approval_id;

  insert into public.client_plan_change_requests (
    client_id,
    current_product_family_id,
    current_product_tier_id,
    requested_product_family_id,
    requested_product_tier_id,
    requested_monthly_price,
    client_note,
    owner_approval_request_id
  ) values (
    current_client.id,
    current_client.product_family_id,
    current_client.product_tier_id,
    target_family.id,
    target_tier.id,
    target_tier.monthly_price,
    nullif(trim(client_note), ''),
    approval_id
  ) returning id into new_request_id;

  return new_request_id;
end;
$$;

revoke all on function public.request_client_plan_change(text, text, text) from public, anon;
grant execute on function public.request_client_plan_change(text, text, text) to authenticated;

comment on table public.client_plan_change_requests is
  'Guarded client requests to upgrade, downgrade, or switch NXQ Web product families. No live plan changes occur until owner approval.';
