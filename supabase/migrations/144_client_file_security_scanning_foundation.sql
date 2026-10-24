-- Client file malware-scan/quarantine foundation.
-- Keeps security state separate from existing client_files records and never stores scanner credentials.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.client_file_security_scans (
  id uuid primary key default gen_random_uuid(),
  client_file_id uuid not null unique references public.client_files(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','scanning','clean','suspicious','infected','error','skipped')),
  quarantine_status text not null default 'restricted' check (quarantine_status in ('restricted','released','quarantined','deleted')),
  provider_key text,
  provider_reference text,
  content_sha256 text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 12),
  run_after timestamptz not null default now(),
  last_error text,
  findings jsonb not null default '{}'::jsonb,
  scanned_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_file_security_scans_due_idx
  on public.client_file_security_scans(status, run_after, created_at)
  where status in ('pending','error');
create index if not exists client_file_security_scans_client_idx
  on public.client_file_security_scans(client_id, status, created_at desc);

alter table public.client_file_security_scans enable row level security;
revoke all on table public.client_file_security_scans from public, anon;
grant select on public.client_file_security_scans to authenticated;
grant select, insert, update, delete on public.client_file_security_scans to service_role;

create policy client_view_own_file_security_scans
on public.client_file_security_scans for select to authenticated
using (exists (
  select 1 from public.clients c
  where c.id = client_file_security_scans.client_id
    and c.auth_user_id = auth.uid()
));

create policy owner_manage_file_security_scans
on public.client_file_security_scans for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create or replace function public.queue_client_file_security_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_file_security_scans (
    client_file_id,
    client_id,
    status,
    quarantine_status,
    run_after
  ) values (
    new.id,
    new.client_id,
    'pending',
    'restricted',
    now()
  )
  on conflict (client_file_id) do nothing;

  insert into public.automation_audit_log (client_id, event_type, actor_type, details)
  values (
    new.client_id,
    'client_file_security_scan_queued',
    'backend',
    jsonb_build_object('client_file_id', new.id, 'storage_path', new.storage_path)
  );

  return new;
end;
$$;

drop trigger if exists queue_client_file_security_scan on public.client_files;
create trigger queue_client_file_security_scan
after insert on public.client_files
for each row execute function public.queue_client_file_security_scan();

-- Backfill scan records for files that already exist and are not marked deleted.
insert into public.client_file_security_scans (client_file_id, client_id, status, quarantine_status, run_after)
select f.id, f.client_id, 'pending', 'restricted', now()
from public.client_files f
where coalesce(f.status, '') <> 'deleted'
on conflict (client_file_id) do nothing;

create or replace function public.claim_next_client_file_security_scan(worker_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scan_row public.client_file_security_scans%rowtype;
begin
  if nullif(btrim(worker_name), '') is null then raise exception 'Worker name is required.'; end if;

  perform public.record_worker_heartbeat(
    worker_name,
    'provider',
    'healthy',
    jsonb_build_object('file_scan_claim_invoked_at', now()),
    null
  );

  select s.* into scan_row
  from public.client_file_security_scans s
  join public.client_files f on f.id = s.client_file_id
  where s.status in ('pending','error')
    and s.run_after <= now()
    and s.attempts < s.max_attempts
    and coalesce(f.status, '') <> 'deleted'
  order by s.run_after asc, s.created_at asc
  for update of s skip locked
  limit 1;

  if not found then return null; end if;

  update public.client_file_security_scans
  set status = 'scanning',
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where id = scan_row.id
  returning * into scan_row;

  return to_jsonb(scan_row);
end;
$$;

create or replace function public.complete_client_file_security_scan(
  target_scan_id uuid,
  target_status text,
  target_provider_key text,
  target_provider_reference text default null,
  target_content_sha256 text default null,
  target_findings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scan_row public.client_file_security_scans%rowtype;
  next_quarantine text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if target_status not in ('clean','suspicious','infected') then raise exception 'Unsupported scan result.'; end if;

  next_quarantine := case when target_status = 'clean' then 'released' else 'quarantined' end;

  update public.client_file_security_scans
  set status = target_status,
      quarantine_status = next_quarantine,
      provider_key = nullif(btrim(target_provider_key), ''),
      provider_reference = nullif(btrim(target_provider_reference), ''),
      content_sha256 = nullif(lower(btrim(target_content_sha256)), ''),
      findings = coalesce(target_findings, '{}'::jsonb),
      scanned_at = now(),
      released_at = case when target_status = 'clean' then now() else null end,
      last_error = null,
      updated_at = now()
  where id = target_scan_id and status = 'scanning'
  returning * into scan_row;

  if scan_row.id is null then raise exception 'Security scan is not in a completable state.'; end if;

  if target_status in ('suspicious','infected') then
    insert into public.automation_escalations (
      client_id,
      escalation_type,
      severity,
      title,
      summary,
      details
    ) values (
      scan_row.client_id,
      'client_file_security_alert',
      case when target_status = 'infected' then 'critical' else 'high' end,
      'Uploaded client file was quarantined',
      'NXQ file security did not release an uploaded file.',
      jsonb_build_object(
        'client_file_id', scan_row.client_file_id,
        'scan_id', scan_row.id,
        'scan_status', target_status,
        'provider_key', target_provider_key
      )
    );
  end if;

  insert into public.automation_audit_log (client_id, event_type, actor_type, details)
  values (
    scan_row.client_id,
    'client_file_security_scan_completed',
    'provider',
    jsonb_build_object(
      'client_file_id', scan_row.client_file_id,
      'scan_id', scan_row.id,
      'status', target_status,
      'quarantine_status', next_quarantine
    )
  );

  return to_jsonb(scan_row);
end;
$$;

create or replace function public.fail_client_file_security_scan(
  target_scan_id uuid,
  target_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scan_row public.client_file_security_scans%rowtype;
  exhausted boolean;
  retry_minutes integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;

  select * into scan_row
  from public.client_file_security_scans
  where id = target_scan_id
  for update;

  if not found or scan_row.status <> 'scanning' then raise exception 'Security scan is not running.'; end if;

  exhausted := scan_row.attempts >= scan_row.max_attempts;
  retry_minutes := least(60, greatest(2, power(2, least(scan_row.attempts, 5))::integer));

  update public.client_file_security_scans
  set status = 'error',
      quarantine_status = 'restricted',
      last_error = left(coalesce(target_error, 'Unknown file scan failure.'), 2000),
      run_after = case when exhausted then run_after else now() + make_interval(mins => retry_minutes) end,
      updated_at = now()
  where id = target_scan_id
  returning * into scan_row;

  if exhausted then
    insert into public.automation_escalations (
      client_id,
      escalation_type,
      severity,
      title,
      summary,
      details
    ) values (
      scan_row.client_id,
      'client_file_scan_exhausted',
      'high',
      'Client file scan needs owner attention',
      'NXQ could not verify an uploaded file after automatic retries, so access remains restricted.',
      jsonb_build_object('scan_id', scan_row.id, 'client_file_id', scan_row.client_file_id, 'error', scan_row.last_error)
    );
  end if;

  return to_jsonb(scan_row);
end;
$$;

revoke all on function public.claim_next_client_file_security_scan(text) from public, anon, authenticated;
revoke all on function public.complete_client_file_security_scan(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_client_file_security_scan(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_next_client_file_security_scan(text) to service_role;
grant execute on function public.complete_client_file_security_scan(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.fail_client_file_security_scan(uuid,text) to service_role;

create or replace function public.dispatch_client_file_security_scans()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  worker_url text;
  worker_token text;
  due_count integer := 0;
  request_id bigint;
begin
  select count(*) into due_count
  from public.client_file_security_scans
  where status in ('pending','error')
    and run_after <= now()
    and attempts < max_attempts;

  if due_count = 0 then return jsonb_build_object('ok',true,'due_scans',0,'dispatched',false); end if;

  select decrypted_secret into worker_url
  from vault.decrypted_secrets
  where name = 'nxq_file_scan_edge_url'
  order by created_at desc limit 1;

  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'nxq_automation_worker_token'
  order by created_at desc limit 1;

  if nullif(btrim(worker_url),'') is null or nullif(btrim(worker_token),'') is null then
    return jsonb_build_object('ok',false,'configured',false,'reason','file_scan_worker_vault_config_missing','due_scans',due_count);
  end if;

  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
    body := jsonb_build_object('source','nxq_file_scan_cron','requested_at',now())
  ) into request_id;

  return jsonb_build_object('ok',true,'configured',true,'due_scans',due_count,'dispatched',true,'request_id',request_id);
end;
$$;

revoke all on function public.dispatch_client_file_security_scans() from public, anon, authenticated;
grant execute on function public.dispatch_client_file_security_scans() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-file-security-scans-every-two-minutes') then
    perform cron.unschedule('nxq-file-security-scans-every-two-minutes');
  end if;
end;
$$;

select cron.schedule(
  'nxq-file-security-scans-every-two-minutes',
  '*/2 * * * *',
  $$select public.dispatch_client_file_security_scans();$$
);

comment on table public.client_file_security_scans is
  'Malware/security verification state for private client uploads. Files remain restricted until explicitly released clean; scanner secrets never live in this table.';
