-- Fixes a real RLS gap found by explicit request before any client-facing
-- notification-list UI was trusted: an authenticated client can currently
-- SELECT any notification_deliveries row where client_id belongs to them,
-- regardless of recipient_kind. The existing client_read_own_notifications
-- policy (migration 133) checks client_id ownership only:
--
--   using (client_id is not null and exists (
--     select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()
--   ));
--
-- It never references recipient_kind. RLS policies are permissive and
-- OR-combined, and authenticated also holds a blanket grant select on this
-- table (migration 133) -- there is no narrower grant to fall back on. The
-- application's own `.eq("recipient_kind", "client")` filter (added to
-- src/pages/ClientPortal.tsx and src/pages/ClientNotificationPreferences.tsx)
-- is a query parameter on those two specific requests, not a database
-- boundary: any other query with the same client session -- a different
-- page, browser devtools, a direct REST call, or simply that filter being
-- absent -- reads every row for that client_id regardless of recipient_kind.
--
-- What this would expose once migration 254 is applied (254 is the only
-- place in this codebase that ever writes a recipient_kind='owner' row with
-- a client_id set): a client could read billing_processor_connection_required
-- (reveals NXQ's own payment processor isn't connected, plus the exact
-- blocked charge amount) and freeze_review_owner_attention (reveals the
-- client's grace period has ended and that a human freeze decision is
-- pending, exposing NXQ's internal review process/timing to the very
-- account it concerns) for their own account. This is not billing-specific:
-- any future owner-facing notification tied to a client_id would leak the
-- same way through this one policy.
--
-- The fix is minimal and surgical: add recipient_kind = 'client' to the
-- policy's USING clause. Verified zero regression risk before drafting --
-- every client-facing notification_deliveries insert in this codebase
-- already explicitly sets recipient_kind='client' (build-business-website,
-- promote-business-production, reconcile-domain x2, ingest-business-lead,
-- process-data-subject-request, migrations 248/249/250, and 254's client
-- branch). Nothing relies on this policy matching any other recipient_kind.
-- owner_manage_all_notifications (the separate owner_users-gated FOR ALL
-- policy) is untouched and continues to give owners full access regardless
-- of recipient_kind, exactly as before.
--
-- Ordering, by design rather than by operational discipline: this
-- migration is deliberately numbered 253, one lower than migration 254
-- (the billing-notification writer that creates the exposed rows).
-- supabase db push applies pending migrations in ascending filename order,
-- each as its own transaction, so this restrictive policy is guaranteed to
-- land strictly before 254 ever can. If a push is interrupted after this
-- file but before 254, the only thing live is a tightened, harmless
-- policy -- the writer capability in 254 does not exist yet, so there is
-- nothing for the old gap to expose during that gap. This was originally
-- drafted as migration 254 with the writer as 253; the two were swapped
-- (git mv, no content dependency existed either way -- verified neither
-- file's SQL references anything the other creates) specifically to make
-- this ordering guarantee structural instead of procedural. See the
-- runtime handoff doc's "Local-file ordering fix" section for the full
-- before/after comparison.
--
-- This migration is staged for review; it has not been applied to any
-- database. Its applied status has not been independently verified
-- against any staging or production database in this renumbering pass --
-- migration history (schema_migrations) must be checked on the real
-- target database before any apply, regardless of what this file's own
-- history suggests.

drop policy if exists client_read_own_notifications on public.notification_deliveries;

create policy client_read_own_notifications on public.notification_deliveries
for select to authenticated
using (
  recipient_kind = 'client'
  and client_id is not null
  and exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid())
);
