-- KT-06 · A (QA01-08): Két sắt mở nhanh mà không nới khoá.
--
-- Trước: mỗi lần tải trang, app chạy lần lượt device_challenge → Edge device-prove → vault_lock + vault_status
-- (4 lượt mạng, một lượt là Edge function khởi động nguội) rồi mới tới Tài chính.
-- Bây giờ:
--   1. Máy chứng minh xong được server nhớ cho ĐÚNG phiên đó, có hạn: account_devices.proved_at.
--      Phiên đã gắn với máy này và chứng minh trong 12 giờ qua thì không cần ký lại.
--   2. public.vault_enter(p_device_id, p_lock) gộp vault_lock + vault_status vào MỘT lời gọi, trong một
--      giao dịch (hết luôn cuộc đua "đọc trạng thái tới trước lệnh khoá" của KT-04), và nói luôn phiên này
--      đã được chứng minh cho máy đang hỏi hay chưa (device_proven). Chưa thì app ký (device-prove) rồi hỏi lại.
--   3. Siết thêm: cửa Két sắt (vault_device_allowed) chỉ coi phiên là "máy chính" khi lần chứng minh còn
--      trong hạn 12 giờ. Trước đây một phiên đã gắn máy chính thì được coi là máy chính mãi, kể cả khi bên
--      cầm phiên không còn giữ khoá ký của máy. Không có gì bị nới.
-- RLS không đổi. Hàm mới: SECURITY DEFINER, search_path = '', chỉ authenticated được gọi.

-- ------------------------------------------------------------------ 1. Lần chứng minh có hạn
-- default now(): hàng có sẵn (đã chứng minh trước đây) được hạn 12 giờ kể từ lúc áp, rồi phải ký lại.
alter table public.account_devices add column if not exists proved_at timestamptz not null default now();
comment on column public.account_devices.proved_at is
  'KT-06: lần cuối máy ký nonce cho phiên session_id (Edge device-prove → device_bind). Cửa Két sắt chỉ tin trong 12 giờ.';
-- Cột này không đưa về client (grant select theo cột ở AVORA-67 không gồm nó).

create or replace function private.device_proof_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '12 hours' $$;
revoke all on function private.device_proof_ttl() from public, anon, authenticated;

-- device_bind: như cũ, thêm proved_at = now() mỗi lần chữ ký hợp lệ (chỉ Edge device-prove gọi, service_role).
CREATE OR REPLACE FUNCTION public.device_bind(p_user uuid, p_session uuid, p_device_id uuid, p_public_key text, p_nonce text, p_label text, p_kind text, p_guest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      session_id = p_session, last_seen_at = now(), proved_at = now(),
      -- A removed device that signs in again starts over as Máy khác; a pending report stays.
      rank = case when revoked_at is not null or lost_status = 'confirmed' then 3 else rank end,
      lost_status = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_status end,
      lost_deadline = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_deadline end,
      revoked_at = null
    where id = v_dev.id returning * into v_dev;
  else
    select exists (select 1 from public.account_devices where user_id = p_user and not guest) into v_had_any;
    insert into public.account_devices (user_id, device_id, device_public_key, label, kind, guest, session_id, proved_at)
    values (p_user, p_device_id, p_public_key, v_label, v_kind, coalesce(p_guest, false), p_session, now())
    returning * into v_dev;
    v_is_new := true;
    if v_had_any then
      perform private.device_notify(p_user, jsonb_build_object('action', 'new', 'label', v_label),
        'Có máy mới đăng nhập: ' || v_label || '. Không phải bạn? Mở Hồ sơ › Bảo mật.');
    end if;
  end if;
  return jsonb_build_object('device', v_dev.id, 'rank', v_dev.rank, 'is_new', v_is_new);
end $function$;
revoke all on function public.device_bind(uuid, uuid, uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.device_bind(uuid, uuid, uuid, text, text, text, text, boolean) to service_role;

-- ------------------------------------------------------------------ 2. Cửa Két sắt: máy chính phải còn trong hạn chứng minh
CREATE OR REPLACE FUNCTION private.vault_device_allowed(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_review_account(p_uid) or not (
    exists (select 1 from public.account_devices d where d.user_id = p_uid and d.rank in (1, 2) and d.revoked_at is null)
    and not coalesce((select p.vault_other_devices_allowed from public.profiles p where p.id = p_uid), false)
    and not exists (
      select 1 from public.account_devices me
      where me.user_id = p_uid and me.session_id = private.current_session_id()
        and private.current_session_id() is not null and me.rank in (1, 2) and me.revoked_at is null
        and me.proved_at > now() - private.device_proof_ttl()
    )
  )
$function$;
revoke all on function private.vault_device_allowed(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. Một lời gọi khi vào Két sắt
-- p_device_id: máy app đang giữ khoá (IndexedDB). Chỉ dùng để trả lời "phiên này đã được chứng minh cho
-- máy này chưa"; không cấp quyền gì — quyền vẫn do phiên (session_id trong JWT) và hàng account_devices quyết.
-- p_lock: lần nhìn đầu của mỗi lần mở app khoá Két sắt của phiên trước rồi mới đọc (51.4), cùng giao dịch.
create or replace function public.vault_enter(p_device_id uuid default null, p_lock boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.account_devices%rowtype := private.current_device();
  v_proven boolean;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  if p_lock then
    delete from private.vault_unlocks where user_id = v_uid and session_id = private.vault_session_id();
  end if;
  v_proven := v_me.id is not null and p_device_id is not null and v_me.device_id = p_device_id
    and v_me.revoked_at is null and v_me.proved_at > now() - private.device_proof_ttl();
  return public.vault_status() || jsonb_build_object('device_proven', v_proven);
end $$;
revoke all on function public.vault_enter(uuid, boolean) from public, anon;
grant execute on function public.vault_enter(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ 4. Chứng minh máy: chỉ xin nonce khi cần
-- Cho phần Bảo mật thiết bị (device_status) — cùng câu hỏi, không đụng Két sắt: phiên này đã được chứng minh
-- cho máy này trong hạn chưa? Chưa thì trả luôn một nonce (cùng giới hạn 20 nonce / 2 phút như device_challenge).
create or replace function public.device_session(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.account_devices%rowtype := private.current_device();
  v_nonce bytea;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is not null and p_device_id is not null and v_me.device_id = p_device_id
     and v_me.revoked_at is null and v_me.proved_at > now() - private.device_proof_ttl() then
    return jsonb_build_object('proven', true, 'nonce', null);
  end if;
  delete from private.device_challenges where expires_at < now();
  if (select count(*) from private.device_challenges where user_id = v_uid) >= 20 then raise exception 'avora_device_rate'; end if;
  v_nonce := extensions.gen_random_bytes(32);
  insert into private.device_challenges (user_id, device_id, nonce) values (v_uid, p_device_id, v_nonce);
  return jsonb_build_object('proven', false, 'nonce', encode(v_nonce, 'base64'));
end $$;
revoke all on function public.device_session(uuid) from public, anon;
grant execute on function public.device_session(uuid) to authenticated;
