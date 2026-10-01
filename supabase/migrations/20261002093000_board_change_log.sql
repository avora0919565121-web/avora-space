-- AVORA-62 · Báo nhóm thay đổi Bảng chung (ADR-039).
-- Edits take effect at once and quietly; they are logged here. The editor announces them in one
-- card when they choose; only people whose Hạng mục were touched (or who are @-named) get a push.

-- ---------------------------------------------------------------- settings on the board
alter table public.think_hub_table add column if not exists announce_who text not null default 'members';
alter table public.think_hub_table add column if not exists announce_mode text not null default 'manual';
alter table public.think_hub_table drop constraint if exists think_hub_table_announce_who_valid;
alter table public.think_hub_table add constraint think_hub_table_announce_who_valid check (announce_who in ('members', 'admins'));
alter table public.think_hub_table drop constraint if exists think_hub_table_announce_mode_valid;
alter table public.think_hub_table add constraint think_hub_table_announce_mode_valid check (announce_mode in ('manual', 'daily', 'silent'));
revoke all (announce_who, announce_mode) on public.think_hub_table from anon;
grant select (announce_who, announce_mode) on public.think_hub_table to authenticated;

-- ---------------------------------------------------------------- the log
create table if not exists public.think_hub_change_log (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('record_add', 'record_edit', 'record_delete', 'column_add', 'column_edit', 'column_delete')),
  record_id uuid references public.think_hub_record(id) on delete cascade,
  column_id text,
  -- Who made the Hạng mục touched (null for column changes): the person a change "belongs" to.
  record_owner_id uuid references auth.users(id) on delete set null,
  record_title text,
  cells integer not null default 1 check (cells >= 0),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  announced_at timestamptz,
  announcement_id uuid,
  nudged_at timestamptz
);
create index if not exists think_hub_change_log_table_idx on public.think_hub_change_log (table_id, created_at desc);
create index if not exists think_hub_change_log_pending_idx on public.think_hub_change_log (table_id, actor_id) where announced_at is null;
alter table public.think_hub_change_log enable row level security;
drop policy if exists think_hub_change_log_select on public.think_hub_change_log;
create policy think_hub_change_log_select on public.think_hub_change_log for select to authenticated
  using (private.think_hub_table_visible(table_id, (select auth.uid())));
revoke all on public.think_hub_change_log from public, anon, authenticated;
grant select on public.think_hub_change_log to authenticated;

-- One card per announcement (and per shared board created), so the chat can draw it.
create table if not exists public.think_hub_announcements (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('update', 'digest', 'created')),
  change_ids uuid[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 500),
  notified_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists think_hub_announcements_message_idx on public.think_hub_announcements (message_id);
create index if not exists think_hub_announcements_recent_idx on public.think_hub_announcements (table_id, actor_id, updated_at desc);
alter table public.think_hub_announcements enable row level security;
drop policy if exists think_hub_announcements_select on public.think_hub_announcements;
create policy think_hub_announcements_select on public.think_hub_announcements for select to authenticated
  using (private.think_hub_table_visible(table_id, (select auth.uid())));
revoke all on public.think_hub_announcements from public, anon, authenticated;
grant select on public.think_hub_announcements to authenticated;

-- When each person last opened a board.
create table if not exists public.think_hub_table_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, table_id)
);
alter table public.think_hub_table_seen enable row level security;
drop policy if exists think_hub_table_seen_own on public.think_hub_table_seen;
create policy think_hub_table_seen_own on public.think_hub_table_seen for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.think_hub_table_seen from public, anon, authenticated;
grant select on public.think_hub_table_seen to authenticated;

-- The 24-hour safety net: a private line to the person whose Hạng mục was changed unannounced.
create table if not exists public.think_hub_nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  record_id uuid references public.think_hub_record(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 400),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists think_hub_nudges_user_idx on public.think_hub_nudges (user_id, created_at desc);
alter table public.think_hub_nudges enable row level security;
drop policy if exists think_hub_nudges_own on public.think_hub_nudges;
create policy think_hub_nudges_own on public.think_hub_nudges for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.think_hub_nudges from public, anon, authenticated;
grant select on public.think_hub_nudges to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function private.think_hub_is_shared(p_table_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select t.conversation_id is not null or t.project_id is not null from think_hub_table t where t.id = p_table_id), false)
$function$;
revoke all on function private.think_hub_is_shared(uuid) from public, anon;

