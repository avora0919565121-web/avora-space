-- AVORA-117 · Gỡ và đổi liên kết liên hệ ↔ tài khoản AVORA.
--
-- Trước khối này: `contact.linked_user_id` chỉ được đặt (confirm_contact_link, accept_invite) và không có
-- đường gỡ hay chuyển. Đọc mã thật cho thấy thêm một lỗ: quyền UPDATE của bảng `contact` cho
-- `authenticated` gồm cả cột `linked_user_id`, nên chủ liên hệ gọi thẳng REST là gắn được BẤT KỲ user id
-- nào. Khối này:
--   1. chặn mọi thay đổi `linked_user_id` từ vai trò máy khách (trigger); chỉ hàm máy chủ đổi được;
--   2. ràng buộc duy nhất (chủ, tài khoản): một tài khoản chỉ gắn với một liên hệ của cùng một chủ
--      (dữ liệu sống đã kiểm trước: 0 cặp trùng);
--   3. unlink_contact · relink_contact · link_contact_to_friend · undo_contact_link_change;
--   4. bảng kiểm toán `contact_link_changes` (chủ đọc dòng của mình; người được liên kết không bao giờ
--      được báo).
-- Mẫu 115: RPC `public` là SECURITY INVOKER, phần cần quyền nằm trong `private`.

-- ------------------------------------------------------------------ 1. chỉ máy chủ đổi liên kết
create or replace function private.contact_link_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Hàm SECURITY DEFINER chạy dưới vai trò chủ hàm, nên chỉ lời gọi thẳng từ máy khách rơi vào đây.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.linked_user_id is not null then
      raise exception 'avora_contact_link_server_only';
    end if;
    if tg_op = 'UPDATE' and new.linked_user_id is distinct from old.linked_user_id then
      raise exception 'avora_contact_link_server_only';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.contact_link_guard() from public, anon, authenticated;

drop trigger if exists trg_contact_link_guard on public.contact;
create trigger trg_contact_link_guard before insert or update of linked_user_id on public.contact
  for each row execute function private.contact_link_guard();

-- ------------------------------------------------------------------ 2. một tài khoản ↔ một liên hệ
create unique index if not exists contact_owner_linked_user_uniq
  on public.contact (owner_user_id, linked_user_id) where linked_user_id is not null;

-- ------------------------------------------------------------------ 4. kiểm toán
create table if not exists public.contact_link_changes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('unlink', 'relink', 'link', 'undo')),
  from_contact_id uuid,
  to_contact_id uuid,
  -- Để hoàn tác mà máy khách không phải gửi user id. Chủ đã biết người này (họ vừa gắn với liên hệ của chủ).
  linked_user_id uuid,
  undone_at timestamptz
);
create index if not exists contact_link_changes_owner_at on public.contact_link_changes (owner_user_id, at desc);
alter table public.contact_link_changes enable row level security;
revoke all on public.contact_link_changes from public, anon, authenticated;
grant select on public.contact_link_changes to authenticated;
drop policy if exists contact_link_changes_owner_read on public.contact_link_changes;
create policy contact_link_changes_owner_read on public.contact_link_changes for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists avora_session_allowed on public.contact_link_changes;
create policy avora_session_allowed on public.contact_link_changes as restrictive for all to authenticated
  using ((select private.session_allowed()));

