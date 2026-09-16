-- Make the normal website-setup APPROVE action one authoritative owner decision.
--
-- The Owner Portal has called approve_website_setup since the guarded pipeline UI
-- was introduced, but the function was never captured in the migration history.
-- This forward-only definition closes that dead RPC lane. It accepts the approval,
-- materializes the structured intake through the existing trigger, and changes the
-- client to approved so the existing deterministic automation bootstrap can run.
-- It does not activate billing, charge a payment method, or bypass downstream gates.

create or replace function public.approve_website_setup(approval_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.owner_approval_requests%rowtype;
  client_row public.clients%rowtype;
  intake_uuid uuid;
  project_uuid uuid;
  family_slug text;
  client_was_already_approved boolean := false;
begin
  -- This is the human authority boundary. Service workers and AI adapters cannot
  -- use this RPC to approve a customer or a disposable QA client.
  if auth.role() <> 'authenticated'
     or not exists (
       select 1
       from public.owner_users ou
       where ou.auth_user_id = auth.uid()
     ) then
    raise exception 'Authenticated owner access required.';
  end if;

  if approval_request_id is null then
    raise exception 'Approval request id is required.';
  end if;

  select * into request_row
  from public.owner_approval_requests
  where id = approval_request_id
  for update;

  if not found then
    raise exception 'Website setup approval request not found.';
  end if;

  if request_row.request_type <> 'website_setup_review' then
    raise exception 'Only a website setup review can start the client pipeline.';
  end if;

  if request_row.client_id is null then
    raise exception 'Website setup approval is not linked to a client.';
  end if;

  select * into client_row
  from public.clients
  where id = request_row.client_id
  for update;

  if not found then
    raise exception 'Client for website setup approval was not found.';
  end if;

  if request_row.status::text = 'accepted'
     and client_row.status::text in ('approved', 'active') then
    select id into intake_uuid
    from public.client_intakes
    where client_id = client_row.id
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'already_approved', true,
      'approval_id', request_row.id,
      'client_id', client_row.id,
      'client_status', client_row.status::text,
      'intake_id', intake_uuid,
      'project_id', request_row.project_id,
      'message', client_row.business_name || ': website setup was already approved.'
    );
  end if;

  if request_row.status::text <> 'pending' then
    raise exception 'Only a pending website setup review can be approved.';
  end if;

  if client_row.pipeline_stopped_at is not null
     or client_row.status::text in ('denied', 'overdue', 'frozen', 'dormant', 'archived') then
    raise exception 'Client is terminal or pipeline-stopped and cannot be approved through normal setup.';
  end if;

  if nullif(btrim(coalesce(request_row.recommended_action, '')), '') is null
     or position('NXQ WEB WEBSITE SETUP REPORT' in request_row.recommended_action) = 0 then
    raise exception 'A complete NXQ website setup report is required before approval.';
  end if;

  client_was_already_approved := client_row.status::text in ('approved', 'active');

  -- This update fires sync_accepted_website_setup_to_intake before client approval
  -- queues any work. A malformed report therefore rolls the whole transaction back.
  update public.owner_approval_requests
  set status = 'accepted',
      owner_response = 'Owner approved the website setup and authorized the deterministic client pipeline.',
      resolved_at = now()
  where id = request_row.id;

  update public.clients
  set status = case
        when status::text = 'active' then status
        else 'approved'::public.client_status
      end,
      updated_at = now()
  where id = client_row.id;

  select id into intake_uuid
  from public.client_intakes
  where client_id = client_row.id
  order by created_at desc
  limit 1;

  if intake_uuid is null then
    raise exception 'Accepted website setup did not produce a structured client intake.';
  end if;

  select id into project_uuid
  from public.projects
  where client_id = client_row.id
  order by created_at desc
  limit 1;

  -- Reconcile the uncommon legacy order where a client card was approved before
  -- the website setup decision. The normal lane is handled by the client-status
  -- trigger; this only ensures an already-created workspace is not stranded.
  if client_was_already_approved and project_uuid is not null then
    select coalesce(pf.slug, 'business') into family_slug
    from public.projects p
    left join public.product_families pf on pf.id = p.product_family_id
    where p.id = project_uuid;

    perform public.enqueue_automation_job(
      client_row.id,
      project_uuid,
      'provision_project_infrastructure',
      'project:' || project_uuid::text || ':provision-infrastructure:v1',
      jsonb_build_object(
        'source', 'accepted_setup_reconciliation',
        'execution_target', 'edge',
        'product_family_slug', coalesce(family_slug, 'business'),
        'requires_external_worker', true
      ),
      now(),
      15
    );
  end if;

  insert into public.automation_audit_log (
    client_id, project_id, event_type, actor_type, details
  ) values (
    client_row.id,
    project_uuid,
    'website_setup_owner_approved',
    'owner',
    jsonb_build_object(
      'approval_id', request_row.id,
      'intake_id', intake_uuid,
      'single_owner_decision', true,
      'client_was_already_approved', client_was_already_approved,
      'billing_changed', false,
      'production_gate_bypassed', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_approved', false,
    'approval_id', request_row.id,
    'client_id', client_row.id,
    'client_status', 'approved',
    'intake_id', intake_uuid,
    'project_id', project_uuid,
    'message', client_row.business_name || ': approved. The protected automation pipeline has started.'
  );
end;
$$;

revoke all on function public.approve_website_setup(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.approve_website_setup(uuid)
to authenticated;

comment on function public.approve_website_setup(uuid) is
  'Owner-only single decision boundary for accepting a complete website setup, structuring intake, and starting deterministic client automation without changing billing.';
