-- Enforce the permanent client-owned domain policy at the database boundary.
-- Existing legacy rows remain readable; all new or updated rows must comply.

alter table public.client_domains
  drop constraint if exists client_domains_client_owned_only;

alter table public.client_domains
  add constraint client_domains_client_owned_only
  check (domain_type = 'client_owned' and ownership_confirmed is true)
  not valid;

comment on constraint client_domains_client_owned_only on public.client_domains is
  'NXQ does not purchase, register, own, renew, or take registrar credentials for client domains. Clients must own/control the domain; NXQ only coordinates DNS and SSL connection.';

create or replace function public.enforce_client_owned_domain_policy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.domain_type is distinct from 'client_owned' or new.ownership_confirmed is not true then
    raise exception 'Client domains must be client-owned and ownership/control must be confirmed.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_client_owned_domain_policy on public.client_domains;
create trigger enforce_client_owned_domain_policy
before insert or update of domain_type, ownership_confirmed on public.client_domains
for each row execute function public.enforce_client_owned_domain_policy();

revoke all on function public.enforce_client_owned_domain_policy() from public, anon, authenticated;
