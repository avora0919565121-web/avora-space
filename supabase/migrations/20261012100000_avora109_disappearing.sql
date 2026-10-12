-- AVORA-109 · PHẦN B — Tin tự biến mất, có dấu vết (VMT 09/10).
-- Per conversation (1-1 and Nhóm, never Nhật ký): Tắt · 1 giờ · 24 giờ · 7 ngày · 30 ngày.
--  * 1-1: turning on / changing is a proposal the other person accepts (3 days); turning off is immediate.
--  * Nhóm: owners / admins only (same gate as set_conversation_appearance); everyone sees a system line.
-- expires_at is set by the server when a message is created (client cannot send it); the sweep
-- (every minute, idempotent) empties the content, files, reactions, pins and receipts, and keeps the
-- row (sender, time sent, time gone) as a tombstone. Tasks / notes made from it keep their own text.

alter table public.conversations add column if not exists disappear_after_seconds integer;
alter table public.conversations drop constraint if exists conversations_disappear_after_check;
alter table public.conversations add constraint conversations_disappear_after_check
  check (disappear_after_seconds is null or disappear_after_seconds in (3600, 86400, 604800, 2592000));

alter table public.messages add column if not exists expires_at timestamptz;
alter table public.messages add column if not exists expired_at timestamptz;
create index if not exists messages_expiring on public.messages (expires_at) where expires_at is not null and expired_at is null;

alter table public.conversation_member_prefs add column if not exists hide_tombstones boolean not null default false;

alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (
  system_kind is null or system_kind = any (array[
    'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected', 'proposal_expired',
    'proposal_withdrawn', 'shared_restored', 'recall_expired', 'member_added', 'column_delete_requested',
    'board_update', 'board_created', 'board_shared', 'board_moved', 'member_left_task', 'appearance_changed',
    'disappear_changed', 'disappear_proposed'
  ]::text[])
);

alter table private.storage_delete_queue drop constraint if exists storage_delete_queue_reason_check;
alter table private.storage_delete_queue add constraint storage_delete_queue_reason_check
  check (reason = any (array['orphan', 'journal_trash', 'task_file', 'expired']::text[]));

-- The server, not the client, decides when a message disappears.
create or replace function private.set_message_expiry()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_seconds integer;
begin
  new.expired_at := null;
  new.expires_at := null;
  if new.system_kind is not null then return new; end if;
  select c.disappear_after_seconds into v_seconds
  from public.conversations c
  where c.id = new.conversation_id and c.type in ('direct', 'group');
  if v_seconds is not null then
    new.expires_at := coalesce(new.created_at, now()) + make_interval(secs => v_seconds);
  end if;
  return new;
end $$;
revoke execute on function private.set_message_expiry () from public, anon, authenticated;

drop trigger if exists messages_set_expiry on public.messages;
create trigger messages_set_expiry
  before insert on public.messages
  for each row execute function private.set_message_expiry ();

-- Nobody edits the clock afterwards except the sweep.
create or replace function private.keep_message_expiry()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if coalesce(current_setting('avora.expiring', true), '') <> '1' then
    new.expires_at := old.expires_at;
    new.expired_at := old.expired_at;
  end if;
  return new;
end $$;
revoke execute on function private.keep_message_expiry () from public, anon, authenticated;

drop trigger if exists messages_keep_expiry on public.messages;
create trigger messages_keep_expiry
  before update of expires_at, expired_at on public.messages
  for each row execute function private.keep_message_expiry ();

create table if not exists public.disappear_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  proposed_by uuid not null references auth.users (id) on delete cascade,
  seconds integer not null check (seconds in (3600, 86400, 604800, 2592000)),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired', 'withdrawn')),
  message_id uuid references public.messages (id) on delete set null,
  answered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint disappear_proposals_resolved check ((status = 'open') = (resolved_at is null))
);
create index if not exists disappear_proposals_conversation on public.disappear_proposals (conversation_id) where status = 'open';
create index if not exists disappear_proposals_proposed_by on public.disappear_proposals (proposed_by);
create index if not exists disappear_proposals_message on public.disappear_proposals (message_id);
create index if not exists disappear_proposals_answered_by on public.disappear_proposals (answered_by);

alter table public.disappear_proposals enable row level security;
revoke all on public.disappear_proposals from public, anon;
grant select on public.disappear_proposals to authenticated;
drop policy if exists disappear_proposals_session on public.disappear_proposals;
create policy disappear_proposals_session on public.disappear_proposals as restrictive for all to authenticated
  using (private.session_allowed ()) with check (private.session_allowed ());
drop policy if exists disappear_proposals_read on public.disappear_proposals;
create policy disappear_proposals_read on public.disappear_proposals for select to authenticated
  using (private.can_act_in (conversation_id, (select auth.uid ()), 'read'));

