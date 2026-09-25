-- AVORA 32 / Nhóm C — Sổ quyết định in two stages.
--
-- Stage 1 (meeting_started_at IS NULL): "Kế hoạch họp" — type, objective, invitees, when/where, planned agenda.
-- Stage 2 (meeting_started_at IS NOT NULL): each agenda line carries its own decisions / action items
--   (action_items[].agenda_index → position in agenda_items, 0-based; null = raised outside the agenda).
-- group_decisions.status (draft → finalized) is untouched: stages live inside a draft, and a finalized note
-- stays frozen exactly as before.
--
-- Also here:
--   * an optional custom minutes file (Word/PDF), view-only, beside the structured data — one per note,
--     replaceable while the note is a draft, frozen with it afterwards;
--   * "Lưu vào Nhật ký": a reference to a finalized note in the saver's own Diary (File của bạn), never a copy.
--
-- Editing a draft (text, details, stage, file) now belongs to the author OR a group Owner/Admin — the same
-- seats that could already finalize it. The author of a note is always an officer or a delegated member,
-- because opening one requires that.

------------------------------------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------------------------------------

alter table public.meeting_note_details
  add column if not exists meeting_started_at timestamptz,
  add column if not exists scheduled_at timestamptz,
  add column if not exists location text not null default '';

alter table public.meeting_note_details
  drop constraint if exists meeting_note_details_location_len;
alter table public.meeting_note_details
  add constraint meeting_note_details_location_len check (char_length(location) <= 300);

-- Every draft written before stages existed was minutes of a meeting that had already happened: it opens in
-- stage 2 so nothing already typed is hidden behind a "Bắt đầu họp" button. Finalized notes are frozen and
-- are not touched (a finalized note reads the same in either stage).
update public.meeting_note_details d
set meeting_started_at = g.created_at
from public.group_decisions g
where g.id = d.decision_id
  and g.status = 'draft'
  and d.meeting_started_at is null;

------------------------------------------------------------------------------------------------------------
-- 2. Who may edit a draft note — predicate helper, private schema (not exposed by PostgREST)
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
      and private.is_conversation_participant (d.conversation_id, p_user)
      and (d.created_by = p_user or private.is_group_officer (d.conversation_id, p_user))
  )
$$;