-- ---------------------------------------------------------------- write the log (records)
create or replace function private.log_think_hub_record_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_cells integer := 0;
  v_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null or not private.think_hub_is_shared(new.table_id) then return null; end if;

  if tg_op = 'INSERT' then
    insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, after)
    values (new.table_id, v_actor, 'record_add', new.id, new.owner_user_id, new.title, 1, jsonb_build_object('title', new.title));
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, before)
    values (new.table_id, v_actor, 'record_delete', new.id, new.owner_user_id, new.title, 1, jsonb_build_object('title', old.title));
    return null;
  end if;
  if old.deleted_at is not null then return null; end if;

  -- Only what a reader sees counts; bookkeeping columns do not.
  v_old := jsonb_build_object('title', old.title, 'status', old.status, 'priority', old.priority, 'category', old.category,
    'next_action_date', old.next_action_date, 'tags', to_jsonb(old.tags), 'notes', old.notes, 'remind_at', old.remind_at);
  v_new := jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority, 'category', new.category,
    'next_action_date', new.next_action_date, 'tags', to_jsonb(new.tags), 'notes', new.notes, 'remind_at', new.remind_at);
  for v_key in select jsonb_object_keys(v_new) loop
    if (v_old->v_key) is distinct from (v_new->v_key) then
      v_before := v_before || jsonb_build_object(v_key, v_old->v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new->v_key);
      v_cells := v_cells + 1;
    end if;
  end loop;
  for v_key in
    select k from jsonb_object_keys(coalesce(old.extension_fields, '{}'::jsonb) || coalesce(new.extension_fields, '{}'::jsonb)) k
  loop
    if nullif(coalesce(old.extension_fields, '{}'::jsonb)->v_key, 'null'::jsonb) is distinct from nullif(coalesce(new.extension_fields, '{}'::jsonb)->v_key, 'null'::jsonb) then
      v_before := v_before || jsonb_build_object('ext:' || v_key, coalesce(old.extension_fields->v_key, 'null'::jsonb));
      v_after := v_after || jsonb_build_object('ext:' || v_key, coalesce(new.extension_fields->v_key, 'null'::jsonb));
      v_cells := v_cells + 1;
    end if;
  end loop;
  if v_cells = 0 then return null; end if;

  insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, before, after)
  values (new.table_id, v_actor, 'record_edit', new.id, new.owner_user_id, new.title, v_cells, v_before, v_after);
  return null;
exception when others then
  -- The log must never stop an edit.
  raise warning 'avora_board_log_failed';
  return null;
end;
$function$;
revoke all on function private.log_think_hub_record_change() from public, anon, authenticated;

drop trigger if exists trg_think_hub_record_log on public.think_hub_record;
create trigger trg_think_hub_record_log after insert or update on public.think_hub_record
  for each row execute function private.log_think_hub_record_change();

-- ---------------------------------------------------------------- write the log (columns)
create or replace function private.log_think_hub_column_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null or (new.conversation_id is null and new.project_id is null) then return null; end if;
  if old.column_defs is not distinct from new.column_defs then return null; end if;
  for v_new in select d from jsonb_array_elements(new.column_defs) d loop
    select d into v_old from jsonb_array_elements(old.column_defs) d where d->>'id' = v_new->>'id';
    if v_old is null then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, after) values (new.id, v_actor, 'column_add', v_new->>'id', v_new);
    elsif (v_old - 'width') is distinct from (v_new - 'width') then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, before, after) values (new.id, v_actor, 'column_edit', v_new->>'id', v_old, v_new);
    end if;
  end loop;
  for v_old in select d from jsonb_array_elements(old.column_defs) d loop
    if not exists (select 1 from jsonb_array_elements(new.column_defs) d where d->>'id' = v_old->>'id') then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, before) values (new.id, v_actor, 'column_delete', v_old->>'id', v_old);
    end if;
  end loop;
  return null;
exception when others then
  raise warning 'avora_board_log_failed';
  return null;
end;
$function$;
revoke all on function private.log_think_hub_column_change() from public, anon, authenticated;

drop trigger if exists trg_think_hub_table_column_log on public.think_hub_table;
create trigger trg_think_hub_table_column_log after update of column_defs on public.think_hub_table
  for each row execute function private.log_think_hub_column_change();