create or replace function private.disappear_label(p_seconds integer)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case p_seconds when 3600 then '1 giờ' when 86400 then '24 giờ' when 604800 then '7 ngày' when 2592000 then '30 ngày' end
$$;
revoke execute on function private.disappear_label (integer) from public, anon;

create or replace function private.disappear_line(p_conversation uuid, p_uid uuid, p_text text, p_kind text)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_name text; v_id uuid;
begin
  select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_name from public.profiles p where p.id = p_uid;
  insert into public.messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_uid, coalesce(v_name, 'Một thành viên') || ' ' || p_text, p_kind)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.disappear_line (uuid, uuid, text, text) from public, anon, authenticated;

-- 'applied' | 'proposed' | 'unchanged'
create or replace function public.set_disappear_timer(p_conversation_id uuid, p_seconds integer default null)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_type text; v_current integer; v_proposal uuid; v_msg uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_seconds is not null and p_seconds not in (3600, 86400, 604800, 2592000) then raise exception 'avora_disappear_invalid'; end if;
  -- Members who may send; Nhóm: owners / admins only (avora_not_admin); never Nhật ký.
  v_type := private.assert_can_style(p_conversation_id, v_uid);
  select c.disappear_after_seconds into v_current from public.conversations c where c.id = p_conversation_id for update;

  if v_type = 'direct' and p_seconds is not null then
    if p_seconds is not distinct from v_current then return 'unchanged'; end if;
    update public.disappear_proposals set status = 'withdrawn', resolved_at = now()
    where conversation_id = p_conversation_id and status = 'open';
    insert into public.disappear_proposals (conversation_id, proposed_by, seconds)
    values (p_conversation_id, v_uid, p_seconds) returning id into v_proposal;
    v_msg := private.disappear_line(p_conversation_id, v_uid,
      'đề nghị tin tự biến mất sau ' || private.disappear_label(p_seconds), 'disappear_proposed');
    update public.disappear_proposals set message_id = v_msg where id = v_proposal;
    return 'proposed';
  end if;

  -- Turning off (anyone, at once) or a Nhóm admin's change.
  if v_type = 'direct' then
    update public.disappear_proposals set status = 'withdrawn', resolved_at = now()
    where conversation_id = p_conversation_id and status = 'open';
  end if;
  if p_seconds is not distinct from v_current then return 'unchanged'; end if;
  update public.conversations set disappear_after_seconds = p_seconds where id = p_conversation_id;
  perform private.disappear_line(p_conversation_id, v_uid,
    case when p_seconds is null then 'đã tắt tin tự biến mất'
         else 'đã đặt tin tự biến mất sau ' || private.disappear_label(p_seconds) end, 'disappear_changed');
  return 'applied';
end $$;
revoke execute on function public.set_disappear_timer (uuid, integer) from public, anon;
grant execute on function public.set_disappear_timer (uuid, integer) to authenticated;

-- The other person in a 1-1 answers. Silence is not consent: after 3 days it simply expires.
create or replace function public.answer_disappear_proposal(p_proposal_id uuid, p_accept boolean)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_row public.disappear_proposals%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.disappear_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_not_found'; end if;
  perform private.assert_can_act_in(v_row.conversation_id, v_uid, 'send');
  if v_row.proposed_by = v_uid then raise exception 'avora_proposal_own'; end if;
  if v_row.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  if v_row.created_at < now() - interval '3 days' then
    update public.disappear_proposals set status = 'expired', resolved_at = now() where id = p_proposal_id;
    raise exception 'avora_proposal_closed';
  end if;
  if p_accept then
    update public.disappear_proposals set status = 'accepted', answered_by = v_uid, resolved_at = now() where id = p_proposal_id;
    update public.conversations set disappear_after_seconds = v_row.seconds where id = v_row.conversation_id;
    perform private.disappear_line(v_row.conversation_id, v_uid,
      'đã đồng ý: tin tự biến mất sau ' || private.disappear_label(v_row.seconds), 'disappear_changed');
    return 'accepted';
  end if;
  update public.disappear_proposals set status = 'declined', answered_by = v_uid, resolved_at = now() where id = p_proposal_id;
  perform private.disappear_line(v_row.conversation_id, v_uid, 'chưa đồng ý đổi tin tự biến mất', 'disappear_changed');
  return 'declined';
end $$;
revoke execute on function public.answer_disappear_proposal (uuid, boolean) from public, anon;
grant execute on function public.answer_disappear_proposal (uuid, boolean) to authenticated;

-- B4: each person tidies only their own screen.
create or replace function public.set_hide_tombstones(p_conversation_id uuid, p_value boolean)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, hide_tombstones)
  values (p_conversation_id, v_uid, coalesce(p_value, false))
  on conflict (conversation_id, user_id) do update set hide_tombstones = excluded.hide_tombstones, updated_at = now();
