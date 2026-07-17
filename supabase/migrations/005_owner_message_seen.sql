alter table public.client_messages
add column if not exists owner_seen_at timestamptz;

update public.client_messages
set owner_seen_at = coalesce(owner_seen_at, now())
where sender_type = 'client'
  and owner_seen_at is null;

create or replace function public.mark_client_messages_seen(
  target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_exists boolean;
  marked_count integer;
begin
  select exists (
    select 1
    from public.owner_users
    where auth_user_id = auth.uid()
  )
  into owner_exists;

  if owner_exists is not true then
    raise exception 'Only approved NXQ owner accounts can mark messages seen.';
  end if;

  if not exists (
    select 1
    from public.clients
    where id = target_client_id
  ) then
    raise exception 'Client record was not found.';
  end if;

  update public.client_messages
  set
    owner_seen_at = now(),
    needs_owner_review = false
  where client_id = target_client_id
    and sender_type = 'client'
    and owner_seen_at is null;

  get diagnostics marked_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'message', 'Client messages marked as seen.',
    'marked_count', marked_count
  );
end;
$$;

grant execute on function public.mark_client_messages_seen(uuid) to authenticated;
