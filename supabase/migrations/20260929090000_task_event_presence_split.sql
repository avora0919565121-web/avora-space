-- AVORA-39 Phần 3 · Nhóm A + mô tả không bắt buộc + luật D3 "việc thuộc người nhận".
--
-- Read before writing (2026-09-29, live): 0 tasks with location/end but no start, 0 tasks with
-- travel/departure but requires_presence = false, 1 task with requires_presence = true (kept as is),
-- 7 accepted suggestions.
--
-- 1. Sự kiện = task with start_at. requires_presence now only means "cần có mặt trực tiếp".
--    - tasks_event_needs_start: location/end need a start (no longer tied to presence).
--    - tasks_presence_needs_start: presence needs a start.
--    - tasks_travel_needs_presence: travel + departure only exist while presence is on;
--      enforce_task_schedule clears them when presence goes off, keeping start/end/location.
-- 2. Ghi chú (description) stays NOT NULL but may be '' (VMT duyệt mục 3): enforce_task_essentials,
--    create_shared_task, update_shared_task_details. (create_task_suggestion / edit_task_suggestion
--    are rewritten in 20260929090200.) create_1_1_shared_task is revoked from clients (Phần 2) and
--    left untouched.
-- 3. private.task_owned_by_assignee: a task some suggestion was accepted into. The proposer may
--    no longer reword / replan it (avora_task_owned_by_assignee). Same signatures → CREATE OR REPLACE.

create index if not exists task_suggestions_accepted_task_idx
  on public.task_suggestions (accepted_task_id) where accepted_task_id is not null;

