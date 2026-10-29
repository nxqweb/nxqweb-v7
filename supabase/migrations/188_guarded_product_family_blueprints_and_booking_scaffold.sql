-- Guarded expansion foundation for NXQ Web product families.
-- A family blueprint is design/QA evidence, never launch authority by itself.
-- Booking receives its first distinct tenant-safe schema without cloning Business
-- automation or exposing a public booking endpoint prematurely.

create table if not exists public.nxq_product_family_blueprints (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid not null unique references public.product_families(id) on delete cascade,
  blueprint_version text not null,
  lifecycle_status text not null default 'scaffolded'
    check(lifecycle_status in ('scaffolded','schema_design','template_design','worker_design','qa','launch_ready')),
  source_branch_prefix text not null,
  intake_contract jsonb not null default '{}'::jsonb,
  portal_modules jsonb not null default '[]'::jsonb,
  data_boundaries jsonb not null default '{}'::jsonb,
  automation_contract jsonb not null default '{}'::jsonb,
  required_qa_scenarios jsonb not null default '[]'::jsonb,
  template_key text,
  worker_key text,
  required_clean_runs integer not null default 10 check(required_clean_runs between 10 and 100),
  launch_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(source_branch_prefix ~ '^safe/family/[a-z0-9-]+/?$'),
  check(source_branch_prefix not in ('main','master','production'))
);

create table if not exists public.product_family_qa_runs (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid not null references public.product_families(id) on delete cascade,
  run_key text not null,
  scenario_key text not null,
  status text not null default 'running' check(status in ('running','passed','failed','blocked','cancelled')),
  disposable boolean not null default true,
  external_evidence boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  failure_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(product_family_id,run_key),
  check(length(btrim(run_key)) between 3 and 160),
  check(length(btrim(scenario_key)) between 3 and 120)
);

create index if not exists product_family_qa_runs_release_idx
on public.product_family_qa_runs(product_family_id,status,external_evidence,completed_at desc);

create or replace function public.guard_product_family_blueprint_launch()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  verified_runs integer:=0;
  missing_scenarios integer:=0;
begin
  new.updated_at:=now();
  if new.launch_enabled then
    if new.lifecycle_status<>'launch_ready'
       or nullif(btrim(new.template_key),'') is null
       or nullif(btrim(new.worker_key),'') is null then
      raise exception 'Launch requires launch-ready status plus a distinct template and protected worker.';
    end if;
    select count(*) into verified_runs
    from public.product_family_qa_runs run
    where run.product_family_id=new.product_family_id
      and run.status='passed' and run.disposable and run.external_evidence
      and run.completed_at is not null;
    if verified_runs<new.required_clean_runs then
      raise exception 'Launch requires % verified disposable external QA runs; only % are recorded.',new.required_clean_runs,verified_runs;
    end if;
    select count(*) into missing_scenarios
    from jsonb_array_elements_text(new.required_qa_scenarios) required(scenario_key)
    where not exists(
      select 1 from public.product_family_qa_runs run
      where run.product_family_id=new.product_family_id
        and run.scenario_key=required.scenario_key
        and run.status='passed' and run.disposable and run.external_evidence
        and run.completed_at is not null
    );
    if missing_scenarios>0 then
      raise exception 'Launch requires verified external evidence for every required QA scenario; % are missing.',missing_scenarios;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_product_family_blueprint_launch on public.nxq_product_family_blueprints;
create trigger guard_product_family_blueprint_launch
before insert or update on public.nxq_product_family_blueprints
for each row execute function public.guard_product_family_blueprint_launch();

create or replace function public.guard_product_family_public_release()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.slug<>'business' and new.public_status in ('available','beta') and not exists(
    select 1 from public.nxq_product_family_blueprints blueprint
    where blueprint.product_family_id=new.id and blueprint.launch_enabled
  ) then
    raise exception 'This product family is launch-locked until its distinct blueprint and external QA evidence are verified.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_product_family_public_release on public.product_families;
create trigger guard_product_family_public_release
before insert or update of public_status on public.product_families
for each row execute function public.guard_product_family_public_release();

