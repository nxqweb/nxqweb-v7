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
-- What this exposes once migration 253 is applied (253 is the only place in
-- this codebase that ever writes a recipient_kind='owner' row with a
-- client_id set): a client could read billing_processor_connection_required
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
-- process-data-subject-request, migrations 248/249/250, and 253's client
-- branch). Nothing relies on this policy matching any other recipient_kind.
-- owner_manage_all_notifications (the separate owner_users-gated FOR ALL
-- policy) is untouched and continues to give owners full access regardless
-- of recipient_kind, exactly as before.
--
-- Ordering requirement, explicit: this migration must be applied in the
-- SAME guarded apply_all run as migration 253, with 254 applying at or
-- before 253 in that run's sequence (supabase db push applies pending
-- migrations in ascending filename order, so 253 then 254, within one
-- transaction-per-migration run -- if the run is interrupted between them,
-- 253 will have applied without 254, and the exposure window above is real
-- for however long that gap lasts). Never apply 253 in a run that does not
-- also carry 254. This is called out explicitly in the runtime handoff
-- doc as a block on applying 253 alone.
--
-- This migration is staged for review; it has not been applied to any
-- database.

drop policy if exists client_read_own_notifications on public.notification_deliveries;

create policy client_read_own_notifications on public.notification_deliveries
for select to authenticated
using (
  recipient_kind = 'client'
  and client_id is not null
  and exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid())
);