-- ---------------------------------------------------------------- summary words
create or replace function private.board_change_summary(p_ids uuid[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'added', count(*) filter (where kind = 'record_add'),
    'cells', coalesce(sum(cells) filter (where kind = 'record_edit'), 0),
    'deleted', count(*) filter (where kind = 'record_delete'),
    'columns', count(*) filter (where kind like 'column_%'),
    'total', count(*) filter (where kind <> 'record_edit') + coalesce(sum(cells) filter (where kind = 'record_edit'), 0))
  from think_hub_change_log where id = any (p_ids)
$function$;
revoke all on function private.board_change_summary(uuid[]) from public, anon;

create or replace function private.board_summary_words(p jsonb)
 returns text
 language sql
 immutable
 set search_path to 'pg_temp'
as $function$
  select coalesce(nullif(array_to_string(array_remove(array[
    case when (p->>'added')::int > 0 then format('Thêm %s Hạng mục', p->>'added') end,
    case when (p->>'cells')::int > 0 then format('Sửa %s ô', p->>'cells') end,
    case when (p->>'deleted')::int > 0 then format('Xoá %s Hạng mục', p->>'deleted') end,
    case when (p->>'columns')::int > 0 then format('Đổi %s cột', p->>'columns') end
  ], null), ' · '), ''), 'Không có thay đổi mới')
$function$;
revoke all on function private.board_summary_words(jsonb) from public, anon;

-- ---------------------------------------------------------------- a push for one person, if they let it through
create or replace function private.board_push(p_user uuid, p_conversation uuid, p_table_id uuid, p_title text, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_surface text := case when p_conversation is null then 'group' else private.push_surface(p_conversation) end;
begin
  -- Never Khẩn; a muted conversation, Tắt thông báo or Chế độ tập trung all hold it back.
  if p_conversation is not null and private.push_mute_blocks(p_user, coalesce(v_surface, 'group'), p_conversation, false, false, false) then return; end if;
  if p_conversation is null and private.push_mute_blocks(p_user, 'group', '00000000-0000-0000-0000-000000000000'::uuid, false, false, false) then return; end if;
  insert into push_outbox (user_id, kind, conversation_id, payload, send_after)
  values (p_user, 'board', p_conversation,
    jsonb_build_object('title', left(p_title, 80), 'body', left(p_body, 160), 'table_id', p_table_id,
      'url', '/ke-hoach?bang=' || p_table_id || '&thay-doi=1'),
    now());
end;
$function$;
revoke all on function private.board_push(uuid, uuid, uuid, text, text) from public, anon, authenticated;

alter table public.push_outbox drop constraint if exists push_outbox_kind;
alter table public.push_outbox add constraint push_outbox_kind check (kind = any (array['message', 'friend_request', 'reminder', 'security', 'board']));

-- ---------------------------------------------------------------- Báo nhóm
create or replace function public.announce_think_hub_changes(p_table_id uuid, p_note text default null, p_notify uuid[] default '{}', p_mentions uuid[] default '{}')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_conv uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_new uuid[];
  v_recent think_hub_announcements%rowtype;
  v_all uuid[];
  v_summary jsonb;
  v_content text;
  v_msg uuid;
  v_ann uuid;
  v_target uuid;
  v_targets uuid[];
  v_name text;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'avora_board_note_too_long'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  if v_conv is null then raise exception 'avora_board_not_shared'; end if;
  if not private.is_conversation_participant(v_conv, v_user) or not private.conversation_is_live(v_conv) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_table.announce_mode = 'silent' then raise exception 'avora_board_announce_off'; end if;
  if v_table.announce_who = 'admins' and v_table.owner_user_id <> v_user
     and not exists (select 1 from conversation_participants cp where cp.conversation_id = v_conv and cp.user_id = v_user and cp.role in ('owner', 'admin')) then
    raise exception 'avora_board_announce_not_allowed';
  end if;

  select coalesce(array_agg(id order by created_at), '{}') into v_new
  from think_hub_change_log where table_id = p_table_id and actor_id = v_user and announced_at is null;

  -- Within two hours the same editor updates their last card instead of adding one.
  select * into v_recent from think_hub_announcements
  where table_id = p_table_id and actor_id = v_user and kind = 'update' and updated_at > now() - interval '2 hours'
    and message_id is not null
  order by updated_at desc limit 1;

  if coalesce(array_length(v_new, 1), 0) = 0 and v_recent.id is null then raise exception 'avora_board_nothing_to_announce'; end if;

  v_all := coalesce(v_recent.change_ids, '{}') || v_new;
  v_summary := private.board_change_summary(v_all);
  v_name := private.public_name(v_user);
  v_content := format('%s cập nhật Bảng "%s" · %s', v_name, v_table.name, private.board_summary_words(v_summary))
    || case when v_note is not null then ' · ' || v_note else '' end;

  if v_recent.id is not null then
    update messages set content = left(v_content, 4000), created_at = now() where id = v_recent.message_id;
    update think_hub_announcements
      set change_ids = v_all, summary = v_summary, note = coalesce(v_note, note), updated_at = now()
    where id = v_recent.id;
    v_ann := v_recent.id;
    v_msg := v_recent.message_id;
  else
    v_msg := private.post_system_line(v_conv, v_user, 'board_update', v_content);
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind, change_ids, summary, note)
    values (p_table_id, v_conv, v_msg, v_user, 'update', v_all, v_summary, v_note)
    returning id into v_ann;
  end if;
  update think_hub_change_log set announced_at = now(), announcement_id = v_ann where id = any (v_new);

  -- Only the people chosen (owners of the Hạng mục touched, by default) and the @-named get a push.
  select coalesce(array_agg(distinct u), '{}') into v_targets
  from unnest(coalesce(p_notify, '{}') || coalesce(p_mentions, '{}')) u
  where u <> v_user and private.is_conversation_participant(v_conv, u) and not private.is_blocked_between(u, v_user);
  foreach v_target in array v_targets loop
    perform private.board_push(v_target, v_conv, p_table_id, format('Bảng "%s"', v_table.name),
      format('%s cập nhật · %s', v_name, private.board_summary_words(v_summary)));
  end loop;
  update think_hub_announcements set notified_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(notified_ids || v_targets) x) where id = v_ann;
  return v_msg;
