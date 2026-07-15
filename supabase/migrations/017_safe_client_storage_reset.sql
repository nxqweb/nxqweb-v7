-- Safe client workspace reset support.
-- Prevents deleting client_files rows while the referenced Storage object still exists,
-- and allows approved owners to remove objects from the private client-files bucket
-- through the Supabase Storage API before calling reset_client_workspace.

-- OWNER STORAGE DELETE ACCESS

drop policy if exists "Owners can delete client file objects" on storage.objects;
create policy "Owners can delete client file objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'client-files'
  and exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

-- GUARD CLIENT FILE RECORD DELETION UNTIL STORAGE OBJECT IS GONE

create or replace function public.guard_client_file_record_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if exists (
    select 1
    from storage.objects
    where storage.objects.bucket_id = old.bucket_id
      and storage.objects.name = old.storage_path
  ) then
    raise exception 'Storage object still exists for client file %. Remove the Storage object before deleting the file record.', old.file_name;
  end if;

  return old;
end;
$$;

drop trigger if exists guard_client_file_record_delete_before_delete on public.client_files;
create trigger guard_client_file_record_delete_before_delete
before delete on public.client_files
for each row
execute function public.guard_client_file_record_delete();
