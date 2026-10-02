-- AVORA-68 (ADR-041): end-to-end encrypted Két sắt for Chứng chỉ · Tài liệu · Tài sản.
-- The server keeps only ciphertext and wrapped keys. The passphrase and the 24 words never leave the device;
-- the server only compares proofs derived from them (HKDF of the Argon2id / recovery output), stored as bcrypt.

create table if not exists public.vault_keyring (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mk_wrapped_pass text not null,
  salt_pass text not null,
  kdf_params jsonb not null,
  mk_wrapped_rec text not null,
  salt_rec text not null,
  rec_check text not null,
  section_keys jsonb not null,
  key_version int not null default 1,
  kit_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists private.vault_proofs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pass_proof_hash text not null,
  rec_proof_hash text not null
);
create table if not exists private.vault_device_shares (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  share bytea not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
-- Which sessions proved the passphrase (or the kit) — only they may register a device share.
create table if not exists private.vault_pass_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  proved_at timestamptz not null default now()
);
create index if not exists vault_pass_sessions_user_idx on private.vault_pass_sessions (user_id);
create table if not exists private.vault_proof_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists vault_proof_attempts_idx on private.vault_proof_attempts (user_id, at);

create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('certificates', 'documents', 'assets')),
  ciphertext text not null,
  wrapped_item_key text not null,
  key_version int not null default 1,
  algorithm_version int not null default 1,
  remind_on date,
  reminder_title text check (reminder_title is null or char_length(reminder_title) <= 120),
  reminder_task_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_owner_idx on public.vault_items (owner_user_id, section);
create index if not exists vault_items_remind_idx on public.vault_items (remind_on) where remind_on is not null and deleted_at is null;

create table if not exists public.vault_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.vault_items(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  page_no int not null default 1 check (page_no between 1 and 20),
  storage_path text not null,
  wrapped_file_key text not null,
  bytes int not null check (bytes between 1 and 20971520 + 64),
  mime_class text not null check (mime_class in ('image', 'pdf')),
  created_at timestamptz not null default now()
);
create index if not exists vault_files_item_idx on public.vault_files (item_id);
create index if not exists vault_files_owner_idx on public.vault_files (owner_user_id);

alter table public.vault_keyring enable row level security;
alter table public.vault_items enable row level security;
alter table public.vault_files enable row level security;
revoke all on public.vault_keyring, public.vault_items, public.vault_files from public, anon, authenticated;
revoke all on private.vault_proofs, private.vault_device_shares, private.vault_pass_sessions, private.vault_proof_attempts from public, anon, authenticated;
-- The keyring is read only through vault_keyring_get (salt + params are needed before unlocking).
grant select, insert, update on public.vault_items to authenticated;
grant select, insert, delete on public.vault_files to authenticated;

drop policy if exists vault_items_own on public.vault_items;
create policy vault_items_own on public.vault_items for all to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.vault_is_unlocked()))
  with check (owner_user_id = (select auth.uid()) and (select private.vault_is_unlocked()));
drop policy if exists vault_files_own on public.vault_files;
create policy vault_files_own on public.vault_files for all to authenticated
  using (owner_user_id = (select auth.uid()) and (select private.vault_is_unlocked()))
  with check (owner_user_id = (select auth.uid()) and (select private.vault_is_unlocked())
              and exists (select 1 from public.vault_items i where i.id = item_id and i.owner_user_id = (select auth.uid())));
-- 67: the same restrictive session policy as every other table.
drop policy if exists avora_session_allowed on public.vault_keyring;
create policy avora_session_allowed on public.vault_keyring as restrictive for all to public using ((select private.session_allowed())) with check ((select private.session_allowed()));
drop policy if exists avora_session_allowed on public.vault_items;
create policy avora_session_allowed on public.vault_items as restrictive for all to public using ((select private.session_allowed())) with check ((select private.session_allowed()));
drop policy if exists avora_session_allowed on public.vault_files;
create policy avora_session_allowed on public.vault_files as restrictive for all to public using ((select private.session_allowed())) with check ((select private.session_allowed()));