insert into public.nxq_product_family_blueprints(
  product_family_id,blueprint_version,lifecycle_status,source_branch_prefix,
  intake_contract,portal_modules,data_boundaries,automation_contract,
  required_qa_scenarios,template_key,worker_key,required_clean_runs,launch_enabled
)
select family.id,definition.blueprint_version,definition.lifecycle_status,definition.branch_prefix,
  definition.intake_contract::jsonb,definition.portal_modules::jsonb,
  definition.data_boundaries::jsonb,definition.automation_contract::jsonb,
  definition.qa_scenarios::jsonb,definition.template_key,definition.worker_key,10,false
from public.product_families family
join (values
  ('business','business-v1.0','qa','safe/family/business',
    '{"authority":"structured_business_intake"}',
    '["website","leads","locations","changes","analytics","seo","reports"]',
    '{"tenant_key":"client_id","production":"exact_commit_only"}',
    '{"worker":"build-business-website","reuse_other_family_worker":false,"production_auto_publish":false}',
    '["approve_live","deny_zero_infrastructure","tenant_isolation","provider_retry","exact_commit","billing_recovery"]',
    'business-v1','build-business-website'),
  ('commerce','commerce-v1.0','qa','safe/family/commerce',
    '{"authority":"commerce_storefront_intake"}',
    '["setup","catalog","products","images","inventory","orders","requests","preview","usage"]',
    '{"tenant_key":"client_id","payment_mode":"provider_or_guarded_links","inventory":"transactional"}',
    '{"worker":"provision-storefront","reuse_other_family_worker":false,"production_auto_publish":false}',
    '["approve_preview","deny_zero_infrastructure","inventory_race","tenant_isolation","checkout_idempotency","provider_retry"]',
    'commerce-v1','provision-storefront'),
  ('booking','booking-v1.0','schema_design','safe/family/booking',
    '{"required":["timezone","services","durations","availability","lead_time","cancellation_policy"],"optional":["staff","locations","buffers","reminder_preferences"]}',
    '["booking_setup","services","staff","availability","appointment_requests","reminders"]',
    '{"tenant_key":"client_id","appointment_default":"requested","payment_data":"forbidden","timezone":"iana_required"}',
    '{"confirmation_mode":"request_only","provider_adapter_required_for_auto_confirm":true,"reuse_business_worker":false,"production_auto_publish":false}',
    '["deny_zero_infrastructure","double_booking","timezone_dst","tenant_isolation","cancellation","reminder_idempotency","provider_retry","denied_after_preview"]',
    'booking-v1-blueprint',null),
  ('menu','menu-v1.0','scaffolded','safe/family/menu',
    '{"required":["menu_sections","items","hours","locations"],"optional":["dietary_labels","specials","ordering_provider"]}',
    '["menu_setup","sections","items","specials","hours","locations"]',
    '{"tenant_key":"client_id","allergen_claims":"owner_verified","ordering_credentials":"server_only"}',
    '{"reuse_business_worker":false,"production_auto_publish":false}',
    '["tenant_isolation","allergen_copy_review","hours_timezone","provider_failure","deny_zero_infrastructure"]',
    null,null),
  ('property','property-v1.0','scaffolded','safe/family/property',
    '{"required":["listing_types","service_areas","agents"],"optional":["feed_provider","inquiry_routing"]}',
    '["property_setup","listings","agents","inquiries","feeds"]',
    '{"tenant_key":"client_id","fair_housing_copy":"review_required","feed_credentials":"server_only"}',
    '{"reuse_business_worker":false,"production_auto_publish":false}',
    '["tenant_isolation","feed_replay","listing_expiry","inquiry_privacy","deny_zero_infrastructure"]',
    null,null),
  ('multi-location','multi-location-v1.0','schema_design','safe/family/multi-location',
    '{"required":["locations","local_contacts","hours","services"],"optional":["teams","regional_rules"]}',
    '["locations","regional_content","local_seo","teams","reports"]',
    '{"tenant_key":"client_id","location_limit":"entitlement_required","local_seo":"exact_commit"}',
    '{"reuse_business_worker":false,"production_auto_publish":false}',
    '["tenant_isolation","location_limit","seo_collision","regional_permissions","deny_zero_infrastructure"]',
    null,null),
  ('membership','membership-v1.0','scaffolded','safe/family/membership',
    '{"required":["membership_levels","access_rules","renewal_policy"],"optional":["billing_provider","gated_content"]}',
    '["membership_setup","levels","members","access","renewals","content"]',
    '{"tenant_key":"client_id","passwords":"auth_provider_only","payment_data":"provider_only"}',
    '{"reuse_business_worker":false,"production_auto_publish":false}',
    '["tenant_isolation","access_revocation","renewal_replay","billing_failure","deny_zero_infrastructure"]',
    null,null),
  ('enterprise-systems','enterprise-systems-v1.0','scaffolded','safe/family/enterprise-systems',
    '{"required":["organization","departments","roles","integrations"],"optional":["sso","scim","audit_export"]}',
    '["organizations","roles","integrations","identity","audit"]',
    '{"tenant_key":"organization_id","step_up_auth":"required","credentials":"vault_references_only"}',
    '{"custom_architecture_review":true,"reuse_business_worker":false,"production_auto_publish":false}',
    '["organization_isolation","role_escalation","sso_failure","scim_replay","audit_integrity","deny_zero_infrastructure"]',
    null,null)
) as definition(slug,blueprint_version,lifecycle_status,branch_prefix,intake_contract,portal_modules,data_boundaries,automation_contract,qa_scenarios,template_key,worker_key)
on family.slug=definition.slug
on conflict(product_family_id) do update set
  blueprint_version=excluded.blueprint_version,
  lifecycle_status=excluded.lifecycle_status,
  source_branch_prefix=excluded.source_branch_prefix,
  intake_contract=excluded.intake_contract,
  portal_modules=excluded.portal_modules,
  data_boundaries=excluded.data_boundaries,
  automation_contract=excluded.automation_contract,
  required_qa_scenarios=excluded.required_qa_scenarios,
  template_key=excluded.template_key,
  worker_key=excluded.worker_key,
  updated_at=now();

