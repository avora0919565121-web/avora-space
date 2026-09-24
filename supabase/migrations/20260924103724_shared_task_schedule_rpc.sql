create or replace function public.update_shared_task_schedule(
  p_task_id uuid,
  p_estimated_duration_minutes integer,
  p_requires_presence boolean,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_location text,
  p_travel_duration_minutes integer
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Same party rule as rewording and replanning: the person who asked and the person carrying it.
  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if v_presence and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;

  -- Not an Event means no when/where: the fields are cleared rather than left dangling.
  update public.tasks
  set
    estimated_duration_minutes = p_estimated_duration_minutes,
    requires_presence = v_presence,
    start_at = case when v_presence then p_start_at end,
    end_at = case when v_presence then p_end_at end,
    location = case when v_presence then v_location end,
    travel_duration_minutes = case when v_presence then p_travel_duration_minutes end,
    departure_reminder_at = case
      when v_presence and p_start_at is not null and p_travel_duration_minutes is not null
        then p_start_at - make_interval(mins => p_travel_duration_minutes)
    end,
    updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$$;

revoke execute on function public.update_shared_task_schedule(uuid, integer, boolean, timestamptz, timestamptz, text, integer) from public, anon;
grant execute on function public.update_shared_task_schedule(uuid, integer, boolean, timestamptz, timestamptz, text, integer) to authenticated;
