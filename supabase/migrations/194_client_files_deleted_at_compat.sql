-- Compatibility forward migration for client portal file listing.
-- The client portal filters client_files.deleted_at to hide soft-deleted rows,
-- while the current owner deletion RPC still hard-deletes metadata after Storage cleanup.
-- Adding this nullable column preserves current hard-delete behavior and removes the
-- staging schema mismatch without weakening RLS or file-deletion safeguards.

alter table public.client_files
  add column if not exists deleted_at timestamptz;

comment on column public.client_files.deleted_at is
  'Optional soft-delete timestamp for client file visibility filters. Existing owner file deletion may still hard-delete rows after Storage cleanup.';
