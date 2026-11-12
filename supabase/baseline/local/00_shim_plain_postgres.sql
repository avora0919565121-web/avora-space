-- Supabase platform shim for a plain Postgres 17. Column lists for auth.users / auth.sessions /
-- auth.identities / storage.buckets / storage.objects / realtime.messages / cron.job /
-- vault.decrypted_secrets copied from the production catalog (myrubjdysllgucgafqjy, 2026-11-09).

-- roles -------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin',
                           'supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- schemas -----------------------------------------------------------------
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists private;
grant usage on schema extensions, auth, storage, realtime to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- extensions (prod: all in `extensions`; pg_cron / pg_net / supabase_vault are stubbed below) --
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;

-- Supabase default search_path for postgres/API roles includes extensions
do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
alter role anon set search_path = "$user", public, extensions;
alter role authenticated set search_path = "$user", public, extensions;
alter role service_role set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;

-- auth --------------------------------------------------------------------
create type auth.aal_level as enum ('aal1','aal2','aal3');

create table auth.users (
  instance_id uuid, id uuid not null primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255), email_change varchar(255),
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text unique default null::varchar, phone_confirmed_at timestamptz, phone_change text default ''::varchar,
  phone_change_token varchar(255) default ''::varchar, phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default ''::varchar, email_change_confirm_status smallint default 0,
  banned_until timestamptz, reauthentication_token varchar(255) default ''::varchar,
  reauthentication_sent_at timestamptz, is_sso_user boolean not null default false,
  deleted_at timestamptz, is_anonymous boolean not null default false
);

create table auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key
);

create table auth.sessions (
  id uuid not null primary key, user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz, updated_at timestamptz, factor_id uuid, aal auth.aal_level,
  not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text,
  oauth_client_id uuid, refresh_token_hmac_key text, refresh_token_counter bigint, scopes text
);

-- same bodies as prod (prod auth.uid reads request.jwt.claim.sub first, then request.jwt.claims)
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- storage -----------------------------------------------------------------
create type storage.buckettype as enum ('STANDARD','ANALYTICS','VECTOR');
create table storage.buckets (
  id text not null primary key, name text not null, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint,
  allowed_mime_types text[], owner_id text, type storage.buckettype not null default 'STANDARD',
  versioning_status text not null default 'DISABLED', lifecycle_configuration jsonb,
  lifecycle_configuration_generation uuid
);
create unique index bname on storage.buckets (name);
create table storage.objects (
  id uuid not null default gen_random_uuid() primary key, bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text, owner_id text, user_metadata jsonb, archived_at timestamptz,
  is_delete_marker boolean not null default false, is_versioned boolean not null default false
);
create unique index bucketid_objname on storage.objects (bucket_id, name);

create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- realtime ----------------------------------------------------------------
create table realtime.messages (
  topic text not null, extension text not null default 'broadcast', payload jsonb, event text,
  private boolean default false, updated_at timestamp not null default now(),
  inserted_at timestamp not null default now(), id uuid not null default gen_random_uuid(),
  binary_payload bytea, skip_broadcast boolean, expires_at timestamp,
  primary key (id, inserted_at)
);
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
-- stub: records the broadcast into realtime.messages (prod also fans it out over websockets)
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into realtime.messages (payload, event, topic, private, extension)
  values (payload, event, topic, private, 'broadcast');
exception when others then
  raise warning 'realtime.send stub failed: %', sqlerrm;
end $$;
grant select, insert on realtime.messages to authenticated, service_role;
grant execute on all functions in schema realtime to anon, authenticated, service_role;

-- vault (stub: empty table behind the decrypted_secrets view) -------------
create table vault.secrets (
  id uuid not null default gen_random_uuid() primary key, name text unique, description text not null default '',
  secret text not null, key_id uuid, nonce bytea,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at
  from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description, key_id) values (new_secret, new_name, new_description, new_key_id) returning id
$$;

-- cron (stub: records jobs, never runs them) ------------------------------
create table cron.job (
  jobid bigserial primary key, schedule text not null, command text not null,
  nodename text not null default 'localhost', nodeport integer not null default 5432,
  database text not null default current_database(), username text not null default current_user,
  active boolean not null default true, jobname text unique
);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create or replace function cron.schedule(schedule text, command text) returns bigint
language sql as $$ insert into cron.job (schedule, command) values (schedule, command) returning jobid $$;
create or replace function cron.unschedule(job_id bigint) returns boolean
language plpgsql as $$ begin delete from cron.job where jobid = job_id; return found; end $$;
create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$ begin delete from cron.job where jobname = job_name; return found; end $$;

-- net (stub: logs requests, returns an id, never calls out) ---------------
create table net.http_request_queue (
  id bigserial primary key, method text, url text, headers jsonb, body jsonb, timeout_milliseconds int,
  created_at timestamptz default now()
);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql security definer set search_path = '' as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, body, timeout_milliseconds) returning id
$$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql security definer set search_path = '' as $$
  insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
  values ('GET', url, headers, timeout_milliseconds) returning id
$$;
