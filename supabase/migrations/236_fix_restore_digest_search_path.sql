-- Allow the recovery RPCs to resolve pgcrypto.digest() from Supabase's
-- extensions schema while retaining an explicit, injection-safe search path.

alter function public.create_verified_project_restore_point(uuid, text)
  set search_path = public, extensions;

alter function public.simulate_project_restore(uuid)
  set search_path = public, extensions;