create or replace function private.task_owned_by_assignee (p_task uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select p_task is not null and exists (
    select 1 from public.task_suggestions s where s.accepted_task_id = p_task
  );
$$;
revoke all on function private.task_owned_by_assignee (uuid) from public, anon;
grant execute on function private.task_owned_by_assignee (uuid) to authenticated;

alter table public.tasks drop constraint tasks_event_needs_start;
alter table public.tasks
  add constraint tasks_event_needs_start
    check ((end_at is null and location is null) or start_at is not null),
  add constraint tasks_presence_needs_start
    check ((not requires_presence) or start_at is not null),
  add constraint tasks_travel_needs_presence
    check (requires_presence or (travel_duration_minutes is null and departure_reminder_at is null));

CREATE OR REPLACE FUNCTION public.enforce_task_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.deadline_tz := btrim(coalesce(nullif(new.deadline_tz, ''), 'Asia/Ho_Chi_Minh'));
  if not exists (select 1 from pg_timezone_names where name = new.deadline_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  -- AVORA-39 Phần 3 · A: "cần có mặt" owns the travel fields. Turning it off clears them; the
  -- Event itself (start/end/location) stays, because an Event no longer implies presence.
  if not coalesce(new.requires_presence, false) then
    new.travel_duration_minutes := null;
    new.departure_reminder_at := null;
  end if;

  new.recurrence := coalesce(nullif(btrim(new.recurrence), ''), 'none');
  if new.recurrence = 'none' then
    new.recurrence_pattern := null;
  end if;

  if new.task_category_id is not null and not exists (
    select 1 from public.task_categories c
    where c.id = new.task_category_id
      and c.user_id = new.creator_id
      and c.deleted_at is null
  ) then
    raise exception 'avora_task_category_foreign';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_task_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.description := btrim(coalesce(new.description, ''));

  if new.deadline_date is null then
    raise exception 'avora_task_deadline_required';
  end if;
  if char_length(new.description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if new.deadline_date < current_date
     and coalesce(current_setting('avora.accepting_suggestion', true), '') <> 'on' then
    raise exception 'avora_task_deadline_past';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shared_task_details(p_task_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.tasks%rowtype;
  v_title text := btrim(p_title);
  v_description text := btrim(coalesce(p_description, ''));
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id
    and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant (v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-39 Phần 3 · D3: work that came from an accepted suggestion belongs to the person who
  -- accepted it. The proposer still reads it, but rewording it is no longer theirs.
  if private.task_owned_by_assignee (p_task_id) and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;

  -- A bystander in a group can read the task but was never party to it, so it is not theirs
  -- to reword. Only the person who asked and the person carrying it may edit.
  if v_uid <> v_row.creator_id
    and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if v_title = '' then
    raise exception 'avora_task_title_blank';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'avora_task_title_max_len';
  end if;
  if char_length(v_description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if p_deadline is null then
    raise exception 'avora_task_deadline_required';
  end if;

  update
    public.tasks
  set
    title = v_title,
    description = v_description,
    deadline_date = p_deadline,
    deadline_time = p_deadline_time,
    deadline_tz = coalesce(p_deadline_tz, deadline_tz),
    updated_at = now()
  where
    id = p_task_id;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shared_task_plan(p_task_id uuid, p_is_milestone boolean DEFAULT NULL::boolean, p_progress_percent integer DEFAULT NULL::integer, p_clear_progress boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row
  from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-39 Phần 3 · D3: see update_shared_task_details.
  if private.task_owned_by_assignee (p_task_id) and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;

  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if p_progress_percent is not null
     and (p_progress_percent < 0 or p_progress_percent > 100) then
    raise exception 'avora_task_progress_range';
  end if;

  update public.tasks
  set
    is_milestone = coalesce(p_is_milestone, is_milestone),
    -- Null means "leave it alone" so one field can be set without disturbing the other;
    -- erasing an estimate is a separate, explicit request.
    progress_percent = case
      when p_clear_progress then null
      else coalesce(p_progress_percent, progress_percent)
    end,
    updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_shared_task(p_conversation_id uuid, p_type text, p_title text, p_description text, p_deadline date, p_task_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb, p_context_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid := coalesce(p_task_id, gen_random_uuid());
  v_type text := btrim(coalesce(p_type, ''));
  v_conv_type text;
  v_assignee uuid := p_assignee_id;
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- AVORA-39 Phần 3 (VMT 28/09): Ghi chú is optional; the name and the deadline are what a task needs.
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;

  -- A suggestion with no trace of the exchange that produced it is exactly the thing this
  -- feature exists to prevent: the person receiving it cannot tell what it refers to.
  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;

  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 / A: no shared task into a blocked 1-1. Groups are untouched.
  perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');

  -- The kind of task and the kind of room have to agree, or a group task could be filed
  -- against a 1-1 thread and inherit the wrong idea of who the assignee is.
  if v_type = '1-1-shared' and v_conv_type <> 'direct' then raise exception 'avora_task_wrong_conversation'; end if;
  if v_type = 'group-shared' and v_conv_type <> 'group' then raise exception 'avora_task_wrong_conversation'; end if;

  if v_type = '1-1-shared' then
    -- Exactly one other person is in the room; naming them is a convenience, not a choice.
    select cp.user_id into v_assignee
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id <> v_uid
    limit 1;
  end if;

  if v_assignee is null then raise exception 'avora_task_assignee_required'; end if;

  -- Work you give yourself is a personal task; the two-party flow needs two parties.
  if v_assignee = v_uid then raise exception 'avora_task_self_assign'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_assignee
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date,
    deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern,
    context_snapshot
  )
  values (
    v_id, v_type, v_uid, v_assignee, p_conversation_id, v_title, v_description, 'pending_confirmation',
    p_deadline, p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'),
    p_category_id, coalesce(p_is_important, false),
    coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern, p_context_snapshot
  )
  on conflict (id) do nothing;

  -- The creator's half of the two-party confirmation, recorded at creation.
  insert into public.task_confirmations (task_id, user_id)
  values (v_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  select * into v_row from public.tasks where id = v_id;
  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- Previous definitions (live, 2026-09-29), kept for the record.
-- ---------------------------------------------------------------------------------------
-- tasks_event_needs_start: CHECK (((NOT requires_presence) OR (start_at IS NOT NULL)))
--
-- CREATE OR REPLACE FUNCTION public.enforce_task_schedule()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- begin
--   new.deadline_tz := btrim(coalesce(nullif(new.deadline_tz, ''), 'Asia/Ho_Chi_Minh'));
--   if not exists (select 1 from pg_timezone_names where name = new.deadline_tz) then
--     raise exception 'avora_task_timezone_invalid';
--   end if;
--
--   new.recurrence := coalesce(nullif(btrim(new.recurrence), ''), 'none');
--   if new.recurrence = 'none' then
--     new.recurrence_pattern := null;
--   end if;
--
--   if new.task_category_id is not null and not exists (
--     select 1 from public.task_categories c
--     where c.id = new.task_category_id
--       and c.user_id = new.creator_id
--       and c.deleted_at is null
--   ) then
--     raise exception 'avora_task_category_foreign';
--   end if;
--
--   return new;
-- end $function$
--
-- CREATE OR REPLACE FUNCTION public.enforce_task_essentials()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SET search_path TO 'public'
-- AS $function$
-- begin
--   new.description := btrim(coalesce(new.description, ''));
--
--   if new.deadline_date is null then
--     raise exception 'avora_task_deadline_required';
--   end if;
--   if new.description = '' then
--     raise exception 'avora_task_description_required';
--   end if;
--   if char_length(new.description) > 2000 then
--     raise exception 'avora_task_description_max_len';
--   end if;
--   if new.deadline_date < current_date
--      and coalesce(current_setting('avora.accepting_suggestion', true), '') <> 'on' then
--     raise exception 'avora_task_deadline_past';
--   end if;
--
--   return new;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.update_shared_task_details(p_task_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid ();
--   v_row public.tasks%rowtype;
--   v_title text := btrim(p_title);
--   v_description text := btrim(p_description);
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
--
--   select
--     * into v_row
--   from
--     public.tasks
--   where
--     id = p_task_id
--     and type in ('1-1-shared', 'group-shared');
--   if not found then
--     raise exception 'avora_task_not_found';
--   end if;
--
--   if not private.is_conversation_participant (v_row.conversation_id, v_uid) then
--     raise exception 'avora_not_a_participant';
--   end if;
--
--   -- A bystander in a group can read the task but was never party to it, so it is not theirs
--   -- to reword. Only the person who asked and the person carrying it may edit.
--   if v_uid <> v_row.creator_id
--     and not public.is_task_assignee (v_row, v_uid) then
--     raise exception 'avora_task_not_party';
--   end if;
--
--   if v_row.status not in ('pending_confirmation', 'confirmed') then
--     raise exception 'avora_task_edit_closed';
--   end if;
--
--   if v_title = '' then
--     raise exception 'avora_task_title_blank';
--   end if;
--   if char_length(v_title) > 200 then
--     raise exception 'avora_task_title_max_len';
--   end if;
--   if v_description = '' then
--     raise exception 'avora_task_description_required';
--   end if;
--   if char_length(v_description) > 2000 then
--     raise exception 'avora_task_description_max_len';
--   end if;
--   if p_deadline is null then
--     raise exception 'avora_task_deadline_required';
--   end if;
--
--   update
--     public.tasks
--   set
--     title = v_title,
--     description = v_description,
--     deadline_date = p_deadline,
--     deadline_time = p_deadline_time,
--     deadline_tz = coalesce(p_deadline_tz, deadline_tz),
--     updated_at = now()
--   where
--     id = p_task_id;
--
--   select
--     * into v_row
--   from
--     public.tasks
--   where
--     id = p_task_id;
--   return v_row;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.update_shared_task_plan(p_task_id uuid, p_is_milestone boolean DEFAULT NULL::boolean, p_progress_percent integer DEFAULT NULL::integer, p_clear_progress boolean DEFAULT false)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_row public.tasks%rowtype;
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
--
--   select * into v_row
--   from public.tasks
--   where id = p_task_id and type in ('1-1-shared', 'group-shared');
--   if not found then
--     raise exception 'avora_task_not_found';
--   end if;
--
--   if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
--     raise exception 'avora_not_a_participant';
--   end if;
--
--   if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
--     raise exception 'avora_task_not_party';
--   end if;
--
--   if v_row.status not in ('pending_confirmation', 'confirmed') then
--     raise exception 'avora_task_edit_closed';
--   end if;
--
--   if p_progress_percent is not null
--      and (p_progress_percent < 0 or p_progress_percent > 100) then
--     raise exception 'avora_task_progress_range';
--   end if;
--
--   update public.tasks
--   set
--     is_milestone = coalesce(p_is_milestone, is_milestone),
--     -- Null means "leave it alone" so one field can be set without disturbing the other;
--     -- erasing an estimate is a separate, explicit request.
--     progress_percent = case
--       when p_clear_progress then null
--       else coalesce(p_progress_percent, progress_percent)
--     end,
--     updated_at = now()
--   where id = p_task_id;
--
--   select * into v_row from public.tasks where id = p_task_id;
--   return v_row;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.create_shared_task(p_conversation_id uuid, p_type text, p_title text, p_description text, p_deadline date, p_task_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb, p_context_snapshot jsonb DEFAULT NULL::jsonb)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_title text := btrim(coalesce(p_title, ''));
--   v_description text := btrim(coalesce(p_description, ''));
--   v_id uuid := coalesce(p_task_id, gen_random_uuid());
--   v_type text := btrim(coalesce(p_type, ''));
--   v_conv_type text;
--   v_assignee uuid := p_assignee_id;
--   v_row public.tasks%rowtype;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
--   if v_title = '' then raise exception 'avora_task_title_blank'; end if;
--   if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
--
--   -- Asking someone for work without saying what you need, or by when, is not a task.
--   if v_description = '' then raise exception 'avora_task_description_required'; end if;
--   if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
--   if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
--   if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
--
--   -- A suggestion with no trace of the exchange that produced it is exactly the thing this
--   -- feature exists to prevent: the person receiving it cannot tell what it refers to.
--   if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
--
--   select c.type into v_conv_type
--   from public.conversations c
--   join public.conversation_participants cp on cp.conversation_id = c.id
--   where c.id = p_conversation_id and cp.user_id = v_uid;
--
--   if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
--   -- AVORA-37 / A: no shared task into a blocked 1-1. Groups are untouched.
--   perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');
--
--   -- The kind of task and the kind of room have to agree, or a group task could be filed
--   -- against a 1-1 thread and inherit the wrong idea of who the assignee is.
--   if v_type = '1-1-shared' and v_conv_type <> 'direct' then raise exception 'avora_task_wrong_conversation'; end if;
--   if v_type = 'group-shared' and v_conv_type <> 'group' then raise exception 'avora_task_wrong_conversation'; end if;
--
--   if v_type = '1-1-shared' then
--     -- Exactly one other person is in the room; naming them is a convenience, not a choice.
--     select cp.user_id into v_assignee
--     from public.conversation_participants cp
--     where cp.conversation_id = p_conversation_id and cp.user_id <> v_uid
--     limit 1;
--   end if;
--
--   if v_assignee is null then raise exception 'avora_task_assignee_required'; end if;
--
--   -- Work you give yourself is a personal task; the two-party flow needs two parties.
--   if v_assignee = v_uid then raise exception 'avora_task_self_assign'; end if;
--
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = p_conversation_id and user_id = v_assignee
--   ) then
--     raise exception 'avora_task_assignee_not_participant';
--   end if;
--
--   -- Idempotent on retry: the client may replay the same generated id.
--   insert into public.tasks (
--     id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date,
--     deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern,
--     context_snapshot
--   )
--   values (
--     v_id, v_type, v_uid, v_assignee, p_conversation_id, v_title, v_description, 'pending_confirmation',
--     p_deadline, p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'),
--     p_category_id, coalesce(p_is_important, false),
--     coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern, p_context_snapshot
--   )
--   on conflict (id) do nothing;
--
--   -- The creator's half of the two-party confirmation, recorded at creation.
--   insert into public.task_confirmations (task_id, user_id)
--   values (v_id, v_uid)
--   on conflict (task_id, user_id) do nothing;
--
--   select * into v_row from public.tasks where id = v_id;
--   return v_row;
-- end;
-- $function$
