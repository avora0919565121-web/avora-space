-- AVORA-39 Phần 3 · Nhóm D + Nhóm E bản 2 — ba RPC gợi ý, lịch việc chung, đi lại riêng tư.
--
-- Ràng buộc chéo #1: the new create/edit/accept keep private.assert_direct_talk (which runs the
-- AVORA-37 block check and private.can_talk_direct for 1-1s, and avora_verification_text_only in a
-- verification frame — Ràng buộc chéo #2). Added on top (tightening only):
--   - create: a group assignee blocked with the proposer is refused (avora_contact_unavailable);
--   - edit:   assert_direct_talk 'rich' (the old edit had no gate at all);
--   - accept: assert_direct_talk 'rich' (VMT duyệt mục 6) + block check proposer↔assignee.
-- Signatures change for create/edit/update_shared_task_schedule → DROP + CREATE, one version
-- each, no overloads. accept keeps (uuid, uuid): "Nhận & chỉnh" is gone (Nhóm E bản 2), so it
-- needs no edited-copy parameter; the nested call inside create_task_suggestion is unchanged.
-- create_record_task keeps its signature: assignee = caller in a 1-1 Bảng now makes a personal task
-- linked to the Hạng mục ("Cho tôi" in 1-1 = việc cá nhân, VMT 29/09 mục 2).

-- ---------------------------------------------------------------------------------------
-- create_task_suggestion
-- ---------------------------------------------------------------------------------------
drop function public.create_task_suggestion (uuid, uuid, text, text, date, jsonb, uuid, uuid, time, text);

