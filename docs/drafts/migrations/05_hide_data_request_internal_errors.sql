-- DRAFT (not applied): stop logged-in clients reading data_subject_requests.last_error (internal worker error text) through the API.
-- Today authenticated users hold table-level SELECT, row security limits them to their own rows, but that still includes last_error. The portal page
-- never shows the text (only a generic "needs another review" notice, now driven by status = 'failed'), so the column is replaced here by a column-level
-- grant that lists every column EXCEPT last_error. INSERT is unchanged (requests are created through submit_current_account_data_request, security definer).
--
-- ORDER MATTERS: apply this ONLY AFTER the front-end change that stops selecting last_error is published (src/pages/ClientSecurityPrivacy.tsx,
-- guarded by `npm run test:privacy-no-internal-errors`). A published page that still asks for last_error would fail to load once this is applied.
-- Side effect to know: `select *` on this table by an authenticated user now fails with permission denied; list the columns. Owners read last_error with
-- the service role (no owner page uses it). A column added to this table in a LATER migration needs its own `grant select (col)` to be visible to clients.
-- Source of the finding: docs/NXQ_RUNTIME_HANDOFF.md "Open findings" (1).

revoke select on table public.data_subject_requests from authenticated;

grant select (
  id, nxq_account_id, client_id, request_code, request_type, status, requested_by_auth_user_id,
  scope, result, requested_at, due_at, completed_at, created_at, updated_at
) on table public.data_subject_requests to authenticated;
