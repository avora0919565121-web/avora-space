-- AVORA-115 · Ảnh đại diện của tài khoản Avora (VMT chốt 13/10).
--
-- Ai thấy: chỉ chủ ảnh và người đã kết nối (bạn), không có chặn giữa hai người. Mọi người khác —
-- thành viên chung nhóm/dự án chưa là bạn, người lạ tìm theo PIN, lời mời chưa chấp nhận, người bị
-- chặn — chỉ thấy chữ cái đầu. Huỷ kết bạn / chặn → mất quyền ngay (máy chủ trả null, link ký mới bị
-- từ chối; link đã cấp hết hạn sau tối đa 5 phút).
-- Ai dùng: chỉ chủ ảnh đặt / đổi / xoá. Bucket riêng tư, không URL công khai.
--
-- • profiles.avatar_updated_at (phiên bản); profiles.avatar_url giữ ĐƯỜNG DẪN `<user_id>/<phiên_bản>.jpg`.
-- • bucket `avatars`: JPEG ≤ 256 KB; chủ ghi/xoá thư mục của mình; đọc: chủ + bạn.
-- • Ghi avatar_url chỉ qua RPC (thu quyền insert/update cột từ app).
-- • private.can_see_avatar(viewer, owner) — một chỗ duy nhất cho luật "ai thấy".
-- • avatar_paths(uuid[]): đường dẫn + phiên bản, null cho người không được thấy.
-- • set_avatar / clear_avatar: trả đường dẫn cũ để app xoá tệp cũ; báo `avatar` tới topic riêng của
--   mỗi người bạn và của chính mình (thiết bị khác) → ảnh mới hiện không cần tải lại.
-- • Kết bạn / huỷ kết bạn / chặn / gỡ chặn: báo `avatar` cho cả hai phía.
-- • contact_card_view (nơi duy nhất khác trả avatar_url): null cho người không phải bạn.

alter table public.profiles add column if not exists avatar_updated_at timestamptz;

revoke insert (avatar_url), update (avatar_url) on public.profiles from authenticated;

-- ------------------------------------------------------------ who sees
create or replace function private.can_see_avatar(p_viewer uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer is not null and p_owner is not null and (
    p_viewer = p_owner
    or (private.are_connected(p_viewer, p_owner) and not private.is_blocked_between(p_viewer, p_owner))
  );
$$;
revoke execute on function private.can_see_avatar(uuid, uuid) from public, anon;
grant execute on function private.can_see_avatar(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 262144, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 262144, allowed_mime_types = array['image/jpeg'];

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
using (bucket_id = 'avatars' and private.can_see_avatar((select auth.uid()), private.folder_uuid(name)));

-- ------------------------------------------------------------ notices
/** Tells `p_to` that `p_about`'s picture may look different now. Never blocks the change that caused it. */
create or replace function private.avatar_notice(p_to uuid, p_about uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('user_id', p_about), 'avatar', 'user-' || p_to::text, true);
exception when others then
  null; -- a failed notice never blocks the change; the next open re-reads by version
end $$;
revoke execute on function private.avatar_notice(uuid, uuid) from public, anon, authenticated;

/** Every friend of `p_owner`, plus the owner's own other devices. */
create or replace function private.avatar_notify_friends(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_friend uuid;
begin
  perform private.avatar_notice(p_owner, p_owner);
  for v_friend in
    select case when uc.user_low = p_owner then uc.user_high else uc.user_low end
    from public.user_connections uc
    where (uc.user_low = p_owner or uc.user_high = p_owner) and uc.status = 'active'
  loop
    perform private.avatar_notice(v_friend, p_owner);
  end loop;
end $$;
revoke execute on function private.avatar_notify_friends(uuid) from public, anon, authenticated;

create or replace function private.avatar_on_connection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  perform private.avatar_notice(new.user_low, new.user_high);
  perform private.avatar_notice(new.user_high, new.user_low);
  return new;
end $$;
revoke execute on function private.avatar_on_connection() from public, anon, authenticated;
drop trigger if exists user_connections_avatar_notice on public.user_connections;
create trigger user_connections_avatar_notice after insert or update of status on public.user_connections
for each row execute function private.avatar_on_connection();

create or replace function private.avatar_on_block()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.user_blocks%rowtype;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  perform private.avatar_notice(v_row.blocker_id, v_row.blocked_id);
  perform private.avatar_notice(v_row.blocked_id, v_row.blocker_id);
  return null;
end $$;
revoke execute on function private.avatar_on_block() from public, anon, authenticated;
drop trigger if exists user_blocks_avatar_notice on public.user_blocks;
create trigger user_blocks_avatar_notice after insert or delete on public.user_blocks
for each row execute function private.avatar_on_block();

-- ------------------------------------------------------------ read
/**
 * Paths of the people asked about that the caller may see. Others are simply absent, so the
 * caller falls back to initials. At most 1000 ids per call.
 */
create or replace function public.avatar_paths(p_user_ids uuid[])
returns table (user_id uuid, path text, version timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 1000 then raise exception 'avora_too_many'; end if;
  return query
    select p.id, p.avatar_url, p.avatar_updated_at
    from public.profiles p
    where p.id = any (p_user_ids)
      and p.avatar_url is not null
      and private.can_see_avatar(v_uid, p.id);
end $$;
revoke execute on function public.avatar_paths(uuid[]) from public, anon;
grant execute on function public.avatar_paths(uuid[]) to authenticated;

-- ------------------------------------------------------------ write (owner only)
/** Points the caller's profile at a picture they uploaded. Returns the previous path (to delete). */
create or replace function public.set_avatar(p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]{1,64}\.jpg$') then
    raise exception 'avora_avatar_invalid';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'avora_attachment_missing';
  end if;
  select avatar_url into v_old from public.profiles where id = v_uid for update;
  update public.profiles set avatar_url = p_path, avatar_updated_at = now() where id = v_uid;
  perform private.avatar_notify_friends(v_uid);
  return case when v_old is distinct from p_path then v_old end;
end $$;
revoke execute on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;

/** Back to initials. Returns the previous path (to delete). */
create or replace function public.clear_avatar()
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select avatar_url into v_old from public.profiles where id = v_uid for update;
  update public.profiles set avatar_url = null, avatar_updated_at = now() where id = v_uid;
  perform private.avatar_notify_friends(v_uid);
  return v_old;
end $$;
revoke execute on function public.clear_avatar() from public, anon;
grant execute on function public.clear_avatar() to authenticated;

-- ------------------------------------------------------------ the one other reader
create or replace function public.contact_card_view(p_message_id uuid)
 returns table(user_id uuid, name text, pin text, avatar_url text, is_friend boolean, is_self boolean)
 language plpgsql stable security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_person uuid;
begin
  perform private.assert_session_allowed();
  select m.conversation_id, m.contact_card_user_id into v_conv, v_person from public.messages m
    where m.id = p_message_id and m.deleted_at is null;
  if v_conv is null or v_person is null or not private.is_conversation_participant(v_conv, v_user) then return; end if;
  -- AVORA-115: the picture only for its owner and friends.
  return query select v_person, p.display_name, up.pin,
      case when private.can_see_avatar(v_user, v_person) then p.avatar_url end,
      private.are_connected(v_user, v_person), v_person = v_user
    from public.profiles p join public.user_pins up on up.user_id = p.id where p.id = v_person;
end $function$;