-- Distinct Booking data model. No public mutation surface exists yet.
-- The composite project key makes client/project mismatches impossible in Booking.
create unique index if not exists projects_id_client_unique
on public.projects(id,client_id);

create table if not exists public.booking_workspaces (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'setup' check(status in ('setup','review','ready','paused','disabled')),
  timezone text not null default 'America/Los_Angeles',
  confirmation_mode text not null default 'request_only' check(confirmation_mode in ('request_only','provider_confirmed')),
  provider_key text,
  minimum_lead_minutes integer not null default 120 check(minimum_lead_minutes between 0 and 525600),
  maximum_advance_days integer not null default 90 check(maximum_advance_days between 1 and 730),
  cancellation_policy text,
  launch_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,client_id) references public.projects(id,client_id) on delete cascade,
  unique(project_id),
  unique(id,client_id,project_id),
  check(length(btrim(timezone)) between 3 and 80)
);

create table if not exists public.booking_service_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  project_id uuid not null,
  service_key text not null,
  name text not null,
  duration_minutes integer not null check(duration_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check(buffer_before_minutes between 0 and 480),
  buffer_after_minutes integer not null default 0 check(buffer_after_minutes between 0 and 480),
  capacity integer not null default 1 check(capacity between 1 and 1000),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,client_id,project_id) references public.booking_workspaces(id,client_id,project_id) on delete cascade,
  unique(workspace_id,service_key),
  unique(id,workspace_id,client_id,project_id),
  check(service_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check(length(btrim(name)) between 2 and 120)
);

create table if not exists public.booking_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  project_id uuid not null,
  staff_key text not null,
  display_name text not null,
  status text not null default 'active' check(status in ('active','inactive','away')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,client_id,project_id) references public.booking_workspaces(id,client_id,project_id) on delete cascade,
  unique(workspace_id,staff_key),
  unique(id,workspace_id,client_id,project_id),
  check(staff_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.booking_availability_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  project_id uuid not null,
  staff_profile_id uuid,
  weekday smallint not null check(weekday between 0 and 6),
  start_local time not null,
  end_local time not null,
  active boolean not null default true,
  effective_from date,
  effective_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,client_id,project_id) references public.booking_workspaces(id,client_id,project_id) on delete cascade,
  foreign key(staff_profile_id,workspace_id,client_id,project_id) references public.booking_staff_profiles(id,workspace_id,client_id,project_id) on delete cascade,
  check(start_local<end_local),
  check(effective_until is null or effective_from is null or effective_until>=effective_from)
);

