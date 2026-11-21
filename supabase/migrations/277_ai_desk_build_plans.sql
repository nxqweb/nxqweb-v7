-- Migration 277: AI Desk build plans (owner decision 2026-10-18: until the paid AI key exists, the owner carries the build-plan task to a
-- separate "NXQX AI Desk" chat and saves the checked answer back). Promoted from draft 09 on 2026-10-18 on the owner's choice "A". NOT APPLIED: the owner applies it
-- with the guarded workflow (docs/OCT22_DEPLOY_DAY_CHECKLIST.md); the panel stays in its no-server mode until the switch in src/lib/aiDeskConfig.ts is set.
--
-- How it fits the pipeline (the server builds the task, so it can never disagree with what the pipeline later checks):
--  1. Owner approves a client. The existing prepare-build-plan worker runs. With no AI key configured it records the EXACT task it would have
--     sent (request incl. the real input fingerprint) as a 'waiting' row here, then defers the job without using up a retry.
--  2. Owner screen reads that task (get_ai_desk_status), the owner copies it to the AI Desk chat, pastes the reply back, and saves it
--     (save_ai_desk_build_plan). Saving checks the answer against the SERVER-HELD fingerprint and wakes the job.
--  3. The worker re-runs the full answer validator (limits, approved services/pages/theme, no links, no unsupported marketing claims). Pass: the
--     plan is used and the row becomes 'used'. Fail: the row becomes 'rejected' with a plain reason and a fresh 'waiting' task is recorded.
--
-- What it adds (deny-by-default: RLS on, no API grants on the table; access only through the two owner functions and the service role):
--  * ai_desk_build_plans with status waiting | saved | used | rejected | superseded; at most ONE row per client in waiting/saved at a time
--  * save_ai_desk_build_plan(client, answer): owner-only. Cheap structural checks only; the worker is the real gate.
--  * get_ai_desk_status(client): owner-only, shows the waiting task to copy, or saved/used, plus the latest rejection reason.
--
-- NOT in this draft: anything that lets an answer skip the worker's validation, publish a site, change a tier or touch billing.

create table if not exists public.ai_desk_build_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  desk_fingerprint text not null check (desk_fingerprint ~ '^[a-f0-9]{64}$'),
  request jsonb not null check (jsonb_typeof(request) = 'object' and length(request::text) <= 16000),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and length(result::text) <= 64000)),
  status text not null default 'waiting' check (status in ('waiting', 'saved', 'used', 'rejected', 'superseded')),
  saved_by uuid,
  last_error text check (last_error is null or length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  used_at timestamptz,
  check (status <> 'saved' or result is not null)
);

create unique index if not exists ai_desk_build_plans_one_open_idx
  on public.ai_desk_build_plans (client_id) where status in ('waiting', 'saved');
create index if not exists ai_desk_build_plans_client_idx
  on public.ai_desk_build_plans (client_id, created_at desc);

alter table public.ai_desk_build_plans enable row level security;
revoke all on public.ai_desk_build_plans from public, anon, authenticated;

