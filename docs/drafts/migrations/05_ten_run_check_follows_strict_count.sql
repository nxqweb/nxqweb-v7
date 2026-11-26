-- Draft 05 (NOT applied, NOT a real migration; it would become migration 301 on promotion).
-- Why: the ten-run launch check is written by two checkers, the strict counter (migration 181) and the
-- older broad evaluator (migration 141). Migration 181 added a guard that forces the row to "unknown"
-- whenever anyone except the strict counter writes it, so the page flickers between ready and unknown
-- depending on which checker ran last, even when the strict count is already 10.
-- Fix: keep the guard (a legacy writer still cannot decide the status), but make the guard derive the
-- status from the strict counter instead of forcing "unknown". Ready only when the strict count is 10 or
-- more; otherwise unknown. No new way to mark the check ready is added, and no other check changes.
create or replace function public.protect_strict_ten_run_readiness()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  strict_count integer;
begin
  if new.check_key='ten_clean_runs'
     and coalesce(new.checked_by,'')<>'nxq-strict-qa-readiness-v2' then
    strict_count:=public.count_strict_clean_business_runs();
    new.status:=case when strict_count>=10 then 'ready' else 'unknown' end;
    new.evidence:=jsonb_build_object(
      'strict_clean_business_e2e_runs',strict_count,
      'required',10,'evidence_policy','strict_qa_only_database_derived_v2',
      'legacy_override_rejected',true
    );
    new.checked_by:='nxq-strict-qa-readiness-protector-v2';
  end if;
  return new;
end;
$$;

comment on function public.protect_strict_ten_run_readiness() is
  'Only the strict counter decides the ten-run check: any other writer gets the status derived from count_strict_clean_business_runs() (ready at 10 or more, else unknown).';
