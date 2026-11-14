-- NXQ-Web Launch Architecture Freeze v1 continued.
-- Adds provider-agnostic growth intelligence, reputation, change-impact, Enterprise access,
-- observability, client-value snapshots, and disposable QA lifecycle foundations.

create table if not exists public.nxq_lead_intelligence (
  lead_id uuid primary key references public.client_leads(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_key text,
  service_interest text,
  urgency text,
  intent_score smallint check(intent_score is null or intent_score between 0 and 100),
  quality_score smallint check(quality_score is null or quality_score between 0 and 100),
  spam_risk_score smallint check(spam_risk_score is null or spam_risk_score between 0 and 100),
  estimated_value_band text,
  recommended_priority text check(recommended_priority is null or recommended_priority in ('low','normal','high','urgent')),
  classification_source text not null default 'deterministic' check(classification_source in ('deterministic','provider','owner')),
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_reputation_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_key text not null,
  external_item_hash text not null,
  rating numeric(3,2) check(rating is null or (rating>=0 and rating<=5)),
  review_text text,
  reviewer_display_name text,
  review_url text,
  published_at timestamptz,
  sentiment text check(sentiment is null or sentiment in ('positive','neutral','negative','unknown')),
  response_status text not null default 'none' check(response_status in ('none','suggested','approved','published','dismissed')),
  testimonial_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,provider_key,external_item_hash)
);

create table if not exists public.nxq_change_impact_assessments (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.website_change_requests(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  seo_impact text not null default 'unknown' check(seo_impact in ('positive','neutral','negative','unknown')),
  conversion_impact text not null default 'unknown' check(conversion_impact in ('positive','neutral','negative','unknown')),
  security_risk text not null default 'unknown' check(security_risk in ('low','normal','high','unknown')),
  estimated_usage_units bigint not null default 0 check(estimated_usage_units>=0),
  estimated_provider_cost_cents integer not null default 0 check(estimated_provider_cost_cents>=0),
  safety_class text not null default 'review_required' check(safety_class in ('auto_safe','review_required','owner_required')),
  evidence jsonb not null default '{}'::jsonb,
  assessed_by text not null default 'deterministic' check(assessed_by in ('deterministic','provider','owner')),
  created_at timestamptz not null default now(),
  unique(change_request_id)
);

create table if not exists public.nxq_enterprise_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null,
  status text not null default 'active' check(status in ('invited','active','suspended','revoked')),
  permissions jsonb not null default '[]'::jsonb,
  location_scope jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,auth_user_id)
);

create table if not exists public.nxq_integration_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  integration_key text not null,
  capability text not null,
  status text not null default 'disabled' check(status in ('disabled','configured','healthy','degraded','blocked')),
  provider_adapter_key text references public.nxq_provider_adapter_registry(adapter_key) on delete set null,
  configuration_profile text,
  secret_values_stored_here boolean not null default false check(secret_values_stored_here=false),
  owner_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,integration_key)
);

create table if not exists public.nxq_client_value_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  snapshot_month date not null,
  leads_received integer not null default 0 check(leads_received>=0),
  conversions integer not null default 0 check(conversions>=0),
  conversion_rate numeric(8,5),
  seo_improvements integer not null default 0 check(seo_improvements>=0),
  issues_fixed integer not null default 0 check(issues_fixed>=0),
  experiments_completed integer not null default 0 check(experiments_completed>=0),
  recommendations_open integer not null default 0 check(recommendations_open>=0),
  included_usage_summary jsonb not null default '{}'::jsonb,
  paid_usage_credit_balance_cents integer not null default 0 check(paid_usage_credit_balance_cents>=0),
  billing_credit_summary jsonb not null default '{}'::jsonb,
  maintenance_health jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique(client_id,snapshot_month)
);

create table if not exists public.nxq_observability_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  component_key text not null,
  metric_key text not null,
  metric_value numeric not null,
  unit text not null,
  severity text not null default 'info' check(severity in ('info','warning','critical')),
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  sensitive_data_present boolean not null default false check(sensitive_data_present=false)
);
create index if not exists nxq_observability_metric_idx on public.nxq_observability_metrics(component_key,metric_key,observed_at desc);

