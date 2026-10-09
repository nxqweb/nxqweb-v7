-- Repair the captured project schema and the one legitimate unmatched Owner Portal RPC.
--
-- Fresh migration replay needs owner identity and client auth linkage before
-- migration 007, then website_status before migration 010. The base schema now
-- declares all three; this forward migration safely repairs running databases.
-- Stale manual client/project/preview controls are removed from the UI rather than
-- receiving new authority that would bypass the single owner setup decision.

create table if not exists public.owner_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.owner_users enable row level security;

drop policy if exists "Owner can read own owner record" on public.owner_users;
create policy "Owner can read own owner record"
on public.owner_users
for select
to authenticated
using (auth_user_id=auth.uid());

grant select on public.owner_users to authenticated;

alter table public.clients
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists clients_auth_user_id_uidx
  on public.clients(auth_user_id)
  where auth_user_id is not null;

alter table public.projects
  add column if not exists website_status text not null default 'intake';

update public.projects
set website_status=stage::text
where website_status is null
   or website_status not in (
     'intake','owner_review','planning','building','review','approved_for_launch',
     'launching','live','maintenance','frozen','cancelled'
   );

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conname='projects_website_status_check'
      and conrelid='public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_website_status_check check (website_status in (
        'intake','owner_review','planning','building','review','approved_for_launch',
        'launching','live','maintenance','frozen','cancelled'
      ));
  end if;
end $$;

update public.projects
set website_status=stage::text
where website_status is distinct from stage::text;

create or replace function public.sync_project_website_status_from_stage()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.website_status:=new.stage::text;
  return new;
end;
$$;

drop trigger if exists sync_project_website_status_from_stage on public.projects;
create trigger sync_project_website_status_from_stage
before insert or update of stage,website_status on public.projects
for each row execute function public.sync_project_website_status_from_stage();

revoke all on function public.sync_project_website_status_from_stage()
from public,anon;

comment on column public.projects.website_status is
  'Compatibility read model for project lifecycle UI. The typed stage column remains the deterministic lifecycle authority.';

create or replace function public.request_targeted_more_info(
  target_client_id uuid,
  requested_field_key text,
  requested_field_label text,
  requested_info text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  field_key_value text:=lower(btrim(coalesce(requested_field_key,'')));
  field_label_value text:=btrim(coalesce(requested_field_label,''));
  request_value text:=btrim(coalesce(requested_info,''));
  message_value text;
  superseded_review_count integer:=0;
begin
  if auth.role()<>'authenticated'
     or not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;

  if field_key_value not in (
    'preferred_contact_method','emergency_availability','business_hours','locations',
    'services','pages_needed','style_direction','assistant_rules','other'
  ) then
    raise exception 'Unsupported targeted information field.';
  end if;
  if length(field_label_value) not between 1 and 80 then
    raise exception 'Requested field label must be between 1 and 80 characters.';
  end if;
  if length(request_value) not between 5 and 1000 then
    raise exception 'Requested information must be between 5 and 1000 characters.';
  end if;

  select * into client_row from public.clients where id=target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if client_row.qa_only then
    raise exception 'Manual information requests are disabled for disposable QA clients.';
  end if;
  if client_row.status::text not in ('lead','intake_received','needs_owner_review') then
    raise exception 'Targeted setup information can only be requested before client approval.';
  end if;

  message_value:='NXQ needs more setup information — '||field_label_value||': '||request_value;

  -- A targeted request supersedes the currently reviewable setup snapshot. The
  -- client response creates a new pending website_setup_review, so the owner can
  -- never approve the stale pre-request report while information is outstanding.
  update public.owner_approval_requests
  set
    status='more_info_requested',
    owner_response=message_value,
    resolved_at=now()
  where client_id=client_row.id
    and request_type='website_setup_review'
    and status::text='pending';

  get diagnostics superseded_review_count=row_count;

  update public.clients
  set
    status='needs_owner_review',
    notes=concat_ws(
      E'\n\n',
      nullif(btrim(coalesce(client_row.notes,'')),''),
      concat(
        'NXQ TARGETED MORE INFO REQUEST',E'\n',
        'Field key: ',field_key_value,E'\n',
        'Field label: ',field_label_value,E'\n',
        'Requested info: ',request_value
      )
    ),
    updated_at=now()
  where id=client_row.id;

  insert into public.client_messages(
    client_id,sender_type,message,needs_owner_review,ai_handled
  ) values(
    client_row.id,'owner',message_value,false,false
  );

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(client_row.id,'owner','targeted_more_info_requested',jsonb_build_object(
    'field_key',field_key_value,'field_label',field_label_value,'request',request_value
  ));

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_row.id,'targeted_setup_info_requested','owner',jsonb_build_object(
    'field_key',field_key_value,'field_label',field_label_value,
    'client_status','needs_owner_review',
    'superseded_pending_setup_reviews',superseded_review_count,
    'external_notification_sent',false
  ));

  return jsonb_build_object(
    'ok',true,'client_id',client_row.id,'client_status','needs_owner_review',
    'requested_field_key',field_key_value,
    'superseded_pending_setup_reviews',superseded_review_count,
    'message',client_row.business_name||': targeted setup information requested for '||field_label_value||'.'
  );
end;
$$;

revoke all on function public.request_targeted_more_info(uuid,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.request_targeted_more_info(uuid,text,text,text)
to authenticated;

comment on function public.request_targeted_more_info(uuid,text,text,text) is
  'Owner-only bounded pre-approval exception flow. Saves an in-portal request without sending an external notification or mutating project/billing state.';
