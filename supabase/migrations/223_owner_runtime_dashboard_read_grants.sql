-- Restore the table-level SELECT privileges required by the owner runtime dashboards.
-- RLS remains the authorization boundary, and authenticated browser sessions stay read-only.

begin;

alter table public.launch_readiness_checks enable row level security;
alter table public.nxq_provider_connections enable row level security;

revoke all on table public.launch_readiness_checks from authenticated;
revoke all on table public.nxq_provider_connections from authenticated;

grant select on table public.launch_readiness_checks to authenticated;
grant select on table public.nxq_provider_connections to authenticated;

drop policy if exists owner_manage_launch_readiness on public.launch_readiness_checks;
drop policy if exists owner_read_launch_readiness on public.launch_readiness_checks;
create policy owner_read_launch_readiness
on public.launch_readiness_checks
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_users ou
    where ou.auth_user_id = auth.uid()
  )
);

drop policy if exists owner_manage_provider_connections on public.nxq_provider_connections;
drop policy if exists owner_read_provider_connections on public.nxq_provider_connections;
create policy owner_read_provider_connections
on public.nxq_provider_connections
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_users ou
    where ou.auth_user_id = auth.uid()
  )
);

comment on policy owner_read_launch_readiness on public.launch_readiness_checks is
  'Authenticated NXQ owners may read launch evidence; service-side runtimes remain the only writers.';

comment on policy owner_read_provider_connections on public.nxq_provider_connections is
  'Authenticated NXQ owners may read provider readiness; service-side runtimes remain the only writers.';

commit;