end $$;
revoke execute on function public.set_hide_tombstones (uuid, boolean) from public, anon;
grant execute on function public.set_hide_tombstones (uuid, boolean) to authenticated;

-- The sweep: safe to run again and again (only rows with expired_at null are touched).
create or replace function private.sweep_expired_messages()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_ids uuid[]; v_paths text[]; v_count integer := 0;
begin
  update public.disappear_proposals set status = 'expired', resolved_at = now()
  where status = 'open' and created_at < now() - interval '3 days';

  select array_agg(s.id) into v_ids from (
    select m.id from public.messages m
    where m.expires_at <= now() and m.expired_at is null
    order by m.expires_at
    limit 2000
    for update skip locked
  ) s;
  if v_ids is null then return 0; end if;

  select array_agg(distinct a.storage_path) into v_paths from public.message_attachments a where a.message_id = any (v_ids);
  delete from public.message_attachments where message_id = any (v_ids);
  -- A forwarded copy elsewhere keeps its file: only paths nothing points to any more are removed.
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', p, 'expired' from unnest(coalesce(v_paths, '{}')) p
  where not exists (select 1 from public.message_attachments a where a.storage_path = p)
  on conflict do nothing;
  delete from public.message_reactions where message_id = any (v_ids);
  delete from public.message_pins where message_id = any (v_ids);
  delete from public.message_deliveries where message_id = any (v_ids);
  delete from public.push_outbox where message_id = any (v_ids) and sent_at is null;

  perform set_config('avora.expiring', '1', true);
  update public.messages set
    content = '', forward_bundle = null, note_card = null, sticker_id = null, contact_card_user_id = null,
    refs = null, effect = null, mentioned_user_ids = '{}', attachment_count = 0, is_urgent = false,
    deleted_at = coalesce(deleted_at, now()), expired_at = now()
  where id = any (v_ids);
  get diagnostics v_count = row_count;
  perform set_config('avora.expiring', '', true);

  if coalesce(array_length(v_paths, 1), 0) > 0 then perform private.call_storage_sweep(); end if;
  return v_count;
end $$;
revoke execute on function private.sweep_expired_messages () from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('avora_sweep_expired_messages');
exception when others then null;
end $$;
select cron.schedule('avora_sweep_expired_messages', '* * * * *', 'select private.sweep_expired_messages()');

-- B2: previews and unread counts skip what has disappeared.
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
    -- B2: nothing left but what disappeared → `—`, not "no messages yet".
    coalesce(lm.content, case when exists (
      select 1 from public.messages mx where mx.conversation_id = c.id and mx.expired_at is not null
    ) then '—' end),
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
      -- AVORA-109 · B2: a message that has disappeared is no preview; the latest remaining one is.
      and m.expired_at is null and (m.expires_at is null or m.expires_at > now())
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
        -- AVORA-109 · B2: nor is it unread.
        and m.expired_at is null and (m.expires_at is null or m.expires_at > now())
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

