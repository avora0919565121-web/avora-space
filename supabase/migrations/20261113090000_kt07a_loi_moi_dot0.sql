-- KT-07a · Lời mời Đợt 0 (SP-03 §0 lỗi 1–6, CEO 12/11).
--
-- 1. accept_invite không còn chép note/phone/email của liên hệ người mời sang liên hệ ngược
--    (đó là ghi chú riêng người mời viết về người được mời, và số/email của chính người được mời).
--    Liên hệ ngược chỉ có tên hiển thị của người mời + liên kết tài khoản. Sửa luôn dữ liệu đã lộ.
-- 2–3. "Đã mời" chỉ ghi khi người mời xác nhận đã gửi: prepare_contact_invite tạo bản nháp
--    (status 'draft'), confirm_invite_sent chuyển sang 'pending'; discard_invite_draft bỏ bản nháp.
-- 4. Người chưa có tài khoản mở link mời: preview_invite_public + decline_invite gọi được bằng anon.
-- 5. Có Từ chối: status 'declined', declined_at.
-- 6. Sổ chống làm phiền private.invite_ledger theo mã băm (HMAC-SHA256 + pepper trong Vault) của
--    số/email người nhận, không theo contact_id → xoá liên hệ rồi thêm lại không lách được.
--    FK contact_invite.contact_id đổi sang ON DELETE SET NULL để lịch sử mời còn khi xoá liên hệ.
--
-- Yêu cầu trước khi áp: Vault có secret tên 'avora_invite_pepper' (≥ 32 byte ngẫu nhiên, mỗi môi
-- trường một giá trị, KHÔNG để trong repo). Thiếu secret thì mời bị từ chối 'avora_invite_key_missing'
-- (đóng an toàn) và bước backfill khoá bị bỏ qua.

-- ── Bảng contact_invite ───────────────────────────────────────────────────────────────────────
alter table public.contact_invite
  add column if not exists expires_at  timestamptz,
  add column if not exists sent_at     timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists note        text,
  add column if not exists is_reinvite boolean not null default false,
  add column if not exists in_batch    boolean not null default false;

update public.contact_invite set expires_at = invited_at + interval '14 days' where expires_at is null;
update public.contact_invite set sent_at = invited_at where sent_at is null and status in ('pending', 'accepted', 'expired');
alter table public.contact_invite alter column expires_at set default now() + interval '14 days';
alter table public.contact_invite alter column expires_at set not null;

alter table public.contact_invite drop constraint if exists contact_invite_status_check;
alter table public.contact_invite add constraint contact_invite_status_check
  check (status in ('draft', 'pending', 'accepted', 'declined', 'expired', 'revoked'));
alter table public.contact_invite drop constraint if exists contact_invite_note_check;
alter table public.contact_invite add constraint contact_invite_note_check
  check (note is null or char_length(note) between 1 and 200);
alter table public.contact_invite drop constraint if exists contact_invite_reinvite_alone;
alter table public.contact_invite add constraint contact_invite_reinvite_alone
  check (not is_reinvite or (not in_batch and note is not null));

-- Lịch sử mời còn khi xoá liên hệ (sổ chống làm phiền không phụ thuộc liên hệ).
alter table public.contact_invite alter column contact_id drop not null;
alter table public.contact_invite drop constraint if exists contact_invite_contact_id_fkey;
alter table public.contact_invite add constraint contact_invite_contact_id_fkey
  foreign key (contact_id) references public.contact(id) on delete set null;
create index if not exists contact_invite_by_inviter on public.contact_invite (invited_by, status, expires_at);

-- Chỉ RPC được ghi lời mời (trước đây authenticated INSERT thẳng được, bỏ qua mọi luật).
drop policy if exists contact_invite_insert_own on public.contact_invite;
revoke insert on table public.contact_invite from authenticated;

