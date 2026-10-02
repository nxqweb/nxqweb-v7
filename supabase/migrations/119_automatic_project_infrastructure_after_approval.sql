-- Automatically bridge approved client onboarding into project infrastructure provisioning.
-- Forward-only. This migration queues trusted Edge work but does not call GitHub/Netlify itself.

create or replace function public.queue_project_infrastructure_after_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_uuid uuid;
  family_slug text;
  accepted_approval_exists boolean;
begin
  if new.job_type <> 'ensure_project_workspace'
     or new.status <> 'completed'
     or old.status = 'completed' then
    return new;
  end if;

  project_uuid := coalesce(
    new.project_id,
    nullif(new.result->>'project_id', '')::uuid
  );

  if project_uuid is null then
    insert into public.automation_escalations (
      client_id, automation_job_id, escalation_type, severity, title, summary, details
    ) values (
      new.client_id,
      new.id,
      'infrastructure_queue_missing_project',
      'high',
      'Infrastructure provisioning could not start',
      'The approved client workspace completed without a project id.',
      jsonb_build_object('source_job_id', new.id)
    );
    return new;
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id
      and c.status::text in ('approved','active')
  ) then
    return new;
  end if;

  select pf.slug into family_slug
  from public.projects p
  left join public.product_families pf on pf.id = p.product_family_id
  where p.id = project_uuid
    and p.client_id = new.client_id;

  family_slug := coalesce(family_slug, 'business');

  select exists (
    select 1
    from public.owner_approval_requests a
    where a.client_id = new.client_id
      and a.request_type = 'website_setup_review'
      and a.status = 'accepted'
  ) into accepted_approval_exists;

  if not accepted_approval_exists then
    insert into public.automation_audit_log (
      client_id, project_id, automation_job_id, event_type, details
    ) values (
      new.client_id,
      project_uuid,
      new.id,
      'infrastructure_queue_blocked',
      jsonb_build_object('reason', 'accepted_owner_approval_required', 'product_family_slug', family_slug)
    );
    return new;
  end if;

  perform public.enqueue_automation_job(
    new.client_id,
    project_uuid,
    'provision_project_infrastructure',
    'project:' || project_uuid::text || ':provision-infrastructure:v1',
    jsonb_build_object(
      'source', 'approved_workspace_ready',
      'execution_target', 'edge',
      'product_family_slug', family_slug,
      'requires_external_worker', true
    ),
    now(),
    15
  );

  insert into public.automation_audit_log (
    client_id, project_id, automation_job_id, event_type, details
  ) values (
    new.client_id,
    project_uuid,
    new.id,
    'project_infrastructure_queued',
    jsonb_build_object('product_family_slug', family_slug)
  );

  return new;
end;
$$;

drop trigger if exists queue_project_infrastructure_after_workspace on public.automation_jobs;
create trigger queue_project_infrastructure_after_workspace
after update of status on public.automation_jobs
for each row execute function public.queue_project_infrastructure_after_workspace();

-- If an owner denial/closure happens before downstream work runs, cancel queued provider/AI work.
create or replace function public.cancel_downstream_automation_for_ineligible_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text in ('denied','archived','dormant')
     and old.status::text is distinct from new.status::text then
    update public.automation_jobs
    set status = 'cancelled',
        last_error = 'Cancelled because the client is no longer eligible for automation.',
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where client_id = new.id
      and execution_target in ('edge','ai')
      and status in ('queued','failed','blocked');

    insert into public.automation_audit_log (client_id, event_type, details)
    values (
      new.id,
      'downstream_automation_cancelled',
      jsonb_build_object('client_status', new.status::text, 'reason', 'client_ineligible')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists cancel_downstream_automation_for_ineligible_client on public.clients;
create trigger cancel_downstream_automation_for_ineligible_client
after update of status on public.clients
for each row execute function public.cancel_downstream_automation_for_ineligible_client();

revoke all on function public.queue_project_infrastructure_after_workspace() from public, anon, authenticated;
revoke all on function public.cancel_downstream_automation_for_ineligible_client() from public, anon, authenticated;

comment on function public.queue_project_infrastructure_after_workspace() is
  'Queues one idempotent Edge infrastructure job after an approved client workspace is ready; no extra owner action is required.';