-- ------------------------------------------------------------------ 3. thao tác (private, definer)
create or replace function private.contact_link_change(
  p_owner uuid, p_kind text, p_from uuid, p_to uuid, p_user uuid, p_change uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_from public.contact%rowtype;
  v_to public.contact%rowtype;
  v_user uuid;
  v_change public.contact_link_changes%rowtype;
  v_id uuid;
begin
  if p_owner is null or p_owner is distinct from auth.uid() then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(p_owner, 'contact_link', 30, interval '1 hour');

  if p_kind = 'unlink' then
    select * into v_from from public.contact where id = p_from for update;
    if not found or v_from.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_from.linked_user_id is null then raise exception 'avora_contact_not_linked'; end if;
    v_user := v_from.linked_user_id;
    update public.contact
      set linked_user_id = null, link_suggestion_dismissed = private.contact_link_fingerprint(p_from, v_user)
      where id = p_from;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, linked_user_id)
      values (p_owner, 'unlink', p_from, v_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'relink' then
    if p_from is null or p_to is null then raise exception 'avora_contact_not_yours'; end if;
    if p_from = p_to then raise exception 'avora_contact_same'; end if;
    -- Khoá theo thứ tự id để hai lời gọi đảo chiều không chờ nhau mãi.
    perform 1 from public.contact where id in (p_from, p_to) order by id for update;
    select * into v_from from public.contact where id = p_from;
    select * into v_to from public.contact where id = p_to;
    if v_from.id is null or v_to.id is null or v_from.owner_user_id <> p_owner or v_to.owner_user_id <> p_owner then
      raise exception 'avora_contact_not_yours';
    end if;
    if v_from.linked_user_id is null then raise exception 'avora_contact_not_linked'; end if;
    if v_to.contact_type <> 'individual' then raise exception 'avora_contact_not_individual'; end if;
    if v_to.linked_user_id is not null then raise exception 'avora_contact_target_linked'; end if;
    v_user := v_from.linked_user_id;
    -- Gỡ trước rồi gắn: ràng buộc duy nhất (chủ, tài khoản) không bao giờ thấy hai dòng cùng lúc.
    update public.contact
      set linked_user_id = null, link_suggestion_dismissed = private.contact_link_fingerprint(p_from, v_user)
      where id = p_from;
    update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null where id = p_to;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, to_contact_id, linked_user_id)
      values (p_owner, 'relink', p_from, p_to, v_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'link' then
    select * into v_to from public.contact where id = p_to for update;
    if not found or v_to.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_to.contact_type <> 'individual' then raise exception 'avora_contact_not_individual'; end if;
    if v_to.linked_user_id is not null then raise exception 'avora_contact_target_linked'; end if;
    -- Chỉ bạn bè đang kết nối: không gắn được tên vào một người lạ bất kỳ.
    if not private.are_connected(p_owner, p_user) then raise exception 'avora_contact_not_friend'; end if;
    if exists (select 1 from public.contact c where c.owner_user_id = p_owner and c.linked_user_id = p_user) then
      raise exception 'avora_contact_account_linked_elsewhere';
    end if;
    update public.contact set linked_user_id = p_user, link_suggestion_dismissed = null where id = p_to;
    insert into public.contact_link_changes (owner_user_id, kind, to_contact_id, linked_user_id)
      values (p_owner, 'link', p_to, p_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'undo' then
    select * into v_change from public.contact_link_changes where id = p_change for update;
    if not found or v_change.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_change.undone_at is not null or v_change.kind = 'undo' or v_change.at < now() - interval '15 minutes' then
      raise exception 'avora_contact_undo_expired';
    end if;
    v_user := v_change.linked_user_id;
    perform 1 from public.contact where id in (v_change.from_contact_id, v_change.to_contact_id) order by id for update;
    if v_change.kind = 'unlink' then
      if exists (select 1 from public.contact c where c.owner_user_id = p_owner and c.linked_user_id = v_user) then
        raise exception 'avora_contact_account_linked_elsewhere';
      end if;
      update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null
        where id = v_change.from_contact_id and owner_user_id = p_owner and linked_user_id is null;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    elsif v_change.kind = 'relink' then
      update public.contact set linked_user_id = null, link_suggestion_dismissed = null
        where id = v_change.to_contact_id and owner_user_id = p_owner and linked_user_id = v_user;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
      update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null
        where id = v_change.from_contact_id and owner_user_id = p_owner and linked_user_id is null;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    else -- link
      update public.contact set linked_user_id = null
        where id = v_change.to_contact_id and owner_user_id = p_owner and linked_user_id = v_user;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    end if;
    update public.contact_link_changes set undone_at = now() where id = p_change;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, to_contact_id, linked_user_id)
      values (p_owner, 'undo', v_change.from_contact_id, v_change.to_contact_id, v_user) returning id into v_id;
    return v_id;
  end if;

  raise exception 'avora_contact_link_kind';
end $$;
revoke execute on function private.contact_link_change(uuid, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.contact_link_change(uuid, text, uuid, uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ RPC công khai (invoker)
create or replace function public.unlink_contact(p_contact_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'unlink', p_contact_id, null, null, null);
end $$;

create or replace function public.relink_contact(p_from_contact_id uuid, p_to_contact_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'relink', p_from_contact_id, p_to_contact_id, null, null);
end $$;

create or replace function public.link_contact_to_friend(p_contact_id uuid, p_friend_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'link', null, p_contact_id, p_friend_id, null);
end $$;

create or replace function public.undo_contact_link_change(p_change_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'undo', null, null, null, p_change_id);
end $$;

revoke execute on function public.unlink_contact(uuid) from public, anon;
revoke execute on function public.relink_contact(uuid, uuid) from public, anon;
revoke execute on function public.link_contact_to_friend(uuid, uuid) from public, anon;
revoke execute on function public.undo_contact_link_change(uuid) from public, anon;
grant execute on function public.unlink_contact(uuid) to authenticated;
grant execute on function public.relink_contact(uuid, uuid) to authenticated;
grant execute on function public.link_contact_to_friend(uuid, uuid) to authenticated;
grant execute on function public.undo_contact_link_change(uuid) to authenticated;