create or replace function public.save_ai_desk_build_plan(
  target_client_id uuid,
  desk_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting_row public.ai_desk_build_plans%rowtype;
  confidence_value numeric;
  top_keys text;
begin
  if auth.role() <> 'authenticated'
     or not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if target_client_id is null or desk_result is null then
    raise exception 'Client and answer are both required.';
  end if;
  if jsonb_typeof(desk_result) <> 'object' then
    raise exception 'The answer must be a JSON object.';
  end if;
  if length(desk_result::text) > 64000 then
    raise exception 'The answer is too large.';
  end if;

  select * into waiting_row from public.ai_desk_build_plans
  where client_id = target_client_id and status = 'waiting'
  for update;
  if not found then
    raise exception 'No AI Desk task is waiting for this client. Approve the client first and give the pipeline a minute to prepare it.';
  end if;

  if desk_result->>'request_fingerprint' is distinct from waiting_row.desk_fingerprint then
    raise exception 'The answer does not match the waiting task. Copy the task again and ask the AI Desk for a fresh answer.';
  end if;
  if desk_result->>'schema_version' is distinct from 'nxq-business-build-plan-v1' then
    raise exception 'The answer has the wrong schema version.';
  end if;
  select string_agg(k, ',' order by k) into top_keys from jsonb_object_keys(desk_result) as k;
  if top_keys is distinct from 'confidence,request_fingerprint,risk_flags,schema_version,strategy' then
    raise exception 'The answer has an unexpected shape.';
  end if;
  if jsonb_typeof(desk_result->'confidence') <> 'number' then
    raise exception 'The answer confidence must be a number.';
  end if;
  confidence_value := (desk_result->>'confidence')::numeric;
  if confidence_value < 0.82 or confidence_value > 1 then
    raise exception 'The answer confidence must be 0.82 to 1.';
  end if;
  if jsonb_typeof(desk_result->'risk_flags') <> 'array' or jsonb_array_length(desk_result->'risk_flags') <> 0 then
    raise exception 'The answer reported risk flags, so it cannot be saved.';
  end if;
  if jsonb_typeof(desk_result->'strategy') <> 'object' then
    raise exception 'The answer has no strategy.';
  end if;

  update public.ai_desk_build_plans
  set status = 'saved', result = desk_result, saved_by = auth.uid(), saved_at = now(), last_error = null
  where id = waiting_row.id;

  -- Wake the plan job now instead of waiting out its retry delay.
  update public.automation_jobs
  set run_after = now()
  where client_id = target_client_id and job_type = 'prepare_build_plan' and status = 'queued';

  insert into public.automation_audit_log (client_id, event_type, actor_type, details)
  values (target_client_id, 'ai_desk_plan_saved', 'owner', jsonb_build_object('plan_id', waiting_row.id, 'desk_fingerprint', waiting_row.desk_fingerprint));

  return jsonb_build_object('ok', true, 'plan_id', waiting_row.id, 'status', 'saved');
end;
$$;

create or replace function public.get_ai_desk_status(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  open_row public.ai_desk_build_plans%rowtype;
  used_row public.ai_desk_build_plans%rowtype;
  rejected_row public.ai_desk_build_plans%rowtype;
  last_error_text text;
begin
  if auth.role() <> 'authenticated'
     or not exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()) then
    raise exception 'Authenticated owner access required.';
  end if;
  if target_client_id is null then
    raise exception 'Client is required.';
  end if;

  select * into rejected_row from public.ai_desk_build_plans
  where client_id = target_client_id and status = 'rejected' order by created_at desc limit 1;
  select * into used_row from public.ai_desk_build_plans
  where client_id = target_client_id and status = 'used' order by used_at desc limit 1;
  if rejected_row.id is not null and (used_row.id is null or rejected_row.created_at > used_row.used_at) then
    last_error_text := rejected_row.last_error;
  end if;

  select * into open_row from public.ai_desk_build_plans
  where client_id = target_client_id and status in ('waiting', 'saved') limit 1;
  if open_row.id is not null then
    return jsonb_build_object(
      'status', open_row.status,
      'request', case when open_row.status = 'waiting' then open_row.request else null end,
      'saved_at', open_row.saved_at,
      'last_error', last_error_text
    );
  end if;
  if used_row.id is not null then
    return jsonb_build_object('status', 'used', 'used_at', used_row.used_at, 'last_error', last_error_text);
  end if;
  return jsonb_build_object('status', 'none', 'last_error', last_error_text);
end;
$$;

revoke all on function public.save_ai_desk_build_plan(uuid, jsonb) from public, anon;
revoke all on function public.get_ai_desk_status(uuid) from public, anon;
grant execute on function public.save_ai_desk_build_plan(uuid, jsonb) to authenticated;
grant execute on function public.get_ai_desk_status(uuid) to authenticated;
