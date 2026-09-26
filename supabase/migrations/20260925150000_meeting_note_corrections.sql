-- AVORA 32 / Nhóm C — corrections after the user's answers (supersedes parts of 20260925120000).
--
-- 1. Editing a draft and pressing "Bắt đầu họp" belong to the note's author (the Owner/Admin who opened it,
--    or the member delegated as secretary) — NOT to every Owner/Admin. Admin scope stays deliberately narrow.
-- 2. "Tạo việc" creates the Task immediately, in a "chờ hiệu lực" state (tasks.pending_decision_id): invisible
--    to every task list, count and reminder, rewritten in place (same id) while the draft is edited, deleted if
--    its action item is removed, and put into effect for everyone when the note is finalized.
-- 3. The custom minutes file can be added or swapped at any time by the author, even after the note is locked
--    (attachments were already an exception to immutability; the structured content is not).
-- 4. "Lưu vào Nhật ký" posts one ordinary note into the saver's own Diary (title + link to the note + file name).
--    No table of its own: journal_references (created empty an hour earlier) is dropped.

------------------------------------------------------------------------------------------------------------
-- 1. Author-only editing
------------------------------------------------------------------------------------------------------------

create or replace function private.can_edit_meeting_note (p_decision_id uuid, p_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.group_decisions d
    where d.id = p_decision_id
      and d.kind = 'meeting_note'
      and d.status = 'draft'
      and d.created_by = p_user
      and private.is_conversation_participant (d.conversation_id, p_user)
  )
$$;

revoke execute on function private.can_edit_meeting_note (uuid, uuid) from public, anon;
grant execute on function private.can_edit_meeting_note (uuid, uuid) to authenticated;

-- The minutes file: the author, at any time (draft or locked), while still in the group.
create or replace function private.can_manage_meeting_file (p_decision_id uuid, p_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.group_decisions d
    where d.id = p_decision_id
      and d.kind = 'meeting_note'
      and d.created_by = p_user
      and private.is_conversation_participant (d.conversation_id, p_user)
  )
$$;

revoke execute on function private.can_manage_meeting_file (uuid, uuid) from public, anon;
grant execute on function private.can_manage_meeting_file (uuid, uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 2. Tasks "chờ hiệu lực"
------------------------------------------------------------------------------------------------------------

alter table public.tasks
  add column if not exists pending_decision_id uuid references public.group_decisions (id) on delete cascade;

create index if not exists tasks_pending_decision_idx on public.tasks (pending_decision_id)
  where pending_decision_id is not null;

-- No client write grant on the new column: only the meeting-note functions set or clear it.
revoke insert (pending_decision_id), update (pending_decision_id) on public.tasks from authenticated, anon;

-- A pending task is nobody's work yet: hidden from every read, and out of reach of direct edits.
drop policy if exists tasks_select_visible on public.tasks;
create policy tasks_select_visible on public.tasks
  for select to authenticated
  using (
    pending_decision_id is null
    and (
      (type = 'personal' and creator_id = (select auth.uid ()))
      or (type in ('1-1-shared', 'group-shared')
        and private.is_conversation_participant (conversation_id, (select auth.uid ()))
        and private.conversation_is_live (conversation_id))
    )
  );

drop policy if exists tasks_update_own_personal on public.tasks;
create policy tasks_update_own_personal on public.tasks
  for update to authenticated
  using (pending_decision_id is null and type = 'personal' and creator_id = (select auth.uid ()))
  with check (pending_decision_id is null and type = 'personal' and creator_id = (select auth.uid ()));

drop policy if exists tasks_delete_own_personal on public.tasks;
create policy tasks_delete_own_personal on public.tasks
  for delete to authenticated
  using (pending_decision_id is null and type = 'personal' and creator_id = (select auth.uid ()));

-- Reminders, flags and participant reads go through these; a pending task offers none of them.
create or replace function private.can_view_task (p_task uuid, p_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and private.conversation_is_live (t.conversation_id))
      )
  );
$$;

create or replace function private.can_link_task (p_task uuid, p_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and (t.creator_id = p_user or public.is_task_assignee (t, p_user)))
      )
  );
