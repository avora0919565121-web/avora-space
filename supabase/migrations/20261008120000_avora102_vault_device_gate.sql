-- AVORA-102 · A — Két sắt: every door that opens or sets the Két sắt checks the device (ADR-042).
-- Before: only vault_unlock asked "is this a main device?"; vault_set_code / vault_confirm_reset /
-- vault_reset_code_by_passphrase opened a Két sắt session on any device. A device that is not
-- Ưu tiên 1 – 2 could set a code (and be let in), then be refused at the next unlock — what VMT met.
-- Also (A0.2): vault_prove counted right proofs as tries; now only wrong ones count.

create or replace function private.vault_device_allowed(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
    exists (select 1 from public.account_devices d where d.user_id = p_uid and d.rank in (1, 2) and d.revoked_at is null)
    and not coalesce((select p.vault_other_devices_allowed from public.profiles p where p.id = p_uid), false)
    and not exists (
      select 1 from public.account_devices me
      where me.user_id = p_uid and me.session_id = private.current_session_id()
        and private.current_session_id() is not null and me.rank in (1, 2) and me.revoked_at is null
    )
  )
$$;

create or replace function private.vault_assert_device_allowed()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_device_allowed(auth.uid()) then raise exception 'avora_vault_device_not_allowed'; end if;
end $$;

revoke all on function private.vault_device_allowed(uuid) from public, anon, authenticated;
revoke all on function private.vault_assert_device_allowed() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vault_unlock(p_code text, p_device_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz; v_me public.account_devices%rowtype := private.current_device(); v_share bytea;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
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
end $function$;

CREATE OR REPLACE FUNCTION public.vault_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_exp timestamptz; v_failed integer; v_me public.account_devices%rowtype := private.current_device();
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
    -- AVORA-102 · A1.3: whether this session is tied to a device at all (unbound ≠ a stranger).
    'device_bound', v_me.id is not null,
    'has_main_device', exists (select 1 from public.account_devices d where d.user_id = v_uid and d.rank in (1, 2) and d.revoked_at is null),
    'device_allowed', private.vault_device_allowed(v_uid));
end $function$;

CREATE OR REPLACE FUNCTION public.vault_change_code(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new) then raise exception 'avora_vault_code_format'; end if;
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_old) or extensions.crypt(p_old, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_secrets set code_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where user_id = v_uid;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  -- Other sessions that were open lose their unlock; this one stays in.
  delete from private.vault_unlocks where user_id = v_uid and session_id is distinct from private.vault_session_id();
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'change');
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_confirm_reset(p_email_code text, p_new_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if private.vault_encrypted(auth.uid()) then raise exception 'avora_vault_encrypted_use_passphrase'; end if;
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  select * into v_row from private.vault_reset_codes
    where user_id = v_uid and used_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not private.vault_code_ok(p_email_code) or extensions.crypt(p_email_code, v_row.code_hash) <> v_row.code_hash then
    update private.vault_reset_codes set attempts = attempts + 1,
      used_at = case when attempts + 1 >= 5 then now() else null end
    where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', case when v_row.attempts + 1 >= 5 then 'expired' else 'wrong' end);
  end if;
  update private.vault_reset_codes set used_at = now() where id = v_row.id;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update set code_hash = excluded.code_hash, updated_at = now();
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  delete from private.vault_unlocks where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'reset');
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_prove(p_kind text, p_proof text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.vault_proof_rate(v_uid);
  select case when p_kind = 'pass' then pass_proof_hash when p_kind = 'rec' then rec_proof_hash end into v_hash
  from private.vault_proofs where user_id = v_uid;
  if v_hash is null or extensions.crypt(coalesce(p_proof, ''), v_hash) <> v_hash then
    -- AVORA-102 · A0.2: only a wrong proof counts toward the 5-in-15-minutes wait.
    insert into private.vault_proof_attempts (user_id) values (v_uid);
    return false;
  end if;
  delete from private.vault_proof_attempts where user_id = v_uid and at > now() - interval '15 minutes';
  if private.vault_session_id() is not null then
    insert into private.vault_pass_sessions (session_id, user_id) values (private.vault_session_id(), v_uid) on conflict (session_id) do update set proved_at = now();
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_register_device_share(p_device_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_share bytea := extensions.gen_random_bytes(32);
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if v_me.id is null or v_me.device_id <> p_device_id then raise exception 'avora_device_unbound'; end if;
  insert into private.vault_device_shares (user_id, device_id, share) values (v_uid, p_device_id, v_share)
  on conflict (user_id, device_id) do update set share = excluded.share, created_at = now();
  return encode(v_share, 'base64');
end $function$;

CREATE OR REPLACE FUNCTION public.vault_request_reset()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_email text; v_code text;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then raise exception 'avora_vault_no_email'; end if;
  if (select count(*) from private.vault_reset_codes where user_id = v_uid and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_vault_reset_rate';
  end if;
  update private.vault_reset_codes set used_at = now() where user_id = v_uid and used_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.vault_reset_codes (user_id, code_hash, expires_at)
  values (v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes');
  perform private.vault_send_mail(jsonb_build_object('kind', 'reset_code', 'email', v_email, 'code', v_code));
  return jsonb_build_object('ok', true, 'expires_in_minutes', 10);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_reset_code_by_passphrase(p_new_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set code_hash = excluded.code_hash;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_reset_everything(p_password text, p_email_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
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
end $function$;

CREATE OR REPLACE FUNCTION public.vault_set_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do nothing;
  if not found then raise exception 'avora_vault_code_exists'; end if;
  perform private.vault_open_session(v_uid);
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_setup(p_ring jsonb, p_pass_proof text, p_rec_proof text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
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
end $function$;

-- vault_proof_rate: now only a check (the wrong proof itself is what vault_prove records).
create or replace function private.vault_proof_rate(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.vault_proof_attempts where at < now() - interval '1 day';
  if (select count(*) from private.vault_proof_attempts where user_id = p_uid and at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_vault_proof_rate';
  end if;
end $$;