create table if not exists public.nxq_qa_fixture_registry (
  id uuid primary key default gen_random_uuid(),
  fixture_key text not null unique,
  client_id uuid references public.clients(id) on delete cascade,
  fixture_type text not null,
  status text not null default 'created' check(status in ('created','running','passed','failed','cleanup_pending','cleaned')),
  provider_calls_allowed boolean not null default false check(provider_calls_allowed=false),
  netlify_calls_allowed boolean not null default false check(netlify_calls_allowed=false),
  production_changes_allowed boolean not null default false check(production_changes_allowed=false),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  cleaned_at timestamptz,
  diagnostics jsonb not null default '{}'::jsonb
);

alter table public.nxq_lead_intelligence enable row level security;
alter table public.nxq_reputation_items enable row level security;
alter table public.nxq_change_impact_assessments enable row level security;
alter table public.nxq_enterprise_members enable row level security;
alter table public.nxq_integration_connections enable row level security;
alter table public.nxq_client_value_snapshots enable row level security;
alter table public.nxq_observability_metrics enable row level security;
alter table public.nxq_qa_fixture_registry enable row level security;

revoke all on public.nxq_lead_intelligence,public.nxq_reputation_items,public.nxq_change_impact_assessments,public.nxq_enterprise_members,public.nxq_integration_connections,public.nxq_client_value_snapshots,public.nxq_observability_metrics,public.nxq_qa_fixture_registry from public,anon,authenticated;
grant select,insert,update,delete on public.nxq_lead_intelligence,public.nxq_reputation_items,public.nxq_change_impact_assessments,public.nxq_enterprise_members,public.nxq_integration_connections,public.nxq_client_value_snapshots,public.nxq_observability_metrics,public.nxq_qa_fixture_registry to service_role;

-- Client-facing summaries are readable only by the owning client; raw evidence stays service-role/owner controlled.
grant select on public.nxq_client_value_snapshots to authenticated;
create policy nxq_client_value_snapshot_read on public.nxq_client_value_snapshots for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()) or exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));

grant select on public.nxq_enterprise_members to authenticated;
create policy nxq_enterprise_member_self_or_owner_read on public.nxq_enterprise_members for select to authenticated
using(auth_user_id=auth.uid() or exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));

-- Owner read access for raw growth/control evidence.
grant select on public.nxq_lead_intelligence,public.nxq_reputation_items,public.nxq_change_impact_assessments,public.nxq_integration_connections,public.nxq_observability_metrics,public.nxq_qa_fixture_registry to authenticated;
create policy nxq_lead_intelligence_owner_read on public.nxq_lead_intelligence for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_reputation_owner_read on public.nxq_reputation_items for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_change_impact_owner_read on public.nxq_change_impact_assessments for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_integration_owner_read on public.nxq_integration_connections for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_observability_owner_read on public.nxq_observability_metrics for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));
create policy nxq_qa_fixture_owner_read on public.nxq_qa_fixture_registry for select to authenticated using(exists(select 1 from public.owner_users o where o.auth_user_id=auth.uid()));

comment on table public.nxq_lead_intelligence is 'Provider-agnostic lead intent, quality, urgency and spam-risk evidence with deterministic fallback support.';
comment on table public.nxq_reputation_items is 'Provider-agnostic review/reputation ingestion; testimonial publication remains explicitly approved.';
comment on table public.nxq_change_impact_assessments is 'Pre-publish SEO, conversion, security, usage and cost assessment for website change requests.';
comment on table public.nxq_integration_connections is 'Enterprise integration metadata only; secret values are forbidden from this table.';
comment on table public.nxq_client_value_snapshots is 'Outcome-first client dashboard snapshot keeping usage credit and billing/referral credit visibly separate.';
comment on table public.nxq_observability_metrics is 'Evidence-backed health, cost, latency, failure and queue metrics without sensitive payloads.';
comment on table public.nxq_qa_fixture_registry is 'Disposable QA fixture lifecycle with provider, Netlify and production actions hard-disabled by default.';