revoke execute on function private.can_edit_meeting_note (uuid, uuid) from public, anon;
grant execute on function private.can_edit_meeting_note (uuid, uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 3. Draft text: author or officer
------------------------------------------------------------------------------------------------------------

create or replace function public.update_meeting_note_draft (p_decision_id uuid, p_title text, p_body text)
  returns public.group_decisions
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_row public.group_decisions%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_decision_title_blank'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  update public.group_decisions
    set title = left (v_title, 200), body = left (v_body, 5000)
    where id = p_decision_id;

  select * into v_row from public.group_decisions where id = p_decision_id;
  return v_row;
end
$$;

revoke execute on function public.update_meeting_note_draft (uuid, text, text) from public, anon;
grant execute on function public.update_meeting_note_draft (uuid, text, text) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 4. Details: agenda-linked action items, when/where, author or officer
------------------------------------------------------------------------------------------------------------

drop function if exists public.save_meeting_note_details (uuid, text, text, uuid[], uuid[], text[], text, jsonb,
  text, timestamptz, text[]);

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
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_note from public.group_decisions where id = p_decision_id;
  if not found then
    raise exception 'avora_decision_not_found';
  end if;
  if v_note.kind <> 'meeting_note' then
    raise exception 'avora_decision_bad_kind';
  end if;
  if v_note.status <> 'draft' then
    raise exception 'avora_decision_settled_immutable';
  end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  if jsonb_typeof(v_actions) <> 'array' then
    raise exception 'avora_note_actions_not_array';
  end if;

  v_agenda_len := coalesce(array_length(v_agenda, 1), 0);
  if v_agenda_len > 50 or jsonb_array_length(v_actions) > 50 then
    raise exception 'avora_note_too_many_items';
  end if;

  foreach v_person in array v_attendees || v_absentees loop
    if not private.is_conversation_participant (v_note.conversation_id, v_person) then
      raise exception 'avora_note_person_not_participant';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(v_actions) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'avora_note_actions_not_array';
    end if;

    -- An action item points at one agenda line by position, or at none. Anything else would attach a
    -- decision to a line that does not exist.
    v_index := v_item -> 'agenda_index';
    if v_index is not null and jsonb_typeof(v_index) <> 'null' then
      if jsonb_typeof(v_index) <> 'number' then
        raise exception 'avora_note_agenda_index_invalid';
      end if;
      v_number := (v_index #>> '{}')::numeric;
      if v_number <> trunc(v_number) or v_number < 0 or v_number >= v_agenda_len then
        raise exception 'avora_note_agenda_index_invalid';
      end if;
    else
      v_item := v_item || jsonb_build_object('agenda_index', null);
    end if;

    -- A draft never owns a task (tasks are only made when the note is locked, and a locked note refuses
    -- this call), so a task_id arriving here can only be stale or invented. It is dropped.
    v_clean := v_clean || jsonb_build_array((v_item - 'task_id') || jsonb_build_object('task_id', null));
  end loop;

  insert into public.meeting_note_details (decision_id, meeting_type, objective, attendee_ids, absentee_ids,
    agenda_items, decisions_made, action_items, risks_issues, next_meeting_at, reference_links, scheduled_at,
    location)
  values (p_decision_id, left (btrim(coalesce(p_meeting_type, '')), 120),
    left (btrim(coalesce(p_objective, '')), 2000), v_attendees, v_absentees, v_agenda,
    left (btrim(coalesce(p_decisions_made, '')), 5000), v_clean,
    left (btrim(coalesce(p_risks_issues, '')), 5000), p_next_meeting_at, coalesce(p_reference_links, '{}'),
    p_scheduled_at, left (btrim(coalesce(p_location, '')), 300))
  on conflict (decision_id)
    do update set
      meeting_type = excluded.meeting_type, objective = excluded.objective,
      attendee_ids = excluded.attendee_ids, absentee_ids = excluded.absentee_ids,
      agenda_items = excluded.agenda_items, decisions_made = excluded.decisions_made,
      action_items = excluded.action_items, risks_issues = excluded.risks_issues,
      next_meeting_at = excluded.next_meeting_at, reference_links = excluded.reference_links,
      scheduled_at = excluded.scheduled_at, location = excluded.location;
  -- meeting_started_at is deliberately absent: only start_meeting_note moves a note into stage 2.

  select * into v_row from public.meeting_note_details where decision_id = p_decision_id;
  return v_row;
end;
$$;

revoke execute on function public.save_meeting_note_details (uuid, text, text, uuid[], uuid[], text[], text, jsonb,
  text, timestamptz, text[], timestamptz, text) from public, anon;
grant execute on function public.save_meeting_note_details (uuid, text, text, uuid[], uuid[], text[], text, jsonb,
  text, timestamptz, text[], timestamptz, text) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 5. "Bắt đầu họp" — one way, idempotent, shared by everyone who reads the note
------------------------------------------------------------------------------------------------------------

create or replace function public.start_meeting_note (p_decision_id uuid)
  returns public.meeting_note_details
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_row public.meeting_note_details%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  insert into public.meeting_note_details (decision_id, meeting_started_at)
  values (p_decision_id, now())
  on conflict (decision_id)
    do update set meeting_started_at = coalesce(public.meeting_note_details.meeting_started_at, now());

  select * into v_row from public.meeting_note_details where decision_id = p_decision_id;
  return v_row;
end;
$$;

revoke execute on function public.start_meeting_note (uuid) from public, anon;
grant execute on function public.start_meeting_note (uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 6. Finalize: the task's snapshot names the agenda line it came from
------------------------------------------------------------------------------------------------------------

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
  v_items jsonb;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_index int := 0;
  v_description text;
  v_assignee uuid;
  v_deadline date;
  v_task_id uuid;
  v_snapshot jsonb;
  v_group_name text;
  v_agenda_index int;
  v_agenda_text text;
  v_quote text;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.group_decisions where id = p_decision_id for update;
  if not found then
    raise exception 'avora_decision_not_found';
  end if;
  if v_row.kind <> 'meeting_note' then
    raise exception 'avora_decision_bad_kind';
  end if;
  -- Already locked: a retry is a no-op success, and must NOT produce the tasks a second time.
  if v_row.status = 'finalized' then
    return v_row;
  end if;

  if v_row.created_by <> v_uid
    and not private.is_group_officer (v_row.conversation_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  select * into v_details from public.meeting_note_details where decision_id = p_decision_id;

  if found and jsonb_array_length(v_details.action_items) > 0 then
    select name into v_group_name from public.conversation_groups
    where conversation_id = v_row.conversation_id;

    v_items := v_details.action_items;

    while v_index < jsonb_array_length(v_items) loop
      v_item := v_items -> v_index;

      if coalesce((v_item ->> 'create_task')::boolean, false) = false
        or nullif (v_item ->> 'task_id', '') is not null then
        v_next := v_next || jsonb_build_array(v_item);
        v_index := v_index + 1;
        continue;
      end if;

      v_description := btrim(coalesce(v_item ->> 'description', ''));
      v_assignee := nullif (v_item ->> 'assignee_id', '')::uuid;
      v_deadline := nullif (v_item ->> 'deadline', '')::date;

      if v_description = '' then
        raise exception 'avora_note_action_needs_description';
      end if;
      if v_assignee is null then
        raise exception 'avora_note_action_needs_assignee';
      end if;
      if v_deadline is null then
        raise exception 'avora_note_action_needs_deadline';
      end if;
      if not private.is_conversation_participant (v_row.conversation_id, v_assignee) then
        raise exception 'avora_note_person_not_participant';
      end if;

      -- Which agenda line this came from, copied as words: the note is frozen, but the task outlives it.
      v_agenda_index := case when jsonb_typeof(v_item -> 'agenda_index') = 'number'
        then (v_item ->> 'agenda_index')::int else null end;
      v_agenda_text := case when v_agenda_index is not null
        then v_details.agenda_items[v_agenda_index + 1] else null end;
      if v_agenda_text is null then
        v_agenda_index := null;
      end if;
      v_quote := 'Biên bản họp: ' || v_row.title
        || coalesce(' — Mục ' || (v_agenda_index + 1)::text || ': ' || v_agenda_text, '');

      v_task_id := gen_random_uuid ();

      v_snapshot := jsonb_build_object('conversation_type', 'group', 'conversation_id',
        v_row.conversation_id::text, 'conversation_name', coalesce(v_group_name, ''),
        'original_message_id', null, 'original_message_text', left (v_quote, 2000),
        'original_message_sender_id', v_row.created_by::text, 'original_message_sender_name',
        coalesce((select display_name from public.profiles where id = v_row.created_by), ''),
        'original_message_created_at', to_char(v_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'user_response', v_description, 'snapshot_created_at', to_char(now(),
        'YYYY-MM-DD"T"HH24:MI:SSOF'), 'source_meeting_note_id', p_decision_id::text,
        'source_agenda_index', to_jsonb (v_agenda_index), 'source_agenda_item', to_jsonb (v_agenda_text));

      if v_assignee = v_row.created_by then
        insert into public.tasks (id, type, creator_id, title, description, status, deadline_date,
          context_snapshot)
        values (v_task_id, 'personal', v_row.created_by, left (v_description, 200), v_description,
          'confirmed', v_deadline, v_snapshot);
      else
        insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title,
          description, status, deadline_date, context_snapshot)
        values (v_task_id, 'group-shared', v_row.created_by, v_assignee, v_row.conversation_id,
          left (v_description, 200), v_description, 'pending_confirmation', v_deadline, v_snapshot);

        insert into public.task_confirmations (task_id, user_id)
          values (v_task_id, v_row.created_by)
        on conflict (task_id, user_id) do nothing;
      end if;

      v_next := v_next || jsonb_build_array(v_item || jsonb_build_object('task_id', v_task_id::text));
      v_index := v_index + 1;
    end loop;

    update public.meeting_note_details set action_items = v_next where decision_id = p_decision_id;
  end if;

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
-- 7. Custom minutes file (Word/PDF), view-only, one per note
------------------------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-files', 'meeting-files', false, 26214400, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.meeting_note_files (
  decision_id uuid primary key references public.group_decisions (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint meeting_note_files_name_len check (char_length(file_name) between 1 and 255),
  constraint meeting_note_files_mime check (mime_type in ('application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  constraint meeting_note_files_size check (byte_size > 0 and byte_size <= 26214400)
);

alter table public.meeting_note_files enable row level security;

revoke all on table public.meeting_note_files from public, anon, authenticated;
grant select on table public.meeting_note_files to authenticated;

drop policy if exists meeting_note_files_select_participant on public.meeting_note_files;
create policy meeting_note_files_select_participant on public.meeting_note_files
  for select to authenticated
  using (private.is_conversation_participant (conversation_id, (select auth.uid ())));

-- Frozen with the note: nothing may be added, swapped or removed once it is finalized.
create or replace function public.enforce_meeting_note_file_immutable ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.group_decisions
  where id = coalesce(new.decision_id, old.decision_id);
  if v_status in ('finalized', 'closed') then
    raise exception 'avora_decision_settled_immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_meeting_note_file_immutable () from public, anon, authenticated;

drop trigger if exists meeting_note_files_immutable on public.meeting_note_files;
create trigger meeting_note_files_immutable
  before insert or update or delete on public.meeting_note_files
  for each row execute function public.enforce_meeting_note_file_immutable ();

-- Storage: read only a file a note actually points at, in a group you are in; upload only into a draft you
-- may edit, under {conversation_id}/{decision_id}/…; delete only your own upload once nothing points at it.
drop policy if exists meeting_files_read on storage.objects;
create policy meeting_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-files'
    and exists (
      select 1 from public.meeting_note_files f
      where f.storage_path = objects.name
        and private.is_conversation_participant (f.conversation_id, (select auth.uid ()))
    )
  );

drop policy if exists meeting_files_write on storage.objects;
create policy meeting_files_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-files'
    and (storage.foldername (name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and (storage.foldername (name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and private.decision_conversation (((storage.foldername (name))[2])::uuid)
      = ((storage.foldername (name))[1])::uuid
    and private.can_edit_meeting_note (((storage.foldername (name))[2])::uuid, (select auth.uid ()))
  );

drop policy if exists meeting_files_delete_own on storage.objects;
create policy meeting_files_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meeting-files'
    and owner = (select auth.uid ())
    and not exists (select 1 from public.meeting_note_files f where f.storage_path = objects.name)
  );

-- Attach or replace. Returns the path it replaced (or null) so the uploader can tidy the old object.
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
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  -- The path must sit under this note, and the object must exist and be the caller's own upload:
  -- otherwise a note could be pointed at someone else's file.
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
  values (p_decision_id, v_note.conversation_id, p_storage_path, left (btrim(p_file_name), 255), p_mime_type,
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

-- Back to the AVORA template. Returns the path that was detached (or null).
create or replace function public.remove_meeting_note_file (p_decision_id uuid)
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
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  delete from public.meeting_note_files where decision_id = p_decision_id returning storage_path into v_old;
  return v_old;
end;
$$;

revoke execute on function public.remove_meeting_note_file (uuid) from public, anon;
grant execute on function public.remove_meeting_note_file (uuid) to authenticated;

------------------------------------------------------------------------------------------------------------
-- 8. "Lưu vào Nhật ký" — a reference in the saver's own Diary, never a copy
------------------------------------------------------------------------------------------------------------

create table if not exists public.journal_references (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The saver's Diary (ADR-017: Diary is their personal conversation, not a separate store).
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  decision_id uuid references public.group_decisions (id) on delete set null,
  -- What the note was, in words, as of saving — so the entry still says what it is if the saver later
  -- leaves the group and can no longer open the note itself.
  context_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint journal_references_one_per_note unique (user_id, decision_id),
  constraint journal_references_snapshot_object check (jsonb_typeof(context_snapshot) = 'object')
);

create index if not exists journal_references_user_idx on public.journal_references (user_id, created_at desc);

alter table public.journal_references enable row level security;

revoke all on table public.journal_references from public, anon, authenticated;
grant select, delete on table public.journal_references to authenticated;

drop policy if exists journal_references_select_own on public.journal_references;
create policy journal_references_select_own on public.journal_references
  for select to authenticated
  using (user_id = (select auth.uid ()));

drop policy if exists journal_references_delete_own on public.journal_references;
create policy journal_references_delete_own on public.journal_references
  for delete to authenticated
  using (user_id = (select auth.uid ()));

create or replace function public.save_meeting_note_to_journal (p_decision_id uuid)
  returns public.journal_references
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_journal uuid;
  v_row public.journal_references%rowtype;
  v_file public.meeting_note_files%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id;
  if not found or not private.is_conversation_participant (v_note.conversation_id, v_uid) then
    raise exception 'avora_decision_not_found';
  end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'finalized' then raise exception 'avora_note_not_finalized'; end if;

  select * into v_row from public.journal_references where user_id = v_uid and decision_id = p_decision_id;
  if found then
    return v_row;
  end if;

  select * into v_file from public.meeting_note_files where decision_id = p_decision_id;
  v_journal := public.ensure_personal_journal (v_uid);

  insert into public.journal_references (user_id, conversation_id, decision_id, context_snapshot)
  values (v_uid, v_journal, p_decision_id, jsonb_build_object(
    'kind', 'meeting_note',
    'decision_id', p_decision_id::text,
    'title', v_note.title,
    'group_id', v_note.conversation_id::text,
    'group_name', coalesce((select name from public.conversation_groups
      where conversation_id = v_note.conversation_id), ''),
    'author_name', coalesce((select display_name from public.profiles where id = v_note.created_by), ''),
    'finalized_at', to_char(v_note.settled_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'file_name', v_file.file_name,
    'saved_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')))
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.save_meeting_note_to_journal (uuid) from public, anon;
grant execute on function public.save_meeting_note_to_journal (uuid) to authenticated;
