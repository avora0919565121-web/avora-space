-- AVORA-108 · KHỐI N1 — Trạng thái tin thật, có đi có lại (thay phần "không có Đã xem" của ADR-028).
--
-- • profiles.share_read_status (mặc định true) + conversation_member_prefs.share_read_status (null =
--   theo cài đặt chung). Hiệu lực = coalesce(riêng cuộc, chung). Ghi qua RPC.
-- • mark_messages_delivered: 1-1 và Nhóm ≤ 100 thành viên; Nhóm > 100 không ghi gì.
-- • "Đã xem" = mốc đọc conversation_read_marks.last_read_at ≥ messages.created_at — không bảng mới.
-- • Đọc chỉ qua get_message_receipts / get_message_receipt_counts (SECURITY DEFINER, kiểm quyền);
--   không realtime, không SELECT trực tiếp lên mốc đọc của người khác. Nhóm > 100 → rỗng, không lỗi.
-- • message_deliveries: người gửi đọc thẳng chỉ còn ở 1-1 (Nhóm đi qua RPC để tôn trọng người tắt).

alter table public.profiles add column if not exists share_read_status boolean not null default true;
grant select (share_read_status) on public.profiles to authenticated;

alter table public.conversation_member_prefs add column if not exists share_read_status boolean null;

