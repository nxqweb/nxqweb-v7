-- Final NXQ launch signoff is a human-only gate. It can be recorded only after
-- every other required readiness check is currently ready, and is invalidated
-- automatically if any required prerequisite later regresses.

create or replace function public.invalidate_owner_launch_signoff_on_regression()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.check_key <> 'owner_launch_signoff'
     and new.required
     and old.status is distinct from new.status
     and new.status <> 'ready' then
    update public.launch_readiness_checks
    set status='unknown',
        evidence=jsonb_build_object(
          'approved',false,
          'invalidated_at',now(),
          'invalidated_by_check',new.check_key,
          'reason','required_readiness_regressed'
        ),
        last_checked_at=now(),
        checked_by='nxq-readiness-signoff-guard',
        updated_at=now()
    where check_key='owner_launch_signoff'
      and status='ready';
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_owner_launch_signoff_on_regression
on public.launch_readiness_checks;
create trigger invalidate_owner_launch_signoff_on_regression
after update of status on public.launch_readiness_checks
for each row execute function public.invalidate_owner_launch_signoff_on_regression();

create or replace function public.owner_approve_nxq_launch_readiness(
  target_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  blocking_keys text[];
  signoff_row public.launch_readiness_checks%rowtype;
begin
  if auth.role()<>'authenticated'
     or auth.uid() is null
     or not exists(
       select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()
     ) then
    raise exception 'Authenticated owner access required.';
  end if;

  if btrim(coalesce(target_confirmation,'')) <> 'APPROVE-NXQ-AUTONOMOUS-LAUNCH' then
    raise exception 'Exact launch approval confirmation is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nxq-owner-launch-readiness-signoff',0));

  select coalesce(array_agg(check_key order by check_key),'{}'::text[])
  into blocking_keys
  from public.launch_readiness_checks
  where required
    and check_key <> 'owner_launch_signoff'
    and status <> 'ready';

  if cardinality(blocking_keys)>0 then
    raise exception 'Launch signoff is blocked by required checks: %',array_to_string(blocking_keys,', ');
  end if;

  update public.launch_readiness_checks
  set status='ready',
      evidence=jsonb_build_object(
        'approved',true,
        'approved_at',now(),
        'approved_by_auth_user_id',auth.uid(),
        'confirmation_version','v1',
        'required_prerequisites_ready',true
      ),
      last_checked_at=now(),
      checked_by='nxq-owner-launch-approval',
      updated_at=now()
  where check_key='owner_launch_signoff'
  returning * into signoff_row;

  if not found then
    raise exception 'Owner launch signoff readiness row is missing.';
  end if;

  insert into public.automation_audit_log(event_type,actor_type,details)
  values(
    'owner_nxq_launch_readiness_approved',
    'owner',
    jsonb_build_object(
      'approved_by_auth_user_id',auth.uid(),
      'approved_at',signoff_row.last_checked_at,
      'provider_action_performed',false,
      'production_deployment_performed',false,
      'server_authoritative',true
    )
  );

  return jsonb_build_object(
    'ok',true,
    'status',signoff_row.status,
    'approved_at',signoff_row.last_checked_at,
    'production_deployment_performed',false
  );
end;
$$;

revoke all on function public.invalidate_owner_launch_signoff_on_regression()
from public,anon,authenticated,service_role;
revoke all on function public.owner_approve_nxq_launch_readiness(text)
from public,anon,authenticated,service_role;
grant execute on function public.owner_approve_nxq_launch_readiness(text)
to authenticated;

comment on function public.owner_approve_nxq_launch_readiness(text) is
  'Human owner-only final NXQ readiness signoff. Requires every other required check to be ready and performs no provider or production mutation.';
