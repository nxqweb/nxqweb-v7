-- Grant the protected Edge Function service role the direct table access it needs
-- after claiming a provisioning job through the worker RPC.
-- Browser roles remain revoked and RLS stays enabled.

grant select, insert, update, delete
on table public.commerce_storefront_provisioning
to service_role;
