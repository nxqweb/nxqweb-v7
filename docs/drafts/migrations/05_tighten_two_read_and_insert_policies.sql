-- DRAFT (not a real migration; needs the owner's approval to promote and apply).
-- From the 2026-11-13 security review. Two corrections, no product decision involved:
--
-- 1. public.ai_rules: the read policy was created as "Temporary" for the public role. Nothing in the app,
--    the Edge functions or any caller-rights database function reads this table, so reads become owner-only.
-- 2. public.website_change_requests: the client insert policy is meant to require that the project belongs
--    to the SAME client as the request row, but its unqualified column reference binds to the inner table.
--    NOT exploitable today (verified 2026-11-13 with a control run): the policy's project lookup runs under
--    the caller's own row security on public.projects, so another client's project is never visible to it
--    and the insert is refused anyway. This rewrite makes the policy say what it means instead of relying
--    on that side effect. Behaviour is unchanged; the sidecar test pins it.

drop policy if exists "Temporary public read ai rules" on public.ai_rules;
revoke all on table public.ai_rules from public, anon;
drop policy if exists owner_read_ai_rules on public.ai_rules;
create policy owner_read_ai_rules on public.ai_rules
for select to authenticated
using (public.is_nxq_owner());

drop policy if exists client_insert_own_change_requests on public.website_change_requests;
create policy client_insert_own_change_requests on public.website_change_requests
for insert to authenticated
with check (
  requested_by_auth_user_id = auth.uid()
  and exists (
    select 1 from public.clients c
    where c.id = website_change_requests.client_id and c.auth_user_id = auth.uid()
  )
  and exists (
    select 1 from public.projects p
    where p.id = website_change_requests.project_id and p.client_id = website_change_requests.client_id
  )
);
