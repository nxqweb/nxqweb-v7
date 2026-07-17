create or replace function public.reset_client_workspace(
  target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_exists boolean;
  client_name text;
  deleted_ai_outputs integer := 0;
  deleted_approvals integer := 0;
  deleted_projects integer := 0;
  deleted_messages integer := 0;
  deleted_domains integer := 0;
  deleted_payments integer := 0;
  deleted_files integer := 0;
begin
  select exists (
    select 1
    from public.owner_users
    where auth_user_id = auth.uid()
  )
  into owner_exists;

  if owner_exists is not true then
    raise exception 'Only approved NXQ owner accounts can reset a client workspace.';
  end if;

  select business_name
  into client_name
  from public.clients
  where id = target_client_id;

  if client_name is null then
    raise exception 'Client record was not found.';
  end if;

  delete from public.ai_task_outputs
  where client_id = target_client_id;
  get diagnostics deleted_ai_outputs = row_count;

  delete from public.owner_approval_requests
  where client_id = target_client_id;
  get diagnostics deleted_approvals = row_count;

  delete from public.projects
  where client_id = target_client_id;
  get diagnostics deleted_projects = row_count;

  delete from public.client_messages
  where client_id = target_client_id;
  get diagnostics deleted_messages = row_count;

  delete from public.client_domains
  where client_id = target_client_id;
  get diagnostics deleted_domains = row_count;

  delete from public.payment_records
  where client_id = target_client_id;
  get diagnostics deleted_payments = row_count;

  delete from public.client_files
  where client_id = target_client_id;
  get diagnostics deleted_files = row_count;

  update public.clients
  set
    status = 'lead',
    package_id = null,
    current_website = null,
    monthly_price = 0,
    notes = null,
    auth_user_id = null,
    updated_at = now()
  where id = target_client_id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    target_client_id,
    'owner',
    'client_workspace_reset',
    jsonb_build_object(
      'client_name', client_name,
      'deleted_ai_outputs', deleted_ai_outputs,
      'deleted_approvals', deleted_approvals,
      'deleted_projects', deleted_projects,
      'deleted_messages', deleted_messages,
      'deleted_domains', deleted_domains,
      'deleted_payments', deleted_payments,
      'deleted_file_records', deleted_files,
      'storage_note', 'Database file records were removed. Physical storage cleanup requires a later storage function.',
      'source', 'owner_portal_rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Client workspace reset.',
    'client_id', target_client_id,
    'client_name', client_name,
    'deleted', jsonb_build_object(
      'ai_outputs', deleted_ai_outputs,
      'approvals', deleted_approvals,
      'projects', deleted_projects,
      'messages', deleted_messages,
      'domains', deleted_domains,
      'payments', deleted_payments,
      'file_records', deleted_files
    )
  );
end;
$$;

grant execute on function public.reset_client_workspace(uuid) to authenticated;