create table if not exists public.booking_appointment_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  project_id uuid not null,
  service_definition_id uuid,
  staff_profile_id uuid,
  request_code text not null unique default ('BOOK-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  idempotency_key text not null,
  status text not null default 'requested'
    check(status in ('requested','needs_review','confirmed','declined','cancelled','completed','no_show')),
  requested_start_at timestamptz not null,
  requested_end_at timestamptz not null,
  timezone text not null,
  contact_name text not null,
  contact_email text,
  contact_phone text,
  notes text,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,client_id,project_id) references public.booking_workspaces(id,client_id,project_id) on delete cascade,
  foreign key(service_definition_id,workspace_id,client_id,project_id) references public.booking_service_definitions(id,workspace_id,client_id,project_id) on delete restrict,
  foreign key(staff_profile_id,workspace_id,client_id,project_id) references public.booking_staff_profiles(id,workspace_id,client_id,project_id) on delete restrict,
  unique(workspace_id,idempotency_key),
  check(requested_end_at>requested_start_at),
  check(length(btrim(idempotency_key)) between 8 and 160),
  check(length(btrim(contact_name)) between 2 and 160),
  check(contact_email is not null or contact_phone is not null),
  check(notes is null or length(notes)<=4000)
);

create index if not exists booking_appointment_requests_workspace_status_idx
on public.booking_appointment_requests(workspace_id,status,requested_start_at);

create or replace function public.guard_booking_workspace_launch()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.updated_at:=now();
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then
    raise exception 'Booking timezone must be a valid IANA timezone.';
  end if;
  if new.confirmation_mode='provider_confirmed' and nullif(btrim(new.provider_key),'') is null then
    raise exception 'Provider-confirmed Booking requires a protected provider adapter.';
  end if;
  if new.launch_enabled and not exists(
    select 1 from public.nxq_product_family_blueprints blueprint
    join public.product_families family on family.id=blueprint.product_family_id
    where family.slug='booking' and blueprint.launch_enabled
  ) then raise exception 'Booking launch is locked until the family blueprint and external QA gate are verified.'; end if;
  return new;
end;
$$;

drop trigger if exists guard_booking_workspace_launch on public.booking_workspaces;
create trigger guard_booking_workspace_launch before insert or update on public.booking_workspaces
for each row execute function public.guard_booking_workspace_launch();

create or replace function public.guard_booking_appointment_request()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare workspace_row public.booking_workspaces%rowtype;
begin
  new.updated_at:=now();
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then
    raise exception 'Appointment timezone must be a valid IANA timezone.';
  end if;
  select * into workspace_row from public.booking_workspaces
  where id=new.workspace_id and client_id=new.client_id and project_id=new.project_id;
  if workspace_row.id is null then raise exception 'Booking workspace tenant boundary mismatch.'; end if;
  if new.status in ('confirmed','completed','no_show') and (
    not workspace_row.launch_enabled
    or workspace_row.confirmation_mode<>'provider_confirmed'
    or nullif(btrim(workspace_row.provider_key),'') is null
    or nullif(btrim(new.provider_reference),'') is null
  ) then
    raise exception 'Confirmed Booking state requires a launched workspace and protected provider evidence.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_booking_appointment_request on public.booking_appointment_requests;
create trigger guard_booking_appointment_request before insert or update on public.booking_appointment_requests
for each row execute function public.guard_booking_appointment_request();

alter table public.nxq_product_family_blueprints enable row level security;
alter table public.product_family_qa_runs enable row level security;
alter table public.booking_workspaces enable row level security;
alter table public.booking_service_definitions enable row level security;
alter table public.booking_staff_profiles enable row level security;
alter table public.booking_availability_rules enable row level security;
alter table public.booking_appointment_requests enable row level security;

revoke all on public.nxq_product_family_blueprints,public.product_family_qa_runs,
  public.booking_workspaces,public.booking_service_definitions,public.booking_staff_profiles,
  public.booking_availability_rules,public.booking_appointment_requests from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_product_family_blueprints,public.product_family_qa_runs,
  public.booking_workspaces,public.booking_service_definitions,public.booking_staff_profiles,
  public.booking_availability_rules,public.booking_appointment_requests to service_role;
grant select on public.booking_workspaces,public.booking_service_definitions,public.booking_staff_profiles,
  public.booking_availability_rules,public.booking_appointment_requests to authenticated;

create policy owner_read_family_blueprints on public.nxq_product_family_blueprints for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy owner_read_family_qa_runs on public.product_family_qa_runs for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));

