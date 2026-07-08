create or replace function public.send_owner_portal_reply(
  target_client_id uuid,
  reply_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_message text;
  owner_exists boolean;
  inserted_message_id uuid;
begin
  clean_message := nullif(trim(reply_message), '');

  if clean_message is null then
    raise exception 'Reply message is required.';
  end if;

  select exists (
    select 1
    from public.owner_users
    where auth_user_id = auth.uid()
  )
  into owner_exists;

  if owner_exists is not true then
    raise exception 'Only approved NXQ owner accounts can send owner replies.';
  end if;

  if not exists (
    select 1
    from public.clients
    where id = target_client_id
  ) then
    raise exception 'Client record was not found.';
  end if;

  insert into public.client_messages (
    client_id,
    sender_type,
    message,
    needs_owner_review,
    ai_handled
  )
  values (
    target_client_id,
    'owner',
    clean_message,
    false,
    false
  )
  returning id into inserted_message_id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    target_client_id,
    'owner',
    'owner_reply_sent',
    jsonb_build_object(
      'message_id', inserted_message_id,
      'preview', left(clean_message, 120),
      'source', 'owner_portal_rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Owner reply sent to client portal.',
    'message_id', inserted_message_id
  );
end;
$$;

create or replace function public.send_client_portal_message(
  message_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_message text;
  linked_client_id uuid;
  inserted_message_id uuid;
begin
  clean_message := nullif(trim(message_text), '');

  if clean_message is null then
    raise exception 'Message is required.';
  end if;

  select id
  into linked_client_id
  from public.clients
  where auth_user_id = auth.uid()
  limit 1;

  if linked_client_id is null then
    raise exception 'No client profile is linked to this login.';
  end if;

  insert into public.client_messages (
    client_id,
    sender_type,
    message,
    needs_owner_review,
    ai_handled
  )
  values (
    linked_client_id,
    'client',
    clean_message,
    true,
    false
  )
  returning id into inserted_message_id;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    linked_client_id,
    'client',
    'client_message_sent',
    jsonb_build_object(
      'message_id', inserted_message_id,
      'preview', left(clean_message, 120),
      'source', 'client_portal_rpc'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Message sent to support.',
    'message_id', inserted_message_id
  );
end;
$$;

grant execute on function public.send_owner_portal_reply(uuid, text) to authenticated;
grant execute on function public.send_client_portal_message(text) to authenticated;