$$;

-- The snapshot is write-once from the moment a task is in effect. While it is still pending, the draft it
-- mirrors may change, so the snapshot may be rewritten with it.
create or replace function public.enforce_task_context ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb := new.context_snapshot;
  v_conv_type text;
  v_list_conversation uuid;
  v_expected uuid;
  k text;
begin
  if tg_op = 'UPDATE'
    and new.context_snapshot is distinct from old.context_snapshot
    and old.pending_decision_id is null then
    raise exception 'avora_context_snapshot_immutable';
  end if;

  if v_snapshot is not null then
    if jsonb_typeof(v_snapshot) <> 'object' then
      raise exception 'avora_context_snapshot_not_object';
    end if;

    foreach k in array array[
      'conversation_type', 'conversation_id', 'conversation_name',
      'original_message_id', 'original_message_text', 'original_message_sender_id',
      'original_message_sender_name', 'original_message_created_at',
      'user_response', 'snapshot_created_at'
    ] loop
      if not (v_snapshot ? k) then
        raise exception 'avora_context_snapshot_missing_key_%', k;
      end if;
    end loop;

    if coalesce(v_snapshot->>'conversation_type', '') not in ('direct', 'group', 'personal') then
      raise exception 'avora_context_snapshot_bad_conversation_type';
    end if;

    if nullif(v_snapshot->>'conversation_id', '') is null then
      raise exception 'avora_context_snapshot_conversation_required';
    end if;

    if not private.is_conversation_participant((v_snapshot->>'conversation_id')::uuid, new.creator_id) then
      raise exception 'avora_context_snapshot_foreign_conversation';
    end if;

    select type into v_conv_type from public.conversations
      where id = (v_snapshot->>'conversation_id')::uuid;
    if v_conv_type is distinct from (v_snapshot->>'conversation_type') then
      raise exception 'avora_context_snapshot_type_mismatch';
    end if;

    if nullif(v_snapshot->>'snapshot_created_at', '') is null then
      raise exception 'avora_context_snapshot_time_required';
    end if;
  end if;

  if new.task_list_id is not null then
    select conversation_id into v_list_conversation from public.task_lists where id = new.task_list_id;
    if v_list_conversation is null then
      raise exception 'avora_task_list_missing';
    end if;

    if new.conversation_id is not null then
      v_expected := new.conversation_id;
    else
      v_expected := public.ensure_personal_journal(new.creator_id);
    end if;

    if v_list_conversation <> v_expected then
      raise exception 'avora_task_list_foreign_conversation';
    end if;
  end if;

  return new;
end
$$;

revoke execute on function public.enforce_task_context () from public, anon, authenticated;

/**
 * Creates or rewrites the pending task behind one action item. Returns the item stamped with its task_id.
 *   p_create: make the task if the item has none yet.
 *   p_strict: refuse an incomplete item out loud (finalize, "Tạo việc"); otherwise leave the task as it was
 *             (autosave while someone is mid-typing must not fail or blank a task).
 * A task that is already in effect is never rewritten from a draft.
 */
