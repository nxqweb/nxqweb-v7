-- Strict ten-run launch gate: only evidence-verified disposable Business E2E runs count.
create or replace function public.evaluate_strict_ten_run_readiness()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  strict_count integer:=0;
  ready_now boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  strict_count:=public.count_strict_clean_business_runs();
  ready_now:=strict_count>=10;
  update public.launch_readiness_checks
  set status=case when ready_now then 'ready' else 'unknown' end,
      evidence=jsonb_build_object('strict_clean_business_e2e_runs',strict_count,'required',10,'evidence_policy','strict_db_verified'),
      last_checked_at=now(),checked_by='nxq-strict-qa-readiness',updated_at=now()
  where check_key='ten_clean_runs';
  return jsonb_build_object('ok',true,'ready',ready_now,'strict_clean_runs',strict_count,'required',10);
end;
$$;
revoke all on function public.evaluate_strict_ten_run_readiness() from public,anon,authenticated;
grant execute on function public.evaluate_strict_ten_run_readiness() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-strict-ten-run-readiness-every-five-minutes') then
    perform cron.unschedule('nxq-strict-ten-run-readiness-every-five-minutes');
  end if;
end $$;
select cron.schedule('nxq-strict-ten-run-readiness-every-five-minutes','*/5 * * * *',$$select public.evaluate_strict_ten_run_readiness();$$);

create or replace function public.refresh_strict_qa_readiness_after_run()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- Runtime evaluator is service-role scheduled; this trigger only marks the gate stale/unknown immediately
  -- so a manually edited QA row can never leave an old green launch state behind.
  if new.test_kind='business_e2e' then
    update public.launch_readiness_checks set status='unknown',evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('stale_after_qa_change',true,'changed_run_id',new.id),updated_at=now() where check_key='ten_clean_runs';
  end if;
  return new;
end;
$$;
drop trigger if exists refresh_strict_qa_readiness_after_run on public.qa_lifecycle_runs;
create trigger refresh_strict_qa_readiness_after_run after insert or update of status,evidence on public.qa_lifecycle_runs for each row execute function public.refresh_strict_qa_readiness_after_run();

comment on function public.evaluate_strict_ten_run_readiness() is 'Launch gate counts only disposable Business E2E runs that passed strict database/provider evidence validation.';