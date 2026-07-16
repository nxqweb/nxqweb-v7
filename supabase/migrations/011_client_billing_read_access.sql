-- Allow authenticated clients to read only their own payment records.
-- Owners retain their existing full management policy.

drop policy if exists "Clients can view own payment records"
on public.payment_records;

create policy "Clients can view own payment records"
on public.payment_records
for select
to authenticated
using (
  exists (
    select 1
    from public.clients
    where clients.id = payment_records.client_id
      and clients.auth_user_id = auth.uid()
  )
);