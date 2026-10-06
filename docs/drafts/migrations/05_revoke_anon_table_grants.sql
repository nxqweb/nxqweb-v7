-- DRAFT (not applied): remove the anonymous-role grants that migration 003 ("v7 dev" convenience) put on seven core tables.
-- No policy on these tables allows anonymous access, so row-level security already blocks every anonymous request today; this removes the
-- grant itself (defense in depth, so a future permissive policy by mistake cannot expose a logged-out visitor). Logged-in clients, owners and the
-- service role are untouched: only the `anon` role loses access. Public pages reach data through Edge functions / RPCs, not these tables.
-- Source of the finding: docs/SECURITY_CHECK_2026-10-05.md, residual risk 2.

revoke all on table public.activity_logs from anon;
revoke all on table public.client_intakes from anon;
revoke all on table public.client_messages from anon;
revoke all on table public.clients from anon;
revoke all on table public.owner_ai_messages from anon;
revoke all on table public.owner_approval_requests from anon;
revoke all on table public.projects from anon;
