-- NXQ Web manual billing foundation
-- Captures the existing production structure and closes the SECURITY DEFINER
-- execution gap by requiring the authenticated caller to be an NXQ owner.

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  provider text not null default 'manual',
  status text not null default 'active',
  amount numeric not null default 0,
  currency text not null default 'USD',
  external_payment_id text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.payment_records enable row level security;

drop policy if exists "Owner can manage payment records"
on public.payment_records;

create policy "Owner can manage payment records"
on public.payment_records
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

create or replace function public.activate_manual_subscription(
  target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  client_row public.clients%rowtype;
  existing_project_row public.projects%rowtype;
  active_project_id uuid;
  payment_record_id uuid;
  amount_value numeric := 0;
  next_project_stage text := 'building';
  now_value timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select *
  into client_row
  from public.clients
  where id = target_client_id
  for update;

  if not found then
    raise exception 'Client not found.';
  end if;

  amount_value := coalesce(client_row.monthly_price, 0);

  update public.clients
  set
    status = 'active',
    updated_at = now_value
  where id = client_row.id;

  select *
  into existing_project_row
  from public.projects
  where client_id = client_row.id
  order by created_at desc
  limit 1
  for update;

  if found then
    next_project_stage := case
      when existing_project_row.website_status in (
        'live',
        'launching',
        'approved_for_launch',
        'maintenance'
      )
        then existing_project_row.website_status
      when existing_project_row.stage::text in (
        'live',
        'launching',
        'approved_for_launch',
        'maintenance'
      )
        then existing_project_row.stage::text
      else 'building'
    end;

    update public.projects
    set
      website_status = next_project_stage,
      stage = next_project_stage::public.project_stage,
      updated_at = now_value
    where id = existing_project_row.id
    returning id into active_project_id;
  else
    insert into public.projects (
      client_id,
      project_name,
      stage,
      website_status,
      build_plan,
      created_at,
      updated_at
    )
    values (
      client_row.id,
      client_row.business_name || ' Website Project',
      'building',
      'building',
      '{}'::jsonb,
      now_value,
      now_value
    )
    returning id into active_project_id;

    next_project_stage := 'building';
  end if;

  insert into public.payment_records (
    client_id,
    provider,
    status,
    amount,
    currency,
    note,
    created_at
  )
  values (
    client_row.id,
    'manual',
    'active',
    amount_value,
    'USD',
    client_row.business_name ||
      ' subscription manually activated. No online charge was processed.',
    now_value
  )
  returning id into payment_record_id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    client_row.id,
    'owner',
    'manual_subscription_activated',
    jsonb_build_object(
      'client_name', client_row.business_name,
      'client_status', 'active',
      'project_id', active_project_id,
      'previous_project_status',
        case
          when existing_project_row.id is not null
            then existing_project_row.website_status
          else null
        end,
      'project_status', next_project_stage,
      'payment_record_id', payment_record_id,
      'payment_mode', 'manual',
      'payment_status', 'active',
      'amount', amount_value,
      'currency', 'USD',
      'source', 'activate_manual_subscription_rpc',
      'safety_note',
        'Manual activation only. No PayPal, Stripe, bank, card, or automatic charge was processed. Existing live/launch-ready projects are not downgraded.'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message',
      client_row.business_name ||
      ' subscription manually activated. No online charge was processed.',
    'client_id', client_row.id,
    'client_status', 'active',
    'project_id', active_project_id,
    'project_status', next_project_stage,
    'payment_record_id', payment_record_id,
    'payment_mode', 'manual',
    'payment_status', 'active',
    'amount', amount_value,
    'safety_note',
      'Existing live/launch-ready projects are not downgraded.'
  );
end;
$function$;

revoke all
on function public.activate_manual_subscription(uuid)
from public;

revoke all
on function public.activate_manual_subscription(uuid)
from anon;

grant execute
on function public.activate_manual_subscription(uuid)
to authenticated;