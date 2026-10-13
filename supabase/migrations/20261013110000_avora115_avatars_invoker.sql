-- AVORA-115 · sửa Advisor: ba RPC ảnh đại diện ở `public` thành SECURITY INVOKER; phần cần quyền
-- (đọc hồ sơ người khác theo luật "ai thấy", ghi cột avatar_url đã thu quyền) nằm trong `private`,
-- schema không lộ qua API. Hành vi giữ nguyên; supabase/tests/avora115_avatars.sql chạy lại.

create or replace function private.avatar_paths_for(p_viewer uuid, p_user_ids uuid[])
returns table (user_id uuid, path text, version timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.avatar_url, p.avatar_updated_at
  from public.profiles p
  where p_viewer is not null
    and p.id = any (p_user_ids)
    and p.avatar_url is not null
    and private.can_see_avatar(p_viewer, p.id);
$$;
revoke execute on function private.avatar_paths_for(uuid, uuid[]) from public, anon;
grant execute on function private.avatar_paths_for(uuid, uuid[]) to authenticated;

create or replace function private.avatar_write(p_owner uuid, p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  -- Only ever the caller's own row: the public wrappers pass auth.uid(), nothing else.
  if p_owner is null or p_owner is distinct from auth.uid() then raise exception 'avora_not_allowed'; end if;
  select avatar_url into v_old from public.profiles where id = p_owner for update;
  update public.profiles set avatar_url = p_path, avatar_updated_at = now() where id = p_owner;
  perform private.avatar_notify_friends(p_owner);
  return v_old;
end $$;
revoke execute on function private.avatar_write(uuid, text) from public, anon;
grant execute on function private.avatar_write(uuid, text) to authenticated;

create or replace function public.avatar_paths(p_user_ids uuid[])
returns table (user_id uuid, path text, version timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 1000 then raise exception 'avora_too_many'; end if;
  return query select * from private.avatar_paths_for(v_uid, p_user_ids);
end $$;
alter function public.avatar_paths(uuid[]) security invoker;

create or replace function public.set_avatar(p_path text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]{1,64}\.jpg$') then
    raise exception 'avora_avatar_invalid';
  end if;
  -- Read as the caller: the owner policy on `avatars` lets them see their own files only.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'avora_attachment_missing';
  end if;
  v_old := private.avatar_write(v_uid, p_path);
  return case when v_old is distinct from p_path then v_old end;
end $$;
alter function public.set_avatar(text) security invoker;

create or replace function public.clear_avatar()
returns text language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return private.avatar_write(v_uid, null);
end $$;
alter function public.clear_avatar() security invoker;

revoke execute on function public.avatar_paths(uuid[]) from public, anon;
revoke execute on function public.set_avatar(text) from public, anon;
revoke execute on function public.clear_avatar() from public, anon;
grant execute on function public.avatar_paths(uuid[]) to authenticated;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.clear_avatar() to authenticated;
