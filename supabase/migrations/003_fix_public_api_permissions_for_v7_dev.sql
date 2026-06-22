-- =========================================================
-- 003 FIX PUBLIC API PERMISSIONS FOR NXQ WEB V7 DEV
-- Temporary local/dev API grants.
-- Later we replace this with real auth-scoped owner/client policies.
-- =========================================================

grant usage on schema public to anon;
grant usage on schema public to authenticated;

grant select on public.packages to anon;
grant select, insert, update on public.clients to anon;
grant select, insert, update on public.client_intakes to anon;
grant select, insert, update on public.projects to anon;
grant select, insert, update on public.owner_approval_requests to anon;
grant select, insert on public.client_messages to anon;
grant select, insert on public.owner_ai_messages to anon;
grant select, insert on public.activity_logs to anon;
grant select on public.ai_rules to anon;

grant select on public.packages to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.client_intakes to authenticated;
grant select, insert, update on public.projects to authenticated;
grant select, insert, update on public.owner_approval_requests to authenticated;
grant select, insert on public.client_messages to authenticated;
grant select, insert on public.owner_ai_messages to authenticated;
grant select, insert on public.activity_logs to authenticated;
grant select on public.ai_rules to authenticated;
grant select, insert on public.ai_worker_logs to authenticated;