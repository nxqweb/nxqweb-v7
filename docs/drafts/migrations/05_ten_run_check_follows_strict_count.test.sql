-- Sidecar test for draft 05 (ten-run check follows the strict count). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  r record;
begin
  -- the strict counter is replaced inside this rolled-back transaction so the test controls the count
  execute 'create or replace function public.count_strict_clean_business_runs() returns integer language sql as $f$ select 10 $f$';

  -- 1. count is 10: a legacy writer that says "unknown" still ends up ready (the flicker case), marked as protected
  update public.launch_readiness_checks set status='unknown', checked_by='nxq-readiness-evaluator' where check_key='ten_clean_runs';
  select status, checked_by, evidence into r from public.launch_readiness_checks where check_key='ten_clean_runs';
  if r.status <> 'ready' then raise exception 'count 10 with a legacy write must stay ready, got %', r.status; end if;
  if r.checked_by <> 'nxq-strict-qa-readiness-protector-v2' then raise exception 'legacy write must be marked protected, got %', r.checked_by; end if;
  if (r.evidence->>'strict_clean_business_e2e_runs')::int <> 10 or (r.evidence->>'legacy_override_rejected') <> 'true' then raise exception 'evidence must show the strict count and the rejected override: %', r.evidence; end if;

  -- 2. count is 9: a legacy writer that says "ready" must NOT make it ready
  execute 'create or replace function public.count_strict_clean_business_runs() returns integer language sql as $f$ select 9 $f$';
  update public.launch_readiness_checks set status='ready', checked_by='nxq-readiness-evaluator' where check_key='ten_clean_runs';
  select status into r from public.launch_readiness_checks where check_key='ten_clean_runs';
  if r.status <> 'unknown' then raise exception 'count 9 must never be ready from a legacy write, got %', r.status; end if;

  -- 3. the strict writer passes through unchanged
  update public.launch_readiness_checks set status='ready', checked_by='nxq-strict-qa-readiness-v2' where check_key='ten_clean_runs';
  select status, checked_by into r from public.launch_readiness_checks where check_key='ten_clean_runs';
  if r.status <> 'ready' or r.checked_by <> 'nxq-strict-qa-readiness-v2' then raise exception 'the strict writer must pass through, got % %', r.status, r.checked_by; end if;

  -- 4. other checks are untouched by the guard
  update public.launch_readiness_checks set status='unknown', checked_by='nxq-readiness-evaluator' where check_key='cron_healthy';
  select status, checked_by into r from public.launch_readiness_checks where check_key='cron_healthy';
  if r.status <> 'unknown' or r.checked_by <> 'nxq-readiness-evaluator' then raise exception 'other checks must not be touched, got % %', r.status, r.checked_by; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