-- ── Khoá người nhận + sổ chống làm phiền (chỉ máy chủ đọc) ─────────────────────────────────────
create table if not exists private.contact_invite_key (
  invite_id  uuid  not null references public.contact_invite(id) on delete cascade,
  inviter_id uuid  not null references auth.users(id) on delete cascade,
  key        bytea not null,
  primary key (invite_id, key)
);
create index if not exists contact_invite_key_lookup on private.contact_invite_key (inviter_id, key);

create table if not exists private.invite_ledger (
  inviter_id       uuid  not null references auth.users(id) on delete cascade,
  recipient_key    bytea not null,
  invites          integer not null default 0,
  declines         integer not null default 0,
  last_invite_at   timestamptz,
  last_decline_at  timestamptz,
  last_reinvite_at timestamptz,
  primary key (inviter_id, recipient_key)
);
alter table private.contact_invite_key enable row level security;
alter table private.invite_ledger enable row level security;
revoke all on table private.contact_invite_key from public, anon, authenticated;
revoke all on table private.invite_ledger from public, anon, authenticated;

-- ── Hàm nội bộ ────────────────────────────────────────────────────────────────────────────────
create or replace function private.invite_pepper()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'avora_invite_pepper';
  if v is null or char_length(v) < 32 then raise exception 'avora_invite_key_missing'; end if;
  return v;
end $$;

-- Mã băm mọi số/email của một liên hệ (cột chính + contact_channel), đã chuẩn hoá như so trùng.
create or replace function private.invite_recipient_keys(p_contact_id uuid)
returns bytea[] language plpgsql stable security definer set search_path = '' as $$
declare v_pepper text := private.invite_pepper(); v bytea[];
begin
  select coalesce(array_agg(distinct extensions.hmac(x.kind || ':' || x.val, v_pepper, 'sha256')), '{}') into v
  from (
    select 'phone' kind, private.normalize_channel('phone', c.phone) val from public.contact c where c.id = p_contact_id and nullif(btrim(coalesce(c.phone, '')), '') is not null
    union all
    select 'email', private.normalize_channel('email', c.email) from public.contact c where c.id = p_contact_id and nullif(btrim(coalesce(c.email, '')), '') is not null
    union all
    select ch.kind, ch.value_normalized from public.contact_channel ch where ch.contact_id = p_contact_id and ch.value_normalized <> ''
  ) x where x.val <> '';
  return v;
end $$;

