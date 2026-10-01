-- AVORA-47 · Kết nối: nhịp sống (ADR-027, ADR-028).
--   A. Xem sau          → mark_unread_from(message_id): moves the caller's own read mark back.
--   B. Tắt từng cuộc    → mute_settings.conversation_id + scope 'conversation', always time-limited (≤ 25 h).
--   C. Chế độ tập trung → profiles.focus_mode / focus_until (own row only, RLS unchanged).
--   D. Cờ Khẩn          → messages.is_urgent + private.urgent_usage / urgent_locks, checked by trigger.
--   E. Đã nhận          → message_deliveries; written by the recipient via RPC, read only by the sender.
--   F. Lưu trữ          → conversation_archives (own rows only).
--   I. Thêm thành viên  → add_group_members (owner / admin, friends only, capacity 300).
-- One mute rule: private.mute_decide() is the pure decision; shouldBlockNotification (lib/mute.ts) is
-- tested against its full matrix.

-- ---------------------------------------------------------------- B. per-conversation mute
alter table public.mute_settings
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

alter table public.mute_settings drop constraint if exists mute_settings_scope_valid;
alter table public.mute_settings add constraint mute_settings_scope_valid
  check (scope = any (array['avora', 'messages', 'direct', 'group', 'project', 'conversation']));
alter table public.mute_settings drop constraint if exists mute_settings_conversation_shape;
alter table public.mute_settings add constraint mute_settings_conversation_shape
  check ((scope = 'conversation') = (conversation_id is not null));

alter table public.mute_settings drop constraint if exists mute_settings_pkey;
alter table public.mute_settings drop constraint if exists mute_settings_unique;
alter table public.mute_settings add constraint mute_settings_unique
  unique nulls not distinct (user_id, scope, conversation_id);

create or replace function private.mute_settings_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A conversation mute always ends: the longest choice is "Hết hôm nay".
  if new.scope = 'conversation' and new.muted_until > now() + interval '25 hours' then
    raise exception 'avora_mute_too_long';
  end if;
  return new;
end $$;
revoke all on function private.mute_settings_guard() from public, anon, authenticated;
drop trigger if exists mute_settings_guard on public.mute_settings;
create trigger mute_settings_guard before insert or update on public.mute_settings
  for each row execute function private.mute_settings_guard();

drop policy if exists mute_settings_insert_own on public.mute_settings;
create policy mute_settings_insert_own on public.mute_settings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (conversation_id is null or private.is_conversation_participant(conversation_id, (select auth.uid())))
  );

create or replace function public.set_conversation_mute(p_conversation_id uuid, p_until timestamptz)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if p_until <= now() then raise exception 'avora_mute_in_past'; end if;
  insert into mute_settings (user_id, scope, conversation_id, muted_until)
  values (v_uid, 'conversation', p_conversation_id, p_until)
  on conflict (user_id, scope, conversation_id) do update set muted_until = excluded.muted_until;
  return p_until;
