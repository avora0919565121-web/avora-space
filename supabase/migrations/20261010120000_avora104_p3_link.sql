-- AVORA-104 · PHẦN 3 — Gắn việc vào Hạng mục sau khi tạo (ADR-076).
-- One road for "this task belongs to that Hạng mục", after the fact, from either side:
--   link_task_to_record · unlink_task_from_record · list_linkable_records · list_linkable_tasks · task_record_of
-- The "cùng nơi" rule is the trigger's own (validate_think_hub_record_task / validate_project_task); here it is
-- checked first so the refusal can say where the task lives. A project board writes project_tasks.record_id,
-- any other board think_hub_record_tasks; a task is under at most one Hạng mục (moving it moves it).
-- Shared boards log the link in think_hub_change_log for `Báo nhóm` (ADR-039) — no separate push.

alter table public.think_hub_change_log drop constraint if exists think_hub_change_log_kind_check;
alter table public.think_hub_change_log add constraint think_hub_change_log_kind_check
  check (kind = any (array['record_add', 'record_edit', 'record_delete', 'column_add', 'column_edit', 'column_delete',
                           'board_edit', 'task_link', 'task_unlink']));

-- Where a task lives, in words: Nhật ký · 1-1 với Lan · Nhóm Hoiana · Dự án Hoiana – chiếu sáng.
create or replace function private.task_place_label(p_task_id uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.type = 'personal' then 'Nhật ký'
    when c.type = 'direct' then '1-1 với ' || coalesce((
      select nullif(btrim(p.display_name), '') from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = c.id and cp.user_id <> p_user limit 1), 'người kia')
    when exists (select 1 from public.projects pr where pr.conversation_id = c.id and pr.deleted_at is null)
      then 'Dự án ' || (select pr.title from public.projects pr where pr.conversation_id = c.id and pr.deleted_at is null limit 1)
    else 'Nhóm ' || coalesce((select nullif(btrim(g.name), '') from public.conversation_groups g where g.conversation_id = c.id), 'này')
  end
  from public.tasks t
  left join public.conversations c on c.id = t.conversation_id
  where t.id = p_task_id
$$;
revoke all on function private.task_place_label(uuid, uuid) from public, anon, authenticated;

-- May this person change what hangs under this Hạng mục? Same rule as attaching a file to it.
create or replace function private.think_hub_record_editable(p_record_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
    from public.think_hub_record r
    join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.deleted_at is null and r.archived_at is null
      and t.deleted_at is null and t.archived_at is null
      and private.think_hub_table_visible(t.id, p_user)
      and (t.share_mode = 'edit' or t.owner_user_id = p_user)
      and (t.project_id is null or private.project_is_open(t.project_id))
  )
$$;
revoke all on function private.think_hub_record_editable(uuid, uuid) from public, anon, authenticated;

-- The trigger's "cùng nơi": private board ↔ its owner's personal task; conversation board ↔ that
-- conversation's shared task; project board ↔ the project's chat (or its parent group).
create or replace function private.task_record_same_place(p_task_id uuid, p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.think_hub_record r
    join public.think_hub_table b on b.id = r.table_id
    join public.tasks t on t.id = p_task_id
    left join public.projects pr on pr.id = b.project_id
    where r.id = p_record_id
      and case
        when b.project_id is not null then
          t.type <> 'personal'
          and (t.conversation_id = pr.conversation_id
               or t.conversation_id = (select c.parent_group_id from public.conversations c where c.id = pr.conversation_id))
        when b.conversation_id is null then t.type = 'personal' and t.creator_id = b.owner_user_id
        else t.type <> 'personal' and t.conversation_id = b.conversation_id
      end
  )
$$;
revoke all on function private.task_record_same_place(uuid, uuid) from public, anon, authenticated;

/** `Bảng › Hạng mục` path pieces for one record. */
create or replace function private.record_path(p_record_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select concat_ws(' › ', pr.title, case when pr.title is null then 'Bảng ' || b.name else b.name end)
  from public.think_hub_record r
  join public.think_hub_table b on b.id = r.table_id
  left join public.projects pr on pr.id = b.project_id
  where r.id = p_record_id
$$;
revoke all on function private.record_path(uuid) from public, anon, authenticated;

create or replace function private.log_task_link(p_record_id uuid, p_kind text, p_task_title text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_table uuid; v_owner uuid; v_title text;
begin
  select r.table_id, r.owner_user_id, r.title into v_table, v_owner, v_title from public.think_hub_record r where r.id = p_record_id;
  if v_table is null or not private.think_hub_is_shared(v_table) then return; end if;
  insert into public.think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, after)
  values (v_table, p_actor, p_kind, p_record_id, v_owner, v_title, 1, jsonb_build_object('task', p_task_title));
exception when others then
  raise warning 'avora_board_log_failed';
end $$;
revoke all on function private.log_task_link(uuid, text, text, uuid) from public, anon, authenticated;

/** The Hạng mục a task hangs under now (either road), or null. */
create or replace function private.current_task_record(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select rt.record_id from public.think_hub_record_tasks rt where rt.task_id = p_task_id),
    (select pt.record_id from public.project_tasks pt where pt.task_id = p_task_id and pt.record_id is not null))
$$;
revoke all on function private.current_task_record(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ link
create or replace function public.link_task_to_record(p_task_id uuid, p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_previous uuid;
  v_title text;
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  if not private.think_hub_record_editable(p_record_id, v_uid) then
    raise exception 'avora_record_not_editable' using errcode = '42501';
  end if;
  if not private.task_record_same_place(p_task_id, p_record_id) then
    raise exception '%', format('Việc này thuộc %s, chỉ gắn được vào Hạng mục cùng nơi.', private.task_place_label(p_task_id, v_uid))
      using errcode = 'P0001', hint = 'avora_link_scope';
  end if;

  v_previous := private.current_task_record(p_task_id);
  if v_previous = p_record_id then
    return jsonb_build_object('record_id', p_record_id, 'moved_from', null, 'unchanged', true);
  end if;
  select t.title into v_title from public.tasks t where t.id = p_task_id;
  select b.project_id into v_project from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id where r.id = p_record_id;

  if v_project is not null then
    delete from public.think_hub_record_tasks where task_id = p_task_id;
    insert into public.project_tasks (task_id, project_id, linked_by, record_id)
    values (p_task_id, v_project, v_uid, p_record_id)
    on conflict (task_id) do update set project_id = excluded.project_id, record_id = excluded.record_id;
  else
    update public.project_tasks set record_id = null where task_id = p_task_id and record_id is not null;
    insert into public.think_hub_record_tasks (task_id, record_id, linked_by)
    values (p_task_id, p_record_id, v_uid)
    on conflict (task_id) do update set record_id = excluded.record_id, linked_by = excluded.linked_by, created_at = now();
  end if;

  if v_previous is not null then perform private.log_task_link(v_previous, 'task_unlink', v_title, v_uid); end if;
  perform private.log_task_link(p_record_id, 'task_link', v_title, v_uid);
  return jsonb_build_object('record_id', p_record_id, 'moved_from', v_previous, 'unchanged', false);
end $$;
revoke all on function public.link_task_to_record(uuid, uuid) from public, anon;
grant execute on function public.link_task_to_record(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ unlink
create or replace function public.unlink_task_from_record(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_previous uuid;
  v_title text;
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  v_previous := private.current_task_record(p_task_id);
  if v_previous is null then return; end if;
  if not private.think_hub_record_editable(v_previous, v_uid) then
    raise exception 'avora_record_not_editable' using errcode = '42501';
  end if;
  select t.title into v_title from public.tasks t where t.id = p_task_id;
  delete from public.think_hub_record_tasks where task_id = p_task_id;
  update public.project_tasks set record_id = null where task_id = p_task_id;
  perform private.log_task_link(v_previous, 'task_unlink', v_title, v_uid);
end $$;
revoke all on function public.unlink_task_from_record(uuid) from public, anon;
grant execute on function public.unlink_task_from_record(uuid) to authenticated;

-- ------------------------------------------------------------ where a task hangs now
create or replace function public.task_record_of(p_task_id uuid)
returns table (record_id uuid, record_title text, table_id uuid, table_name text, path text, can_edit boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_record uuid;
begin
  if v_uid is null or not private.session_allowed() or not private.can_view_task(p_task_id, v_uid) then return; end if;
  v_record := private.current_task_record(p_task_id);
  if v_record is null then return; end if;
  return query
    select r.id, r.title, b.id, b.name, private.record_path(r.id),
           private.can_link_task(p_task_id, v_uid) and private.think_hub_record_editable(r.id, v_uid)
    from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id
    where r.id = v_record and r.deleted_at is null and private.think_hub_table_visible(b.id, v_uid);
end $$;
revoke all on function public.task_record_of(uuid) from public, anon;
grant execute on function public.task_record_of(uuid) to authenticated;

-- ------------------------------------------------------------ pickers
create or replace function public.list_linkable_records(p_task_id uuid, p_query text default null)
returns table (record_id uuid, record_title text, table_id uuid, table_name text, path text, is_current boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text := private.fold_search(btrim(coalesce(p_query, '')));
  v_current uuid;
begin
  if v_uid is null or not private.session_allowed() or not private.can_link_task(p_task_id, v_uid) then return; end if;
  v_current := private.current_task_record(p_task_id);
  return query
    select r.id, r.title, b.id, b.name, private.record_path(r.id), r.id = v_current
    from public.think_hub_record r
    join public.think_hub_table b on b.id = r.table_id
    where r.deleted_at is null and r.archived_at is null and b.deleted_at is null and b.archived_at is null
      and private.task_record_same_place(p_task_id, r.id)
      and private.think_hub_record_editable(r.id, v_uid)
      and (v_q = '' or private.fold_search(r.title) like '%' || v_q || '%' or private.fold_search(b.name) like '%' || v_q || '%')
    order by (r.id = v_current) desc, r.updated_at desc, r.id
    limit 30;
end $$;
revoke all on function public.list_linkable_records(uuid, text) from public, anon;
grant execute on function public.list_linkable_records(uuid, text) to authenticated;

create or replace function public.list_linkable_tasks(p_record_id uuid, p_query text default null)
returns table (task_id uuid, title text, deadline_date date, status text, linked_record_title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text := private.fold_search(btrim(coalesce(p_query, '')));
  v_board public.think_hub_table%rowtype;
  v_convs uuid[];
begin
  if v_uid is null or not private.session_allowed() or not private.think_hub_record_editable(p_record_id, v_uid) then return; end if;
  select b.* into v_board from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id where r.id = p_record_id;
  if v_board.project_id is not null then
    select array_remove(array[pr.conversation_id, c.parent_group_id], null) into v_convs
    from public.projects pr join public.conversations c on c.id = pr.conversation_id where pr.id = v_board.project_id;
  elsif v_board.conversation_id is not null then
    v_convs := array[v_board.conversation_id];
  end if;

  return query
    select t.id, t.title, t.deadline_date, t.status,
           (select r2.title from public.think_hub_record r2 where r2.id = private.current_task_record(t.id))
    from public.tasks t
    where t.pending_decision_id is null
      and not t.deleted_by_creator and not t.deleted_by_peer
      and t.status not in ('done', 'skipped', 'done_pending_review')
      and case when v_convs is null then t.type = 'personal' and t.creator_id = v_board.owner_user_id and t.creator_id = v_uid
               else t.type <> 'personal' and t.conversation_id = any (v_convs) end
      and private.can_link_task(t.id, v_uid)
      and private.current_task_record(t.id) is distinct from p_record_id
      and (v_q = '' or private.fold_search(t.title) like '%' || v_q || '%')
    order by (private.current_task_record(t.id) is null) desc, t.created_at desc, t.id
    limit 30;
end $$;
revoke all on function public.list_linkable_tasks(uuid, text) from public, anon;
grant execute on function public.list_linkable_tasks(uuid, text) to authenticated;