-- Bucket `vault-files`: private, octet-stream only, {user_id}/{item_id}/{file_id}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vault-files', 'vault-files', false, 21000000, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists vault_files_rw on storage.objects;
create policy vault_files_rw on storage.objects for all to authenticated
  using (bucket_id = 'vault-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.vault_is_unlocked()))
  with check (bucket_id = 'vault-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.vault_is_unlocked()));

-- ------------------------------------------------------------------ RPCs
create or replace function private.vault_proof_rate(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.vault_proof_attempts where at < now() - interval '1 day';
  if (select count(*) from private.vault_proof_attempts where user_id = p_uid and at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_vault_proof_rate';
  end if;
  insert into private.vault_proof_attempts (user_id) values (p_uid);
end $$;
revoke execute on function private.vault_proof_rate(uuid) from public;

/** Salt + KDF params + wraps. Wraps are useless without the passphrase / kit; salts are not secret. */
create or replace function public.vault_keyring_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.vault_keyring%rowtype;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from public.vault_keyring where user_id = auth.uid();
  if v.user_id is null then return null; end if;
  return to_jsonb(v) - 'user_id';
end $$;

create or replace function public.vault_setup(p_ring jsonb, p_pass_proof text, p_rec_proof text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if exists (select 1 from public.vault_keyring where user_id = v_uid) then raise exception 'avora_vault_ring_exists'; end if;
  if coalesce(p_ring ->> 'mk_wrapped_pass', '') = '' or coalesce(p_ring ->> 'mk_wrapped_rec', '') = ''
     or jsonb_typeof(p_ring -> 'section_keys') <> 'object' or jsonb_typeof(p_ring -> 'kdf_params') <> 'object'
     or coalesce((p_ring -> 'kdf_params' ->> 'm')::int, 0) < 32768 or length(coalesce(p_pass_proof, '')) < 40 or length(coalesce(p_rec_proof, '')) < 40 then
    raise exception 'avora_vault_ring_invalid';
  end if;
  -- The kit was asked back (3 words) before this call: a keyring never exists without a confirmed kit.
  insert into public.vault_keyring (user_id, mk_wrapped_pass, salt_pass, kdf_params, mk_wrapped_rec, salt_rec, rec_check, section_keys, key_version, kit_confirmed_at)
  values (v_uid, p_ring ->> 'mk_wrapped_pass', p_ring ->> 'salt_pass', p_ring -> 'kdf_params', p_ring ->> 'mk_wrapped_rec', p_ring ->> 'salt_rec',
          p_ring ->> 'rec_check', p_ring -> 'section_keys', coalesce((p_ring ->> 'key_version')::int, 1), now());
  insert into private.vault_proofs (user_id, pass_proof_hash, rec_proof_hash)
  values (v_uid, extensions.crypt(p_pass_proof, extensions.gen_salt('bf', 8)), extensions.crypt(p_rec_proof, extensions.gen_salt('bf', 8)));
  if private.vault_session_id() is not null then
    insert into private.vault_pass_sessions (session_id, user_id) values (private.vault_session_id(), v_uid) on conflict (session_id) do update set proved_at = now();
  end if;
end $$;

/** The device proved the passphrase or the kit in this session: the session may register a device share. */
create or replace function public.vault_prove(p_kind text, p_proof text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.vault_proof_rate(v_uid);
  select case when p_kind = 'pass' then pass_proof_hash when p_kind = 'rec' then rec_proof_hash end into v_hash
  from private.vault_proofs where user_id = v_uid;
  if v_hash is null or extensions.crypt(coalesce(p_proof, ''), v_hash) <> v_hash then return false; end if;
  if private.vault_session_id() is not null then
    insert into private.vault_pass_sessions (session_id, user_id) values (private.vault_session_id(), v_uid) on conflict (session_id) do update set proved_at = now();
  end if;
  return true;
end $$;

create or replace function public.vault_register_device_share(p_device_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_share bytea := extensions.gen_random_bytes(32);
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if v_me.id is null or v_me.device_id <> p_device_id then raise exception 'avora_device_unbound'; end if;
  insert into private.vault_device_shares (user_id, device_id, share) values (v_uid, p_device_id, v_share)
  on conflict (user_id, device_id) do update set share = excluded.share, created_at = now();
  return encode(v_share, 'base64');
end $$;

create or replace function public.vault_change_passphrase(p_wrapped text, p_salt text, p_params jsonb, p_proof text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if coalesce((p_params ->> 'm')::int, 0) < 32768 or length(coalesce(p_proof, '')) < 40 then raise exception 'avora_vault_ring_invalid'; end if;
  update public.vault_keyring set mk_wrapped_pass = p_wrapped, salt_pass = p_salt, kdf_params = p_params, updated_at = now() where user_id = v_uid;
  update private.vault_proofs set pass_proof_hash = extensions.crypt(p_proof, extensions.gen_salt('bf', 8)) where user_id = v_uid;
end $$;

create or replace function public.vault_rotate_recovery(p_wrapped text, p_salt text, p_check text, p_proof text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if length(coalesce(p_proof, '')) < 40 then raise exception 'avora_vault_ring_invalid'; end if;
  update public.vault_keyring set mk_wrapped_rec = p_wrapped, salt_rec = p_salt, rec_check = p_check, kit_confirmed_at = now(), updated_at = now() where user_id = v_uid;
  update private.vault_proofs set rec_proof_hash = extensions.crypt(p_proof, extensions.gen_salt('bf', 8)) where user_id = v_uid;
end $$;

/** Forgot the 6-digit code on an encrypted account: the passphrase (proved this session) sets a new one. */
create or replace function public.vault_reset_code_by_passphrase(p_new_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set code_hash = excluded.code_hash;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
end $$;

/** Forgot both: wipe the encrypted part (account password + email code). Nothing to recover — by design. */
create or replace function public.vault_reset_everything(p_password text, p_email_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_row from private.vault_reset_codes where user_id = v_uid and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if v_row.id is null or extensions.crypt(coalesce(p_email_code, ''), v_row.code_hash) <> v_row.code_hash then
    if v_row.id is not null then update private.vault_reset_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() end where id = v_row.id; end if;
    raise exception 'avora_device_code';
  end if;
  update private.vault_reset_codes set used_at = now() where id = v_row.id;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'vault-files' and (storage.foldername(name))[1] = v_uid::text;
  delete from public.vault_items where owner_user_id = v_uid;
  delete from public.vault_keyring where user_id = v_uid;
  delete from private.vault_proofs where user_id = v_uid;
  delete from private.vault_device_shares where user_id = v_uid;
  delete from private.vault_pass_sessions where user_id = v_uid;
end $$;

create or replace function public.vault_purge_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if not exists (select 1 from public.vault_items where id = p_id and owner_user_id = v_uid and deleted_at is not null) then
    raise exception 'avora_vault_item_missing';
  end if;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'vault-files' and name like v_uid::text || '/' || p_id::text || '/%';
  delete from public.vault_items where id = p_id;
end $$;

-- vault_unlock (51 + 67 + 68): returns the device share only on a right code, only for the caller's own bound device.
create or replace function public.vault_unlock(p_code text, p_device_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz; v_me account_devices%rowtype := private.current_device(); v_share bytea;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  if exists (select 1 from account_devices where user_id = v_uid and rank in (1, 2) and revoked_at is null)
     and not coalesce((select vault_other_devices_allowed from profiles where id = v_uid), false)
     and (v_me.id is null or v_me.rank not in (1, 2)) then
    raise exception 'avora_vault_device_not_allowed';
  end if;
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_code) or extensions.crypt(p_code, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  if p_device_id is not null and v_me.id is not null and v_me.device_id = p_device_id then
    select share into v_share from private.vault_device_shares where user_id = v_uid and device_id = p_device_id;
  end if;
  return jsonb_build_object('ok', true, 'share', case when v_share is null then null else encode(v_share, 'base64') end);
end $$;

-- 68.8: an encrypted account no longer resets its code by email (the passphrase does it).
create or replace function private.vault_encrypted(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.vault_keyring where user_id = p_uid) $$;
revoke execute on function private.vault_encrypted(uuid) from public;

do $$ declare v_src text; begin
  select prosrc into v_src from pg_proc where oid = 'public.vault_confirm_reset(text, text)'::regprocedure;
  if v_src not like '%vault_encrypted%' then
    execute replace(pg_get_functiondef('public.vault_confirm_reset(text, text)'::regprocedure), v_src,
      replace(v_src, 'perform private.assert_session_allowed();',
        E'perform private.assert_session_allowed();\n  if private.vault_encrypted(auth.uid()) then raise exception ''avora_vault_encrypted_use_passphrase''; end if;'));
  end if;
end $$;

-- vault_status: tell the app whether a keyring exists and whether this device holds a share.
create or replace function public.vault_status() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_exp timestamptz; v_failed integer; v_me account_devices%rowtype := private.current_device();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select expires_at into v_exp from private.vault_unlocks where user_id = v_uid and session_id = private.vault_session_id() and expires_at > now();
  select failed_count into v_failed from private.vault_attempts where user_id = v_uid;
  return jsonb_build_object(
    'has_code', exists (select 1 from private.vault_secrets where user_id = v_uid),
    'has_data', exists (select 1 from public.accounts where user_id = v_uid) or exists (select 1 from public.transactions where user_id = v_uid),
    'unlocked', v_exp is not null,
    'expires_at', v_exp,
    'locked_until', private.vault_wait_until(v_uid),
    'remaining', 5 - coalesce(v_failed, 0),
    'has_keyring', private.vault_encrypted(v_uid),
    'device_share', v_me.id is not null and exists (select 1 from private.vault_device_shares s where s.user_id = v_uid and s.device_id = v_me.device_id),
    'device_allowed', not (exists (select 1 from account_devices where user_id = v_uid and rank in (1, 2) and revoked_at is null)
      and not coalesce((select vault_other_devices_allowed from profiles where id = v_uid), false)
      and (v_me.id is null or v_me.rank not in (1, 2))));
end $$;

-- 67 hook: a removed / lost device loses its share at once (68.6).
create or replace function private.on_device_removed(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.vault_device_shares s using public.account_devices d
  where d.id = p_device and s.user_id = d.user_id and s.device_id = d.device_id;
end $$;
revoke execute on function private.on_device_removed(uuid) from public;

-- list_my_devices: `Mở được Két sắt` per device.
do $$ declare v_src text; begin
  select prosrc into v_src from pg_proc where oid = 'public.list_my_devices()'::regprocedure;
  if v_src not like '%can_open_vault%' then
    execute replace(pg_get_functiondef('public.list_my_devices()'::regprocedure), v_src,
      replace(v_src, '''lost_status'', d.lost_status,',
        '''lost_status'', d.lost_status, ''can_open_vault'', exists (select 1 from private.vault_device_shares s where s.user_id = d.user_id and s.device_id = d.device_id),'));
  end if;
end $$;

-- ------------------------------------------------------------------ reminders + trash (pg_cron, daily)
create or replace function private.vault_daily() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_task uuid;
begin
  for r in select * from public.vault_items where remind_on <= current_date and reminder_task_id is null and deleted_at is null loop
    insert into public.tasks (type, creator_id, title, description, status, deadline_date, deadline_tz, is_important, recurrence)
    values ('personal', r.owner_user_id, coalesce(nullif(r.reminder_title, ''), 'Giấy tờ trong Két sắt sắp tới hạn'),
            'Mở trong Két sắt › /ket-sat/' || case r.section when 'certificates' then 'chung-chi' when 'documents' then 'tai-lieu' else 'tai-san' end || '?muc=' || r.id,
            'confirmed', current_date, 'Asia/Ho_Chi_Minh', false, 'none')
    returning id into v_task;
    update public.vault_items set reminder_task_id = v_task where id = r.id;
  end loop;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o using public.vault_items i
  where o.bucket_id = 'vault-files' and i.deleted_at < now() - interval '30 days' and o.name like i.owner_user_id::text || '/' || i.id::text || '/%';
  delete from public.vault_items where deleted_at < now() - interval '30 days';
  delete from private.vault_pass_sessions where proved_at < now() - interval '1 day';
end $$;
revoke execute on function private.vault_daily() from public;
select cron.unschedule(jobid) from cron.job where jobname = 'avora_vault_daily';
select cron.schedule('avora_vault_daily', '20 0 * * *', 'select private.vault_daily()');

-- reminder_title / remind_on change → a fresh reminder task.
create or replace function private.vault_items_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.remind_on is distinct from old.remind_on then new.reminder_task_id := null; end if;
  if tg_op = 'INSERT' then new.reminder_task_id := null; end if;
  return new;
end $$;
revoke execute on function private.vault_items_touch() from public;
drop trigger if exists vault_items_touch on public.vault_items;
create trigger vault_items_touch before insert or update on public.vault_items for each row execute function private.vault_items_touch();

do $$ declare f text; begin
  foreach f in array array['public.vault_keyring_get()', 'public.vault_setup(jsonb, text, text)', 'public.vault_prove(text, text)',
    'public.vault_register_device_share(uuid)', 'public.vault_change_passphrase(text, text, jsonb, text)', 'public.vault_rotate_recovery(text, text, text, text)',
    'public.vault_reset_code_by_passphrase(text)', 'public.vault_reset_everything(text, text)', 'public.vault_purge_item(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
