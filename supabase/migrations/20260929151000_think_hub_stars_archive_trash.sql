-- Đợt gộp 2 · C5 / C6 / C7 / C8 / C10.
--   C8  ★ Quan trọng: a private star per person per Hạng mục.
--   C10 Lưu trữ: an archived table (and every sub-table under it) is read-only for everyone,
--       enforced by triggers so no path slips past; stars stay writable.
--   C5  Deleting a personal table takes its tasks to the Task bin (flags only) and logs exactly
--       which, so restoring brings back that set and nothing a person had binned themselves.
--   C6  Kệ sách: one bookshelf table per person.
--   C7  Nhìn lại: rest day + two switches on profiles.

-- ------------------------------------------------------------------ columns
alter table public.think_hub_table
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists kind text;

alter table public.think_hub_table
  drop constraint if exists think_hub_table_kind_check,
  add constraint think_hub_table_kind_check check (kind is null or kind = 'bookshelf'),
  drop constraint if exists think_hub_table_bookshelf_personal,
  add constraint think_hub_table_bookshelf_personal check (
    kind is null or (conversation_id is null and project_id is null and parent_record_id is null));

create unique index if not exists think_hub_table_one_bookshelf
  on public.think_hub_table (owner_user_id) where kind = 'bookshelf';

grant select (archived_at, archived_by, kind) on public.think_hub_table to authenticated;

alter table public.profiles
  add column if not exists rest_weekday smallint not null default 0,
  add column if not exists review_daily_enabled boolean not null default true,
  add column if not exists review_daily_hour smallint not null default 19,
  add column if not exists review_weekly_enabled boolean not null default true;
alter table public.profiles
  drop constraint if exists profiles_rest_weekday_range,
  add constraint profiles_rest_weekday_range check (rest_weekday between 0 and 6),
  drop constraint if exists profiles_review_daily_hour_range,
  add constraint profiles_review_daily_hour_range check (review_daily_hour between 12 and 23);
grant select (rest_weekday, review_daily_enabled, review_daily_hour, review_weekly_enabled) on public.profiles to authenticated;
grant update (rest_weekday, review_daily_enabled, review_daily_hour, review_weekly_enabled) on public.profiles to authenticated;