create function public.create_task_suggestion (
  p_conversation_id uuid,
  p_assignee_id uuid,
  p_title text,
  p_description text,
  p_deadline date,
  p_context_snapshot jsonb,
  p_suggestion_id uuid default null,
  p_message_id uuid default null,
  p_deadline_time time default null,
  p_deadline_tz text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_location text default null,
  p_requires_presence boolean default false,
  p_record_id uuid default null,
  p_project_id uuid default null
)
returns public.task_suggestions
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
  v_conv_type text;
  v_snapshot_conv uuid;
  v_table public.think_hub_table%rowtype;
  v_row public.task_suggestions%rowtype;
  v_self boolean;
  k text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  -- Ghi chú is optional (VMT 28/09); only its length is bounded.
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;
  if (p_end_at is not null or v_location is not null or v_presence) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;
  if p_end_at is not null and p_end_at < p_start_at then raise exception 'avora_event_end_before_start'; end if;
  if v_location is not null and char_length(v_location) > 300 then raise exception 'avora_task_location_max_len'; end if;

  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
  if jsonb_typeof(p_context_snapshot) <> 'object' then
    raise exception 'avora_context_snapshot_not_object';
  end if;
  foreach k in array array[
    'conversation_type', 'conversation_id', 'conversation_name',
    'original_message_id', 'original_message_text', 'original_message_sender_id',
    'original_message_sender_name', 'original_message_created_at',
    'user_response', 'snapshot_created_at'
  ] loop
    if not (p_context_snapshot ? k) then
      raise exception 'avora_context_snapshot_missing_key_%', k;
    end if;
  end loop;

  v_snapshot_conv := nullif(p_context_snapshot->>'conversation_id', '')::uuid;
  if v_snapshot_conv is null then raise exception 'avora_context_snapshot_conversation_required'; end if;
  if v_snapshot_conv <> p_conversation_id then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;
  if nullif(p_context_snapshot->>'snapshot_created_at', '') is null then
    raise exception 'avora_context_snapshot_time_required';
  end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;
  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 + AVORA-38: blocked / not bạn / verification frame → refused here, as before.
  perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');

  if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
    raise exception 'avora_context_snapshot_type_mismatch';
  end if;

  if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
  v_self := (p_assignee_id = v_uid);
  if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_assignee_id
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;
  -- Groups: "Cả nhóm" / "Chọn người" never reach someone blocked with the proposer.
  if not v_self and private.is_blocked_between (v_uid, p_assignee_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  if p_message_id is not null and not exists (
    select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;

  -- Where it will be filed once accepted: a project of THIS group, a Hạng mục the proposer can see
  -- on a board of this conversation (or of that project).
  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.conversation_id = p_conversation_id and p.deleted_at is null
  ) then
    raise exception 'avora_project_missing';
  end if;
  if p_record_id is not null then
    select t.* into v_table
    from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.deleted_at is null;
    if not found or not private.think_hub_table_visible (v_table.id, v_uid) then
      raise exception 'avora_think_hub_record_not_yours';
    end if;
    if (p_project_id is not null and v_table.project_id is distinct from p_project_id)
       or (p_project_id is null and v_table.conversation_id is distinct from p_conversation_id) then
      raise exception 'avora_think_hub_record_foreign';
    end if;
  end if;

  insert into public.task_suggestions (
    id, conversation_id, message_id, proposer_id, assignee_id,
    proposed_title, proposed_description, proposed_deadline,
    proposed_deadline_time, proposed_deadline_tz, context_snapshot, status,
    proposed_start_at, proposed_end_at, proposed_location, proposed_requires_presence,
    proposed_record_id, proposed_project_id
  )
  values (
    v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
    v_title, v_description, p_deadline,
    p_deadline_time, v_tz, p_context_snapshot, 'pending',
    p_start_at, p_end_at, v_location, v_presence,
    p_record_id, p_project_id
  )
  on conflict (id) do nothing;

  if v_self then
    perform public.accept_task_suggestion(v_id, gen_random_uuid());
  end if;

  select * into v_row from public.task_suggestions where id = v_id;
  return v_row;
end;
$function$;
revoke all on function public.create_task_suggestion (uuid, uuid, text, text, date, jsonb, uuid, uuid, time, text, timestamptz, timestamptz, text, boolean, uuid, uuid) from public, anon;
grant execute on function public.create_task_suggestion (uuid, uuid, text, text, date, jsonb, uuid, uuid, time, text, timestamptz, timestamptz, text, boolean, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- edit_task_suggestion
-- ---------------------------------------------------------------------------------------
drop function public.edit_task_suggestion (uuid, text, text, date, time, text);

create function public.edit_task_suggestion (
  p_suggestion_id uuid,
  p_title text,
  p_description text,
  p_deadline date,
  p_deadline_time time default null,
  p_deadline_tz text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_location text default null,
  p_requires_presence boolean default false
)
returns public.task_suggestions
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;
  if (p_end_at is not null or v_location is not null or v_presence) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;
  if p_end_at is not null and p_end_at < p_start_at then raise exception 'avora_event_end_before_start'; end if;
  if v_location is not null and char_length(v_location) > 300 then raise exception 'avora_task_location_max_len'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;
  if v_s.proposer_id <> v_uid then raise exception 'avora_task_not_proposer'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  perform private.assert_direct_talk (v_s.conversation_id, v_uid, 'rich');
  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  update public.task_suggestions
  set proposed_title = v_title,
      proposed_description = v_description,
      proposed_deadline = p_deadline,
      proposed_deadline_time = p_deadline_time,
      proposed_deadline_tz = v_tz,
      proposed_start_at = p_start_at,
      proposed_end_at = p_end_at,
      proposed_location = v_location,
      proposed_requires_presence = v_presence
  where id = p_suggestion_id
  returning * into v_s;

  return v_s;
end;
$function$;
revoke all on function public.edit_task_suggestion (uuid, text, text, date, time, text, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.edit_task_suggestion (uuid, text, text, date, time, text, timestamptz, timestamptz, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------
-- accept_task_suggestion (same signature)
-- ---------------------------------------------------------------------------------------
create or replace function public.accept_task_suggestion (p_suggestion_id uuid, p_task_id uuid default null)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_task_id uuid;
  v_type text;
  v_conv_type text;
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;
  if v_s.assignee_id <> v_uid then raise exception 'avora_task_not_assignee'; end if;

  if v_s.status = 'accepted' then
    if v_s.accepted_task_id is null then raise exception 'avora_task_not_found'; end if;
    select * into v_row from public.tasks where id = v_s.accepted_task_id;
    if not found then raise exception 'avora_task_not_found'; end if;
    return v_row;
  end if;

  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  -- VMT duyệt mục 6: accepting is a write into the 1-1 — same gate as sending.
  perform private.assert_direct_talk (v_s.conversation_id, v_uid, 'rich');
  if v_s.proposer_id <> v_uid and private.is_blocked_between (v_uid, v_s.proposer_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  select type into v_conv_type from public.conversations where id = v_s.conversation_id;
  v_type := case when v_conv_type = 'group' then 'group-shared' else '1-1-shared' end;
  v_task_id := coalesce(p_task_id, gen_random_uuid());

  perform set_config('avora.accepting_suggestion', 'on', true);

  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status,
    confirmed_by, confirmed_at, deadline_date, deadline_time, deadline_tz, context_snapshot,
    start_at, end_at, location, requires_presence
  )
  values (
    v_task_id, v_type, v_s.proposer_id, v_s.assignee_id, v_s.conversation_id,
    v_s.proposed_title, v_s.proposed_description, 'confirmed',
    v_uid, now(), v_s.proposed_deadline, v_s.proposed_deadline_time,
    v_s.proposed_deadline_tz, v_s.context_snapshot,
    v_s.proposed_start_at, v_s.proposed_end_at, v_s.proposed_location, v_s.proposed_requires_presence
  );

  perform set_config('avora.accepting_suggestion', 'off', true);

  insert into public.task_confirmations (task_id, user_id)
  values (v_task_id, v_s.proposer_id), (v_task_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  -- Filed where it was raised from (VMT 29/09 mục 3).
  if v_s.proposed_project_id is not null then
    insert into public.project_tasks (task_id, project_id, record_id, linked_by)
    values (v_task_id, v_s.proposed_project_id, v_s.proposed_record_id, v_uid)
    on conflict (task_id) do nothing;
  elsif v_s.proposed_record_id is not null then
    insert into public.think_hub_record_tasks (task_id, record_id, linked_by)
    values (v_task_id, v_s.proposed_record_id, v_uid)
    on conflict (task_id) do nothing;
  end if;

  update public.task_suggestions
  set status = 'accepted', resolved_at = now(), accepted_task_id = v_task_id
  where id = p_suggestion_id;

  select * into v_row from public.tasks where id = v_task_id;
  return v_row;
end;
$function$;
revoke all on function public.accept_task_suggestion (uuid, uuid) from public, anon;
grant execute on function public.accept_task_suggestion (uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- update_shared_task_schedule — Event no longer implies presence; travel of an owned task is private
-- ---------------------------------------------------------------------------------------
drop function public.update_shared_task_schedule (uuid, integer, boolean, timestamptz, timestamptz, text, integer);

create function public.update_shared_task_schedule (
  p_task_id uuid,
  p_estimated_duration_minutes integer,
  p_requires_presence boolean,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_location text,
  p_travel_duration_minutes integer,
  p_reminder_offset_minutes integer default 0
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
  v_owned boolean;
  v_travel integer := case when coalesce(p_requires_presence, false) then p_travel_duration_minutes end;
  v_offset integer := greatest(coalesce(p_reminder_offset_minutes, 0), 0);
  v_departure timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  v_owned := private.task_owned_by_assignee (p_task_id);
  if v_owned and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;
  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;
  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if (v_presence or p_end_at is not null or v_location is not null) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;

  if v_travel is not null and p_start_at is not null then
    v_departure := p_start_at - make_interval(mins => v_travel + v_offset);
  end if;

  update public.tasks
  set
    estimated_duration_minutes = p_estimated_duration_minutes,
    requires_presence = v_presence,
    start_at = p_start_at,
    end_at = p_end_at,
    location = v_location,
    -- An owned task keeps travel out of the shared row: only its assignee may know it.
    travel_duration_minutes = case when v_owned then null else v_travel end,
    departure_reminder_at = case when v_owned then null else v_departure end,
    updated_at = now()
  where id = p_task_id;

  if v_owned then
    if v_travel is null then
      delete from public.task_travel_plans where task_id = p_task_id;
    else
      insert into public.task_travel_plans (task_id, user_id, travel_duration_minutes, reminder_offset_minutes, departure_reminder_at, updated_at)
      values (p_task_id, v_uid, v_travel, v_offset, v_departure, now())
      on conflict (task_id) do update
        set travel_duration_minutes = excluded.travel_duration_minutes,
            reminder_offset_minutes = excluded.reminder_offset_minutes,
            departure_reminder_at = excluded.departure_reminder_at,
            updated_at = now();
    end if;
  end if;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;
revoke all on function public.update_shared_task_schedule (uuid, integer, boolean, timestamptz, timestamptz, text, integer, integer) from public, anon;
grant execute on function public.update_shared_task_schedule (uuid, integer, boolean, timestamptz, timestamptz, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------
-- set_task_travel — "Bạn đi mất bao lâu?" right after Đồng ý (D2)
-- ---------------------------------------------------------------------------------------
create function public.set_task_travel (
  p_task_id uuid,
  p_travel_duration_minutes integer,
  p_reminder_offset_minutes integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_offset integer := greatest(coalesce(p_reminder_offset_minutes, 0), 0);
  v_departure timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.tasks where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;
  if not public.is_task_assignee (v_row, v_uid) or not private.task_owned_by_assignee (p_task_id) then
    raise exception 'avora_task_not_assignee';
  end if;
  if not v_row.requires_presence or v_row.start_at is null then raise exception 'avora_event_needs_start'; end if;
  if p_travel_duration_minutes is not null and (p_travel_duration_minutes < 0 or p_travel_duration_minutes > 1440) then
    raise exception 'avora_task_travel_range';
  end if;

  if p_travel_duration_minutes is null then
    delete from public.task_travel_plans where task_id = p_task_id;
    return false;
  end if;

  v_departure := v_row.start_at - make_interval(mins => p_travel_duration_minutes + v_offset);
  insert into public.task_travel_plans (task_id, user_id, travel_duration_minutes, reminder_offset_minutes, departure_reminder_at, updated_at)
  values (p_task_id, v_uid, p_travel_duration_minutes, v_offset, v_departure, now())
  on conflict (task_id) do update
    set travel_duration_minutes = excluded.travel_duration_minutes,
        reminder_offset_minutes = excluded.reminder_offset_minutes,
        departure_reminder_at = excluded.departure_reminder_at,
        updated_at = now();
  return true;
end;
$function$;
revoke all on function public.set_task_travel (uuid, integer, integer) from public, anon;
grant execute on function public.set_task_travel (uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------
-- suggestion_travel_flags — what the proposer may know: yes/no, never the minutes (D3)
-- ---------------------------------------------------------------------------------------
create function public.suggestion_travel_flags ()
returns table (suggestion_id uuid, travel_arranged boolean)
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select s.id, exists (select 1 from public.task_travel_plans tp where tp.task_id = s.accepted_task_id)
  from public.task_suggestions s
  where s.status = 'accepted'
    and s.accepted_task_id is not null
    and s.proposed_requires_presence
    and (s.proposer_id = auth.uid () or s.assignee_id = auth.uid ())
    and private.is_conversation_participant (s.conversation_id, auth.uid ());
$function$;
revoke all on function public.suggestion_travel_flags () from public, anon;
grant execute on function public.suggestion_travel_flags () to authenticated;

-- ---------------------------------------------------------------------------------------
-- task_recipient_ids — members "Cả nhóm" / "Chọn người" may reach: live members, no block either way
-- ---------------------------------------------------------------------------------------
create function public.task_recipient_ids (p_conversation_id uuid)
returns setof uuid
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select cp.user_id
  from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id
    and private.is_conversation_participant (p_conversation_id, auth.uid ())
    and (cp.user_id = auth.uid () or not private.is_blocked_between (cp.user_id, auth.uid ()));
$function$;
revoke all on function public.task_recipient_ids (uuid) from public, anon;
grant execute on function public.task_recipient_ids (uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- create_record_task (same signature): "Cho tôi" in a 1-1 Bảng → personal task on this Hạng mục
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_record_task(p_record_id uuid, p_task_id uuid, p_title text, p_description text, p_deadline date, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_rec   think_hub_record%ROWTYPE;
  v_table think_hub_table%ROWTYPE;
  v_conv_type text;
  v_task  tasks%ROWTYPE;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc  text := btrim(coalesce(p_description, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_rec FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_rec.table_id, v_uid) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  SELECT * INTO v_table FROM think_hub_table WHERE id = v_rec.table_id;
  IF v_table.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_is_project';
  END IF;
  IF v_table.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = v_table.conversation_id;
  END IF;

  -- Personal: a private Bảng, or "Cho tôi" on a 1-1 Bảng (the other person does not see it).
  IF v_table.conversation_id IS NULL OR (v_conv_type = 'direct' AND p_assignee_id = v_uid) THEN
    IF v_title = '' THEN RAISE EXCEPTION 'avora_task_title_blank'; END IF;
    IF char_length(v_title) > 200 THEN RAISE EXCEPTION 'avora_task_title_max_len'; END IF;
    INSERT INTO tasks (
      id, type, creator_id, title, description, status, deadline_date, deadline_time, deadline_tz,
      is_important, recurrence
    ) VALUES (
      p_task_id, 'personal', v_uid, v_title, v_desc, 'confirmed', p_deadline, p_deadline_time,
      coalesce(nullif(btrim(coalesce(p_deadline_tz, '')), ''), 'Asia/Ho_Chi_Minh'), false, 'none'
    )
    RETURNING * INTO v_task;
  ELSE
    v_task := public.create_shared_task(
      v_table.conversation_id,
      CASE WHEN v_conv_type = 'group' THEN 'group-shared' ELSE '1-1-shared' END,
      p_title, p_description, p_deadline, p_task_id, p_assignee_id, p_deadline_time, p_deadline_tz,
      NULL, false, 'none', NULL,
      jsonb_build_object(
        'conversation_type', v_conv_type,
        'conversation_id', v_table.conversation_id,
        'conversation_name', v_table.name,
        'original_message_id', NULL,
        'original_message_text', '',
        'original_message_sender_id', NULL,
        'original_message_sender_name', '',
        'original_message_created_at', NULL,
        'user_response', 'Từ Hạng mục: ' || v_rec.title,
        'snapshot_created_at', now()
      )
    );
  END IF;

  INSERT INTO think_hub_record_tasks (task_id, record_id, linked_by)
  VALUES (v_task.id, p_record_id, v_uid);

  RETURN v_task;
END;
$function$;

-- ---------------------------------------------------------------------------------------
-- Previous definitions (live, 2026-09-29).
-- ---------------------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.create_task_suggestion(p_conversation_id uuid, p_assignee_id uuid, p_title text, p_description text, p_deadline date, p_context_snapshot jsonb, p_suggestion_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
--  RETURNS task_suggestions
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
--   v_title text := btrim(coalesce(p_title, ''));
--   v_description text := btrim(coalesce(p_description, ''));
--   v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
--   v_conv_type text;
--   v_snapshot_conv uuid;
--   v_row public.task_suggestions%rowtype;
--   v_self boolean;
--   k text;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_title = '' then raise exception 'avora_task_title_blank'; end if;
--   if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
--   if v_description = '' then raise exception 'avora_task_description_required'; end if;
--   if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
--   if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
--   if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
--   if not exists (select 1 from pg_timezone_names where name = v_tz) then
--     raise exception 'avora_task_timezone_invalid';
--   end if;
--
--   -- Same bar a shared task has to clear: a suggestion with no trace of the exchange behind it
--   -- leaves the person receiving it unable to tell what it refers to.
--   if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
--   if jsonb_typeof(p_context_snapshot) <> 'object' then
--     raise exception 'avora_context_snapshot_not_object';
--   end if;
--   foreach k in array array[
--     'conversation_type', 'conversation_id', 'conversation_name',
--     'original_message_id', 'original_message_text', 'original_message_sender_id',
--     'original_message_sender_name', 'original_message_created_at',
--     'user_response', 'snapshot_created_at'
--   ] loop
--     if not (p_context_snapshot ? k) then
--       raise exception 'avora_context_snapshot_missing_key_%', k;
--     end if;
--   end loop;
--
--   v_snapshot_conv := nullif(p_context_snapshot->>'conversation_id', '')::uuid;
--   if v_snapshot_conv is null then raise exception 'avora_context_snapshot_conversation_required'; end if;
--   -- The snapshot must describe the room this is actually being raised in, or it becomes a way
--   -- to write a fabricated quote into someone else's context.
--   if v_snapshot_conv <> p_conversation_id then
--     raise exception 'avora_context_snapshot_foreign_conversation';
--   end if;
--   if nullif(p_context_snapshot->>'snapshot_created_at', '') is null then
--     raise exception 'avora_context_snapshot_time_required';
--   end if;
--
--   select c.type into v_conv_type
--   from public.conversations c
--   join public.conversation_participants cp on cp.conversation_id = c.id
--   where c.id = p_conversation_id and cp.user_id = v_uid;
--   if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
--   -- AVORA-37 / A: no suggestion into a blocked 1-1. Groups are untouched.
--   perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');
--
--   if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
--     raise exception 'avora_context_snapshot_type_mismatch';
--   end if;
--
--   if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
--   v_self := (p_assignee_id = v_uid);
--   -- Asking yourself is only meaningful in a group. In a 1-1 the other person is the only one
--   -- there is to ask, so naming yourself is a mistake rather than a choice.
--   if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = p_conversation_id and user_id = p_assignee_id
--   ) then
--     raise exception 'avora_task_assignee_not_participant';
--   end if;
--
--   -- A quoted message has to belong to this conversation.
--   if p_message_id is not null and not exists (
--     select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
--   ) then
--     raise exception 'avora_context_snapshot_foreign_conversation';
--   end if;
--
--   -- Idempotent on retry: the client may replay the same generated id.
--   insert into public.task_suggestions (
--     id, conversation_id, message_id, proposer_id, assignee_id,
--     proposed_title, proposed_description, proposed_deadline,
--     proposed_deadline_time, proposed_deadline_tz, context_snapshot, status
--   )
--   values (
--     v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
--     v_title, v_description, p_deadline,
--     p_deadline_time, v_tz, p_context_snapshot, 'pending'
--   )
--   on conflict (id) do nothing;
--
--   -- Work taken on by the person raising it needs no answer, so it is answered here and now,
--   -- through the ordinary acceptance path. Re-running this for an already-accepted row is a
--   -- no-op inside that function, which keeps the whole call idempotent.
--   if v_self then
--     perform public.accept_task_suggestion(v_id, gen_random_uuid());
--   end if;
--
--   select * into v_row from public.task_suggestions where id = v_id;
--   return v_row;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.edit_task_suggestion(p_suggestion_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
--  RETURNS task_suggestions
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_s public.task_suggestions%rowtype;
--   v_title text := btrim(coalesce(p_title, ''));
--   v_description text := btrim(coalesce(p_description, ''));
--   v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_title = '' then raise exception 'avora_task_title_blank'; end if;
--   if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
--   if v_description = '' then raise exception 'avora_task_description_required'; end if;
--   if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
--   if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
--   if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
--   if not exists (select 1 from pg_timezone_names where name = v_tz) then
--     raise exception 'avora_task_timezone_invalid';
--   end if;
--
--   select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
--   if not found then raise exception 'avora_suggestion_not_found'; end if;
--
--   -- Editing the ask belongs to the person who asked. The assignee cannot rewrite somebody
--   -- else's request into one they prefer, and neither can a bystander.
--   if v_s.proposer_id <> v_uid then raise exception 'avora_task_not_proposer'; end if;
--
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = v_s.conversation_id and user_id = v_uid
--   ) then
--     raise exception 'avora_not_a_participant';
--   end if;
--
--   -- Only a question can be reworded. Once answered — accepted, skipped or withdrawn — the
--   -- record stands as what it was when it was answered; a retractable edit would let a
--   -- proposer rewrite an offer after the other person had already relied on it.
--   if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;
--
--   update public.task_suggestions
--   set proposed_title = v_title,
--       proposed_description = v_description,
--       proposed_deadline = p_deadline,
--       proposed_deadline_time = p_deadline_time,
--       proposed_deadline_tz = v_tz
--   where id = p_suggestion_id
--   returning * into v_s;
--
--   return v_s;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.accept_task_suggestion(p_suggestion_id uuid, p_task_id uuid DEFAULT NULL::uuid)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_s public.task_suggestions%rowtype;
--   v_task_id uuid;
--   v_type text;
--   v_conv_type text;
--   v_row public.tasks%rowtype;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--
--   -- Lock the suggestion: two taps on a slow connection must not create two tasks.
--   select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
--   if not found then raise exception 'avora_suggestion_not_found'; end if;
--
--   -- Only the person asked may answer. The proposer accepting on their behalf would be
--   -- assigning work while calling it agreement.
--   if v_s.assignee_id <> v_uid then raise exception 'avora_task_not_assignee'; end if;
--
--   -- Retrying returns the task already created rather than failing or making a second one.
--   if v_s.status = 'accepted' then
--     if v_s.accepted_task_id is null then raise exception 'avora_task_not_found'; end if;
--     select * into v_row from public.tasks where id = v_s.accepted_task_id;
--     if not found then raise exception 'avora_task_not_found'; end if;
--     return v_row;
--   end if;
--
--   if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;
--
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = v_s.conversation_id and user_id = v_uid
--   ) then
--     raise exception 'avora_not_a_participant';
--   end if;
--
--   select type into v_conv_type from public.conversations where id = v_s.conversation_id;
--   v_type := case when v_conv_type = 'group' then 'group-shared' else '1-1-shared' end;
--   v_task_id := coalesce(p_task_id, gen_random_uuid());
--
--   -- See enforce_task_essentials: an aged suggestion stays answerable, as it always was.
--   perform set_config('avora.accepting_suggestion', 'on', true);
--
--   -- Accepted on the spot: the assignee has just agreed, so there is nothing left to confirm.
--   -- Going in at 'pending_confirmation' would ask them to accept the thing they just accepted.
--   insert into public.tasks (
--     id, type, creator_id, assignee_id, conversation_id, title, description, status,
--     confirmed_by, confirmed_at, deadline_date, deadline_time, deadline_tz, context_snapshot
--   )
--   values (
--     v_task_id, v_type, v_s.proposer_id, v_s.assignee_id, v_s.conversation_id,
--     v_s.proposed_title, v_s.proposed_description, 'confirmed',
--     v_uid, now(), v_s.proposed_deadline, v_s.proposed_deadline_time,
--     v_s.proposed_deadline_tz, v_s.context_snapshot
--   );
--
--   perform set_config('avora.accepting_suggestion', 'off', true);
--
--   -- Both halves of the two-party record, in one step, because both happened.
--   insert into public.task_confirmations (task_id, user_id)
--   values (v_task_id, v_s.proposer_id), (v_task_id, v_uid)
--   on conflict (task_id, user_id) do nothing;
--
--   update public.task_suggestions
--   set status = 'accepted', resolved_at = now(), accepted_task_id = v_task_id
--   where id = p_suggestion_id;
--
--   select * into v_row from public.tasks where id = v_task_id;
--   return v_row;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.update_shared_task_schedule(p_task_id uuid, p_estimated_duration_minutes integer, p_requires_presence boolean, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_location text, p_travel_duration_minutes integer)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_row public.tasks%rowtype;
--   v_location text := nullif(btrim(coalesce(p_location, '')), '');
--   v_presence boolean := coalesce(p_requires_presence, false);
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
--
--   select * into v_row from public.tasks
--   where id = p_task_id and type in ('1-1-shared', 'group-shared');
--   if not found then
--     raise exception 'avora_task_not_found';
--   end if;
--
--   if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
--     raise exception 'avora_not_a_participant';
--   end if;
--
--   -- Same party rule as rewording and replanning: the person who asked and the person carrying it.
--   if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
--     raise exception 'avora_task_not_party';
--   end if;
--
--   if v_row.status not in ('pending_confirmation', 'confirmed') then
--     raise exception 'avora_task_edit_closed';
--   end if;
--
--   if v_presence and p_start_at is null then
--     raise exception 'avora_event_needs_start';
--   end if;
--
--   -- Not an Event means no when/where: the fields are cleared rather than left dangling.
--   update public.tasks
--   set
--     estimated_duration_minutes = p_estimated_duration_minutes,
--     requires_presence = v_presence,
--     start_at = case when v_presence then p_start_at end,
--     end_at = case when v_presence then p_end_at end,
--     location = case when v_presence then v_location end,
--     travel_duration_minutes = case when v_presence then p_travel_duration_minutes end,
--     departure_reminder_at = case
--       when v_presence and p_start_at is not null and p_travel_duration_minutes is not null
--         then p_start_at - make_interval(mins => p_travel_duration_minutes)
--     end,
--     updated_at = now()
--   where id = p_task_id;
--
--   select * into v_row from public.tasks where id = p_task_id;
--   return v_row;
-- end;
-- $function$
--
-- CREATE OR REPLACE FUNCTION public.create_record_task(p_record_id uuid, p_task_id uuid, p_title text, p_description text, p_deadline date, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_uid   uuid := auth.uid();
--   v_rec   think_hub_record%ROWTYPE;
--   v_table think_hub_table%ROWTYPE;
--   v_conv_type text;
--   v_task  tasks%ROWTYPE;
--   v_title text := btrim(coalesce(p_title, ''));
--   v_desc  text := btrim(coalesce(p_description, ''));
-- BEGIN
--   IF v_uid IS NULL THEN
--     RAISE EXCEPTION 'avora_not_signed_in';
--   END IF;
--
--   SELECT * INTO v_rec FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
--   IF NOT FOUND OR NOT private.think_hub_table_visible(v_rec.table_id, v_uid) THEN
--     RAISE EXCEPTION 'avora_think_hub_record_not_yours';
--   END IF;
--   SELECT * INTO v_table FROM think_hub_table WHERE id = v_rec.table_id;
--   IF v_table.project_id IS NOT NULL THEN
--     RAISE EXCEPTION 'avora_think_hub_record_is_project';
--   END IF;
--
--   IF v_table.conversation_id IS NULL THEN
--     IF v_title = '' THEN RAISE EXCEPTION 'avora_task_title_blank'; END IF;
--     IF char_length(v_title) > 200 THEN RAISE EXCEPTION 'avora_task_title_max_len'; END IF;
--     INSERT INTO tasks (
--       id, type, creator_id, title, description, status, deadline_date, deadline_time, deadline_tz,
--       is_important, recurrence
--     ) VALUES (
--       p_task_id, 'personal', v_uid, v_title, v_desc, 'confirmed', p_deadline, p_deadline_time,
--       coalesce(nullif(btrim(coalesce(p_deadline_tz, '')), ''), 'Asia/Ho_Chi_Minh'), false, 'none'
--     )
--     RETURNING * INTO v_task;
--   ELSE
--     SELECT type INTO v_conv_type FROM conversations WHERE id = v_table.conversation_id;
--     v_task := public.create_shared_task(
--       v_table.conversation_id,
--       CASE WHEN v_conv_type = 'group' THEN 'group-shared' ELSE '1-1-shared' END,
--       p_title, p_description, p_deadline, p_task_id, p_assignee_id, p_deadline_time, p_deadline_tz,
--       NULL, false, 'none', NULL,
--       jsonb_build_object(
--         'conversation_type', v_conv_type,
--         'conversation_id', v_table.conversation_id,
--         'conversation_name', v_table.name,
--         'original_message_id', NULL,
--         'original_message_text', '',
--         'original_message_sender_id', NULL,
--         'original_message_sender_name', '',
--         'original_message_created_at', NULL,
--         'user_response', 'Từ Hạng mục: ' || v_rec.title,
--         'snapshot_created_at', now()
--       )
--     );
--   END IF;
--
--   INSERT INTO think_hub_record_tasks (task_id, record_id, linked_by)
--   VALUES (v_task.id, p_record_id, v_uid);
--
--   RETURN v_task;
-- END;
-- $function$
--
