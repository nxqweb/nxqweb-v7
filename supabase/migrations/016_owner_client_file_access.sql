-- Owner client-file access
-- Adds narrowly scoped owner read access to client file metadata and private storage objects.

alter table public.client_files enable row level security;

drop policy if exists "Owners can read client files" on public.client_files;
create policy "Owners can read client files"
on public.client_files
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read client file storage objects" on storage.objects;
create policy "Owners can read client file storage objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'client-files'
  and exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);
