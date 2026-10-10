-- AVORA-106 · K3 (phần còn lại) — N9 danh sách Kết nối theo trang.
-- • list_my_conversations(): số chưa đọc ngừng đếm ở 100 (huy hiệu ghi 99+).
-- • inbox_page(p_limit, p_before_sort, p_before_id, p_include): 1-1 theo trang (mặc định 50, con trỏ
--   (sort_at, id)); Nhật ký, Nhóm, Dự án luôn trả đủ (ít, và Nhóm vẽ thành cây); p_include luôn trả
--   thêm các cuộc đang mở / đã ghim dù chưa tới trang.
-- • inbox_unread_counts(): một RPC đếm nhẹ cho huy hiệu các ngăn khi danh sách chưa nạp hết.

CREATE OR REPLACE FUNCTION public.list_my_conversations()
 RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer, is_connected boolean, verification_status text, verification_expires_at timestamp with time zone, verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid, verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select
    c.id,
    peer.user_id,
    case when live.v and c.verification_via_group_id is null then null else pp.display_name end,
    case when live.v then null else pu.email::text end,
    lm.content,
    lm.created_at,
    lm.sender_id,
    coalesce(un.unread_count, 0)::integer,
    coalesce(lm.created_at, c.created_at),
    c.type,
    cg.name,
    coalesce(mc.member_count, 1)::integer,
    case when c.type = 'direct' then private.are_connected (auth.uid(), peer.user_id) end,
    case when live.v then 'pending' end,
    case when live.v then c.verification_expires_at end,
    case when live.v then c.verification_via_group_id end,
    case when live.v then bg.name end,
    case when live.v then c.verification_opened_by end,
    case when live.v then greatest(0, 5 - (
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.sender_id = auth.uid() and m2.created_at >= c.verification_started_at
    ))::integer end,
    case when live.v then exists (
      select 1 from public.conversation_verification_confirms vc
      where vc.conversation_id = c.id and vc.user_id = auth.uid()
    ) end,
    case
      when c.type <> 'direct' then null
      when live.v and c.verification_via_group_id is null then pin.pin
      when not live.v and private.are_connected (auth.uid(), peer.user_id) then pin.pin
    end
  from public.conversations c
  join public.conversation_participants me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_read_marks rm
    on rm.conversation_id = c.id and rm.user_id = auth.uid()
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
  left join public.user_pins pin on pin.user_id = peer.user_id
  left join public.conversation_groups bg on bg.conversation_id = c.verification_via_group_id
  cross join lateral (select (c.verification_status = 'pending' and private.verification_is_live (c.id)) as v) live
  left join lateral (
    select m.content, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  left join lateral (
    -- K3 · N9: counting stops at 100; the badge reads 99+ past that.
    select count(*) as unread_count from (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        -- AVORA-62 · E0: "X tạo Bảng" is a quiet line, never unread.
        and m.system_kind is distinct from 'board_created'
        and (rm.last_read_at is null or m.created_at > rm.last_read_at)
      limit 100
    ) capped
  ) un on true
  left join lateral (
    select count(*) as member_count
    from public.conversation_participants cp2
    where cp2.conversation_id = c.id
  ) mc on true
  where auth.uid() is not null
    and c.deleted_at is null
    and not (
      c.type = 'direct'
      and c.verification_status in ('pending', 'closed')
      and not live.v
      and not private.are_connected (auth.uid(), peer.user_id)
    )
  order by coalesce(lm.created_at, c.created_at) desc;
$function$;

create or replace function public.inbox_page(
  p_limit integer default 50,
  p_before_sort timestamptz default null,
  p_before_id uuid default null,
  p_include uuid[] default '{}'
)
returns table(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer, is_connected boolean, verification_status text, verification_expires_at timestamp with time zone, verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid, verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text)
language sql stable security definer set search_path = ''
as $$
  with allrows as (select * from public.list_my_conversations()),
  direct_page as (
    select a.conversation_id from allrows a
    where a.conversation_type = 'direct'
      and (p_before_sort is null or (a.sort_at, a.conversation_id) < (p_before_sort, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by a.sort_at desc, a.conversation_id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select a.* from allrows a
  where a.conversation_id in (select conversation_id from direct_page)
     or a.conversation_id = any(coalesce(p_include, '{}'))
     or (p_before_sort is null and a.conversation_type <> 'direct')
  order by a.sort_at desc, a.conversation_id desc;
$$;
revoke execute on function public.inbox_page(integer, timestamptz, uuid, uuid[]) from public, anon;
grant execute on function public.inbox_page(integer, timestamptz, uuid, uuid[]) to authenticated;

create or replace function public.inbox_unread_counts()
returns table(conversation_type text, unread_messages integer, unread_conversations integer)
language sql stable security definer set search_path = ''
as $$
  select a.conversation_type, sum(a.unread_count)::integer, count(*) filter (where a.unread_count > 0)::integer
  from public.list_my_conversations() a
  group by a.conversation_type;
$$;
revoke execute on function public.inbox_unread_counts() from public, anon;
grant execute on function public.inbox_unread_counts() to authenticated;
