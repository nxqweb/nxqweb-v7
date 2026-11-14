-- Regression test for migration 293 (build-plan AI readiness accepts Claude). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  proto text; r jsonb; listed jsonb;
begin
  -- the adapter's recorded protocol list now names all three
  select config->'supported_protocols' into listed from public.nxq_provider_connections where provider_key = 'business_build_plan_ai' and scope_type = 'global' and scope_id is null;
  if listed is null or not (listed ? 'anthropic_messages' and listed ? 'openai_responses' and listed ? 'openai_chat_completions') then raise exception 'supported_protocols must list all three, got %', listed; end if;

  -- the readiness function reports the protocol as proven for the three real names, and not for anything else
  foreach proto in array array['anthropic_messages', 'openai_responses', 'openai_chat_completions', 'made_up_protocol', ''] loop
    delete from public.automation_worker_heartbeats where worker_key = 'generate-business-build-plan';
    insert into public.automation_worker_heartbeats (worker_key, execution_target, status, worker_version, heartbeat_at, metadata)
    values ('generate-business-build-plan', 'edge', 'healthy', 'test', now(), jsonb_build_object('provider_protocol', proto));
    r := public.evaluate_business_build_plan_ai_readiness();
    if (r->>'provider_protocol_proven')::boolean is distinct from (proto in ('anthropic_messages', 'openai_responses', 'openai_chat_completions')) then
      raise exception 'protocol "%" gave provider_protocol_proven = %', proto, r->>'provider_protocol_proven';
    end if;
    -- the check as a whole must stay "unknown" here: nothing else is proven in this fixture, so the protocol alone never makes it ready
    if (r->>'ready')::boolean then raise exception 'readiness must not turn on from the protocol alone'; end if;
  end loop;
end $$;

select 'DRAFT_TEST_OK';
rollback;
