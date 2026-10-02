-- AVORA-69 (ADR-043): Di chuyển Bảng — one board lives in one place; a personal board moved into a
-- conversation is shared there. What belongs to the board goes with it (sub-tables, rows, columns,
-- cell files, change log, tasks raised from its rows); what belongs to a person stays theirs (★,
-- "Nhắc tôi xem lại", the private part of a task). Once others have contributed, moving it on is a
-- proposal (ADR-031), never one person's decision.

-- 1. "Nhắc tôi xem lại" is per person (it used to be one value on the row, reminding the row's owner).
create table if not exists public.think_hub_record_reminders (
  record_id  uuid not null references public.think_hub_record(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  remind_at  timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (record_id, user_id)
);
create index if not exists think_hub_record_reminders_user_idx on public.think_hub_record_reminders (user_id, remind_at);
alter table public.think_hub_record_reminders enable row level security;
revoke all on public.think_hub_record_reminders from public, anon, authenticated;
grant select on public.think_hub_record_reminders to authenticated;
drop policy if exists think_hub_record_reminders_own on public.think_hub_record_reminders;
create policy think_hub_record_reminders_own on public.think_hub_record_reminders for select to authenticated
  using (user_id = (select auth.uid()));

-- What was set so far belongs to the board's owner (the only one who could see it on a private board).
insert into public.think_hub_record_reminders (record_id, user_id, remind_at)
select r.id, t.owner_user_id, r.remind_at
from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
where r.remind_at is not null
on conflict do nothing;
update public.think_hub_record set remind_at = null where remind_at is not null;

-- 2. Cùng sửa / Chỉ xem.
alter table public.think_hub_table add column if not exists share_mode text not null default 'edit';
do $$ begin
  alter table public.think_hub_table add constraint think_hub_table_share_mode_check check (share_mode in ('edit', 'view'));
exception when duplicate_object then null; end $$;

-- 3. Chat lines and proposals that know about moving.
alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (system_kind is null or system_kind = any (array[
  'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected', 'proposal_expired', 'proposal_withdrawn',
  'shared_restored', 'recall_expired', 'member_added', 'column_delete_requested', 'board_update', 'board_created',
  'board_shared', 'board_moved']));
alter table public.think_hub_announcements drop constraint if exists think_hub_announcements_kind_check;
alter table public.think_hub_announcements add constraint think_hub_announcements_kind_check check (kind in ('update', 'digest', 'created', 'shared'));
alter table public.shared_proposals drop constraint if exists shared_proposals_action_check;
alter table public.shared_proposals add constraint shared_proposals_action_check check (action in ('delete', 'archive', 'reopen', 'move'));
alter table public.shared_proposals add column if not exists move_to_conversation uuid references public.conversations(id) on delete set null;
alter table public.shared_proposals add column if not exists move_mode text;

CREATE OR REPLACE FUNCTION private.validate_think_hub_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parent_table think_hub_table%ROWTYPE;
  v_conv_type text;
BEGIN
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  PERFORM private.validate_column_defs(NEW.column_defs);

  IF jsonb_array_length(NEW.column_defs) > 24 THEN
    RAISE EXCEPTION 'avora_think_hub_column_limit';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- AVORA-69: only move_board_tree changes where a board lives (it checks the destination itself).
    IF coalesce(current_setting('avora.board_move', true), '') = 'on' THEN
      IF NEW.owner_user_id <> OLD.owner_user_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.parent_record_id IS DISTINCT FROM OLD.parent_record_id OR NEW.depth <> OLD.depth THEN
        RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.owner_user_id <> OLD.owner_user_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       OR NEW.parent_record_id IS DISTINCT FROM OLD.parent_record_id
       OR NEW.depth <> OLD.depth THEN
      RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
    END IF;
    -- AVORA-61 · E: only delete_think_hub_column / change_think_hub_column_type may drop a
    -- column or change its kind (they keep the values in the board's bin / convert them safely).
    IF coalesce(current_setting('avora.column_reshape', true), '') <> 'on' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.column_defs) o
      WHERE o ? 'id' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.column_defs) n
        WHERE n->>'id' = o->>'id' AND n->>'key' = o->>'key' AND n->>'type' = o->>'type'
      )
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_column_id_immutable';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
      RAISE EXCEPTION 'avora_project_closed';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_record_id IS NOT NULL THEN
    SELECT t.* INTO v_parent_table
    FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
    WHERE r.id = NEW.parent_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'avora_think_hub_record_not_yours';
    END IF;
    IF v_parent_table.depth >= 3 THEN
      RAISE EXCEPTION 'avora_think_hub_depth_limit';
    END IF;
    NEW.depth := v_parent_table.depth + 1;
    NEW.project_id := v_parent_table.project_id;
    NEW.conversation_id := v_parent_table.conversation_id;
    NEW.share_mode := v_parent_table.share_mode;
    IF NEW.project_id IS NULL AND NEW.conversation_id IS NULL
       AND NEW.owner_user_id <> v_parent_table.owner_user_id THEN
      RAISE EXCEPTION 'avora_think_hub_table_not_yours';
    END IF;
  ELSE
    NEW.depth := 1;
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = NEW.conversation_id;
    IF v_conv_type IS NULL OR v_conv_type NOT IN ('direct', 'group') THEN
      RAISE EXCEPTION 'avora_think_hub_scope_invalid';
    END IF;
  END IF;

  IF NOT private.think_hub_scope_visible(NEW.owner_user_id, NEW.conversation_id, NEW.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION private.validate_think_hub_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table think_hub_table%ROWTYPE;
BEGIN
  IF btrim(coalesce(NEW.title, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;
  IF btrim(coalesce(NEW.status, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_status_required';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_id <> OLD.table_id
     AND coalesce(current_setting('avora.record_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = NEW.table_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  -- AVORA-69: a board shared `Chỉ xem` is changed by its owner only (server-side, whatever the client shows).
  IF auth.uid() IS NOT NULL AND v_table.share_mode = 'view' AND auth.uid() <> v_table.owner_user_id
     AND coalesce(current_setting('avora.board_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_think_hub_view_only';
  END IF;
  IF v_table.project_id IS NOT NULL AND NOT private.project_is_open(v_table.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.table_id <> OLD.table_id)
     AND NOT private.think_hub_scope_visible(v_table.owner_user_id, v_table.conversation_id, v_table.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF NEW.tags IS NULL OR array_position(NEW.tags, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_tags_shape';
  END IF;
  PERFORM private.validate_extension_values(v_table.column_defs, NEW.extension_fields);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION private.think_hub_cell_file_insertable(p_table_id uuid, p_record_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_user is not null
    and private.think_hub_table_visible(p_table_id, p_user)
    and exists (select 1 from think_hub_table t where t.id = p_table_id and t.deleted_at is null and t.archived_at is null
      and (t.share_mode = 'edit' or t.owner_user_id = p_user))
    and exists (select 1 from think_hub_record r where r.id = p_record_id and r.table_id = p_table_id and r.deleted_at is null)
$function$;
CREATE OR REPLACE FUNCTION public.update_think_hub_record(p_record_id uuid, p_patch jsonb)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
  v_key  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'avora_think_hub_patch_shape';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'title', 'status', 'priority', 'category',
      'next_action_date', 'tags', 'notes', 'extension_fields', 'remind_at'
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_patch_field';
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM think_hub_record WHERE id = p_record_id;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_row.table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_deleted';
  END IF;

  IF p_patch ? 'priority'
     AND coalesce(p_patch->>'priority', '') NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  -- AVORA-69: `Nhắc tôi xem lại` is the caller's own, never the row's (and never blocked by Chỉ xem).
  IF p_patch ? 'remind_at' THEN
    IF nullif(btrim(coalesce(p_patch->>'remind_at', '')), '') IS NULL THEN
      DELETE FROM think_hub_record_reminders WHERE record_id = p_record_id AND user_id = v_user;
    ELSE
      INSERT INTO think_hub_record_reminders (record_id, user_id, remind_at)
      VALUES (p_record_id, v_user, (p_patch->>'remind_at')::timestamptz)
      ON CONFLICT (record_id, user_id) DO UPDATE SET remind_at = excluded.remind_at, updated_at = now();
    END IF;
    p_patch := p_patch - 'remind_at';
    IF p_patch = '{}'::jsonb THEN
      RETURN v_row;
    END IF;
  END IF;

  UPDATE think_hub_record SET
    title = CASE WHEN p_patch ? 'title'
      THEN btrim(coalesce(p_patch->>'title', '')) ELSE title END,
    status = CASE WHEN p_patch ? 'status'
      THEN btrim(coalesce(p_patch->>'status', '')) ELSE status END,
    priority = CASE WHEN p_patch ? 'priority'
      THEN p_patch->>'priority' ELSE priority END,
    category = CASE WHEN p_patch ? 'category'
      THEN nullif(btrim(coalesce(p_patch->>'category', '')), '') ELSE category END,
    next_action_date = CASE WHEN p_patch ? 'next_action_date'
      THEN nullif(btrim(coalesce(p_patch->>'next_action_date', '')), '')::date
      ELSE next_action_date END,
    tags = CASE WHEN p_patch ? 'tags'
      THEN coalesce((
        SELECT array_agg(btrim(tag #>> '{}'))
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_patch->'tags') = 'array' THEN p_patch->'tags' ELSE '[]'::jsonb END
        ) AS tag
        WHERE btrim(coalesce(tag #>> '{}', '')) <> ''
      ), '{}')
      ELSE tags END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END,
    extension_fields = CASE WHEN p_patch ? 'extension_fields'
      THEN coalesce(p_patch->'extension_fields', '{}'::jsonb) ELSE extension_fields END,
    remind_at = NULL
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION private.enqueue_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer := 0; v_step integer;
begin
  -- 1. task_reminders: is_sent keeps it to one; only the reminder's own person.
  with due as (
    update task_reminders r set is_sent = true
    from tasks t
    where t.id = r.task_id and not r.is_sent and r.reminder_time <= now() and r.reminder_time > now() - interval '1 hour'
      and t.status not in ('done', 'skipped')
    returning r.id, r.user_id, r.task_id, r.reminder_time
  )
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select d.user_id, 'reminder', d.task_id, 'tr:' || d.id, jsonb_build_object('at', d.reminder_time)
  from due d join profiles p on p.id = d.user_id
  where p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = d.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 2. tasks.departure_reminder_at: the person who does the task (never the proposer, D3).
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select coalesce(t.assignee_id, t.creator_id), 'reminder', t.id, 'dep:' || t.id || ':' || t.departure_reminder_at, jsonb_build_object('at', t.departure_reminder_at, 'go', true)
  from tasks t join profiles p on p.id = coalesce(t.assignee_id, t.creator_id)
  where t.departure_reminder_at <= now() and t.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped') and t.pending_decision_id is null
    and (t.type = 'personal' or t.assignee_id is not null)
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 3. task_travel_plans: the assignee's own travel for a task from a suggestion.
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select tp.user_id, 'reminder', tp.task_id, 'tp:' || tp.task_id || ':' || tp.departure_reminder_at, jsonb_build_object('at', tp.departure_reminder_at, 'go', true)
  from task_travel_plans tp join tasks t on t.id = tp.task_id join profiles p on p.id = tp.user_id
  where tp.departure_reminder_at <= now() and tp.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped')
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = tp.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 4. `Nhắc tôi xem lại`: only the person who set it, while they can still see the board (AVORA-69).
  insert into push_outbox (user_id, kind, dedupe_key, payload)
  select m.user_id, 'reminder', 'rec:' || r.id || ':' || m.user_id || ':' || m.remind_at,
         jsonb_build_object('at', m.remind_at, 'record_id', r.id, 'table_id', r.table_id, 'title', r.title)
  from think_hub_record_reminders m
  join think_hub_record r on r.id = m.record_id
  join profiles p on p.id = m.user_id
  where r.deleted_at is null and m.remind_at <= now() and m.remind_at > now() - interval '1 hour'
    and private.think_hub_table_visible(r.table_id, m.user_id)
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = m.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  return v_n;
end $function$;
CREATE OR REPLACE FUNCTION private.proposal_words(p_action text, p_target_type text, p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_target_type = 'group' then 'giải tán Nhóm "' || p_name || '"'
    else (case p_action when 'delete' then 'xoá ' when 'archive' then 'lưu trữ ' when 'move' then 'chuyển ' else 'mở lại ' end)
      || (case p_target_type when 'project' then 'Dự án "' else 'Bảng "' end) || p_name || '"'
  end
$function$;

-- Where a board is said to have gone (to the people left behind): never more than a name.
create or replace function private.board_place_label(p_conversation uuid, p_owner uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_conversation is null then 'Bảng riêng của ' || private.public_name(p_owner)
    when (select type from conversations where id = p_conversation) = 'group'
      then 'nhóm "' || coalesce((select nullif(btrim(name), '') from conversation_groups where conversation_id = p_conversation), 'Nhóm') || '"'
    else 'một cuộc trò chuyện 1-1'
  end
$$;

-- Has anyone but the owner put something into this board (rows, edits, files)?
create or replace function private.board_has_others(p_table uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from private.think_hub_table_tree(p_table) tr join think_hub_record r on r.table_id = tr.id
    where r.owner_user_id <> p_owner or exists (select 1 from unnest(coalesce(r.editor_ids, '{}'::uuid[])) e where e <> p_owner)
  ) or exists (
    select 1 from private.think_hub_table_tree(p_table) tr join think_hub_cell_files f on f.table_id = tr.id where f.uploaded_by <> p_owner
  )
$$;

-- The move itself: the whole tree, its tasks, and one line in each place.
create or replace function private.move_board_tree(p_table uuid, p_dest uuid, p_mode text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_root think_hub_table%rowtype; v_tree uuid[]; v_dest_type text; v_rows int; v_msg uuid; v_actor_name text;
begin
  select * into v_root from think_hub_table where id = p_table for update;
  select array_agg(id) into v_tree from private.think_hub_table_tree(p_table);
  if p_dest is not null then select type into v_dest_type from conversations where id = p_dest; end if;

  perform set_config('avora.board_move', 'on', true);
  update think_hub_table set conversation_id = p_dest, share_mode = case when p_dest is null then 'edit' else p_mode end
  where id = any (v_tree);

  -- Tasks the owner raised from the board's rows go with it: they become the room's shared tasks,
  -- assigned to the owner as before. Their private part (reminders, travel, steps) stays the owner's.
  if p_dest is not null then
    update tasks t set
      type = case when v_dest_type = 'direct' then '1-1-shared' else 'group-shared' end,
      conversation_id = p_dest,
      assignee_id = coalesce(t.assignee_id, t.creator_id),
      confirmed_at = coalesce(t.confirmed_at, now()),
      completed_confirmed_at = case when t.status = 'done' then coalesce(t.completed_confirmed_at, t.done_at, now()) else null end,
      task_list_id = null
    from think_hub_record_tasks rt join think_hub_record r on r.id = rt.record_id
    where rt.task_id = t.id and r.table_id = any (v_tree)
      and t.type = 'personal' and t.creator_id = v_root.owner_user_id and t.pending_decision_id is null;
  end if;
  -- A task that cannot follow (another room's task, someone else's) stays where it lives, unlinked.
  delete from think_hub_record_tasks rt using think_hub_record r, tasks t
  where rt.record_id = r.id and t.id = rt.task_id and r.table_id = any (v_tree)
    and ((p_dest is null and not (t.type = 'personal' and t.creator_id = v_root.owner_user_id))
      or (p_dest is not null and t.conversation_id is distinct from p_dest));
  perform set_config('avora.board_move', 'off', true);

  select count(*) into v_rows from think_hub_record where table_id = p_table and deleted_at is null;
  v_actor_name := private.public_name(v_root.owner_user_id);
  if p_dest is not null then
    v_msg := private.post_system_line(p_dest, p_actor, 'board_shared',
      case when v_root.conversation_id is null
        then format('%s chia sẻ Bảng "%s" · %s Hạng mục', v_actor_name, v_root.name, v_rows)
        else format('Bảng "%s" của %s đã chuyển vào đây · %s Hạng mục', v_root.name, v_actor_name, v_rows) end);
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind)
    values (p_table, p_dest, v_msg, p_actor, 'shared');
  end if;
  if v_root.conversation_id is not null then
    perform private.post_system_line(v_root.conversation_id, p_actor, 'board_moved',
      format('Bảng "%s" đã chuyển sang %s', v_root.name, private.board_place_label(p_dest, v_root.owner_user_id)));
  end if;
end $$;

CREATE OR REPLACE FUNCTION private.execute_proposal(p_id uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v shared_proposals%rowtype; v_title text;
begin
  select * into v from shared_proposals where id = p_id;
  perform private.act_as(p_actor);
  perform set_config('avora.proposal_exec', 'on', true);
  if v.target_type = 'think_hub_table' then
    if v.action = 'move' then
      perform private.move_board_tree(v.target_id, v.move_to_conversation, coalesce(v.move_mode, 'edit'), v.proposed_by);
    elsif v.action = 'delete' then
      perform public.delete_think_hub_table(v.target_id);
      update think_hub_table set deleted_via = v.id where id = v.target_id;
    else
      perform public.set_think_hub_table_archived(v.target_id, v.action = 'archive');
    end if;
  elsif v.target_type = 'group' then
    perform private.dissolve_group(v.target_id, v.id);
  elsif v.action = 'delete' then
    select title into v_title from projects where id = v.target_id;
    perform public.delete_project(v.target_id, v_title, v.reason);
    update projects set deleted_via = v.id where id = v.target_id;
  else
    perform public.reopen_project(v.target_id);
  end if;
  perform set_config('avora.proposal_exec', 'off', true);
end $function$;

/**
 * `Di chuyển Bảng…` (AVORA-69). Owner only; a root board, not Kệ sách, not a project's board. A 1-1
 * destination must be a friend (ADR-029). Moving a board others have already filled in becomes a
 * proposal in its current conversation (ADR-031). Returns {status: moved | proposed, proposal_id}.
 */
create or replace function public.move_think_hub_table(p_table_id uuid, p_conversation_id uuid default null, p_mode text default 'edit')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_table think_hub_table%rowtype; v_type text; v_prop shared_proposals%rowtype; v_msg uuid; v_words text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_mode not in ('edit', 'view') then raise exception 'avora_board_move_mode'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_table.owner_user_id <> v_uid then raise exception 'avora_board_move_owner_only'; end if;
  if v_table.parent_record_id is not null then raise exception 'avora_board_move_sub_table'; end if;
  if v_table.kind = 'bookshelf' or v_table.project_id is not null then raise exception 'avora_board_move_locked'; end if;
  if v_table.archived_at is not null then raise exception 'avora_table_archived'; end if;
  if v_table.conversation_id is not distinct from p_conversation_id then
    if p_conversation_id is not null and v_table.share_mode <> p_mode then
      update think_hub_table set share_mode = p_mode where id in (select id from private.think_hub_table_tree(p_table_id));
      return jsonb_build_object('status', 'mode_changed');
    end if;
    raise exception 'avora_board_move_same';
  end if;

  if p_conversation_id is not null then
    select type into v_type from conversations where id = p_conversation_id and deleted_at is null;
    if v_type is null or v_type not in ('direct', 'group') or not private.is_conversation_participant(p_conversation_id, v_uid)
       or not private.conversation_is_live(p_conversation_id) then
      raise exception 'avora_not_a_participant';
    end if;
    if v_type = 'direct' then
      -- Raises avora_not_connected / avora_contact_unavailable / avora_verification_text_only.
      perform private.assert_direct_talk(p_conversation_id, v_uid, 'rich');
    end if;
  end if;

  if v_table.conversation_id is not null and private.board_has_others(p_table_id, v_uid) then
    if exists (select 1 from shared_proposals where target_type = 'think_hub_table' and target_id = p_table_id and status = 'open') then
      raise exception 'avora_proposal_already_open';
    end if;
    v_words := 'Chuyển sang ' || private.board_place_label(p_conversation_id, v_uid);
    insert into shared_proposals (action, target_type, target_id, target_name, conversation_id, proposed_by, reason, move_to_conversation, move_mode)
    values ('move', 'think_hub_table', p_table_id, v_table.name, v_table.conversation_id, v_uid, left(v_words, 300), p_conversation_id, p_mode)
    returning * into v_prop;
    insert into shared_proposal_votes (proposal_id, user_id)
    select v_prop.id, s.user_id from private.proposal_stakeholders('think_hub_table', p_table_id, v_uid) s;
    v_msg := private.post_system_line(v_table.conversation_id, v_uid, 'proposal_opened',
      format('%s đề nghị %s · Lý do: %s', private.public_name(v_uid), private.proposal_words('move', 'think_hub_table', v_table.name), v_words));
    update shared_proposals set message_id = v_msg where id = v_prop.id;
    perform private.settle_proposal(v_prop.id, v_uid);
    select * into v_prop from shared_proposals where id = v_prop.id;
    return jsonb_build_object('status', case when v_prop.status = 'approved' then 'moved' else 'proposed' end, 'proposal_id', v_prop.id);
  end if;

  perform private.move_board_tree(p_table_id, p_conversation_id, p_mode, v_uid);
  return jsonb_build_object('status', 'moved');
end $$;

revoke all on function public.move_think_hub_table(uuid, uuid, text) from public, anon;
grant execute on function public.move_think_hub_table(uuid, uuid, text) to authenticated;
revoke all on function private.move_board_tree(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.board_has_others(uuid, uuid) from public, anon, authenticated;
revoke all on function private.board_place_label(uuid, uuid) from public, anon, authenticated;
