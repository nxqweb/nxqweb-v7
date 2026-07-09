-- RLS Lockdown v1
-- Replaces temporary public dev policies with owner/client-scoped access.

-- CLIENTS
drop policy if exists "Temporary public read clients" on public.clients;
drop policy if exists "Temporary public insert clients" on public.clients;
drop policy if exists "Temporary public update clients" on public.clients;

drop policy if exists "Owners can manage clients" on public.clients;
create policy "Owners can manage clients"
on public.clients
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can read own client profile" on public.clients;
create policy "Clients can read own client profile"
on public.clients
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "Clients can update own client profile" on public.clients;
create policy "Clients can update own client profile"
on public.clients
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "Authenticated users can create own client profile" on public.clients;
create policy "Authenticated users can create own client profile"
on public.clients
for insert
to authenticated
with check (auth_user_id = auth.uid());


-- PROJECTS
drop policy if exists "Temporary public read projects" on public.projects;
drop policy if exists "Temporary public insert projects" on public.projects;
drop policy if exists "Temporary public update projects" on public.projects;

drop policy if exists "Owners can manage projects" on public.projects;
create policy "Owners can manage projects"
on public.projects
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Client can read own projects" on public.projects;
drop policy if exists "Clients can read own projects" on public.projects;
create policy "Clients can read own projects"
on public.projects
for select
to authenticated
using (
  exists (
    select 1
    from public.clients
    where clients.id = projects.client_id
      and clients.auth_user_id = auth.uid()
  )
);


-- OWNER APPROVAL REQUESTS
drop policy if exists "Temporary public read approvals" on public.owner_approval_requests;
drop policy if exists "Temporary public insert approvals" on public.owner_approval_requests;
drop policy if exists "Temporary public update approvals" on public.owner_approval_requests;

drop policy if exists "Owners can manage approval requests" on public.owner_approval_requests;
create policy "Owners can manage approval requests"
on public.owner_approval_requests
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can read own approval requests" on public.owner_approval_requests;
create policy "Clients can read own approval requests"
on public.owner_approval_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.clients
    where clients.id = owner_approval_requests.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can create own approval requests" on public.owner_approval_requests;
create policy "Clients can create own approval requests"
on public.owner_approval_requests
for insert
to authenticated
with check (
  exists (
    select 1
    from public.clients
    where clients.id = owner_approval_requests.client_id
      and clients.auth_user_id = auth.uid()
  )
);


-- CLIENT MESSAGES
drop policy if exists "Temporary public read messages" on public.client_messages;
drop policy if exists "Temporary public insert messages" on public.client_messages;

drop policy if exists "Owners can manage client messages" on public.client_messages;
create policy "Owners can manage client messages"
on public.client_messages
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can read own messages" on public.client_messages;
create policy "Clients can read own messages"
on public.client_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.clients
    where clients.id = client_messages.client_id
      and clients.auth_user_id = auth.uid()
  )
);


-- ACTIVITY LOGS
drop policy if exists "Temporary public read activity logs" on public.activity_logs;
drop policy if exists "Temporary public insert activity logs" on public.activity_logs;

drop policy if exists "Owners can manage activity logs" on public.activity_logs;
create policy "Owners can manage activity logs"
on public.activity_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can read own activity logs" on public.activity_logs;
create policy "Clients can read own activity logs"
on public.activity_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.clients
    where clients.id = activity_logs.client_id
      and clients.auth_user_id = auth.uid()
  )
);

drop policy if exists "Clients can create own activity logs" on public.activity_logs;
create policy "Clients can create own activity logs"
on public.activity_logs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.clients
    where clients.id = activity_logs.client_id
      and clients.auth_user_id = auth.uid()
  )
);


-- OWNER AI MESSAGES
drop policy if exists "Temporary public read owner ai messages" on public.owner_ai_messages;
drop policy if exists "Temporary public insert owner ai messages" on public.owner_ai_messages;

drop policy if exists "Owners can manage owner ai messages" on public.owner_ai_messages;
create policy "Owners can manage owner ai messages"
on public.owner_ai_messages
for all
to authenticated
using (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  )
);
