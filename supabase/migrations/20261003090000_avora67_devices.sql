-- AVORA-67 (ADR-042): Ưu tiên 1 – 2 devices · Báo mất thiết bị · Khoá thiết bị · PIN never reissued.
-- Device control is enforced on the server: private.session_allowed() is AND-ed into every RLS table
-- (restrictive policy), Storage and Realtime, and asserted at the top of every SECURITY DEFINER RPC.

-- ------------------------------------------------------------------ 1. Data
create table if not exists public.account_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_public_key text not null,
  label text not null default 'Thiết bị' check (char_length(label) between 1 and 60),
  kind text not null default 'unknown' check (kind in ('phone', 'tablet', 'computer', 'unknown')),
  rank smallint not null default 3 check (rank in (1, 2, 3)),
  guest boolean not null default false,
  session_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  lost_reported_at timestamptz,
  lost_reported_by_device uuid,
  lost_deadline timestamptz,
  lost_status text check (lost_status in ('pending', 'confirmed', 'rejected', 'found')),
  unique (user_id, device_id),
  constraint account_devices_guest_rank check (not guest or rank = 3)
);
create unique index if not exists account_devices_rank_uniq on public.account_devices (user_id, rank) where rank in (1, 2) and revoked_at is null;
create index if not exists account_devices_session_idx on public.account_devices (session_id) where session_id is not null;
alter table public.account_devices enable row level security;
revoke all on public.account_devices from public, anon, authenticated;
-- The public key never goes back to a client: everything else the owner may read, nobody writes directly.
grant select (id, user_id, device_id, label, kind, rank, guest, approved_at, created_at, last_seen_at, revoked_at, lost_status, lost_deadline) on public.account_devices to authenticated;
drop policy if exists account_devices_own_select on public.account_devices;
create policy account_devices_own_select on public.account_devices for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.account_device_lock (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locked_by_device uuid not null references public.account_devices(id) on delete cascade,
  locked_rank smallint not null check (locked_rank in (1, 2)),
  locked_at timestamptz not null default now(),
  unlock_requested_at timestamptz
);
create index if not exists account_device_lock_by_idx on public.account_device_lock (locked_by_device);
alter table public.account_device_lock enable row level security;
revoke all on public.account_device_lock from public, anon, authenticated;
grant select on public.account_device_lock to authenticated;
drop policy if exists account_device_lock_own_select on public.account_device_lock;
create policy account_device_lock_own_select on public.account_device_lock for select to authenticated using (user_id = (select auth.uid()));

create table if not exists private.device_challenges (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  nonce bytea not null,
  expires_at timestamptz not null default now() + interval '2 minutes'
);
create index if not exists device_challenges_user_idx on private.device_challenges (user_id);

create table if not exists private.device_action_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('rank_claim_code', 'lost_confirm', 'not_me_rank', 'lock_escape')),
  device_id uuid,
  token_hash text not null,
  meta jsonb not null default '{}'::jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists device_action_tokens_hash_idx on private.device_action_tokens (token_hash);
create index if not exists device_action_tokens_user_idx on private.device_action_tokens (user_id, kind);

create table if not exists private.blocked_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  reason text not null,
  blocked_at timestamptz not null default now()
);

create table if not exists private.device_alarm_log (
  user_id uuid not null,
  kind text not null,
  sent_at timestamptz not null default now()
);
create index if not exists device_alarm_log_idx on private.device_alarm_log (user_id, kind, sent_at);

create table if not exists private.retired_pins (
  pin text primary key,
  retired_at timestamptz not null default now()
);

alter table public.profiles add column if not exists vault_other_devices_allowed boolean not null default false;

revoke all on private.device_challenges, private.device_action_tokens, private.blocked_sessions, private.device_alarm_log, private.retired_pins from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. Helpers
create or replace function private.current_session_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid
$$;
revoke execute on function private.current_session_id() from public;

create or replace function private.session_allowed() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_sid uuid;
  v_dev public.account_devices%rowtype;
  v_lock public.account_device_lock%rowtype;
begin
  if v_uid is null then
    -- No user: only the system itself (cron, service_role, migrations) — never anon (S12).
    return v_role = 'service_role' or (v_role = '' and session_user not in ('authenticator', 'anon', 'authenticated'));
  end if;
  v_sid := private.current_session_id();
  if v_sid is not null and exists (select 1 from private.blocked_sessions where session_id = v_sid) then
    return false;
  end if;
  if v_sid is not null then
    select * into v_dev from public.account_devices where user_id = v_uid and session_id = v_sid limit 1;
  end if;
  if v_dev.id is not null and (v_dev.revoked_at is not null or v_dev.lost_status in ('pending', 'confirmed')) then
    return false;
  end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_lock.user_id is null then
    return true; -- Not locked: an unbound session still works (nobody breaks on rollout day).
  end if;
  if v_dev.id is null then return false; end if;
  if v_lock.locked_rank = 1 then return v_dev.rank = 1; end if;
  return v_dev.rank in (1, 2);
