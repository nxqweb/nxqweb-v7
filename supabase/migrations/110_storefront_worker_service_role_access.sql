-- Allow only the protected Supabase service role to claim provisioning jobs.
-- Browser users still cannot call this worker-only RPC directly.

grant execute on function public.claim_next_storefront_provisioning_job(uuid) to service_role;
