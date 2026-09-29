-- Đợt gộp 2 · B3 (ADR-028): nobody can read how far someone else has read — by SELECT, view,
-- RPC or realtime. Read marks move to their own table where RLS returns only your own row;
-- the old column on conversation_participants (readable by every member) is dropped.

create table if not exists public.conversation_read_marks (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (conversation_id, user_id)
);

alter table public.conversation_read_marks enable row level security;
revoke all on public.conversation_read_marks from public, anon, authenticated;
revoke truncate on public.conversation_read_marks from authenticated;
grant select on public.conversation_read_marks to authenticated;

drop policy if exists "Own read marks only" on public.conversation_read_marks;
create policy "Own read marks only" on public.conversation_read_marks
  for select to authenticated using (user_id = (select auth.uid()));

-- Copy what exists.
insert into public.conversation_read_marks (conversation_id, user_id, last_read_at)
select cp.conversation_id, cp.user_id, cp.last_read_at
from public.conversation_participants cp
where cp.last_read_at is not null
on conflict do nothing;

-- Realtime: only this table's rows, filtered by RLS to the reader's own.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_read_marks') then
    alter publication supabase_realtime add table public.conversation_read_marks;
  end if;
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_latest timestamptz;
  v_result timestamptz;
begin
  if v_user is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if not private.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;

  select max(m.created_at) into v_latest from public.messages m where m.conversation_id = p_conversation_id;

  if v_latest is not null then
    -- Monotonic, and no write when nothing moved.
    insert into public.conversation_read_marks as r (conversation_id, user_id, last_read_at)
    values (p_conversation_id, v_user, v_latest)
    on conflict (conversation_id, user_id) do update
      set last_read_at = excluded.last_read_at
      where r.last_read_at < excluded.last_read_at;
  end if;

  select last_read_at into v_result from public.conversation_read_marks
  where conversation_id = p_conversation_id and user_id = v_user;
  return v_result;
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.list_my_conversations()
 returns table(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer, is_connected boolean, verification_status text, verification_expires_at timestamp with time zone, verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid, verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    select count(*) as unread_count
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_id <> auth.uid()
      and (rm.last_read_at is null or m.created_at > rm.last_read_at)
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

alter table public.conversation_participants drop column if exists last_read_at;
