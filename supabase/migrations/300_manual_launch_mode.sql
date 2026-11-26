-- 300: promoted from draft 05 on 2026-11-24 (owner said "promote and apply 05" in chat); NOT applied until the owner approves the guarded run.
-- Draft 05: "manual launch mode" for the three key-dependent launch readiness checks (added 2026-11-24).
-- Owner decision 2026-11-23, Option B in docs/READINESS_GATE_MAP.md: launch with the AI Desk copy-paste instead of AI planning and classification, and with automatic
-- email off. The AI key and the email provider become post-launch upgrades. This marks exactly three checks "not required" WITH A WRITTEN REASON that survives the
-- evaluators (they rewrite each row's status and evidence on every run, so the reason lives in its own column), and adds a reversible owner switch.
-- The precedent is migration 172 (the optional billing check). ADDITIVE: two new columns and one new function; no existing function or policy changes.
-- Only these three checks can ever be waived by this: notification_pipeline_ready, change_classifier_ready, business_build_plan_ai_ready.

alter table public.launch_readiness_checks add column if not exists waived_reason text;
alter table public.launch_readiness_checks add column if not exists waived_at timestamptz;

-- The decision, applied by this migration. (The owner's sign-off function only blocks on rows where required is true.)
update public.launch_readiness_checks
   set required = false,
       waived_reason = 'Manual launch mode (owner decision 2026-11-23): the AI Desk copy-paste replaces AI planning and classification, and automatic email stays off at launch. The AI key and the email provider are post-launch upgrades.',
       waived_at = now(),
       updated_at = now()
 where check_key in ('notification_pipeline_ready', 'change_classifier_ready', 'business_build_plan_ai_ready');

-- The reversible switch. true = manual mode (the three checks are not required), false = they are required again.
-- It shares the sign-off function's lock, so the two can never race. Turning manual mode OFF also withdraws any existing sign-off, because the sign-off guard
-- (migration 226) only reacts when a check's STATUS changes, and a check that becomes required again keeps its old status.
create or replace function public.owner_set_manual_launch_mode(enabled_value boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare changed integer; signoff_withdrawn boolean := false;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null or not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if enabled_value is null then raise exception 'Choose on or off.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nxq-owner-launch-readiness-signoff', 0));
  if enabled_value then
    update public.launch_readiness_checks
       set required = false,
           waived_reason = 'Manual launch mode (owner decision 2026-11-23): the AI Desk copy-paste replaces AI planning and classification, and automatic email stays off at launch. The AI key and the email provider are post-launch upgrades.',
           waived_at = now(), updated_at = now()
     where check_key in ('notification_pipeline_ready', 'change_classifier_ready', 'business_build_plan_ai_ready');
    get diagnostics changed = row_count;
  else
    update public.launch_readiness_checks
       set required = true, waived_reason = null, waived_at = null, updated_at = now()
     where check_key in ('notification_pipeline_ready', 'change_classifier_ready', 'business_build_plan_ai_ready');
    get diagnostics changed = row_count;
    update public.launch_readiness_checks
       set status = 'unknown',
           evidence = jsonb_build_object('approved', false, 'invalidated_at', now(), 'reason', 'manual_launch_mode_turned_off'),
           last_checked_at = now(), checked_by = 'nxq-manual-launch-mode', updated_at = now()
     where check_key = 'owner_launch_signoff' and status = 'ready';
    signoff_withdrawn := found;
  end if;
  insert into public.automation_audit_log(event_type, actor_type, details)
  values ('manual_launch_mode_set', 'owner', jsonb_build_object('owner_auth_user_id', auth.uid(), 'enabled', enabled_value, 'checks_changed', changed, 'signoff_withdrawn', signoff_withdrawn));
  return jsonb_build_object('ok', true, 'manual_launch_mode', enabled_value, 'checks_changed', changed, 'signoff_withdrawn', signoff_withdrawn);
end;
$$;

revoke all on function public.owner_set_manual_launch_mode(boolean) from public, anon;
grant execute on function public.owner_set_manual_launch_mode(boolean) to authenticated;
