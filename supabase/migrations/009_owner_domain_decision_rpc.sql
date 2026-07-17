create or replace function public.resolve_domain_connection_review(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_exists boolean;
  approval_record public.owner_approval_requests%rowtype;
  clean_response text;
  clean_status text;
  clean_domain_name text;
  domain_update_count integer := 0;
  domain_decision_message text;
begin
  clean_status := lower(trim(coalesce(decision_status, '')));
  clean_response := nullif(trim(coalesce(owner_response_text, '')), '');

  if clean_status not in ('accepted', 'denied') then
    raise exception 'Domain decision must be accepted or denied.';
  end if;

  if clean_response is null then
    raise exception 'Owner response is required.';
  end if;

  select exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
  into owner_exists;

  if owner_exists is not true then
    raise exception 'Only approved NXQ owner accounts can resolve domain reviews.';
  end if;

  select *
  into approval_record
  from public.owner_approval_requests
  where id = target_approval_id;

  if approval_record.id is null then
    raise exception 'Approval request was not found.';
  end if;

  if approval_record.request_type <> 'domain_connection_review' then
    raise exception 'This RPC only resolves domain connection reviews.';
  end if;

  clean_domain_name := substring(
    concat_ws(E'\n', approval_record.summary, approval_record.recommended_action)
    from 'Domain:\s*([a-z0-9.-]+\.[a-z]{2,})'
  );

  if clean_domain_name is null or trim(clean_domain_name) = '' then
    clean_domain_name := substring(
      concat_ws(E'\n', approval_record.summary, approval_record.recommended_action)
      from '\m([a-z0-9-]+\.[a-z]{2,})\M'
    );
  end if;

  clean_domain_name := lower(trim(coalesce(clean_domain_name, '')));
  clean_domain_name := regexp_replace(clean_domain_name, '\.+$', '');

  if clean_domain_name = '' then
    raise exception 'Could not find the domain name in the approval request.';
  end if;

  update public.owner_approval_requests
  set
    status = clean_status::public.approval_status,
    owner_response = clean_response,
    resolved_at = now()
  where id = target_approval_id;

  if clean_status = 'accepted' then
    update public.client_domains
    set
      status = 'waiting_dns',
      reviewed_at = now(),
      dns_instructions = 'NXQ reviewed this client-owned domain request. DNS instructions are pending. Client keeps ownership of the domain and should not transfer ownership to NXQ.',
      owner_notes = clean_response,
      updated_at = now()
    where public.client_domains.client_id = approval_record.client_id
      and public.client_domains.domain_name = clean_domain_name;

    get diagnostics domain_update_count = row_count;
    domain_decision_message := clean_domain_name || ' moved to waiting DNS.';
  end if;

  if clean_status = 'denied' then
    update public.client_domains
    set
      status = 'failed',
      reviewed_at = now(),
      owner_notes = clean_response,
      updated_at = now()
    where public.client_domains.client_id = approval_record.client_id
      and public.client_domains.domain_name = clean_domain_name;

    get diagnostics domain_update_count = row_count;
    domain_decision_message := clean_domain_name || ' marked as failed/denied.';
  end if;

  if domain_update_count = 0 then
    raise exception 'Domain record was not found or was not updated.';
  end if;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    approval_record.client_id,
    'owner',
    'domain_connection_' || clean_status,
    jsonb_build_object(
      'approval_id', target_approval_id,
      'domain_name', clean_domain_name,
      'owner_response', clean_response,
      'domain_decision', domain_decision_message,
      'source', 'owner_portal_rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', domain_decision_message,
    'approval_id', target_approval_id,
    'domain_name', clean_domain_name,
    'decision_status', clean_status
  );
end;
$$;

grant execute on function public.resolve_domain_connection_review(uuid, text, text) to authenticated;
