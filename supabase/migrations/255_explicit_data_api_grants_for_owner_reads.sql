-- Explicit Data API grants ahead of Supabase's 2026-10-30 change (new public
-- tables no longer receive automatic anon/authenticated/service_role grants).
-- Forward-only and additive: it grants privileges and revokes nothing. On a
-- database that already holds these privileges via the old defaults it is a
-- no-op; on a fresh project or db reset it supplies what the earlier
-- migrations left implicit. See docs/DATA_API_GRANT_AUDIT.md.

-- 1. Owner pages read these two tables directly with the signed-in owner's
--    session (OwnerAutomationHealth.tsx -> automation_jobs;
--    OwnerExceptionCenter.tsx -> automation_escalations). Both already carry
--    owner-only "for all" RLS policies (migration 097), so the grant is SELECT
--    only: owners get no additional write path, and non-owners still see no rows.
grant select on table public.automation_jobs to authenticated;
grant select on table public.automation_escalations to authenticated;

-- 2. These tables are reached only through SECURITY DEFINER functions today.
--    Make service_role access explicit instead of depending on migration 195's
--    role-specific default privileges. anon/authenticated stay revoked (234).
grant select, insert, update, delete on table public.nxq_netlify_budget_settings to service_role;
grant select, insert, update, delete on table public.nxq_netlify_build_reservations to service_role;
