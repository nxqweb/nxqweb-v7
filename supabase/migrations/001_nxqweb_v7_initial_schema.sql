create extension if not exists "pgcrypto";

do $$ begin
  create type public.client_status as enum (
    'lead',
    'intake_received',
    'needs_owner_review',
    'approved',
    'denied',
    'active',
    'overdue',
    'frozen',
    'dormant',
    'archived'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.project_stage as enum (
    'intake',
    'owner_review',
    'planning',
    'building',
    'review',
    'approved_for_launch',
    'launching',
    'live',
    'maintenance',
    'frozen',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.approval_status as enum (
    'pending',
    'accepted',
    'denied',
    'revision_requested',
    'more_info_requested',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.risk_level as enum (
    'low',
    'medium',
    'high'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.message_sender_type as enum (
    'owner',
    'client',
    'ai',
    'system'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  monthly_price numeric(10,2) not null default 0,
  description text,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references public.packages(id) on delete set null,
  business_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  business_type text,
  service_area text,
  current_website text,
  status public.client_status not null default 'lead',
  monthly_price numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_intakes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  business_name text not null,
  contact_name text,
  contact_email text not null,
  contact_phone text,
  business_type text,
  services text,
  service_area text,
  current_website text,
  desired_style text,
  goals text,
  package_interest text,
  extra_notes text,
  ai_summary text,
  ai_recommended_package text,
  ai_missing_info jsonb not null default '[]'::jsonb,
  ai_risk_level public.risk_level not null default 'low',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_name text not null,
  stage public.project_stage not null default 'intake',
  build_plan jsonb not null default '{}'::jsonb,
  current_blocker text,
  next_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_approval_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  request_type text not null,
  title text not null,
  summary text not null,
  recommended_action text,
  risk_level public.risk_level not null default 'low',
  status public.approval_status not null default 'pending',
  options jsonb not null default '["accept","deny","edit","ask_more"]'::jsonb,
  owner_response text,
  ai_reasoning_summary text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  sender_type public.message_sender_type not null,
  message text not null,
  needs_owner_review boolean not null default false,
  ai_handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.owner_ai_messages (
  id uuid primary key default gen_random_uuid(),
  sender_type public.message_sender_type not null,
  message text not null,
  related_client_id uuid references public.clients(id) on delete set null,
  related_approval_id uuid references public.owner_approval_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  bucket_name text not null default 'client-files',
  storage_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  ai_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  actor_type public.message_sender_type not null default 'system',
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  rule_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_worker_logs (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  status text not null default 'completed',
  input_summary text,
  output_summary text,
  error_message text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

insert into public.packages (name, slug, monthly_price, description, features)
values
  (
    'Starter',
    'starter',
    50,
    'Simple website package for small local businesses.',
    '["Basic website", "Client portal", "Project tracking", "Simple updates"]'::jsonb
  ),
  (
    'Growth',
    'growth',
    100,
    'Stronger package for businesses that need more pages, trust, and lead flow.',
    '["Multi-page website", "Client portal", "Review section", "Lead/contact setup", "Monthly updates"]'::jsonb
  ),
  (
    'Premium',
    'premium',
    150,
    'Higher-end package for businesses that need a more premium web presence.',
    '["Premium design", "More sections/pages", "Advanced content", "Priority updates", "Growth-ready structure"]'::jsonb
  )
on conflict (slug) do nothing;

insert into public.ai_rules (rule_key, rule_text)
values
  (
    'owner_approval_required_high_risk',
    'AI must create an owner approval request before accepting clients, denying clients, sending final quotes, marking payment paid, freezing clients, unfreezing clients, launching websites, deleting records, or publishing anything live.'
  ),
  (
    'safe_ai_actions',
    'AI may summarize clients, classify leads, detect missing information, recommend packages, draft replies, prepare build plans, create internal logs, and create owner approval requests.'
  ),
  (
    'client_message_escalation',
    'AI should escalate client messages to the owner when the message involves pricing, payment issues, launch approval, unclear requests, complaints, refunds, or anything high-risk.'
  )
on conflict (rule_key) do nothing;

alter table public.packages enable row level security;
alter table public.clients enable row level security;
alter table public.client_intakes enable row level security;
alter table public.projects enable row level security;
alter table public.owner_approval_requests enable row level security;
alter table public.client_messages enable row level security;
alter table public.owner_ai_messages enable row level security;
alter table public.client_files enable row level security;
alter table public.activity_logs enable row level security;
alter table public.ai_rules enable row level security;
alter table public.ai_worker_logs enable row level security;

drop policy if exists "Public can read active packages" on public.packages;
create policy "Public can read active packages"
on public.packages
for select
using (is_active = true);

drop policy if exists "Temporary public read clients" on public.clients;
create policy "Temporary public read clients"
on public.clients
for select
using (true);

drop policy if exists "Temporary public insert clients" on public.clients;
create policy "Temporary public insert clients"
on public.clients
for insert
with check (true);

drop policy if exists "Temporary public update clients" on public.clients;
create policy "Temporary public update clients"
on public.clients
for update
using (true)
with check (true);

drop policy if exists "Temporary public read projects" on public.projects;
create policy "Temporary public read projects"
on public.projects
for select
using (true);

drop policy if exists "Temporary public insert projects" on public.projects;
create policy "Temporary public insert projects"
on public.projects
for insert
with check (true);

drop policy if exists "Temporary public update projects" on public.projects;
create policy "Temporary public update projects"
on public.projects
for update
using (true)
with check (true);

drop policy if exists "Temporary public read approvals" on public.owner_approval_requests;
create policy "Temporary public read approvals"
on public.owner_approval_requests
for select
using (true);

drop policy if exists "Temporary public insert approvals" on public.owner_approval_requests;
create policy "Temporary public insert approvals"
on public.owner_approval_requests
for insert
with check (true);

drop policy if exists "Temporary public update approvals" on public.owner_approval_requests;
create policy "Temporary public update approvals"
on public.owner_approval_requests
for update
using (true)
with check (true);

drop policy if exists "Temporary public read messages" on public.client_messages;
create policy "Temporary public read messages"
on public.client_messages
for select
using (true);

drop policy if exists "Temporary public insert messages" on public.client_messages;
create policy "Temporary public insert messages"
on public.client_messages
for insert
with check (true);

drop policy if exists "Temporary public read owner ai messages" on public.owner_ai_messages;
create policy "Temporary public read owner ai messages"
on public.owner_ai_messages
for select
using (true);

drop policy if exists "Temporary public insert owner ai messages" on public.owner_ai_messages;
create policy "Temporary public insert owner ai messages"
on public.owner_ai_messages
for insert
with check (true);

drop policy if exists "Temporary public read activity logs" on public.activity_logs;
create policy "Temporary public read activity logs"
on public.activity_logs
for select
using (true);

drop policy if exists "Temporary public insert activity logs" on public.activity_logs;
create policy "Temporary public insert activity logs"
on public.activity_logs
for insert
with check (true);

drop policy if exists "Temporary public read ai rules" on public.ai_rules;
create policy "Temporary public read ai rules"
on public.ai_rules
for select
using (is_active = true);