end $$;
revoke all on function public.set_conversation_mute(uuid, timestamptz) from public, anon;
grant execute on function public.set_conversation_mute(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------- C. focus mode
alter table public.profiles add column if not exists focus_mode text;
alter table public.profiles add column if not exists focus_until timestamptz;
alter table public.profiles drop constraint if exists profiles_focus_mode_valid;
alter table public.profiles add constraint profiles_focus_mode_valid
  check (focus_mode is null or focus_mode = any (array['quiet', 'disconnect']));
grant update (focus_mode, focus_until) on public.profiles to authenticated;

-- ---------------------------------------------------------------- the one mute rule
-- Strongest first: Tắt toàn AVORA (nothing passes) → Gia đình / Khẩn pass everything below →
-- Chế độ tập trung → Tắt tin nhắn → Tắt cuộc / loại cuộc (in a group, being named passes).
create or replace function private.mute_decide(
  p_avora boolean, p_focus text, p_messages boolean, p_conversation boolean, p_tab boolean,
  p_surface text, p_family boolean, p_mention boolean, p_urgent boolean)
returns boolean language sql immutable set search_path = pg_temp as $$
  select case
    when p_avora then true
    when p_family or p_urgent then false
    when p_focus is not null then true
    when p_messages then true
    when p_conversation or p_tab then not (p_surface = 'group' and p_mention)
    else false
  end
$$;
revoke all on function private.mute_decide(boolean, text, boolean, boolean, boolean, text, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function private.push_mute_blocks(
  p_user uuid, p_surface text, p_conversation uuid, p_from_family boolean, p_mentions boolean,
  p_urgent boolean, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select private.mute_decide(
    exists (select 1 from mute_settings where user_id = p_user and scope = 'avora' and muted_until > p_now),
    (select pr.focus_mode from profiles pr where pr.id = p_user and pr.focus_mode is not null
       and (pr.focus_until is null or pr.focus_until > p_now)),
    exists (select 1 from mute_settings where user_id = p_user and scope = 'messages' and muted_until > p_now),
    exists (select 1 from mute_settings where user_id = p_user and scope = 'conversation'
              and conversation_id = p_conversation and muted_until > p_now),
    exists (select 1 from mute_settings where user_id = p_user and scope = p_surface and muted_until > p_now),
    p_surface, p_from_family, p_mentions, p_urgent)
$$;
revoke all on function private.push_mute_blocks(uuid, text, uuid, boolean, boolean, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- D. urgent flag
alter table public.messages add column if not exists is_urgent boolean not null default false;
grant insert (is_urgent) on public.messages to authenticated;

create table if not exists private.urgent_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  used_at timestamptz not null default now()
);
create index if not exists urgent_usage_user_idx on private.urgent_usage (user_id, used_at desc);
create table if not exists private.urgent_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  locked_until timestamptz not null
);
create index if not exists urgent_locks_user_idx on private.urgent_locks (user_id, locked_until desc);
revoke all on private.urgent_usage, private.urgent_locks from public, anon, authenticated;

create or replace function private.urgent_state(p_user uuid, p_conversation uuid)
returns table (used_today boolean, locked_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with tz as (select coalesce((select timezone from profiles where id = p_user), 'Asia/Ho_Chi_Minh') as z)
  select
    exists (
      select 1 from private.urgent_usage u, tz
      where u.user_id = p_user and u.conversation_id = p_conversation
        and u.used_at >= (date_trunc('day', now() at time zone tz.z) at time zone tz.z)
    ),
    (select max(l.locked_until) from private.urgent_locks l where l.user_id = p_user and l.locked_until > now())
$$;
revoke all on function private.urgent_state(uuid, uuid) from public, anon, authenticated;

create or replace function private.enforce_urgent_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state record;
  v_since timestamptz;
  v_count int;
  v_first timestamptz;
begin
  if not new.is_urgent then return new; end if;
  if (select type from conversations where id = new.conversation_id) = 'personal' then
    raise exception 'avora_urgent_not_here';
  end if;
  perform pg_advisory_xact_lock(hashtext('avora_urgent:' || new.sender_id::text));
  select * into v_state from private.urgent_state(new.sender_id, new.conversation_id);
  if v_state.locked_until is not null then raise exception 'avora_urgent_locked'; end if;
  if v_state.used_today then raise exception 'avora_urgent_daily_limit'; end if;

  insert into private.urgent_usage (user_id, conversation_id) values (new.sender_id, new.conversation_id);

  -- A chain starts fresh after the last lock ended; 3 uses inside 7 days lock for 7 days from the first.
  v_since := greatest(now() - interval '7 days',
    coalesce((select max(locked_until) from private.urgent_locks where user_id = new.sender_id), '-infinity'::timestamptz));
  select count(*), min(used_at) into v_count, v_first
    from private.urgent_usage where user_id = new.sender_id and used_at > v_since;
  if v_count >= 3 then
    insert into private.urgent_locks (user_id, locked_until) values (new.sender_id, v_first + interval '7 days');
  end if;
  return new;
end $$;
revoke all on function private.enforce_urgent_message() from public, anon, authenticated;
drop trigger if exists messages_enforce_urgent on public.messages;
create trigger messages_enforce_urgent before insert on public.messages
  for each row when (new.is_urgent) execute function private.enforce_urgent_message();

create or replace function public.urgent_status(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_state record;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  select * into v_state from private.urgent_state(v_uid, p_conversation_id);
  return jsonb_build_object('used_today', v_state.used_today, 'locked_until', v_state.locked_until);
end $$;
revoke all on function public.urgent_status(uuid) from public, anon;
grant execute on function public.urgent_status(uuid) to authenticated;

-- Push: the queue now knows the conversation and the urgent flag.
create or replace function private.enqueue_message_push()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_surface text; v_pending boolean;
begin
  if new.system_kind is not null or new.deleted_at is not null then return null; end if;
  v_surface := private.push_surface(new.conversation_id);
  if v_surface is null then return null; end if;
  select verification_status = 'pending' into v_pending from conversations where id = new.conversation_id;
  insert into push_outbox (user_id, kind, conversation_id, message_id, send_after)
  select cp.user_id, case when coalesce(v_pending, false) then 'friend_request' else 'message' end,
         new.conversation_id, new.id, now() + interval '20 seconds'
  from conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id
    and exists (select 1 from push_subscriptions s where s.user_id = cp.user_id)
    and not private.is_blocked_between(cp.user_id, new.sender_id)
    and not private.push_mute_blocks(cp.user_id, v_surface, new.conversation_id,
          exists (select 1 from family_relations f where f.user_id = cp.user_id and f.related_user_id = new.sender_id),
          cp.user_id = any (coalesce(new.mentioned_user_ids, '{}')),
          new.is_urgent);
  return null;
exception when others then
  -- A notification must never stop a message from being sent.
  raise warning 'avora_push_enqueue_failed';
  return null;
end $$;

drop function if exists private.push_mute_blocks(uuid, text, boolean, boolean, timestamptz);

-- ---------------------------------------------------------------- A. Xem sau
create or replace function public.mark_unread_from(p_message_id uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_msg messages%rowtype;
  v_mark timestamptz;
begin
  if v_uid is null then raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000'; end if;
  select * into v_msg from messages where id = p_message_id;
  if v_msg.id is null or not private.is_conversation_participant(v_msg.conversation_id, v_uid) then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  -- Just before that message: it and everything after it count as unread again. Only the
  -- caller's own mark moves; nothing reaches the sender.
  v_mark := v_msg.created_at - interval '1 microsecond';
  insert into conversation_read_marks as r (conversation_id, user_id, last_read_at)
  values (v_msg.conversation_id, v_uid, v_mark)
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_mark;
end $$;
revoke all on function public.mark_unread_from(uuid) from public, anon;
grant execute on function public.mark_unread_from(uuid) to authenticated;

-- ---------------------------------------------------------------- E. Đã nhận
create table if not exists public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_deliveries enable row level security;
revoke all on public.message_deliveries from public, anon, authenticated;
grant select on public.message_deliveries to authenticated;
drop policy if exists message_deliveries_sender_reads on public.message_deliveries;
create policy message_deliveries_sender_reads on public.message_deliveries for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and m.sender_id = (select auth.uid())));

create or replace function public.mark_messages_delivered(p_message_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  -- 1-1 only (a group never shows who is online), never one's own line, never across a block.
  insert into message_deliveries (message_id, user_id)
  select m.id, v_uid
  from messages m
  join conversations c on c.id = m.conversation_id and c.type = 'direct'
  where m.id = any (p_message_ids)
    and m.sender_id <> v_uid
    and m.system_kind is null
    and private.is_conversation_participant(m.conversation_id, v_uid)
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.mark_messages_delivered(uuid[]) from public, anon;
grant execute on function public.mark_messages_delivered(uuid[]) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.message_deliveries;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- F. archive
create table if not exists public.conversation_archives (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_archives enable row level security;
revoke all on public.conversation_archives from public, anon, authenticated;
grant select, insert, update (archived_at), delete on public.conversation_archives to authenticated;
drop policy if exists conversation_archives_own_select on public.conversation_archives;
create policy conversation_archives_own_select on public.conversation_archives for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists conversation_archives_own_insert on public.conversation_archives;
create policy conversation_archives_own_insert on public.conversation_archives for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_conversation_participant(conversation_id, (select auth.uid()))
    and (select type from public.conversations where id = conversation_id) <> 'personal'
  );
drop policy if exists conversation_archives_own_update on public.conversation_archives;
create policy conversation_archives_own_update on public.conversation_archives for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists conversation_archives_own_delete on public.conversation_archives;
create policy conversation_archives_own_delete on public.conversation_archives for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- I. add members from friends
alter table public.messages drop constraint if exists messages_system_kind_check;
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%system_kind%';
  if v_name is not null then execute format('alter table public.messages drop constraint %I', v_name); end if;
end $$;
alter table public.messages add constraint messages_system_kind_check check (
  system_kind is null or system_kind = any (array['project_deleted', 'proposal_opened', 'proposal_approved',
    'proposal_rejected', 'proposal_expired', 'proposal_withdrawn', 'shared_restored', 'recall_expired', 'member_added']));

create or replace function public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_person uuid;
  v_added uuid[] := '{}';
  v_names text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_user_ids, 1) > 50 then raise exception 'avora_too_many'; end if;
  if not exists (select 1 from conversations where id = p_conversation_id and type = 'group' and deleted_at is null) then
    raise exception 'avora_not_a_group';
  end if;
  select role into v_role from conversation_participants where conversation_id = p_conversation_id and user_id = v_uid;
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'avora_group_add_forbidden'; end if;

  foreach v_person in array p_user_ids loop
    if v_person = v_uid or private.is_conversation_participant(p_conversation_id, v_person) then continue; end if;
    if not private.are_connected(v_uid, v_person) or private.is_blocked_between(v_uid, v_person) then
      raise exception 'avora_group_add_not_friend';
    end if;
    -- The capacity trigger (300) raises avora_group_full and undoes the whole call.
    insert into conversation_participants (conversation_id, user_id, role) values (p_conversation_id, v_person, 'member');
    v_added := v_added || v_person;
  end loop;

  if array_length(v_added, 1) > 0 then
    select string_agg(private.push_display_name(x), ', ') into v_names from unnest(v_added) x;
    insert into messages (conversation_id, sender_id, content, system_kind)
    values (p_conversation_id, v_uid, private.push_display_name(v_uid) || ' đã thêm ' || v_names, 'member_added');
  end if;
  return coalesce(array_length(v_added, 1), 0);
end $$;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