create policy client_read_booking_workspaces on public.booking_workspaces for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy client_read_booking_services on public.booking_service_definitions for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy client_read_booking_staff on public.booking_staff_profiles for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy client_read_booking_availability on public.booking_availability_rules for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users where auth_user_id=auth.uid()));
create policy client_read_booking_requests on public.booking_appointment_requests for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users where auth_user_id=auth.uid()));

-- Booking tier definitions are distinct design contracts and remain planned.
update public.product_family_tiers tier set
  intake_schema='{"required":["timezone","services","durations","availability","lead_time","cancellation_policy"],"optional":["staff","locations","buffers","reminder_preferences"]}'::jsonb,
  portal_modules='["booking_setup","services","staff","availability","appointment_requests","reminders"]'::jsonb,
  build_instructions=jsonb_build_object(
    'blueprint_version','booking-v1.0','template_key','booking-v1-blueprint',
    'source_branch_prefix','safe/family/booking','confirmation_mode','request_only',
    'production_auto_publish',false,'launch_enabled',false,'worker_key',null
  ),
  features=case tier.tier_key
    when 'starter' then '["Appointment request foundation","One service calendar design","Owner-reviewed confirmations"]'::jsonb
    when 'growth' then '["Multiple service design","Staff and availability foundation","Reminder workflow design"]'::jsonb
    when 'intelligence' then '["Scheduling analytics design","Capacity optimization design","Cancellation insights design"]'::jsonb
    else '["Multi-location scheduling design","Advanced permissions design","Provider integration architecture"]'::jsonb end,
  public_status='planned',updated_at=now()
from public.product_families family
where family.id=tier.product_family_id and family.slug='booking';

create or replace function public.owner_product_family_foundation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare result jsonb;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',family.slug,'name',family.name,'description',family.description,
    'public_status',family.public_status,
    'foundation_status',coalesce(blueprint.lifecycle_status,'not_started'),
    'launch_enabled',coalesce(blueprint.launch_enabled,false),
    'source_branch_prefix',blueprint.source_branch_prefix,
    'template_key',blueprint.template_key,'worker_key',blueprint.worker_key,
    'portal_modules',coalesce(blueprint.portal_modules,'[]'::jsonb),
    'required_clean_runs',coalesce(blueprint.required_clean_runs,10),
    'verified_external_runs',(select count(*) from public.product_family_qa_runs run where run.product_family_id=family.id and run.status='passed' and run.disposable and run.external_evidence),
    'next_gate',case
      when blueprint.launch_enabled then 'Launch authority enabled from verified external evidence.'
      when blueprint.lifecycle_status='qa' then 'Complete verified disposable external lifecycle runs and resolve every blocker.'
      when blueprint.lifecycle_status='worker_design' then 'Finish the protected worker and enter family-specific QA.'
      when blueprint.lifecycle_status='template_design' then 'Finish the distinct template before building a protected worker.'
      when blueprint.lifecycle_status='schema_design' then 'Finish tenant-safe client mutations, portal flows, and the distinct template.'
      else 'Approve the family-specific intake, data boundary, and safety contract.' end
  ) order by family.sort_order),'[]'::jsonb) into result
  from public.product_families family
  left join public.nxq_product_family_blueprints blueprint on blueprint.product_family_id=family.id;
  return jsonb_build_object('families',result,'generated_at',now());
end;
$$;

revoke all on function public.owner_product_family_foundation_status() from public,anon,authenticated,service_role;
grant execute on function public.owner_product_family_foundation_status() to authenticated;
revoke insert,update,delete on public.product_families,public.product_family_tiers from authenticated;
revoke all on function public.guard_product_family_blueprint_launch(),public.guard_product_family_public_release(),public.guard_booking_workspace_launch(),public.guard_booking_appointment_request() from public,anon,authenticated,service_role;

comment on table public.nxq_product_family_blueprints is 'Guarded distinct-family design and QA authority. A blueprint cannot enable launch without external disposable evidence.';
comment on table public.product_family_qa_runs is 'Family-specific external QA evidence; local simulations never set external_evidence true.';
comment on table public.booking_appointment_requests is 'Tenant-scoped Booking request ledger. Requests default to requested and have no public mutation surface until the Booking intake worker is approved.';
