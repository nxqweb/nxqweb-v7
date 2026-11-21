-- Continuation of the read-only end-to-end audit, now covering file
-- security/malware scanning. complete_client_file_security_scan()
-- (migration 144) flips a scanned file's quarantine_status to "released"
-- or "quarantined" and, for suspicious/infected results, records an
-- automation_escalations row for the owner -- but never told the client
-- their own upload was released or quarantined. Same notification gap
-- already fixed for Business/Commerce/domain/privacy events this session.
--
-- The owner-visibility side of this (automation_escalations rows that no
-- owner-facing tool ever reads) is the same systemic gap already found and
-- logged for billing escalations; this migration does not attempt to fix
-- that broader problem, only the client-notification half that is unique
-- to this function.
--
-- This migration only adds a notification_deliveries insert to the
-- already-existing function, using the same channel/recipient_kind
-- pattern already established elsewhere in this schema. No new table, no
-- privilege change. Every other line of the function body is unchanged
-- from migration 144.
--
-- This migration is staged for review; it has not been applied to any
-- database.

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

  insert into public.notification_deliveries(
    client_id,channel,recipient_kind,template_key,subject,body,priority,metadata
  ) values (
    scan_row.client_id,
    'in_app','client',
    case when target_status = 'clean' then 'client_file_released' else 'client_file_quarantined' end,
    case when target_status = 'clean' then 'Your uploaded file is ready' else 'Your uploaded file needs attention' end,
    case when target_status = 'clean'
      then 'Your uploaded file passed security scanning and is now available.'
      else 'Your uploaded file could not be released after security scanning and remains restricted. NXQ has been notified.'
    end,
    case when target_status = 'clean' then 'normal' else 'high' end,
    jsonb_build_object('client_file_id', scan_row.client_file_id, 'scan_id', scan_row.id, 'status', target_status)
  );

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

comment on function public.complete_client_file_security_scan(uuid,text,text,text,text,jsonb) is
  'Completes a client file security scan and notifies the client in-app -- identical to migration 144''s version except for the added notification_deliveries insert.';
