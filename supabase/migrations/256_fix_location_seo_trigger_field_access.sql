-- Forward-only fix for a latent defect in queue_location_seo_refresh()
-- (migration 132).
--
-- The function is shared by two triggers: one on client_locations and one on
-- client_location_services. It chose the location id with
--   case when tg_table_name = 'client_locations' then coalesce(new.id, old.id)
--        else coalesce(new.location_id, old.location_id) end
-- but PL/pgSQL resolves record fields when it PLANS the statement, not when a
-- branch executes. client_locations has no location_id column, so every INSERT
-- or UPDATE on client_locations failed with SQLSTATE 42703
-- ('record "new" has no field "location_id"') before the branch was evaluated.
-- Found by the first real staging run of the paid-capability guard validator
-- (run #226) and reproduced on a local database built from every migration.
--
-- Only the location-id expression changes: the second branch now reads the
-- field through to_jsonb(), which resolves at run time and returns null when
-- the row has no such column. Everything else is the same as migration 132:
-- same signature, SECURITY DEFINER, search_path, client/project guards, job
-- payload and idempotency key. No table, trigger, grant or data changes.
-- The revoke below repeats migration 132's privilege restriction.

create or replace function public.queue_location_seo_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_location_id uuid;
  project_uuid uuid;
  client_status text;
begin
  target_client_id := coalesce(new.client_id, old.client_id);
  target_location_id := case
    when tg_table_name = 'client_locations' then coalesce(new.id, old.id)
    else coalesce((to_jsonb(new) ->> 'location_id')::uuid, (to_jsonb(old) ->> 'location_id')::uuid)
  end;

  select status::text into client_status from public.clients where id = target_client_id;
  if client_status not in ('approved','active') then return coalesce(new, old); end if;

  select id into project_uuid from public.projects where client_id = target_client_id order by created_at desc limit 1;
  if project_uuid is null then return coalesce(new, old); end if;

  perform public.enqueue_automation_job(
    target_client_id,
    project_uuid,
    'website_location_seo_refresh',
    'project:' || project_uuid::text || ':location:' || target_location_id::text || ':seo:' || to_char(now(), 'YYYYMMDDHH24MI'),
    jsonb_build_object(
      'execution_target', 'edge',
      'requires_external_worker', true,
      'location_id', target_location_id,
      'source', tg_table_name
    ),
    now() + interval '2 minutes',
    55
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.queue_location_seo_refresh() from public, anon, authenticated;
