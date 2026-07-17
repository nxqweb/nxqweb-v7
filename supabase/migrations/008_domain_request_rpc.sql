create or replace function public.submit_domain_connection_request(
  requested_domain_name text,
  requested_registrar_name text default null,
  requested_dns_provider text default null,
  requested_client_notes text default null,
  ownership_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_domain text;
  clean_registrar text;
  clean_dns_provider text;
  clean_notes text;
  linked_client_id uuid;
  linked_client_name text;
  linked_project_id uuid;
  inserted_domain_id uuid;
  inserted_approval_id uuid;
  approval_text text;
begin
  clean_domain := lower(trim(coalesce(requested_domain_name, '')));
  clean_domain := regexp_replace(clean_domain, '^https?://', '');
  clean_domain := regexp_replace(clean_domain, '^www\.', '');
  clean_domain := regexp_replace(clean_domain, '/.*$', '');
  clean_domain := regexp_replace(clean_domain, '\.+$', '');

  clean_registrar := nullif(trim(coalesce(requested_registrar_name, '')), '');
  clean_dns_provider := nullif(trim(coalesce(requested_dns_provider, '')), '');
  clean_notes := nullif(trim(coalesce(requested_client_notes, '')), '');

  if clean_domain = '' then
    raise exception 'Domain name is required.';
  end if;

  if clean_domain !~ '^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$' then
    raise exception 'Enter a valid domain like example.com.';
  end if;

  if ownership_confirmed is not true then
    raise exception 'You must confirm that you own or control this domain.';
  end if;

  select id, business_name
  into linked_client_id, linked_client_name
  from public.clients
  where auth_user_id = auth.uid()
  limit 1;

  if linked_client_id is null then
    raise exception 'No client profile is linked to this login.';
  end if;

  select id
  into linked_project_id
  from public.projects
  where client_id = linked_client_id
  order by created_at desc
  limit 1;

  insert into public.client_domains (
    client_id,
    domain_name,
    domain_type,
    status,
    registrar_name,
    dns_provider,
    ownership_confirmed,
    client_notes
  )
  values (
    linked_client_id,
    clean_domain,
    'client_owned',
    'owner_review',
    clean_registrar,
    clean_dns_provider,
    ownership_confirmed,
    clean_notes
  )
  returning id into inserted_domain_id;

  approval_text := concat_ws(
    E'\n',
    'NXQ DOMAIN CONNECTION REVIEW',
    '',
    'Client: ' || linked_client_name,
    'Domain: ' || clean_domain,
    'Domain type: client owned',
    'Status: owner review',
    'Registrar: ' || coalesce(clean_registrar, 'Not provided'),
    'DNS provider: ' || coalesce(clean_dns_provider, 'Not provided'),
    'Ownership confirmed: yes',
    '',
    'Client notes:',
    coalesce(clean_notes, 'No notes provided.'),
    '',
    'Owner safety rule:',
    'Client owns this domain. NXQ may connect website hosting and provide DNS instructions, but NXQ must not take ownership of the domain.',
    '',
    'Recommended owner action:',
    'Approve the domain connection only if the domain looks correct for this client. Then provide DNS instructions or mark as waiting for DNS.'
  );

  insert into public.owner_approval_requests (
    client_id,
    project_id,
    request_type,
    title,
    summary,
    recommended_action,
    risk_level,
    status
  )
  values (
    linked_client_id,
    linked_project_id,
    'domain_connection_review',
    'Domain connection review needed',
    linked_client_name || ' requested to connect ' || clean_domain || '. Client confirmed they own/control the domain.',
    approval_text,
    'medium',
    'pending'
  )
  returning id into inserted_approval_id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    linked_client_id,
    'client',
    'domain_connection_requested',
    jsonb_build_object(
      'domain_id', inserted_domain_id,
      'approval_id', inserted_approval_id,
      'domain_name', clean_domain,
      'registrar_name', clean_registrar,
      'dns_provider', clean_dns_provider,
      'source', 'client_portal_rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Domain request submitted for review.',
    'domain_id', inserted_domain_id,
    'approval_id', inserted_approval_id,
    'domain_name', clean_domain
  );
end;
$$;

grant execute on function public.submit_domain_connection_request(text, text, text, text, boolean) to authenticated;

