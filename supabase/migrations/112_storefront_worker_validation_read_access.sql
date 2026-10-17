-- Allow the protected storefront worker to read only the validation tables it needs.
-- Browser roles remain unchanged.

grant select on table public.clients to service_role;
grant select on table public.commerce_storefronts to service_role;