end;
$function$;

-- ---------------------------------------------------------------- opened a board: remember when, say what was there before
create or replace function public.mark_think_hub_table_seen(p_table_id uuid)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid := auth.uid(); v_prev timestamptz;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  select seen_at into v_prev from think_hub_table_seen where user_id = v_user and table_id = p_table_id;
  insert into think_hub_table_seen (user_id, table_id, seen_at) values (v_user, p_table_id, now())
  on conflict (user_id, table_id) do update set seen_at = excluded.seen_at;
  return v_prev;
end;
$function$;

-- ---------------------------------------------------------------- the owner's choices
create or replace function public.set_think_hub_announce_settings(p_table_id uuid, p_who text, p_mode text)
 returns think_hub_table
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_who not in ('members', 'admins') or p_mode not in ('manual', 'daily', 'silent') then raise exception 'avora_board_settings_invalid'; end if;
  update think_hub_table set announce_who = p_who, announce_mode = p_mode
  where id = p_table_id and owner_user_id = v_user and deleted_at is null
    and (conversation_id is not null or project_id is not null)
  returning * into v_row;
  if not found then raise exception 'avora_think_hub_table_not_yours'; end if;
  return v_row;
end;
$function$;

create or replace function public.dismiss_think_hub_nudge(p_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  update think_hub_nudges set seen_at = now() where id = p_id and user_id = auth.uid();
$function$;

-- ---------------------------------------------------------------- a shared board is born: one quiet line
create or replace function private.announce_board_created()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_conv uuid; v_msg uuid;
begin
  if new.parent_record_id is not null or (new.conversation_id is null and new.project_id is null) then return null; end if;
  v_conv := coalesce(new.conversation_id, (select pr.conversation_id from projects pr where pr.id = new.project_id));
  if v_conv is null then return null; end if;
  v_msg := private.post_system_line(v_conv, new.owner_user_id, 'board_created',
    format('%s tạo Bảng "%s"', private.public_name(new.owner_user_id), new.name));
  insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind)
  values (new.id, v_conv, v_msg, new.owner_user_id, 'created');
  return null;
exception when others then
  raise warning 'avora_board_created_line_failed';
  return null;