end $$;
revoke execute on function private.session_allowed() from public;
grant execute on function private.session_allowed() to anon, authenticated, service_role;

create or replace function private.assert_session_allowed() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.session_allowed() then raise exception 'avora_session_not_allowed'; end if;
end $$;
revoke execute on function private.assert_session_allowed() from public;
grant execute on function private.assert_session_allowed() to anon, authenticated, service_role;

create or replace function private.current_device() returns public.account_devices
language sql stable security definer set search_path = '' as $$
  select d.* from public.account_devices d
  where d.user_id = auth.uid() and d.session_id = private.current_session_id() and private.current_session_id() is not null
  limit 1
$$;
revoke execute on function private.current_device() from public;

/** Ends sessions now: refresh fails at once (auth.sessions), access tokens still alive are refused by session_allowed. */
create or replace function private.block_sessions(p_user uuid, p_sessions uuid[], p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.blocked_sessions (session_id, user_id, reason)
  select s, p_user, p_reason from unnest(p_sessions) s where s is not null
  on conflict (session_id) do nothing;
  delete from auth.sessions where user_id = p_user and id = any (p_sessions);
end $$;
revoke execute on function private.block_sessions(uuid, uuid[], text) from public;

/** Hook for AVORA-68: a removed device loses its Két sắt share. Redefined there. */
create or replace function private.on_device_removed(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  null;
end $$;
revoke execute on function private.on_device_removed(uuid) from public;

create or replace function private.check_password(p_uid uuid, p_password text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  delete from private.password_checks where checked_at < now() - interval '1 day';
  if (select count(*) from private.password_checks where user_id = p_uid and checked_at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_password_check_rate';
  end if;
  insert into private.password_checks (user_id) values (p_uid);
  select encrypted_password into v_hash from auth.users where id = p_uid;
  return coalesce(v_hash, '') <> '' and length(coalesce(p_password, '')) between 1 and 200
    and extensions.crypt(p_password, v_hash) = v_hash;
end $$;
revoke execute on function private.check_password(uuid, text) from public;

create or replace function private.app_origin(p_origin text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_origin ~ '^https://[a-z0-9-]+\.(rork\.app|rork\.live)$' or p_origin ~ '^https://(www\.)?avorachat\.com$' then p_origin
    else 'https://9gn7yyx8sbtban1pcozwb.rork.app'
  end
$$;

create or replace function private.local_when(p_user uuid, p_at timestamptz default now()) returns text
language sql stable security definer set search_path = '' as $$
  select to_char(p_at at time zone coalesce((select timezone from public.profiles where id = p_user), 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY')
$$;
revoke execute on function private.local_when(uuid, timestamptz) from public;

/** One email through vault-mail + one `security` push. The address is read here, never passed by a client. */
create or replace function private.device_notify(p_user uuid, p_body jsonb, p_push text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    perform private.vault_send_mail(p_body || jsonb_build_object('kind', 'device', 'email', v_email, 'when', private.local_when(p_user)));
  end if;
  if p_push is not null then
    insert into public.push_outbox (user_id, kind, payload, dedupe_key)
    values (p_user, 'security', jsonb_build_object('text', p_push), 'device:' || (p_body ->> 'action') || ':' || gen_random_uuid()::text);
  end if;
end $$;
revoke execute on function private.device_notify(uuid, jsonb, text) from public;

create or replace function private.new_action_token(p_user uuid, p_kind text, p_device uuid, p_expires timestamptz, p_meta jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into private.device_action_tokens (user_id, kind, device_id, token_hash, expires_at, meta)
  values (p_user, p_kind, p_device, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_expires, p_meta);
  return v_token;
end $$;
revoke execute on function private.new_action_token(uuid, text, uuid, timestamptz, jsonb) from public;

-- ------------------------------------------------------------------ 3. RPCs (device group)
create or replace function public.device_challenge(p_device_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_nonce bytea := extensions.gen_random_bytes(32);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from private.device_challenges where expires_at < now();
  if (select count(*) from private.device_challenges where user_id = v_uid) >= 20 then raise exception 'avora_device_rate'; end if;
  insert into private.device_challenges (user_id, device_id, nonce) values (v_uid, p_device_id, v_nonce);
  return encode(v_nonce, 'base64');
end $$;

/** service_role only (Edge `device-prove`): the stored public key of a device, to check a signature against. */
create or replace function public.device_key_for(p_user uuid, p_device_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select device_public_key from public.account_devices where user_id = p_user and device_id = p_device_id
$$;

/** service_role only (Edge `device-prove`, after the ECDSA signature checked out). */
create or replace function public.device_bind(
  p_user uuid, p_session uuid, p_device_id uuid, p_public_key text, p_nonce text, p_label text, p_kind text, p_guest boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.account_devices%rowtype; v_is_new boolean := false; v_had_any boolean; v_challenge bigint;
  v_label text := left(coalesce(nullif(btrim(p_label), ''), 'Thiết bị'), 60);
  v_kind text := case when p_kind in ('phone', 'tablet', 'computer') then p_kind else 'unknown' end;
begin
  delete from private.device_challenges
  where id = (select id from private.device_challenges
              where user_id = p_user and device_id = p_device_id and nonce = decode(p_nonce, 'base64') and expires_at > now() limit 1)
  returning id into v_challenge;
  if v_challenge is null then raise exception 'avora_device_challenge'; end if;
  if p_session is null then raise exception 'avora_device_unbound'; end if;
  if exists (select 1 from private.blocked_sessions where session_id = p_session) then raise exception 'avora_session_not_allowed'; end if;

  update public.account_devices set session_id = null where session_id = p_session and device_id <> p_device_id;
  select * into v_dev from public.account_devices where user_id = p_user and device_id = p_device_id;
  if v_dev.id is not null then
    if v_dev.device_public_key <> p_public_key then raise exception 'avora_device_key_mismatch'; end if;
    update public.account_devices set
      session_id = p_session, last_seen_at = now(),
      -- A removed device that signs in again starts over as Máy khác; a pending report stays.
      rank = case when revoked_at is not null or lost_status = 'confirmed' then 3 else rank end,
      lost_status = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_status end,
      lost_deadline = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_deadline end,
      revoked_at = null
    where id = v_dev.id returning * into v_dev;
  else
    select exists (select 1 from public.account_devices where user_id = p_user and not guest) into v_had_any;
    insert into public.account_devices (user_id, device_id, device_public_key, label, kind, guest, session_id)
    values (p_user, p_device_id, p_public_key, v_label, v_kind, coalesce(p_guest, false), p_session)
    returning * into v_dev;
    v_is_new := true;
    if v_had_any then
      perform private.device_notify(p_user, jsonb_build_object('action', 'new', 'label', v_label),
        'Có máy mới đăng nhập: ' || v_label || '. Không phải bạn? Mở Hồ sơ › Bảo mật.');
    end if;
  end if;
  return jsonb_build_object('device', v_dev.id, 'rank', v_dev.rank, 'is_new', v_is_new);
end $$;

create or replace function public.device_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_sid uuid := private.current_session_id();
  v_dev public.account_devices%rowtype; v_lock public.account_device_lock%rowtype;
  v_reason text; v_by text; v_lock_dev public.account_devices%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_sid is not null then
    select * into v_dev from public.account_devices where user_id = v_uid and session_id = v_sid limit 1;
  end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_dev.lost_status = 'pending' then
    v_reason := 'lost';
    select label into v_by from public.account_devices where id = v_dev.lost_reported_by_device;
  elsif v_dev.revoked_at is not null or v_dev.lost_status = 'confirmed'
        or (v_sid is not null and exists (select 1 from private.blocked_sessions where session_id = v_sid)) then
    v_reason := 'revoked';
  elsif v_lock.user_id is not null and (v_dev.id is null or (v_lock.locked_rank = 1 and v_dev.rank <> 1) or (v_lock.locked_rank = 2 and v_dev.rank = 3)) then
    v_reason := 'locked';
    -- `lock_attempt`: the locking device hears about it, at most once every 10 minutes.
    if not exists (select 1 from private.device_alarm_log where user_id = v_uid and kind = 'lock_attempt' and sent_at > now() - interval '10 minutes') then
      insert into private.device_alarm_log (user_id, kind) values (v_uid, 'lock_attempt');
      perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_attempt', 'label', coalesce(v_dev.label, 'Một máy chưa xác nhận')),
        'Có người vừa thử vào tài khoản đang khoá thiết bị (' || coalesce(v_dev.label, 'máy chưa xác nhận') || ').');
    end if;
  end if;
  if v_reason is null and v_dev.id is not null then
    update public.account_devices set last_seen_at = now() where id = v_dev.id and last_seen_at < now() - interval '5 minutes';
  end if;
  if v_lock.user_id is not null then select * into v_lock_dev from public.account_devices where id = v_lock.locked_by_device; end if;
  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'device', v_dev.id,
    'my_rank', v_dev.rank,
    'guest', coalesce(v_dev.guest, false),
    'lost_by', v_by,
    'lost_at', v_dev.lost_reported_at,
    'lock', case when v_lock.user_id is null then null else jsonb_build_object(
      'rank', v_lock.locked_rank, 'at', v_lock.locked_at, 'mine', v_lock.locked_by_device = v_dev.id,
      'by_label', v_lock_dev.label, 'escape_at', v_lock.unlock_requested_at) end,
    'rank_taken', jsonb_build_object(
      '1', exists (select 1 from public.account_devices where user_id = v_uid and rank = 1 and revoked_at is null),
      '2', exists (select 1 from public.account_devices where user_id = v_uid and rank = 2 and revoked_at is null)),
    'vault_other_allowed', coalesce((select vault_other_devices_allowed from public.profiles where id = v_uid), false)
  );
end $$;

create or replace function public.list_my_devices() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind, 'rank', d.rank, 'guest', d.guest,
      'last_seen_at', d.last_seen_at, 'created_at', d.created_at, 'is_me', d.id = v_me.id,
      'lost_status', d.lost_status, 'lost_deadline', d.lost_deadline,
      'can_revoke', d.id <> coalesce(v_me.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (v_me.rank = 1 or (v_me.rank = 2 and d.rank = 3)),
      'can_report_lost', d.id <> coalesce(v_me.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and v_me.rank in (1, 2) and d.rank in (1, 2) and d.rank <> v_me.rank and d.lost_status is distinct from 'pending'
    ) order by d.rank, d.last_seen_at desc)
    from public.account_devices d
    where d.user_id = v_uid and d.revoked_at is null and d.lost_status is distinct from 'confirmed'
  ), '[]'::jsonb);
end $$;

create or replace function public.request_rank_claim_code(p_rank smallint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_code text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null then raise exception 'avora_device_unbound'; end if;
  if p_rank not in (1, 2) then raise exception 'avora_device_rank_invalid'; end if;
  if (select count(*) from private.device_action_tokens where user_id = v_uid and kind = 'rank_claim_code' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_device_rate';
  end if;
  v_code := lpad((abs(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.device_action_tokens (user_id, kind, device_id, token_hash, expires_at, meta)
  values (v_uid, 'rank_claim_code', v_me.device_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes', jsonb_build_object('rank', p_rank));
  perform private.device_notify(v_uid, jsonb_build_object('action', 'rank_code', 'code', v_code, 'rank', p_rank, 'label', v_me.label), null);
end $$;

create or replace function public.set_device_rank(p_rank smallint, p_password text, p_email_code text default null, p_origin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
  v_holder public.account_devices%rowtype; v_tok uuid; v_link text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null then raise exception 'avora_device_unbound'; end if;
  if v_me.guest then raise exception 'avora_device_guest'; end if;
  if p_rank not in (1, 2) then raise exception 'avora_device_rank_invalid'; end if;
  if v_me.rank = p_rank then return jsonb_build_object('rank', p_rank); end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_holder from public.account_devices where user_id = v_uid and rank = p_rank and revoked_at is null and id <> v_me.id;
  if v_holder.id is not null then
    update private.device_action_tokens set used_at = now()
    where id = (select id from private.device_action_tokens
                where user_id = v_uid and kind = 'rank_claim_code' and device_id = v_me.device_id and used_at is null and expires_at > now()
                  and (meta ->> 'rank')::int = p_rank and token_hash = encode(extensions.digest(coalesce(p_email_code, ''), 'sha256'), 'hex')
                limit 1)
    returning id into v_tok;
    if v_tok is null then raise exception 'avora_device_code'; end if;
    update public.account_devices set rank = 3 where id = v_holder.id;
    perform private.block_sessions(v_uid, array[v_holder.session_id], 'rank_taken');
    v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' ||
      private.new_action_token(v_uid, 'not_me_rank', v_holder.device_id, now() + interval '24 hours', jsonb_build_object('rank', p_rank, 'old', v_holder.id, 'claimer', v_me.id));
    perform private.device_notify(v_uid, jsonb_build_object('action', 'rank_taken', 'label', v_me.label, 'old_label', v_holder.label, 'rank', p_rank, 'link', v_link),
      v_me.label || ' vừa nhận Ưu tiên ' || p_rank || '. ' || v_holder.label || ' đã thành Máy khác.');
  end if;
  update public.account_devices set rank = p_rank, approved_at = now() where id = v_me.id;
  return jsonb_build_object('rank', p_rank, 'took_from', v_holder.label);
end $$;

create or replace function public.rename_device(p_device uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_label text := btrim(coalesce(p_label, ''));
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_label) not between 1 and 60 then raise exception 'avora_device_label'; end if;
  update public.account_devices set label = v_label where id = p_device and user_id = auth.uid();
  if not found then raise exception 'avora_device_not_yours'; end if;
end $$;

create or replace function public.revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_target public.account_devices%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_target from public.account_devices where id = p_device and user_id = v_uid and revoked_at is null;
  if v_target.id is null then raise exception 'avora_device_not_yours'; end if;
  if v_me.id is null or v_target.id = v_me.id or not (v_me.rank = 1 or (v_me.rank = 2 and v_target.rank = 3)) then
    raise exception 'avora_device_revoke_rank';
  end if;
  update public.account_devices set revoked_at = now(), rank = 3 where id = v_target.id;
  perform private.block_sessions(v_uid, array[v_target.session_id], 'revoked');
  perform private.on_device_removed(v_target.id);
end $$;

create or replace function private.resolve_lost(p_device uuid, p_choice text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_dev public.account_devices%rowtype; v_reporter public.account_devices%rowtype;
begin
  select * into v_dev from public.account_devices where id = p_device;
  if v_dev.id is null or v_dev.lost_status is distinct from 'pending' then raise exception 'avora_device_lost_settled'; end if;
  select * into v_reporter from public.account_devices where id = v_dev.lost_reported_by_device;
  if p_choice = 'confirm' then
    update public.account_devices set lost_status = 'confirmed', revoked_at = now(), rank = 3 where id = v_dev.id;
    perform private.on_device_removed(v_dev.id);
  elsif p_choice = 'reject' then
    -- "Sai — tôi không báo mất": the reporting device may be the one in a stranger's hands.
    update public.account_devices set lost_status = 'rejected', lost_deadline = null where id = v_dev.id;
    if v_reporter.id is not null then perform private.block_sessions(v_dev.user_id, array[v_reporter.session_id], 'lost_rejected'); end if;
  elsif p_choice = 'found' then
    update public.account_devices set lost_status = 'found', lost_deadline = null where id = v_dev.id;
  else
    raise exception 'avora_device_choice';
  end if;
  update private.device_action_tokens set used_at = now() where kind = 'lost_confirm' and device_id = v_dev.device_id and user_id = v_dev.user_id and used_at is null;
  perform private.device_notify(v_dev.user_id, jsonb_build_object('action', 'lost_result', 'label', v_dev.label, 'result', p_choice, 'reporter', v_reporter.label), null);
end $$;
revoke execute on function private.resolve_lost(uuid, text) from public;

create or replace function public.report_device_lost(p_device uuid, p_days int, p_password text, p_origin text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_target public.account_devices%rowtype;
  v_deadline timestamptz; v_link text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_days not in (3, 7) then raise exception 'avora_device_lost_days'; end if;
  select * into v_target from public.account_devices where id = p_device and user_id = v_uid and revoked_at is null;
  if v_target.id is null then raise exception 'avora_device_not_yours'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) or v_target.rank not in (1, 2) or v_target.rank = v_me.rank then
    raise exception 'avora_device_revoke_rank';
  end if;
  if v_target.lost_status = 'pending' then raise exception 'avora_device_lost_settled'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  v_deadline := now() + make_interval(days => p_days);
  update public.account_devices set lost_status = 'pending', lost_reported_at = now(), lost_reported_by_device = v_me.id, lost_deadline = v_deadline
  where id = v_target.id;
  perform private.block_sessions(v_uid, array[v_target.session_id], 'lost');
  v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' || private.new_action_token(v_uid, 'lost_confirm', v_target.device_id, v_deadline);
  perform private.device_notify(v_uid, jsonb_build_object('action', 'lost_report', 'label', v_target.label, 'reporter', v_me.label, 'days', p_days, 'link', v_link),
    v_target.label || ' đã được báo mất từ ' || v_me.label || '. Kiểm tra email để xác nhận.');
  return v_deadline;
end $$;

create or replace function public.lost_device_dispute(p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.lost_status is distinct from 'pending' then raise exception 'avora_device_lost_settled'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  perform private.resolve_lost(v_me.id, 'reject');
end $$;

create or replace function public.set_device_lock(p_on boolean, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_lock public.account_device_lock%rowtype;
  v_keep uuid[];
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if p_on then
    if v_lock.user_id is not null and v_lock.locked_rank = 1 and v_me.rank = 2 then raise exception 'avora_device_lock_owner'; end if;
    insert into public.account_device_lock (user_id, locked_by_device, locked_rank)
    values (v_uid, v_me.id, v_me.rank)
    on conflict (user_id) do update set locked_by_device = excluded.locked_by_device, locked_rank = excluded.locked_rank, locked_at = now(), unlock_requested_at = null;
    select array_agg(session_id) into v_keep from public.account_devices
    where user_id = v_uid and revoked_at is null and lost_status is distinct from 'pending' and session_id is not null
      and (rank = 1 or (v_me.rank = 2 and rank = 2));
    perform private.block_sessions(v_uid, array(select id from auth.sessions where user_id = v_uid and not (id = any (coalesce(v_keep, '{}')))), 'locked');
    perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_on', 'label', v_me.label, 'rank', v_me.rank),
      'Đã bật Khoá thiết bị từ ' || v_me.label || '.');
  else
    if v_lock.user_id is null then return; end if;
    if v_me.rank = 2 and v_lock.locked_rank = 1 then raise exception 'avora_device_lock_owner'; end if;
    delete from public.account_device_lock where user_id = v_uid;
  end if;
end $$;

create or replace function public.request_lock_escape(p_password text, p_origin text default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_lock public.account_device_lock%rowtype; v_link text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_lock.user_id is null then raise exception 'avora_device_not_locked'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  if v_lock.unlock_requested_at is null then
    update public.account_device_lock set unlock_requested_at = now() where user_id = v_uid returning * into v_lock;
    v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' || private.new_action_token(v_uid, 'lock_escape', null, now() + interval '72 hours');
    perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_escape', 'link', v_link),
      'Có yêu cầu tắt Khoá thiết bị sau 72 giờ. Không phải bạn? Bấm Huỷ trên máy chính.');
  end if;
  return v_lock.unlock_requested_at + interval '72 hours';
end $$;

create or replace function public.cancel_lock_escape() returns void
language plpgsql security definer set search_path = '' as $$
declare v_me public.account_devices%rowtype := private.current_device();
begin
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  update public.account_device_lock set unlock_requested_at = null where user_id = auth.uid();
end $$;

create or replace function public.set_vault_other_devices_allowed(p_on boolean, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  update public.profiles set vault_other_devices_allowed = coalesce(p_on, false) where id = v_uid;
end $$;

/** A guest device (ADR-035) forgets itself on sign-out. */
create or replace function public.forget_this_device(p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.account_devices where user_id = auth.uid() and device_id = p_device_id and guest;
end $$;

/** service_role only (Edge `device-action`). Opening the link changes nothing; this only describes it. */
create or replace function public.device_action_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t private.device_action_tokens%rowtype; v_label text;
begin
  select * into v_t from private.device_action_tokens where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_t.id is null or v_t.kind = 'rank_claim_code' then return jsonb_build_object('status', 'invalid'); end if;
  if v_t.used_at is not null then return jsonb_build_object('status', 'used', 'kind', v_t.kind); end if;
  if v_t.expires_at < now() then return jsonb_build_object('status', 'expired', 'kind', v_t.kind); end if;
  select label into v_label from public.account_devices where user_id = v_t.user_id and device_id = v_t.device_id;
  return jsonb_build_object('status', 'open', 'kind', v_t.kind, 'label', v_label,
    'when', private.local_when(v_t.user_id, v_t.created_at), 'expires_at', v_t.expires_at,
    'claimer', (select label from public.account_devices where id = (v_t.meta ->> 'claimer')::uuid));
end $$;

/** service_role only (Edge `device-action`): the button press. */
create or replace function public.device_action(p_token text, p_choice text, p_password text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t private.device_action_tokens%rowtype; v_dev public.account_devices%rowtype; v_hash text;
begin
  select * into v_t from private.device_action_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and kind <> 'rank_claim_code' for update;
  if v_t.id is null then raise exception 'avora_device_token'; end if;
  if v_t.used_at is not null then raise exception 'avora_device_token_used'; end if;
  if v_t.expires_at < now() then raise exception 'avora_device_token_expired'; end if;
  if v_t.kind = 'lost_confirm' then
    select * into v_dev from public.account_devices where user_id = v_t.user_id and device_id = v_t.device_id;
    perform private.resolve_lost(v_dev.id, p_choice);
  elsif v_t.kind = 'not_me_rank' then
    if p_choice <> 'not_me_rank' then raise exception 'avora_device_choice'; end if;
    if v_t.attempts >= 5 then raise exception 'avora_password_check_rate'; end if;
    update private.device_action_tokens set attempts = attempts + 1 where id = v_t.id;
    select encrypted_password into v_hash from auth.users where id = v_t.user_id;
    if coalesce(v_hash, '') = '' or extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
      return jsonb_build_object('ok', false, 'reason', 'password');
    end if;
    select * into v_dev from public.account_devices where id = (v_t.meta ->> 'claimer')::uuid;
    if v_dev.id is not null then
      update public.account_devices set rank = 3, revoked_at = now() where id = v_dev.id;
      perform private.block_sessions(v_t.user_id, array[v_dev.session_id], 'not_me_rank');
      perform private.on_device_removed(v_dev.id);
    end if;
    update public.account_devices set rank = (v_t.meta ->> 'rank')::smallint
    where id = (v_t.meta ->> 'old')::uuid and revoked_at is null
      and not exists (select 1 from public.account_devices o where o.user_id = v_t.user_id and o.rank = (v_t.meta ->> 'rank')::smallint and o.revoked_at is null);
  elsif v_t.kind = 'lock_escape' then
    if p_choice <> 'cancel_escape' then raise exception 'avora_device_choice'; end if;
    update public.account_device_lock set unlock_requested_at = null where user_id = v_t.user_id;
  end if;
  update private.device_action_tokens set used_at = now() where id = v_t.id;
  return jsonb_build_object('ok', true);
end $$;

-- Grants: the device group to signed-in users; the Edge-only calls to service_role only.
do $$ declare f text; begin
  foreach f in array array[
    'public.device_challenge(uuid)', 'public.device_status()', 'public.list_my_devices()', 'public.request_rank_claim_code(smallint)',
    'public.set_device_rank(smallint, text, text, text)', 'public.rename_device(uuid, text)', 'public.revoke_device(uuid)',
    'public.report_device_lost(uuid, int, text, text)', 'public.lost_device_dispute(text)', 'public.set_device_lock(boolean, text)',
    'public.request_lock_escape(text, text)', 'public.cancel_lock_escape()', 'public.set_vault_other_devices_allowed(boolean, text)',
    'public.forget_this_device(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.device_key_for(uuid, uuid)', 'public.device_bind(uuid, uuid, uuid, text, text, text, text, boolean)',
    'public.device_action_info(text)', 'public.device_action(text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------------ 4. Két sắt by rank (3.5)
drop function if exists public.vault_unlock(text);
create or replace function public.vault_unlock(p_code text, p_device_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz; v_me account_devices%rowtype := private.current_device();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  -- Ưu tiên 1 – 2 only, unless the owner allowed other devices. An account with no ranked device yet is not
  -- locked out (the app asks to set this device first).
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
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.vault_unlock(text, uuid) from public, anon;
grant execute on function public.vault_unlock(text, uuid) to authenticated;

-- ------------------------------------------------------------------ 5. PIN never reissued (I1)
create or replace function private.retire_user_pin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.retired_pins (pin) values (OLD.pin) on conflict (pin) do nothing;
  return OLD;
end $$;
revoke execute on function private.retire_user_pin() from public;
drop trigger if exists user_pins_retire on public.user_pins;
create trigger user_pins_retire before delete on public.user_pins for each row execute function private.retire_user_pin();

create or replace function public.check_user_pin(p_pin text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_pin text := upper(btrim(coalesce(p_pin, ''))); v_problem text;
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  v_problem := private.user_pin_problem(v_pin);
  if v_problem is not null then return v_problem; end if;
  -- A retired PIN answers exactly like a taken one: nothing tells that an account was deleted.
  if exists (select 1 from public.user_pins where pin = v_pin) or exists (select 1 from private.retired_pins where pin = v_pin) then return 'taken'; end if;
  return 'ok';
end $$;

create or replace function public.claim_user_pin(p_pin text, p_source text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_pin text := upper(btrim(coalesce(p_pin, ''))); v_problem text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_source not in ('chosen', 'generated') then raise exception 'avora_pin_format'; end if;
  if exists (select 1 from public.user_pins where user_id = v_uid) then raise exception 'avora_pin_permanent'; end if;
  v_problem := private.user_pin_problem(v_pin);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if exists (select 1 from private.retired_pins where pin = v_pin) then raise exception 'avora_pin_taken'; end if;
  begin
    insert into public.user_pins (user_id, pin, source) values (v_uid, v_pin, p_source);
  exception when unique_violation then
    if exists (select 1 from public.user_pins where user_id = v_uid) then raise exception 'avora_pin_permanent'; end if;
    raise exception 'avora_pin_taken';
  end;
  return v_pin;
end $$;

-- ------------------------------------------------------------------ 6. Sweep (pg_cron, every 15 minutes)
create or replace function private.device_sweep() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Nobody pressed a button before the deadline: treated as `Đúng` (VMT 02/10).
  for r in select id from public.account_devices where lost_status = 'pending' and lost_deadline < now() loop
    perform private.resolve_lost(r.id, 'confirm');
  end loop;
  delete from public.account_device_lock where unlock_requested_at < now() - interval '72 hours';
  -- S12: a guest device never holds a rank and is forgotten after 24 hours unseen.
  delete from public.account_devices where guest and last_seen_at < now() - interval '24 hours';
  delete from private.device_challenges where expires_at < now();
  delete from private.device_action_tokens where expires_at < now() - interval '1 day';
  delete from private.blocked_sessions where blocked_at < now() - interval '3 days';
  delete from private.device_alarm_log where sent_at < now() - interval '1 day';
end $$;
revoke execute on function private.device_sweep() from public;
select cron.unschedule(jobid) from cron.job where jobname = 'avora_device_sweep';
select cron.schedule('avora_device_sweep', '*/15 * * * *', 'select private.device_sweep()');

-- ------------------------------------------------------------------ 7. Wiring session_allowed everywhere (S1 a–c)
-- (a) every RLS table in public gets one RESTRICTIVE policy; existing policies stay as they are.
do $$ declare r record; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity loop
    execute format('drop policy if exists avora_session_allowed on public.%I', r.relname);
    execute format('create policy avora_session_allowed on public.%I as restrictive for all to public using ((select private.session_allowed())) with check ((select private.session_allowed()))', r.relname);
  end loop;
end $$;

-- (c) Storage: all five buckets (and vault-files later) in one policy.
drop policy if exists avora_session_allowed on storage.objects;
create policy avora_session_allowed on storage.objects as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));

-- (c) Realtime private channels: thread presence (participants only) and the milestone burst.
create or replace function private.realtime_topic_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic = 'avora-milestone' then return auth.uid() is not null; end if;
  if p_topic ~ '^thread-[0-9a-f-]{36}$' then
    return private.is_conversation_participant(substr(p_topic, 8)::uuid, auth.uid());
  end if;
  return false;
end $$;
revoke execute on function private.realtime_topic_ok(text) from public;
grant execute on function private.realtime_topic_ok(text) to authenticated;
drop policy if exists avora_rt_read on realtime.messages;
create policy avora_rt_read on realtime.messages for select to authenticated
  using ((select private.session_allowed()) and private.realtime_topic_ok((select realtime.topic())));
drop policy if exists avora_rt_write on realtime.messages;
create policy avora_rt_write on realtime.messages for insert to authenticated
  with check ((select private.session_allowed()) and private.realtime_topic_ok((select realtime.topic())));

-- (b) every SECURITY DEFINER RPC in public asserts the session first — except the device / sign-in group,
-- which a blocked session still needs to show its block screen and get out.
create or replace function private.session_guard_exempt() returns text[]
language sql immutable set search_path = '' as $$
  select array['device_challenge', 'device_status', 'lost_device_dispute', 'request_lock_escape', 'forget_this_device',
               'device_key_for', 'device_bind', 'device_action_info', 'device_action']
$$;

do $$ declare r record; v_def text; v_new text; begin
  for r in
    select p.oid, p.proname, p.prosrc, l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and l.lanname in ('plpgsql', 'sql') and p.prosrc not like '%assert_session_allowed%'
      and not (p.proname = any (private.session_guard_exempt()))
  loop
    if r.lanname = 'plpgsql' then
      v_new := regexp_replace(r.prosrc, '\m(begin)\M', E'\\1\n  perform private.assert_session_allowed();', 'i');
    else
      v_new := E'select private.assert_session_allowed();\n' || r.prosrc;
    end if;
    v_def := pg_get_functiondef(r.oid);
    execute replace(v_def, r.prosrc, v_new);
  end loop;
end $$;

/** 67.13: what is not wired yet — tables without the restrictive policy, RPCs without the assert. */
create or replace function private.session_guard_gaps() returns table (kind text, name text)
language sql stable security definer set search_path = '' as $$
  select 'table', c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'avora_session_allowed' and p.permissive = 'RESTRICTIVE')
  union all
  select 'table', c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select 'function', p.proname::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and p.prosrc not like '%assert_session_allowed%' and not (p.proname = any (private.session_guard_exempt()))
$$;
revoke execute on function private.session_guard_gaps() from public;