-- B2: search never finds it.
CREATE OR REPLACE FUNCTION public.search_avora(p_query text, p_here jsonb, p_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(kind text, id uuid, title text, snippet text, place_kind text, place_id uuid, place_name text, conversation_id uuid, at timestamp with time zone, in_here boolean, scope text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_first text;
  v_like text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_tab text := coalesce(p_here->>'tab', '');
  v_here_conv uuid := nullif(p_here->>'conversation_id', '')::uuid;
  v_types text[] := coalesce(p_types, array['message', 'file', 'task', 'note', 'record', 'table', 'contact', 'conversation', 'habit']);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := left(v_q, 120);
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(public.f_unaccent(v_q), '\s+')) w where w <> '';
  if v_words is null then return; end if;
  select w into v_first from unnest(v_words) w order by char_length(w) desc limit 1;
  v_like := '%' || replace(replace(replace(v_first, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- messages (not recalled, not in the journal bin, not system lines)
  if 'message' = any (v_types) then
    return query
    select 'message'::text, m.id, null::text, left(m.content, 240), c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, m.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct'
                when exists (select 1 from projects p where p.conversation_id = c.id) then 'project' else 'group' end
    from messages m
    join conversations c on c.id = m.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where m.deleted_at is null and m.trashed_at is null and m.system_kind is null
      and (m.expires_at is null or m.expires_at > now())
      and public.f_unaccent(m.content) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(m.content) not like '%' || w || '%')
    order by m.created_at desc
    limit v_limit * 3;
  end if;

  if 'file' = any (v_types) then
    return query
    select 'file'::text, a.message_id, a.file_name, null::text, c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, a.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from message_attachments a
    join messages m on m.id = a.message_id and m.deleted_at is null and m.trashed_at is null
      and (m.expires_at is null or m.expires_at > now())
    join conversations c on c.id = a.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where public.f_unaccent(a.file_name) like v_like
    order by a.created_at desc
    limit v_limit * 2;
  end if;

  if 'task' = any (v_types) then
    return query
    select 'task'::text, t.id, t.title, left(coalesce(t.description, ''), 200),
           case when t.conversation_id is null then 'personal' else coalesce(c.type, 'personal') end,
           t.conversation_id, coalesce(g.name, case when t.conversation_id is null then 'Của tôi' when c.type = 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           t.conversation_id, t.updated_at,
           v_tab = 'nhiem-vu' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = t.conversation_id),
           case when t.type = 'personal' then 'personal' when t.type = '1-1-shared' then 'direct' else 'group' end
    from tasks t
    left join conversations c on c.id = t.conversation_id
    left join conversation_groups g on g.conversation_id = t.conversation_id
    where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) not like '%' || w || '%')
      and not (t.creator_id = v_uid and t.deleted_by_creator) and not (t.creator_id <> v_uid and t.deleted_by_peer)
    order by t.updated_at desc
    limit v_limit * 2;
  end if;

  if 'note' = any (v_types) then
    return query
    select 'note'::text, n.id, coalesce(nullif(btrim(n.title), ''), 'Ghi chép'), left(n.search_text, 200),
           'personal'::text, n.folder_id, coalesce(f.name, 'Chưa xếp'), null::uuid, n.updated_at,
           v_tab = 'nhat-ky', 'personal'::text
    from notes n
    left join note_folders f on f.id = n.folder_id
    where n.deleted_at is null and n.search_text like v_like
      and not exists (select 1 from unnest(v_words) w where n.search_text not like '%' || w || '%')
    order by n.updated_at desc
    limit v_limit * 2;
  end if;

  if 'record' = any (v_types) then
    return query
    select 'record'::text, r.id, r.title, case when r.archived_at is not null then 'Đã cất · ' else '' end || left(coalesce(r.notes, ''), 200),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, r.updated_at,
           v_tab = 'ke-hoach' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = tb.conversation_id),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_record r
    join think_hub_table tb on tb.id = r.table_id and tb.deleted_at is null
    left join conversations c on c.id = tb.conversation_id
    where r.deleted_at is null
      and public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) not like '%' || w || '%')
    order by r.updated_at desc
    limit v_limit * 2;
  end if;

  if 'table' = any (v_types) then
    return query
    select 'table'::text, tb.id, tb.name, coalesce(tb.purpose, ''),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, tb.updated_at, v_tab = 'ke-hoach',
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_table tb
    left join conversations c on c.id = tb.conversation_id
    where tb.deleted_at is null and public.f_unaccent(tb.name) like v_like
    order by tb.updated_at desc
    limit v_limit;
  end if;

  if 'contact' = any (v_types) then
    return query
    select 'contact'::text, ct.id, ct.name, null::text, 'contact'::text, ct.id, 'Liên hệ', null::uuid, ct.updated_at,
           v_tab = 'ket-noi' and v_here_conv is null, 'personal'::text
    from contact ct
    where public.f_unaccent(ct.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(ct.name) not like '%' || w || '%')
    order by ct.name
    limit v_limit;
  end if;

  if 'conversation' = any (v_types) then
    return query
    select 'conversation'::text, g.conversation_id, g.name, null::text, 'group'::text, g.conversation_id, g.name, g.conversation_id, g.updated_at,
           v_tab = 'ket-noi', 'group'::text
    from conversation_groups g
    join conversations c on c.id = g.conversation_id and c.deleted_at is null
    where public.f_unaccent(g.name) like v_like
    order by g.updated_at desc
    limit v_limit;
  end if;
  -- AVORA-107 · Thói quen: tìm được như Hạng mục (chỉ của mình — RLS chủ). Đã lưu trữ thì ghi rõ.
  if 'habit' = any (v_types) then
    return query
    select 'habit'::text, h.id, h.name,
           case when h.archived_at is not null then 'Đã lưu trữ' when h.paused_at is not null then 'Đang tạm nghỉ'
                when h.kind = 'timed' then 'Có đồng hồ · ' || h.target_minutes || ' phút' else 'Chỉ đánh dấu' end,
           'personal'::text, null::uuid, 'Thói quen', null::uuid, h.updated_at,
           v_tab = 'nhiem-vu', 'personal'::text
    from habits h
    where h.user_id = v_uid
      and public.f_unaccent(h.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(h.name) not like '%' || w || '%')
    order by h.archived_at nulls first, h.updated_at desc
    limit v_limit;
  end if;
end $function$;
