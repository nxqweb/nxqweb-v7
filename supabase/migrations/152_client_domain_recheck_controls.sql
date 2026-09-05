-- Client-safe domain recheck request.
-- Clients can ask NXQ to re-evaluate their own domain but cannot mark it connected themselves.

create or replace function public.current_client_request_domain_recheck(target_domain_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare client_uuid uuid; domain_row public.client_domains%rowtype;
begin
  select id into client_uuid from public.clients where auth_user_id=auth.uid() order by created_at desc limit 1;
  if client_uuid is null then raise exception 'Client account not found.'; end if;
  update public.client_domains
  set next_check_at=now(),
      automation_state=case when automation_state='connected' then 'connected' else 'queued' end,
      automation_error=case when automation_state='connected' then automation_error else null end
  where id=target_domain_id and client_id=client_uuid and automation_enabled=true
  returning * into domain_row;
  if domain_row.id is null then raise exception 'Domain is unavailable or automation is disabled.'; end if;
  return jsonb_build_object('ok',true,'domain_id',domain_row.id,'automation_state',domain_row.automation_state,'connected',domain_row.automation_state='connected','next_check_at',domain_row.next_check_at);
end;
$$;
revoke all on function public.current_client_request_domain_recheck(uuid) from public,anon;
grant execute on function public.current_client_request_domain_recheck(uuid) to authenticated;
