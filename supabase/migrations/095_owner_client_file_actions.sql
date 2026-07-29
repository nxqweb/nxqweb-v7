-- Guarded owner actions for client-uploaded files.
-- Storage objects must be removed through the Supabase Storage API first.
-- This function then removes only the matching metadata row after verifying owner access.

create or replace function public.owner_finalize_client_file_delete(target_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  target_file public.client_files%rowtype;
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  select *
  into target_file
  from public.client_files
  where id = target_file_id
  for update;

  if target_file.id is null then
    raise exception 'Client file not found.';
  end if;

  if exists (
    select 1
    from storage.objects
    where bucket_id = target_file.bucket_id
      and name = target_file.storage_path
  ) then
    raise exception 'Storage object still exists. Remove it before deleting the file record.';
  end if;

  delete from public.client_files
  where id = target_file.id;

  return jsonb_build_object(
    'deleted', true,
    'file_id', target_file.id,
    'file_name', target_file.file_name,
    'client_id', target_file.client_id
  );
end;
$$;

revoke all on function public.owner_finalize_client_file_delete(uuid) from public;
grant execute on function public.owner_finalize_client_file_delete(uuid) to authenticated;

comment on function public.owner_finalize_client_file_delete(uuid) is
  'Owner-only metadata cleanup after the matching private Storage object has been removed.';