create or replace function private.sync_meeting_note_task (
  p_note public.group_decisions,
  p_agenda text[],
  p_item jsonb,
  p_create boolean,
  p_strict boolean
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_task uuid := case when coalesce(p_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$'
    then (p_item->>'task_id')::uuid else null end;
  v_desc text := btrim(coalesce(p_item->>'description', ''));
  v_assignee uuid;
  v_deadline date;
  v_idx int;
  v_line text;
  v_quote text;
  v_group text;
  v_snapshot jsonb;
  v_personal boolean;
begin
  if v_task is null and not p_create then
    return p_item;
  end if;

  begin
    v_assignee := nullif(p_item->>'assignee_id', '')::uuid;
    v_deadline := nullif(p_item->>'deadline', '')::date;
  exception when others then
    if p_strict then raise exception 'avora_note_action_invalid'; end if;
    return p_item;
  end;

  if v_desc = '' then
    if p_strict then raise exception 'avora_note_action_needs_description'; end if;
    return p_item;
  end if;
  if v_assignee is null then
    if p_strict then raise exception 'avora_note_action_needs_assignee'; end if;
    return p_item;
  end if;
  if v_deadline is null then
    if p_strict then raise exception 'avora_note_action_needs_deadline'; end if;
    return p_item;
  end if;
  if not private.is_conversation_participant (p_note.conversation_id, v_assignee) then
    if p_strict then raise exception 'avora_note_person_not_participant'; end if;
    return p_item;
  end if;

  v_idx := case when jsonb_typeof(p_item->'agenda_index') = 'number' then (p_item->>'agenda_index')::int end;
  v_line := case when v_idx is not null then p_agenda[v_idx + 1] end;
  if v_line is null then v_idx := null; end if;
  v_quote := 'Biên bản họp: ' || p_note.title
    || coalesce(' — Mục ' || (v_idx + 1)::text || ': ' || v_line, '');

  select name into v_group from public.conversation_groups where conversation_id = p_note.conversation_id;

  v_snapshot := jsonb_build_object(
    'conversation_type', 'group',
    'conversation_id', p_note.conversation_id::text,
    'conversation_name', coalesce(v_group, ''),
    'original_message_id', null,
    'original_message_text', left(v_quote, 2000),
    'original_message_sender_id', p_note.created_by::text,
    'original_message_sender_name',
      coalesce((select display_name from public.profiles where id = p_note.created_by), ''),
    'original_message_created_at', to_char(p_note.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'user_response', v_desc,
    'snapshot_created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'source_meeting_note_id', p_note.id::text,
    'source_agenda_index', to_jsonb(v_idx),
    'source_agenda_item', to_jsonb(v_line));

  v_personal := v_assignee = p_note.created_by;

  if v_task is null then
    v_task := gen_random_uuid ();
    if v_personal then
      insert into public.tasks (id, type, creator_id, title, description, status, deadline_date,
        context_snapshot, pending_decision_id)
      values (v_task, 'personal', p_note.created_by, left(v_desc, 200), v_desc, 'confirmed', v_deadline,
        v_snapshot, p_note.id);
    else
      insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, description, status,
        deadline_date, context_snapshot, pending_decision_id)
      values (v_task, 'group-shared', p_note.created_by, v_assignee, p_note.conversation_id, left(v_desc, 200),
        v_desc, 'pending_confirmation', v_deadline, v_snapshot, p_note.id);
      insert into public.task_confirmations (task_id, user_id) values (v_task, p_note.created_by)
        on conflict (task_id, user_id) do nothing;
    end if;
  else
    if not exists (select 1 from public.tasks where id = v_task and pending_decision_id = p_note.id) then
      return p_item;
    end if;
    update public.tasks set
      type = case when v_personal then 'personal' else 'group-shared' end,
      conversation_id = case when v_personal then null else p_note.conversation_id end,
      assignee_id = case when v_personal then null else v_assignee end,
      title = left(v_desc, 200),
      description = v_desc,
      deadline_date = v_deadline,
      status = case when v_personal then 'confirmed' else 'pending_confirmation' end,
      confirmed_at = null,
      confirmed_by = null,
      context_snapshot = v_snapshot
    where id = v_task;
    if v_personal then
      delete from public.task_confirmations where task_id = v_task;
    else
      insert into public.task_confirmations (task_id, user_id) values (v_task, p_note.created_by)
        on conflict (task_id, user_id) do nothing;
    end if;
  end if;

  return p_item || jsonb_build_object('task_id', v_task::text, 'create_task', true);
end;
$$;

revoke execute on function private.sync_meeting_note_task (public.group_decisions, text[], jsonb, boolean, boolean)
  from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------
-- Details save: keeps each item's key + task link, mirrors edits into pending tasks, cancels removed ones
------------------------------------------------------------------------------------------------------------

create or replace function public.save_meeting_note_details (
  p_decision_id uuid,
  p_meeting_type text,
  p_objective text,
  p_attendee_ids uuid[],
  p_absentee_ids uuid[],
  p_agenda_items text[],
  p_decisions_made text,
  p_action_items jsonb,
  p_risks_issues text,
  p_next_meeting_at timestamptz,
  p_reference_links text[],
  p_scheduled_at timestamptz default null,
  p_location text default null
)
  returns public.meeting_note_details
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_row public.meeting_note_details%rowtype;
  v_attendees uuid[] := coalesce(p_attendee_ids, '{}');
  v_absentees uuid[] := coalesce(p_absentee_ids, '{}');
  v_agenda text[] := coalesce(p_agenda_items, '{}');
  v_agenda_len int;
  v_actions jsonb := coalesce(p_action_items, '[]'::jsonb);
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index jsonb;
  v_number numeric;
  v_person uuid;
  v_key text;
  v_task uuid;
  v_old_tasks uuid[] := '{}';
  v_seen_tasks uuid[] := '{}';
  v_seen_keys text[] := '{}';
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  if jsonb_typeof(v_actions) <> 'array' then raise exception 'avora_note_actions_not_array'; end if;

  v_agenda_len := coalesce(array_length(v_agenda, 1), 0);
  if v_agenda_len > 50 or jsonb_array_length(v_actions) > 50 then
    raise exception 'avora_note_too_many_items';
  end if;

  foreach v_person in array v_attendees || v_absentees loop
    if not private.is_conversation_participant (v_note.conversation_id, v_person) then
      raise exception 'avora_note_person_not_participant';
    end if;
  end loop;

  -- The tasks this draft already owns. A task_id arriving from the client is honoured only if it is one of
  -- these, so no one can attach someone else's task to a note.
  select coalesce(array_agg((e->>'task_id')::uuid), '{}') into v_old_tasks
  from public.meeting_note_details d, jsonb_array_elements(d.action_items) e
  where d.decision_id = p_decision_id and coalesce(e->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$';

  for v_item in select value from jsonb_array_elements(v_actions) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'avora_note_actions_not_array'; end if;

    v_index := v_item -> 'agenda_index';
    if v_index is not null and jsonb_typeof(v_index) <> 'null' then
      if jsonb_typeof(v_index) <> 'number' then raise exception 'avora_note_agenda_index_invalid'; end if;
      v_number := (v_index #>> '{}')::numeric;
      if v_number <> trunc(v_number) or v_number < 0 or v_number >= v_agenda_len then
        raise exception 'avora_note_agenda_index_invalid';
      end if;
    else
      v_item := v_item || jsonb_build_object('agenda_index', null);
    end if;

    v_key := v_item->>'key';
    if v_key is null or char_length(v_key) = 0 or char_length(v_key) > 64 or v_key = any(v_seen_keys) then
      v_key := gen_random_uuid ()::text;
    end if;
    v_seen_keys := v_seen_keys || v_key;

    v_task := case when coalesce(v_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$'
      then (v_item->>'task_id')::uuid else null end;
    if v_task is not null and (not (v_task = any(v_old_tasks)) or v_task = any(v_seen_tasks)) then
      v_task := null;
    end if;
    if v_task is not null then v_seen_tasks := v_seen_tasks || v_task; end if;

    v_clean := v_clean || jsonb_build_array(v_item || jsonb_build_object(
      'key', v_key,
      'task_id', case when v_task is null then null else v_task::text end,
      'create_task', v_task is not null or coalesce((v_item->>'create_task')::boolean, false)));
  end loop;

  insert into public.meeting_note_details (decision_id, meeting_type, objective, attendee_ids, absentee_ids,
    agenda_items, decisions_made, action_items, risks_issues, next_meeting_at, reference_links, scheduled_at,
    location)
  values (p_decision_id, left(btrim(coalesce(p_meeting_type, '')), 120),
    left(btrim(coalesce(p_objective, '')), 2000), v_attendees, v_absentees, v_agenda,
    left(btrim(coalesce(p_decisions_made, '')), 5000), v_clean,
    left(btrim(coalesce(p_risks_issues, '')), 5000), p_next_meeting_at, coalesce(p_reference_links, '{}'),
    p_scheduled_at, left(btrim(coalesce(p_location, '')), 300))
  on conflict (decision_id)
    do update set
      meeting_type = excluded.meeting_type, objective = excluded.objective,
      attendee_ids = excluded.attendee_ids, absentee_ids = excluded.absentee_ids,
      agenda_items = excluded.agenda_items, decisions_made = excluded.decisions_made,
      action_items = excluded.action_items, risks_issues = excluded.risks_issues,
      next_meeting_at = excluded.next_meeting_at, reference_links = excluded.reference_links,
      scheduled_at = excluded.scheduled_at, location = excluded.location;

  -- Edits reach the pending tasks (same id); an item that was removed takes its pending task with it.
  for v_item in select value from jsonb_array_elements(v_clean) loop
    perform private.sync_meeting_note_task (v_note, v_agenda, v_item, false, false);
  end loop;
  delete from public.tasks where pending_decision_id = p_decision_id and not (id = any(v_seen_tasks));

  select * into v_row from public.meeting_note_details where decision_id = p_decision_id;
  return v_row;
end;
$$;

revoke execute on function public.save_meeting_note_details (uuid, text, text, uuid[], uuid[], text[], text, jsonb,
  text, timestamptz, text[], timestamptz, text) from public, anon;
grant execute on function public.save_meeting_note_details (uuid, text, text, uuid[], uuid[], text[], text, jsonb,
  text, timestamptz, text[], timestamptz, text) to authenticated;

-- "Tạo việc" on one saved action item (found by its key). Pressing it again returns the same task.
create or replace function public.create_meeting_note_task (p_decision_id uuid, p_item_key text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_details public.meeting_note_details%rowtype;
  v_pos int;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  select * into v_details from public.meeting_note_details where decision_id = p_decision_id;
  select t.ord - 1, t.value into v_pos, v_item
  from jsonb_array_elements(coalesce(v_details.action_items, '[]'::jsonb)) with ordinality as t(value, ord)
  where t.value->>'key' = p_item_key
  limit 1;
  if v_pos is null then raise exception 'avora_note_item_not_saved'; end if;

  v_item := private.sync_meeting_note_task (v_note, v_details.agenda_items, v_item, true, true);

  update public.meeting_note_details
    set action_items = jsonb_set(action_items, array[v_pos::text], v_item)
    where decision_id = p_decision_id;

  return (v_item->>'task_id')::uuid;
end;
$$;

revoke execute on function public.create_meeting_note_task (uuid, text) from public, anon;
grant execute on function public.create_meeting_note_task (uuid, text) to authenticated;

-- Finalize: every pending task is brought up to date, then all of them take effect together.
create or replace function public.finalize_meeting_note (p_decision_id uuid)
  returns public.group_decisions
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_row public.group_decisions%rowtype;
  v_details public.meeting_note_details%rowtype;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status = 'finalized' then return v_row; end if;

  if v_row.created_by <> v_uid and not private.is_group_officer (v_row.conversation_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  select * into v_details from public.meeting_note_details where decision_id = p_decision_id;

  if found then
    for v_item in select value from jsonb_array_elements(v_details.action_items) loop
      if coalesce(v_item->>'task_id', '') <> '' then
        v_item := private.sync_meeting_note_task (v_row, v_details.agenda_items, v_item, false, true);
      elsif coalesce((v_item->>'create_task')::boolean, false) then
        v_item := private.sync_meeting_note_task (v_row, v_details.agenda_items, v_item, true, true);
      end if;
      if coalesce(v_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$' then
        v_seen := v_seen || (v_item->>'task_id')::uuid;
      end if;
      v_next := v_next || jsonb_build_array(v_item);
    end loop;

    update public.meeting_note_details set action_items = v_next where decision_id = p_decision_id;
  end if;

  delete from public.tasks where pending_decision_id = p_decision_id and not (id = any(v_seen));
  update public.tasks set pending_decision_id = null where pending_decision_id = p_decision_id;

  update public.group_decisions
    set status = 'finalized', settled_at = now(), settled_by = v_uid
    where id = p_decision_id;

  select * into v_row from public.group_decisions where id = p_decision_id;
  return v_row;
end;
$$;

revoke execute on function public.finalize_meeting_note (uuid) from public, anon;
grant execute on function public.finalize_meeting_note (uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 3. Minutes file: any time, author only
------------------------------------------------------------------------------------------------------------

drop trigger if exists meeting_note_files_immutable on public.meeting_note_files;
drop function if exists public.enforce_meeting_note_file_immutable ();

drop policy if exists meeting_files_write on storage.objects;
create policy meeting_files_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-files'
    and (storage.foldername (name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and (storage.foldername (name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and private.decision_conversation (((storage.foldername (name))[2])::uuid)
      = ((storage.foldername (name))[1])::uuid
    and private.can_manage_meeting_file (((storage.foldername (name))[2])::uuid, (select auth.uid ()))
  );

create or replace function public.attach_meeting_note_file (
  p_decision_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
  returns text
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_old text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if not private.can_manage_meeting_file (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  if p_storage_path is null
    or p_storage_path not like v_note.conversation_id::text || '/' || p_decision_id::text || '/%' then
    raise exception 'avora_note_file_bad_path';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'meeting-files' and o.name = p_storage_path and o.owner = v_uid
  ) then
    raise exception 'avora_note_file_missing';
  end if;

  select storage_path into v_old from public.meeting_note_files where decision_id = p_decision_id;

  insert into public.meeting_note_files (decision_id, conversation_id, storage_path, file_name, mime_type,
    byte_size, uploaded_by)
  values (p_decision_id, v_note.conversation_id, p_storage_path, left(btrim(p_file_name), 255), p_mime_type,
    p_byte_size, v_uid)
  on conflict (decision_id)
    do update set storage_path = excluded.storage_path, file_name = excluded.file_name,
      mime_type = excluded.mime_type, byte_size = excluded.byte_size, uploaded_by = excluded.uploaded_by,
      created_at = now();

  return case when v_old is distinct from p_storage_path then v_old else null end;
end;
$$;

revoke execute on function public.attach_meeting_note_file (uuid, text, text, text, bigint) from public, anon;
grant execute on function public.attach_meeting_note_file (uuid, text, text, text, bigint) to authenticated;

create or replace function public.remove_meeting_note_file (p_decision_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_old text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_manage_meeting_file (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;
  delete from public.meeting_note_files where decision_id = p_decision_id returning storage_path into v_old;
  return v_old;
end;
$$;

revoke execute on function public.remove_meeting_note_file (uuid) from public, anon;
grant execute on function public.remove_meeting_note_file (uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 4. "Lưu vào Nhật ký": one note in the saver's own Diary, no table of its own
------------------------------------------------------------------------------------------------------------

drop function if exists public.save_meeting_note_to_journal (uuid);
drop table if exists public.journal_references;

create or replace function public.save_meeting_note_to_journal (p_decision_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_journal uuid;
  v_link text;
  v_existing uuid;
  v_group text;
  v_file text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id;
  if not found or not private.is_conversation_participant (v_note.conversation_id, v_uid) then
    raise exception 'avora_decision_not_found';
  end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'finalized' then raise exception 'avora_note_not_finalized'; end if;

  v_journal := public.ensure_personal_journal (v_uid);
  v_link := '/tin-nhan/' || v_note.conversation_id::text || '?so-quyet-dinh=' || p_decision_id::text;

  -- Saving twice keeps one note.
  select id into v_existing from public.messages
  where conversation_id = v_journal and sender_id = v_uid and deleted_at is null
    and position(v_link in content) > 0
  limit 1;
  if v_existing is not null then return v_existing; end if;

  select name into v_group from public.conversation_groups where conversation_id = v_note.conversation_id;
  select file_name into v_file from public.meeting_note_files where decision_id = p_decision_id;

  insert into public.messages (conversation_id, sender_id, content)
  values (v_journal, v_uid, left(concat_ws(E'\n',
    '📋 Biên bản họp: ' || v_note.title,
    'Nhóm ' || coalesce(nullif(v_group, ''), 'không tên') || ' · khoá ngày '
      || to_char(v_note.settled_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'),
    case when v_file is not null then 'Mẫu riêng: ' || v_file end,
    v_link), 4000))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.save_meeting_note_to_journal (uuid) from public, anon;
grant execute on function public.save_meeting_note_to_journal (uuid) to authenticated;