end;
$function$;
revoke all on function private.announce_board_created() from public, anon, authenticated;
drop trigger if exists trg_think_hub_table_created_line on public.think_hub_table;
create trigger trg_think_hub_table_created_line after insert on public.think_hub_table
  for each row execute function private.announce_board_created();

-- ---------------------------------------------------------------- hourly: 24 h safety net, 18:00 digest, 90-day retention
create or replace function private.board_hourly()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare g record; v_ids uuid[]; v_summary jsonb; v_msg uuid; v_ann uuid; v_text text;
begin
  -- Safety net: someone changed MY Hạng mục and never said so — a private line to me only.
  for g in
    select l.record_owner_id as owner_id, l.actor_id, l.table_id, l.record_id, max(l.record_title) as title,
           array_agg(l.id) as ids, max(t.name) as table_name
    from think_hub_change_log l join think_hub_table t on t.id = l.table_id
    where l.announced_at is null and l.nudged_at is null and l.created_at < now() - interval '24 hours'
      and l.record_owner_id is not null and l.record_owner_id <> l.actor_id and t.deleted_at is null
      and private.think_hub_table_visible(l.table_id, l.record_owner_id)
    group by l.record_owner_id, l.actor_id, l.table_id, l.record_id
  loop
    v_text := format('%s đã %s "%s" trong Bảng %s', private.public_name(g.actor_id),
      case when exists (select 1 from think_hub_change_log where id = any (g.ids) and kind = 'record_delete') then 'xoá' else 'sửa' end,
      coalesce(g.title, 'Hạng mục'), g.table_name);
    insert into think_hub_nudges (user_id, table_id, record_id, actor_id, content)
    values (g.owner_id, g.table_id, g.record_id, g.actor_id, left(v_text, 400));
    perform private.board_push(g.owner_id, null, g.table_id, 'Kế hoạch', v_text);
    update think_hub_change_log set nudged_at = now() where id = any (g.ids);
  end loop;

  -- Tóm tắt cuối ngày: at 18:00 in the owner's own time, one card for everyone's unannounced changes.
  for g in
    select t.id, t.name, t.owner_user_id,
           coalesce(t.conversation_id, (select pr.conversation_id from projects pr where pr.id = t.project_id)) as conv
    from think_hub_table t join profiles p on p.id = t.owner_user_id
    where t.deleted_at is null and t.announce_mode = 'daily'
      and extract(hour from now() at time zone coalesce(p.timezone, 'Asia/Ho_Chi_Minh')) = 18
      and exists (select 1 from think_hub_change_log l where l.table_id = t.id and l.announced_at is null)
  loop
    if g.conv is null or not private.conversation_is_live(g.conv) then continue; end if;
    select array_agg(id) into v_ids from think_hub_change_log where table_id = g.id and announced_at is null;
    v_summary := private.board_change_summary(v_ids);
    v_msg := private.post_system_line(g.conv, g.owner_user_id, 'board_update',
      format('Tóm tắt cuối ngày · Bảng "%s" · %s', g.name, private.board_summary_words(v_summary)));
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind, change_ids, summary)
    values (g.id, g.conv, v_msg, g.owner_user_id, 'digest', v_ids, v_summary) returning id into v_ann;
    update think_hub_change_log set announced_at = now(), announcement_id = v_ann where id = any (v_ids);
  end loop;

  delete from think_hub_change_log where created_at < now() - interval '90 days';
  delete from think_hub_nudges where created_at < now() - interval '90 days';
end;
$function$;
revoke all on function private.board_hourly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'avora_board_hourly') then perform cron.unschedule('avora_board_hourly'); end if;
  perform cron.schedule('avora_board_hourly', '3 * * * *', 'select private.board_hourly()');
end $$;

revoke all on function public.announce_think_hub_changes(uuid, text, uuid[], uuid[]) from public, anon;
revoke all on function public.mark_think_hub_table_seen(uuid) from public, anon;
revoke all on function public.set_think_hub_announce_settings(uuid, text, text) from public, anon;
revoke all on function public.dismiss_think_hub_nudge(uuid) from public, anon;
grant execute on function public.announce_think_hub_changes(uuid, text, uuid[], uuid[]) to authenticated;
grant execute on function public.mark_think_hub_table_seen(uuid) to authenticated;
grant execute on function public.set_think_hub_announce_settings(uuid, text, text) to authenticated;
grant execute on function public.dismiss_think_hub_nudge(uuid) to authenticated;
