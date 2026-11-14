-- Disposable-database stand-ins for platform pieces that vanilla Postgres lacks.
-- Applied ONLY by scripts/test-local-full-schema.mjs into a throwaway database.
-- These are NOT Supabase's real implementations (see docs/LOCAL_FULL_SCHEMA_TEST.md).

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- Minimal auth schema: enough for the signup trigger, auth.uid()/role()/jwt() and fixtures.
create schema if not exists auth;
create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text,
  raw_user_meta_data jsonb default '{}'::jsonb, encrypted_password text, created_at timestamptz default now(),
  updated_at timestamptz default now(), last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

-- Minimal storage schema.
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text,
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select string_to_array(name, '/') $$;

-- Supabase installs pgcrypto's digest() in the "extensions" schema.
create schema if not exists extensions;
create or replace function extensions.digest(data text, algorithm text) returns bytea language sql immutable as
  $$ select public.digest(data, algorithm) $$;
create or replace function extensions.digest(data bytea, algorithm text) returns bytea language sql immutable as
  $$ select public.digest(data, algorithm) $$;

-- pg_cron stand-in: schedule/unschedule are no-ops (no jobs ever run here).
create schema if not exists cron;
create table if not exists cron.job(jobid bigserial primary key, schedule text, command text, nodename text,
  nodeport int, database text, username text, active boolean default true, jobname text);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.schedule(schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;
create or replace function cron.unschedule(job_id bigint) returns boolean language sql as $$ select true $$;

-- supabase_vault stand-in: PLAIN-TEXT table, no encryption. Placeholder data only.
create schema if not exists vault;
create table if not exists vault.secrets(id uuid primary key default gen_random_uuid(), name text unique,
  description text, secret text, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as
  $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
  new_description text default null) returns void language sql as
  $$ update vault.secrets set secret = coalesce(new_secret, secret), updated_at = now() where id = secret_id $$;

-- pg_net stand-in: http_post never leaves the machine.
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
