-- Hard-stop semantics for the single owner APPROVE / DENY decision.
-- A denied website setup cannot continue queued automation, domain reconciliation,
-- maintenance, or future provider work. Running external workers still re-check client
-- eligibility independently before touching providers.

alter table public.clients
  add column if not exists pipeline_stopped_at timestamptz,
  add column if not exists pipeline_stop_reason text;

create or replace function public.enforce_website_setup_denial_stop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_type <> 'website_setup_review'
     or new.status <> 'denied'
     or old.status = 'denied' then
    return new;
  end if;

  update public.clients
  set status = 'denied',
      pipeline_stopped_at = now(),
      pipeline_stop_reason = coalesce(nullif(btrim(new.owner_response), ''), 'Owner denied website setup.'),
      updated_at = now()
  where id = new.client_id;

  update public.automation_jobs
  set status = 'cancelled',
      last_error = 'Cancelled because the owner denied the client website setup.',
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where client_id = new.client_id
    and status in ('queued','failed','blocked');

  -- Domain automation must not keep waking after denial.
  update public.client_domains
  set automation_enabled = false,
      automation_state = 'stopped',
      automation_error = 'Domain automation stopped because the client setup was denied.',
      action_required_message = null,
      last_checked_at = now()
  where client_id = new.client_id
    and automation_state <> 'connected';

  -- If maintenance somehow existed before denial, stop future checks.
  update public.website_maintenance_plans
  set status = 'disabled',
      latest_error = 'Maintenance disabled because the client setup was denied.',
      updated_at = now()
  where client_id = new.client_id
    and status <> 'disabled';

  insert into public.automation_audit_log (client_id, project_id, event_type, actor_type, details)
  values (
    new.client_id,
    new.project_id,
    'client_pipeline_hard_stopped',
    'owner',
    jsonb_build_object(
      'approval_id', new.id,
      'reason', coalesce(new.owner_response, 'Owner denied website setup.'),
      'queued_jobs_cancelled', true,
      'domain_automation_disabled', true,
      'maintenance_disabled', true
    )
  );

  return new;
end;
$$;

drop trigger if exists enforce_website_setup_denial_stop on public.owner_approval_requests;
create trigger enforce_website_setup_denial_stop
after update of status on public.owner_approval_requests
for each row execute function public.enforce_website_setup_denial_stop();

revoke all on function public.enforce_website_setup_denial_stop() from public, anon, authenticated;

comment on column public.clients.pipeline_stopped_at is
  'Permanent pipeline stop marker set by an owner DENY decision. Future automation must treat a non-null value as ineligible unless an explicit owner recovery flow is added.';