-- AVORA-37 / C2 — stop sending the peer's read watermark (ADR-028: no "Đã xem").
--
-- list_my_conversations returned peer_last_read_at, which the client used for "Đã xem".
-- The column is dropped from the result; everything else is unchanged. The viewer's OWN
-- last_read_at (me.last_read_at) still drives unread_count and the badge.
-- Dropping a result column changes the return type, so the function is dropped and recreated
-- and its grants restored exactly as they were: EXECUTE for authenticated only.
--
-- ---------------------------------------------------------------------------------------
-- Definition BEFORE this migration (pg_get_functiondef, 2026-09-27):
-- ACL: {postgres=X/postgres,authenticated=X/postgres}
--   CREATE OR REPLACE FUNCTION public.list_my_conversations()
--    RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, peer_last_read_at timestamp with time zone, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer)
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO 'public', 'pg_temp'
--   AS $function$
--     select
--       c.id,
--       peer.user_id,
--       pp.display_name,
--       pu.email::text,
--       lm.content,
--       lm.created_at,
--       lm.sender_id,
--       coalesce(un.unread_count, 0)::integer,
--       peer.last_read_at,
--       coalesce(lm.created_at, c.created_at),
--       c.type,
--       cg.name,
--       coalesce(mc.member_count, 1)::integer
--     from public.conversations c
--     join public.conversation_participants me
--       on me.conversation_id = c.id and me.user_id = auth.uid()
--     left join public.conversation_groups cg on cg.conversation_id = c.id
--     left join lateral (
--       select cp.user_id, cp.last_read_at
--       from public.conversation_participants cp
--       where cp.conversation_id = c.id
--         and cp.user_id <> auth.uid()
--         and c.type = 'direct'
--       order by cp.joined_at
--       limit 1
--     ) peer on true
--     left join public.profiles pp on pp.id = peer.user_id
--     left join auth.users pu on pu.id = peer.user_id
--     left join lateral (
--       select m.content, m.created_at, m.sender_id
--       from public.messages m
--       where m.conversation_id = c.id
--       order by m.created_at desc, m.id desc
--       limit 1
--     ) lm on true
--     left join lateral (
--       select count(*) as unread_count
--       from public.messages m
--       where m.conversation_id = c.id
--         and m.sender_id <> auth.uid()
--         and (me.last_read_at is null or m.created_at > me.last_read_at)
--     ) un on true
--     left join lateral (
--       select count(*) as member_count
--       from public.conversation_participants cp2
--       where cp2.conversation_id = c.id
--     ) mc on true
--     where auth.uid() is not null
--       and c.deleted_at is null
--     order by coalesce(lm.created_at, c.created_at) desc;
--   $function$
-- ---------------------------------------------------------------------------------------

begin;

drop function public.list_my_conversations();

create function public.list_my_conversations()
 returns table(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    c.id,
    peer.user_id,
    pp.display_name,
    pu.email::text,
    lm.content,
    lm.created_at,
    lm.sender_id,
    coalesce(un.unread_count, 0)::integer,
    coalesce(lm.created_at, c.created_at),
    c.type,
    cg.name,
    coalesce(mc.member_count, 1)::integer
  from public.conversations c
  join public.conversation_participants me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_groups cg on cg.conversation_id = c.id
  left join lateral (
    select cp.user_id
    from public.conversation_participants cp
    where cp.conversation_id = c.id
      and cp.user_id <> auth.uid()
      and c.type = 'direct'
    order by cp.joined_at
    limit 1
  ) peer on true
  left join public.profiles pp on pp.id = peer.user_id
  left join auth.users pu on pu.id = peer.user_id
  left join lateral (
    select m.content, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as unread_count
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_id <> auth.uid()
      and (me.last_read_at is null or m.created_at > me.last_read_at)
  ) un on true
  left join lateral (
    select count(*) as member_count
    from public.conversation_participants cp2
    where cp2.conversation_id = c.id
  ) mc on true
  where auth.uid() is not null
    and c.deleted_at is null
  order by coalesce(lm.created_at, c.created_at) desc;
$function$;

revoke execute on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;

commit;
