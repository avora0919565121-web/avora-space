-- Vá gấp (tester đang dùng): link mời Nhóm có hạn 7 ngày; danh sách thành viên không trả email.

-- 1. Invite links expire after 7 days. Links issued before this had no expiry: their clock starts today.
alter table public.group_invite_links add column if not exists expires_at timestamptz;
update public.group_invite_links set expires_at = now() + interval '7 days' where expires_at is null;
alter table public.group_invite_links
  alter column expires_at set default (now() + interval '7 days'),
  alter column expires_at set not null;

create or replace function public.rotate_group_invite(p_conversation_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  select role into v_role
    from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_uid;
  if v_role is null then
    raise exception 'You are not a participant of this group';
  end if;
  if v_role <> 'owner' then
    raise exception 'Only owner can manage the invite link';
  end if;
  if not exists (select 1 from public.conversation_groups g where g.conversation_id = p_conversation_id) then
    raise exception 'Not a group conversation';
  end if;
  insert into public.group_invite_links (conversation_id, created_by, expires_at)
    values (p_conversation_id, v_uid, now() + interval '7 days')
    on conflict (conversation_id) do update
      set token = gen_random_uuid(),
          created_by = excluded.created_by,
          created_at = now(),
          expires_at = now() + interval '7 days',
          revoked_at = null
    returning token into v_token;
  return v_token;
end;
$function$;

create or replace function public.preview_group_invite(p_token uuid)
 returns table(conversation_id uuid, group_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_conversation_id uuid;
  v_name text;
begin
  select l.conversation_id, g.name into v_conversation_id, v_name
    from public.group_invite_links l
    join public.conversation_groups g on g.conversation_id = l.conversation_id
    where l.token = p_token and l.revoked_at is null and l.expires_at > now();
  if v_conversation_id is null then
    raise exception 'Invite link not found';
  end if;
  conversation_id := v_conversation_id;
  group_name := v_name;
  return next;
end;
$function$;

create or replace function public.join_group_with_invite(p_token uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  select conversation_id into v_conversation_id
    from public.group_invite_links
    where token = p_token and revoked_at is null and expires_at > now();
  if v_conversation_id is null then
    raise exception 'Invite link not found';
  end if;
  if exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conversation_id and user_id = v_uid
  ) then
    return v_conversation_id;
  end if;
  insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_conversation_id, v_uid, 'member');
  return v_conversation_id;
end;
$function$;

-- 2. The roster carries names and roles only. Email never leaves the server through a group.
drop function if exists public.list_group_members(uuid);
create function public.list_group_members(p_conversation_id uuid)
 returns table(user_id uuid, display_name text, role text, joined_at timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'avora_not_signed_in';
  end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()
  ) then
    raise exception 'You are not a participant of this group';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.type = 'group') then
    raise exception 'Not a group conversation';
  end if;
  return query
  select cp.user_id, pp.display_name, cp.role, cp.joined_at
  from public.conversation_participants cp
  left join public.profiles pp on pp.id = cp.user_id
  where cp.conversation_id = p_conversation_id
  order by cp.joined_at asc;
end;
$function$;
revoke all on function public.list_group_members(uuid) from public, anon;
grant execute on function public.list_group_members(uuid) to authenticated;