create or replace function private.invite_live(p_status text, p_expires_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('draft', 'pending') and p_expires_at > now()
$$;

-- Trạng thái người nhận theo sổ: 'declined' khi lần cuối là từ chối (chưa có lần mời lại sau đó).
create or replace function private.invite_ledger_state(p_inviter uuid, p_keys bytea[])
returns table (declined boolean, last_reinvite_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(l.last_decline_at is not null and (l.last_invite_at is null or l.last_decline_at >= l.last_invite_at)), false),
         max(l.last_reinvite_at)
  from private.invite_ledger l
  where l.inviter_id = p_inviter and l.recipient_key = any (coalesce(p_keys, '{}'))
$$;

create or replace function private.invite_ledger_touch(p_inviter uuid, p_keys bytea[], p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare k bytea;
begin
  foreach k in array coalesce(p_keys, '{}') loop
    insert into private.invite_ledger as l (inviter_id, recipient_key, invites, declines, last_invite_at, last_decline_at, last_reinvite_at)
    values (p_inviter, k,
            case when p_event in ('invite', 'reinvite') then 1 else 0 end,
            case when p_event = 'decline' then 1 else 0 end,
            case when p_event in ('invite', 'reinvite') then now() end,
            case when p_event = 'decline' then now() end,
            case when p_event = 'reinvite' then now() end)
    on conflict (inviter_id, recipient_key) do update set
      invites          = l.invites + case when p_event in ('invite', 'reinvite') then 1 else 0 end,
      declines         = l.declines + case when p_event = 'decline' then 1 else 0 end,
      last_invite_at   = case when p_event in ('invite', 'reinvite') then now() else l.last_invite_at end,
      last_decline_at  = case when p_event = 'decline' then now() else l.last_decline_at end,
      last_reinvite_at = case when p_event = 'reinvite' then now() else l.last_reinvite_at end;
  end loop;
end $$;

create or replace function private.invite_keys_of(p_invite_id uuid)
returns bytea[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(k.key), '{}') from private.contact_invite_key k where k.invite_id = p_invite_id
$$;

revoke all on function private.invite_pepper() from public, anon, authenticated;
revoke all on function private.invite_recipient_keys(uuid) from public, anon, authenticated;
revoke all on function private.invite_live(text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_ledger_state(uuid, bytea[]) from public, anon, authenticated;
revoke all on function private.invite_ledger_touch(uuid, bytea[], text) from public, anon, authenticated;
revoke all on function private.invite_keys_of(uuid) from public, anon, authenticated;

-- Hạn cũ đọc theo invited_at; giữ chữ ký cho bản app cũ, nhưng không coi bản nháp là "đang chờ".
create or replace function public.contact_invite_timed_out(p_status text, p_invited_at timestamp with time zone)
returns boolean language sql stable set search_path = 'public' as $$
  select p_status in ('pending', 'draft') and now() - p_invited_at > interval '14 days';
$$;

-- ── Mời: bản nháp ─────────────────────────────────────────────────────────────────────────────
create or replace function public.prepare_contact_invite(
  p_contact_id uuid, p_method text, p_note text default null, p_reinvite boolean default false, p_batch boolean default false)
returns table (invite_id uuid, invite_token text, status text, expires_at timestamptz, reused boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_c public.contact%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_keys bytea[];
  v_live public.contact_invite%rowtype;
  v_declined boolean; v_last_re timestamptz;
  v_is_re boolean := false;
  v_id uuid; v_token text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_method not in ('sms', 'email', 'link') then raise exception 'avora_invite_bad_method'; end if;

  select * into v_c from public.contact c where c.id = p_contact_id;
  if v_c.id is null or v_c.owner_user_id <> v_uid then raise exception 'avora_contact_not_found'; end if;
  if v_c.contact_type <> 'individual' then raise exception 'avora_invite_individual_only'; end if;
  if v_c.linked_user_id is not null then raise exception 'avora_invite_already_linked'; end if;
  if p_method = 'sms' and nullif(btrim(coalesce(v_c.phone, '')), '') is null then raise exception 'avora_invite_no_phone'; end if;
  if p_method = 'email' and nullif(btrim(coalesce(v_c.email, '')), '') is null then raise exception 'avora_invite_no_email'; end if;
  if v_note is not null and (char_length(v_note) > 200 or private.text_has_link(v_note)) then raise exception 'avora_invite_note_invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':contact_invite', 0));
  v_keys := private.invite_recipient_keys(p_contact_id);

  -- Một lời mời còn sống cho mỗi người nhận (theo mã băm, hoặc theo liên hệ khi chưa có số/email).
  select i.* into v_live from public.contact_invite i
  where i.invited_by = v_uid and private.invite_live(i.status, i.expires_at)
    and (i.contact_id = p_contact_id or exists (
      select 1 from private.contact_invite_key k where k.invite_id = i.id and k.inviter_id = v_uid and k.key = any (v_keys)))
  order by i.invited_at desc limit 1;
  if v_live.id is not null then
    if v_live.status = 'draft' then
      update public.contact_invite i set method = p_method, contact_id = p_contact_id,
        note = case when v_live.is_reinvite then i.note else v_note end
      where i.id = v_live.id;
    elsif v_live.contact_id is null then
      -- Liên hệ cũ đã bị xoá, người nhận (cùng mã băm) được thêm lại: gắn lời mời vào liên hệ mới.
      update public.contact_invite i set contact_id = p_contact_id where i.id = v_live.id;
    end if;
    return query select v_live.id, v_live.invite_token, v_live.status, v_live.expires_at, true;
    return;
  end if;

  select s.declined, s.last_reinvite_at into v_declined, v_last_re from private.invite_ledger_state(v_uid, v_keys) s;
  if v_declined then
    -- Luật CEO: người đã từ chối vẫn mời lại được, nhưng chủ động, kèm lời nhắn, từng người một.
    if p_batch then raise exception 'avora_invite_declined_not_in_batch'; end if;
    if not p_reinvite then raise exception 'avora_invite_declined'; end if;
    if v_note is null or char_length(v_note) < 10 then raise exception 'avora_invite_note_required'; end if;
    if v_last_re is not null and v_last_re > now() - interval '30 days' then raise exception 'avora_invite_reinvite_too_soon'; end if;
    v_is_re := true;
  end if;

  perform private.rate_take(v_uid, 'contact_invite_draft', 200, interval '1 day');
  v_token := gen_random_uuid()::text;
  insert into public.contact_invite (contact_id, invited_by, method, invite_token, status, expires_at, note, is_reinvite, in_batch)
  values (p_contact_id, v_uid, p_method, v_token, 'draft', now() + interval '14 days', v_note, v_is_re, coalesce(p_batch, false))
  returning id into v_id;
  insert into private.contact_invite_key (invite_id, inviter_id, key) select v_id, v_uid, k from unnest(v_keys) k on conflict do nothing;

  return query select i.id, i.invite_token, i.status, i.expires_at, false from public.contact_invite i where i.id = v_id;
end $$;

-- ── Mời: người mời xác nhận đã gửi ────────────────────────────────────────────────────────────
create or replace function public.confirm_invite_sent(p_invite_id uuid)
returns table (invite_id uuid, status text, sent_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v public.contact_invite%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from public.contact_invite i where i.id = p_invite_id and i.invited_by = v_uid for update;
  if v.id is null then raise exception 'avora_invite_missing'; end if;
  if v.status = 'draft' then
    if v.expires_at <= now() then raise exception 'avora_invite_expired'; end if;
    perform private.rate_take(v_uid, 'contact_invite', 50, interval '1 day');
    perform private.rate_take(v_uid, 'contact_invite_week', 300, interval '7 days');
    update public.contact_invite i set status = 'pending', sent_at = now(), expires_at = now() + interval '14 days' where i.id = v.id;
    perform private.invite_ledger_touch(v_uid, private.invite_keys_of(v.id), case when v.is_reinvite then 'reinvite' else 'invite' end);
  end if;
  return query select i.id, i.status, i.sent_at, i.expires_at from public.contact_invite i where i.id = v.id;
end $$;

-- ── Mời: người mời nói "Chưa gửi" → bỏ bản nháp, không tính vào hạn mức ──────────────────────
create or replace function public.discard_invite_draft(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.contact_invite i where i.id = p_invite_id and i.invited_by = v_uid and i.status = 'draft';
end $$;

-- ── Bản cũ (app đã phát hành): tạo rồi coi như đã gửi, nhưng qua cùng luật ────────────────────
create or replace function public.create_contact_invite(p_contact_id uuid, p_method text)
returns text language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.assert_session_allowed();
  select * into r from public.prepare_contact_invite(p_contact_id, p_method, null, false, false);
  if r.status = 'draft' then perform public.confirm_invite_sent(r.invite_id); end if;
  return r.invite_token;
end $$;

-- ── Trang mời công khai: ai cầm link cũng xem được, không cần tài khoản ───────────────────────
create or replace function public.preview_invite_public(p_token text)
returns table (inviter_name text, status text, expires_at timestamptz, note text, is_own_invite boolean, already_linked boolean, signed_in boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v public.contact_invite%rowtype; v_linked boolean := false;
begin
  if v_uid is not null then perform private.assert_session_allowed(); end if;
  select * into v from public.contact_invite i where i.invite_token = nullif(btrim(coalesce(p_token, '')), '');
  if v.id is null or v.status = 'revoked' then return; end if;
  if v_uid is not null and private.is_blocked_between(v.invited_by, v_uid) then return; end if;
  if v.contact_id is not null then
    select c.linked_user_id is not null into v_linked from public.contact c where c.id = v.contact_id;
  end if;
  return query select
    coalesce((select nullif(btrim(p.display_name), '') from public.profiles p where p.id = v.invited_by), 'Một người dùng AVORA'),
    case when v.status in ('draft', 'pending') and (v.expires_at <= now() or v.contact_id is null) then 'expired'
         when v.status = 'draft' then 'pending'
         else v.status end,
    v.expires_at,
    v.note,
    v_uid is not null and v_uid = v.invited_by,
    coalesce(v_linked, false),
    v_uid is not null;
end $$;

-- Bản cũ của trang nhận lời: cùng luật, trạng thái lạ (declined) đọc là hết hiệu lực.
create or replace function public.preview_contact_invite(p_token text)
returns table (inviter_name text, status text, is_own_invite boolean, already_linked boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  return query select p.inviter_name, case when p.status in ('pending', 'accepted', 'expired') then p.status else 'expired' end,
                      p.is_own_invite, p.already_linked
  from public.preview_invite_public(p_token) p;
end $$;

-- ── Từ chối: không cần tài khoản ──────────────────────────────────────────────────────────────
create or replace function public.decline_invite(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.contact_invite%rowtype;
begin
  if v_uid is not null then perform private.assert_session_allowed(); end if;
  select * into v from public.contact_invite i where i.invite_token = nullif(btrim(coalesce(p_token, '')), '') for update;
  if v.id is null or v.status = 'revoked' then raise exception 'avora_invite_missing'; end if;
  if v_uid is not null and private.is_blocked_between(v.invited_by, v_uid) then raise exception 'avora_invite_missing'; end if;
  if v_uid is not null and v_uid = v.invited_by then raise exception 'avora_invite_own'; end if;
  if v.status = 'declined' then return 'declined'; end if;
  if v.status = 'accepted' then raise exception 'avora_invite_accepted'; end if;
  if not private.invite_live(v.status, v.expires_at) then raise exception 'avora_invite_expired'; end if;
  update public.contact_invite i set status = 'declined', declined_at = now(), sent_at = coalesce(i.sent_at, now()) where i.id = v.id;
  perform private.invite_ledger_touch(v.invited_by, private.invite_keys_of(v.id), 'decline');
  return 'declined';
end $$;

-- ── Nhận lời: sửa lỗi lộ ghi chú ──────────────────────────────────────────────────────────────
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_invite  contact_invite%rowtype;
  v_contact contact%rowtype;
  v_inviter_name text;
  v_reciprocal_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_invite from contact_invite where invite_token = nullif(btrim(p_token), '') for update;
  if not found or v_invite.status = 'revoked' then raise exception 'Lời mời không tồn tại hoặc đã hết hiệu lực'; end if;
  -- AVORA-37 / A: between a blocked pair the invite reads exactly as if it did not exist.
  if private.is_blocked_between(v_invite.invited_by, v_uid) then raise exception 'Lời mời không tồn tại hoặc đã hết hiệu lực'; end if;
  if v_invite.status = 'accepted' then raise exception 'Lời mời này đã được chấp nhận'; end if;
  if v_invite.status = 'declined' then raise exception 'Lời mời này đã được từ chối'; end if;
  if not private.invite_live(v_invite.status, v_invite.expires_at) then raise exception 'Lời mời đã hết hạn'; end if;
  if v_invite.invited_by = v_uid then raise exception 'Không thể tự chấp nhận lời mời của chính mình'; end if;

  select * into v_contact from contact where id = v_invite.contact_id;
  if not found then raise exception 'Liên hệ gốc không còn tồn tại'; end if;
  if v_contact.linked_user_id = v_uid then raise exception 'Hai tài khoản đã liên kết với nhau từ trước'; end if;
  if v_contact.linked_user_id is not null then raise exception 'Người này đã liên kết với một tài khoản khác'; end if;

  select nullif(btrim(display_name), '') into v_inviter_name from profiles where id = v_invite.invited_by;

  update contact_invite set status = 'accepted', accepted_at = now(), sent_at = coalesce(sent_at, now()) where id = v_invite.id;
  update contact set linked_user_id = v_uid, updated_at = now() where id = v_contact.id;

  -- KT-07a: liên hệ ngược KHÔNG mang note/phone/email từ liên hệ của người mời — đó là ghi chú
  -- riêng của người mời và số/email của chính người nhận. Chỉ tên hiển thị + liên kết tài khoản.
  select id into v_reciprocal_id from contact where owner_user_id = v_uid and linked_user_id = v_invite.invited_by limit 1;
  if v_reciprocal_id is null then
    insert into contact (owner_user_id, contact_type, name, linked_user_id)
    values (v_uid, 'individual', coalesce(v_inviter_name, 'Người dùng AVORA'), v_invite.invited_by)
    returning id into v_reciprocal_id;
  end if;

  -- AVORA-38 / ADR-029: both sides agreed through the invite, so they are now bạn.
  perform private.connect_users(v_invite.invited_by, v_uid, 'contact_invite');
  return v_reciprocal_id;
end $$;

-- ── Quyền ─────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.prepare_contact_invite(uuid, text, text, boolean, boolean) from public, anon;
revoke all on function public.confirm_invite_sent(uuid) from public, anon;
revoke all on function public.discard_invite_draft(uuid) from public, anon;
revoke all on function public.create_contact_invite(uuid, text) from public, anon;
revoke all on function public.preview_invite_public(text) from public;
revoke all on function public.decline_invite(text) from public;
revoke all on function public.preview_contact_invite(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.prepare_contact_invite(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.confirm_invite_sent(uuid) to authenticated;
grant execute on function public.discard_invite_draft(uuid) to authenticated;
grant execute on function public.create_contact_invite(uuid, text) to authenticated;
grant execute on function public.preview_invite_public(text) to anon, authenticated;
grant execute on function public.decline_invite(text) to anon, authenticated;
grant execute on function public.preview_contact_invite(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.contact_invite_timed_out(text, timestamptz) to authenticated;

-- ── Dữ liệu cũ ────────────────────────────────────────────────────────────────────────────────
-- (a) Liên hệ ngược đã lộ: chỉ xoá trường trùng y hệt bản của người mời (chưa ai sửa).
update public.contact r set
  note  = case when c.note  is not null and r.note  = c.note  then null else r.note  end,
  phone = case when c.phone is not null and r.phone = c.phone then null else r.phone end,
  email = case when c.email is not null and r.email = c.email then null else r.email end
from public.contact_invite i join public.contact c on c.id = i.contact_id
where i.status = 'accepted' and r.owner_user_id = c.linked_user_id and r.linked_user_id = c.owner_user_id
  and ((c.note is not null and r.note = c.note) or (c.phone is not null and r.phone = c.phone) or (c.email is not null and r.email = c.email));

-- (b) Khoá người nhận + sổ cho lời mời cũ (chỉ khi đã có pepper).
do $$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'avora_invite_pepper') then
    insert into private.contact_invite_key (invite_id, inviter_id, key)
    select i.id, i.invited_by, k from public.contact_invite i, unnest(private.invite_recipient_keys(i.contact_id)) k
    where i.contact_id is not null on conflict do nothing;
    insert into private.invite_ledger (inviter_id, recipient_key, invites, last_invite_at)
    select k.inviter_id, k.key, count(*), max(i.sent_at)
    from private.contact_invite_key k join public.contact_invite i on i.id = k.invite_id
    where i.status in ('pending', 'accepted', 'expired') group by 1, 2
    on conflict (inviter_id, recipient_key) do nothing;
  end if;
end $$;
