-- Automatically create one client workspace for each new client auth account.

create unique index if not exists clients_auth_user_id_unique_idx
on public.clients (auth_user_id)
where auth_user_id is not null;

create or replace function public.handle_new_client_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_business_name text;
  signup_contact_name text;
begin
  signup_business_name := nullif(trim(new.raw_user_meta_data ->> 'business_name'), '');
  signup_contact_name := nullif(trim(new.raw_user_meta_data ->> 'contact_name'), '');

  -- Ignore auth users that were not created through the client signup flow.
  if signup_business_name is null then
    return new;
  end if;

  insert into public.clients (
    business_name,
    contact_name,
    contact_email,
    auth_user_id
  )
  values (
    signup_business_name,
    signup_contact_name,
    new.email,
    new.id
  )
  on conflict (auth_user_id) where auth_user_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_client
on auth.users;

create trigger on_auth_user_created_create_client
after insert on auth.users
for each row
execute function public.handle_new_client_signup();