-- ------------------------------------------------------------------ archived state
-- A sub-table follows its root: walk up through the Hạng mục each level grew from.
create or replace function private.think_hub_table_archived(p_table_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with recursive chain as (
    select t.id, t.parent_record_id, t.archived_at, 1 as lvl from think_hub_table t where t.id = p_table_id
    union all
    select p.id, p.parent_record_id, p.archived_at, chain.lvl + 1
    from chain
    join think_hub_record r on r.id = chain.parent_record_id
    join think_hub_table p on p.id = r.table_id
    where chain.lvl < 5
  )
  select exists (select 1 from chain where archived_at is not null)
$$;
revoke all on function private.think_hub_table_archived(uuid) from public, anon, authenticated;

create or replace function private.block_archived_table()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent_table uuid;
begin
  if tg_op = 'INSERT' then
    if new.parent_record_id is not null then
      select table_id into v_parent_table from think_hub_record where id = new.parent_record_id;
      if private.think_hub_table_archived(v_parent_table) then raise exception 'avora_table_archived'; end if;
    end if;
    return new;
  end if;
  -- Archiving / unarchiving / binning an archived table are the only changes allowed.
  if (old.archived_at is not null or private.think_hub_table_archived(old.id))
     and (new.name, new.purpose, new.column_defs, new.position, new.status_options, new.title_label,
          new.default_view, new.mobile_columns)
         is distinct from
         (old.name, old.purpose, old.column_defs, old.position, old.status_options, old.title_label,
          old.default_view, old.mobile_columns)
  then
    raise exception 'avora_table_archived';
  end if;
  return new;
end $$;

drop trigger if exists trg_think_hub_table_archived on public.think_hub_table;
create trigger trg_think_hub_table_archived before insert or update on public.think_hub_table
  for each row execute function private.block_archived_table();

create or replace function private.block_archived_record()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if private.think_hub_table_archived(new.table_id) then raise exception 'avora_table_archived'; end if;
  return new;
end $$;

drop trigger if exists trg_think_hub_record_archived on public.think_hub_record;
create trigger trg_think_hub_record_archived before insert or update on public.think_hub_record
  for each row execute function private.block_archived_record();

create or replace function private.block_archived_record_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_table uuid;
begin
  if new.record_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.record_id is not distinct from old.record_id then return new; end if;
  select table_id into v_table from think_hub_record where id = new.record_id;
  if private.think_hub_table_archived(v_table) then raise exception 'avora_table_archived'; end if;
  return new;
end $$;

drop trigger if exists trg_think_hub_record_tasks_archived on public.think_hub_record_tasks;
create trigger trg_think_hub_record_tasks_archived before insert or update on public.think_hub_record_tasks
  for each row execute function private.block_archived_record_link();
drop trigger if exists trg_project_tasks_archived on public.project_tasks;
create trigger trg_project_tasks_archived before insert or update on public.project_tasks
  for each row execute function private.block_archived_record_link();

-- ------------------------------------------------------------------ C8 stars
create table if not exists public.think_hub_record_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.think_hub_record(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
create index if not exists think_hub_record_stars_record_idx on public.think_hub_record_stars (record_id);
alter table public.think_hub_record_stars enable row level security;
revoke all on public.think_hub_record_stars from anon, authenticated;
grant select on public.think_hub_record_stars to authenticated;
drop policy if exists think_hub_record_stars_own on public.think_hub_record_stars;
create policy think_hub_record_stars_own on public.think_hub_record_stars for select to authenticated
  using (user_id = (select auth.uid()));

-- Returns whether the Hạng mục is starred after the call.
create or replace function public.toggle_record_star(p_record_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_table uuid;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select table_id into v_table from think_hub_record where id = p_record_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(v_table, v_user) then
    raise exception 'avora_think_hub_record_not_yours';
  end if;
  delete from think_hub_record_stars where user_id = v_user and record_id = p_record_id;
  if found then return false; end if;
  insert into think_hub_record_stars (user_id, record_id) values (v_user, p_record_id);
  return true;
end $$;
revoke all on function public.toggle_record_star(uuid) from public, anon;
grant execute on function public.toggle_record_star(uuid) to authenticated;

-- ------------------------------------------------------------------ C10 personal archive
create or replace function public.set_think_hub_table_archived(p_table_id uuid, p_archived boolean)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.parent_record_id is not null then raise exception 'avora_think_hub_sub_table_follows_root'; end if;
  if v_row.kind = 'bookshelf' then raise exception 'avora_bookshelf_locked'; end if;
  if v_row.project_id is not null then raise exception 'avora_think_hub_project_root_locked'; end if;
  if v_row.conversation_id is not null
     and coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
    raise exception 'avora_shared_needs_proposal';
  end if;
  if v_row.conversation_id is null and v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;

  update think_hub_table set
    archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
    archived_by = case when p_archived then coalesce(archived_by, v_user) else null end
  where id = p_table_id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_think_hub_table_archived(uuid, boolean) from public, anon;
grant execute on function public.set_think_hub_table_archived(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ C5 cascade log
create table if not exists public.think_hub_delete_cascade (
  batch_id uuid not null,
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  side text not null check (side in ('creator', 'peer')),
  created_at timestamptz not null default now(),
  primary key (batch_id, task_id, side)
);
create index if not exists think_hub_delete_cascade_table_idx on public.think_hub_delete_cascade (table_id);
alter table public.think_hub_delete_cascade enable row level security;
revoke all on public.think_hub_delete_cascade from anon, authenticated;

-- Every table under a root (the root included), up to the three-level limit.
create or replace function private.think_hub_table_tree(p_table_id uuid)
returns table (id uuid) language sql stable security definer set search_path = public, pg_temp as $$
  with recursive tree as (
    select t.id, 1 as lvl from think_hub_table t where t.id = p_table_id
    union all
    select c.id, tree.lvl + 1
    from tree
    join think_hub_record r on r.table_id = tree.id
    join think_hub_table c on c.parent_record_id = r.id
    where tree.lvl < 4
  )
  select tree.id from tree
$$;

-- Bins the tasks hanging off a table tree, flags only. The person doing unfinished work keeps it:
-- the assignee's side is only binned when the task is done or skipped.
create or replace function private.cascade_table_tasks(p_table_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch uuid := gen_random_uuid(); v_count integer := 0; v_task record;
begin
  for v_task in
    select distinct t.id, t.type, t.status, t.deleted_by_creator, t.deleted_by_peer
    from private.think_hub_table_tree(p_table_id) tr
    join think_hub_record r on r.table_id = tr.id
    left join think_hub_record_tasks rt on rt.record_id = r.id
    left join project_tasks pt on pt.record_id = r.id
    join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
  loop
    if not v_task.deleted_by_creator then
      update tasks set deleted_by_creator = true, updated_at = now() where id = v_task.id;
      insert into think_hub_delete_cascade (batch_id, table_id, task_id, side) values (v_batch, p_table_id, v_task.id, 'creator');
      v_count := v_count + 1;
    end if;
    if v_task.type <> 'personal' and not v_task.deleted_by_peer and v_task.status in ('done', 'skipped') then
      update tasks set deleted_by_peer = true, updated_at = now() where id = v_task.id;
      insert into think_hub_delete_cascade (batch_id, table_id, task_id, side) values (v_batch, p_table_id, v_task.id, 'peer');
    end if;
  end loop;
  return v_count;
end $$;

create or replace function private.restore_table_tasks(p_table_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update tasks t set deleted_by_creator = false, updated_at = now()
  from think_hub_delete_cascade c where c.table_id = p_table_id and c.task_id = t.id and c.side = 'creator';
  update tasks t set deleted_by_peer = false, updated_at = now()
  from think_hub_delete_cascade c where c.table_id = p_table_id and c.task_id = t.id and c.side = 'peer';
  delete from think_hub_delete_cascade where table_id = p_table_id;
end $$;

revoke all on function private.think_hub_table_tree(uuid) from public, anon, authenticated;
revoke all on function private.cascade_table_tasks(uuid) from public, anon, authenticated;
revoke all on function private.restore_table_tasks(uuid) from public, anon, authenticated;

-- What deleting would take along, for the dialog.
create or replace function public.preview_think_hub_table_delete(p_table_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v jsonb;
begin
  if v_user is null or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  select jsonb_build_object(
    'records', (select count(*) from think_hub_record r join private.think_hub_table_tree(p_table_id) tr on tr.id = r.table_id
                where r.deleted_at is null and r.table_id = p_table_id),
    'sub_tables', (select count(*) - 1 from private.think_hub_table_tree(p_table_id) tr
                   join think_hub_table t on t.id = tr.id where t.deleted_at is null),
    'tasks', (select count(distinct t.id) from private.think_hub_table_tree(p_table_id) tr
              join think_hub_record r on r.table_id = tr.id
              left join think_hub_record_tasks rt on rt.record_id = r.id
              left join project_tasks pt on pt.record_id = r.id
              join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
              where not t.deleted_by_creator),
    'tasks_kept_by_assignee', (select count(distinct t.id) from private.think_hub_table_tree(p_table_id) tr
              join think_hub_record r on r.table_id = tr.id
              left join think_hub_record_tasks rt on rt.record_id = r.id
              left join project_tasks pt on pt.record_id = r.id
              join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
              where t.type <> 'personal' and t.status not in ('done', 'skipped'))
  ) into v;
  return v;
end $$;
revoke all on function public.preview_think_hub_table_delete(uuid) from public, anon;
grant execute on function public.preview_think_hub_table_delete(uuid) to authenticated;

-- ------------------------------------------------------------------ delete / restore / purge
create or replace function public.delete_think_hub_table(p_table_id uuid)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.project_id is not null and v_row.parent_record_id is null then
    raise exception 'avora_think_hub_project_root_locked';
  end if;
  if v_row.kind = 'bookshelf' then raise exception 'avora_bookshelf_locked'; end if;
  -- ADR-031: a shared table is never deleted by one person; only an approved proposal gets here.
  if (v_row.conversation_id is not null or v_row.project_id is not null) then
    if coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
      raise exception 'avora_shared_needs_proposal';
    end if;
  elsif v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;

  perform private.cascade_table_tasks(p_table_id);
  update think_hub_table set deleted_at = now() where id = p_table_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.restore_think_hub_table(p_table_id uuid)
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.conversation_id is not null or v_row.project_id is not null then
    if coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
      raise exception 'avora_shared_use_restore_shared';
    end if;
  elsif v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  update think_hub_table set deleted_at = null where id = p_table_id returning * into v_row;
  perform private.restore_table_tasks(p_table_id);
  return v_row;
end $$;

-- Xoá vĩnh viễn: personal tables in the bin only, typed name must match. Tasks binned with it stay
-- in the Task bin (only the link to the Hạng mục goes).
create or replace function public.purge_think_hub_table(p_table_id uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or v_row.owner_user_id <> v_user then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_row.conversation_id is not null or v_row.project_id is not null then
    raise exception 'avora_shared_no_purge';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_row.name) then
    raise exception 'avora_confirm_name_mismatch';
  end if;
  delete from think_hub_delete_cascade where table_id = p_table_id;
  delete from think_hub_table where id = p_table_id;
end $$;
revoke all on function public.purge_think_hub_table(uuid, text) from public, anon;
grant execute on function public.purge_think_hub_table(uuid, text) to authenticated;

-- ------------------------------------------------------------------ C6 bookshelf
create or replace function public.ensure_bookshelf()
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype; v_tpl think_hub_template%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('think_hub_bookshelf:' || v_user::text, 0));
  select * into v_row from think_hub_table where owner_user_id = v_user and kind = 'bookshelf';
  if found then
    if v_row.deleted_at is not null or v_row.archived_at is not null then
      update think_hub_table set deleted_at = null, archived_at = null, archived_by = null
      where id = v_row.id returning * into v_row;
    end if;
    return v_row;
  end if;

  select * into v_tpl from think_hub_template where key = 'reading';
  insert into think_hub_table (owner_user_id, name, purpose, position, column_defs, kind)
  values (v_user, 'Kệ sách', v_tpl.guiding_question, 10000, '[]'::jsonb, 'bookshelf')
  returning * into v_row;
  return private.apply_structure_to_table(v_row.id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
    v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, null);
end $$;
revoke all on function public.ensure_bookshelf() from public, anon;
grant execute on function public.ensure_bookshelf() to authenticated;

-- The default "Bảng tổng hợp" is never the bookshelf.
create or replace function public.ensure_default_think_hub_table()
returns public.think_hub_table language plpgsql security definer set search_path = public, pg_temp as $$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('think_hub_default:' || v_user::text, 0));
  SELECT * INTO v_row FROM think_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL AND kind IS NULL
    AND project_id IS NULL AND conversation_id IS NULL AND parent_record_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO think_hub_table (owner_user_id, name, position, column_defs)
  VALUES (v_user, 'Bảng tổng hợp', 0, '[]'::jsonb)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