/** Cài đặt › Riêng tư: `Cho nhóm biết khi tôi đã xem tin`. */
create or replace function public.set_share_read_status(p_value boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  update public.profiles set share_read_status = coalesce(p_value, true) where id = v_uid;
end $$;
revoke execute on function public.set_share_read_status(boolean) from public, anon;
grant execute on function public.set_share_read_status(boolean) to authenticated;

/** ⋯ của một cuộc: `Theo cài đặt chung` (null) · `Luôn bật` (true) · `Luôn tắt` (false). */
create or replace function public.set_conversation_share_read(p_conversation_id uuid, p_value boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, share_read_status)
  values (p_conversation_id, v_uid, p_value)
  on conflict (conversation_id, user_id) do update set share_read_status = excluded.share_read_status, updated_at = now();
end $$;
revoke execute on function public.set_conversation_share_read(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_share_read(uuid, boolean) to authenticated;

create or replace function private.shares_read(p_conversation uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select mp.share_read_status from public.conversation_member_prefs mp where mp.conversation_id = p_conversation and mp.user_id = p_uid),
    (select p.share_read_status from public.profiles p where p.id = p_uid),
    true)
$$;
revoke execute on function private.shares_read(uuid, uuid) from public, anon, authenticated;

/** 'direct' · 'group' (≤ 100 others besides… counted as members) · null = no receipts here. */
create or replace function private.receipt_scope(p_conversation uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when c.type = 'direct' then 'direct'
    when c.type = 'group' and (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) <= 100 then 'group'
    else null end
  from public.conversations c where c.id = p_conversation
$$;
revoke execute on function private.receipt_scope(uuid) from public, anon, authenticated;

create or replace function public.mark_messages_delivered(p_message_ids uuid[])
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  -- AVORA-108: 1-1 and groups of ≤ 100; never one's own line, never across a block, never a system line.
  insert into message_deliveries (message_id, user_id)
  select m.id, v_uid
  from messages m
  where m.id = any (p_message_ids)
    and m.sender_id <> v_uid
    and m.system_kind is null
    and private.receipt_scope(m.conversation_id) is not null
    and private.can_act_in(m.conversation_id, v_uid, 'mark')
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

-- A group's deliveries go through the receipts RPC (it hides those who do not share); 1-1 stays as it was.
drop policy if exists message_deliveries_sender_reads on public.message_deliveries;
create policy message_deliveries_sender_reads on public.message_deliveries for select to authenticated
using (exists (
  select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
  where m.id = message_deliveries.message_id and m.sender_id = (select auth.uid()) and c.type = 'direct'
));

/**
 * Who has the message: one row per member other than the sender —
 * read · delivered · not_delivered · hidden (does not share) · unavailable (a block between).
 * The caller must be a current member who shares their own status (`avora_receipts_off` otherwise).
 * 1-1: `read` only when both share. Groups over 100, Nhật ký, email: empty, no error.
 */
create or replace function public.get_message_receipts(p_message_id uuid)
returns table (user_id uuid, display_name text, state text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages%rowtype;
  v_scope text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_msg from public.messages m where m.id = p_message_id;
  if v_msg.id is null or not private.can_act_in(v_msg.conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  v_scope := private.receipt_scope(v_msg.conversation_id);
  if v_scope is null or v_msg.system_kind is not null or v_msg.deleted_at is not null then return; end if;
  if not private.shares_read(v_msg.conversation_id, v_uid) then raise exception 'avora_receipts_off'; end if;
  return query
    select cp.user_id,
           coalesce(nullif(btrim(p.display_name), ''), 'Thành viên'),
           case
             when private.is_blocked_between(v_uid, cp.user_id) then 'unavailable'
             -- 1-1: someone who does not share is simply `delivered` — no word hints at a reason.
             when not private.shares_read(v_msg.conversation_id, cp.user_id) and v_scope = 'direct' then case when d.delivered_at is not null then 'delivered' else 'not_delivered' end
             when not private.shares_read(v_msg.conversation_id, cp.user_id) then 'hidden'
             when rm.last_read_at is not null and rm.last_read_at >= v_msg.created_at then 'read'
             when d.delivered_at is not null then 'delivered'
             else 'not_delivered'
           end,
           case
             when private.is_blocked_between(v_uid, cp.user_id) then null
             when not private.shares_read(v_msg.conversation_id, cp.user_id) and v_scope = 'direct' then d.delivered_at
             when not private.shares_read(v_msg.conversation_id, cp.user_id) then null
             when rm.last_read_at is not null and rm.last_read_at >= v_msg.created_at then rm.last_read_at
             else d.delivered_at
           end
      from public.conversation_participants cp
      left join public.profiles p on p.id = cp.user_id
      left join public.conversation_read_marks rm on rm.conversation_id = cp.conversation_id and rm.user_id = cp.user_id
      left join public.message_deliveries d on d.message_id = v_msg.id and d.user_id = cp.user_id
     where cp.conversation_id = v_msg.conversation_id
       and cp.user_id <> v_msg.sender_id
       -- The caller never sees their own time; in a 1-1 the one other person is the row.
       and cp.user_id <> v_uid;
end $$;
revoke execute on function public.get_message_receipts(uuid) from public, anon;
grant execute on function public.get_message_receipts(uuid) to authenticated;

/** The chip `👁 n/m` under my last line: counts only, same rules (≤ 50 messages). */
create or replace function public.get_message_receipt_counts(p_message_ids uuid[])
returns table (message_id uuid, read_count int, delivered_count int, total int)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 50 then raise exception 'avora_too_many'; end if;
  if exists (select 1 from public.messages m where m.id = any (p_message_ids) and not private.can_act_in(m.conversation_id, v_uid, 'read')) then
    raise exception 'avora_not_allowed';
  end if;
  if exists (select 1 from public.messages m where m.id = any (p_message_ids) and private.receipt_scope(m.conversation_id) is not null and not private.shares_read(m.conversation_id, v_uid)) then
    raise exception 'avora_receipts_off';
  end if;
  return query
    select m.id,
           count(*) filter (where not private.is_blocked_between(v_uid, cp.user_id) and private.shares_read(m.conversation_id, cp.user_id)
                              and rm.last_read_at is not null and rm.last_read_at >= m.created_at)::int,
           count(*) filter (where not private.is_blocked_between(v_uid, cp.user_id) and private.shares_read(m.conversation_id, cp.user_id)
                              and (d.delivered_at is not null or (rm.last_read_at is not null and rm.last_read_at >= m.created_at)))::int,
           count(cp.user_id)::int
      from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id <> m.sender_id and cp.user_id <> v_uid
      left join public.conversation_read_marks rm on rm.conversation_id = cp.conversation_id and rm.user_id = cp.user_id
      left join public.message_deliveries d on d.message_id = m.id and d.user_id = cp.user_id
     where m.id = any (p_message_ids)
       and m.system_kind is null and m.deleted_at is null
       and private.receipt_scope(m.conversation_id) is not null
     group by m.id;
end $$;
revoke execute on function public.get_message_receipt_counts(uuid[]) from public, anon;
grant execute on function public.get_message_receipt_counts(uuid[]) to authenticated;

-- 2.1: opening the conversation (once, K2 · C8) now also covers groups of ≤ 100.
create or replace function public.mark_conversation_delivered(p_conversation uuid)
returns integer
language plpgsql security definer set search_path to '' as $function$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation, v_uid, 'mark') then return 0; end if;
  if private.receipt_scope(p_conversation) is null then return 0; end if;
  insert into public.message_deliveries (message_id, user_id)
  select m.id, v_uid from public.messages m
  where m.conversation_id = p_conversation and m.sender_id <> v_uid and m.system_kind is null
    and m.created_at > now() - interval '30 days'
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
