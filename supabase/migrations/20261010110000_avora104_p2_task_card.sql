-- AVORA-104 · PHẦN 2 — Một thẻ nhiệm vụ (ADR-075).
--  1. `Lặp lại · Ngày làm việc`: recurrence 'weekdays' (Mon–Fri), spawned by the same trigger.
--  2. set_task_recurrence: the card's `Lặp lại` row writes through one checked RPC (personal and shared alike).
--  3. task_files + private bucket `task-files`: `Thêm tệp` on a task. Read = whoever sees the task;
--     add = whoever may edit it; remove = the uploader or the task's creator. Same 25 MB cap as chat.
--     A purged task takes its rows with it (cascade) and its objects go to the K6 sweep queue.

-- ------------------------------------------------------------ 1. weekdays
alter table public.tasks drop constraint if exists tasks_recurrence_allowed;
alter table public.tasks add constraint tasks_recurrence_allowed
  check (recurrence = any (array['none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom']));

create or replace function public.spawn_recurring_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  step interval;
  next_deadline date;
  n integer := 1;
  new_id uuid;
  next_status text;
  freq text;
  every integer;
  due timestamptz;
  r record;
begin
  if new.recurrence in ('daily', 'weekdays') then
    step := interval '1 day';
  elsif new.recurrence = 'weekly' then
    step := interval '7 days';
  elsif new.recurrence = 'monthly' then
    step := interval '1 month';
  elsif new.recurrence = 'custom' then
    freq  := coalesce(new.recurrence_pattern->>'frequency', 'weekly');
    every := greatest(coalesce((new.recurrence_pattern->>'interval')::int, 1), 1);
    step := case freq
              when 'daily' then interval '1 day'
              when 'weekly' then interval '7 days'
              when 'monthly' then interval '1 month'
              else interval '7 days'
            end * every;
  else
    return new;
  end if;

  -- Step forward until the successor is in the future (and, for Ngày làm việc, not a Saturday/Sunday).
  loop
    next_deadline := (new.deadline_date + (step * n))::date;
    exit when (next_deadline > current_date
               and (new.recurrence <> 'weekdays' or extract(isodow from next_deadline) < 6))
      or n > 500;
    n := n + 1;
  end loop;

  if next_deadline <= current_date then
    return new;
  end if;

  next_status := case when new.type = 'personal' then 'confirmed' else 'pending_confirmation' end;

  insert into public.tasks (
    type, creator_id, conversation_id, title, description, status,
    deadline_date, deadline_time, deadline_tz, task_category_id, is_important,
    recurrence, recurrence_pattern, recurrence_origin_id
  ) values (
    new.type, new.creator_id, new.conversation_id, new.title, new.description, next_status,
    next_deadline, new.deadline_time, new.deadline_tz, new.task_category_id, new.is_important,
    new.recurrence, new.recurrence_pattern, coalesce(new.recurrence_origin_id, new.id)
  ) returning id into new_id;

  due := public.task_deadline_instant(next_deadline, new.deadline_time, new.deadline_tz);
  for r in
    select distinct user_id, offset_minutes
    from public.task_reminders
    where task_id = new.id and offset_minutes is not null
  loop
    if due - make_interval(mins => r.offset_minutes) > now() then
      insert into public.task_reminders (task_id, user_id, reminder_time, reminder_tz, offset_minutes)
      values (new_id, r.user_id, due - make_interval(mins => r.offset_minutes), new.deadline_tz, r.offset_minutes)
      on conflict do nothing;
    end if;
  end loop;

  new.recurrence_spawned_at := now();
  return new;
end $function$;

-- ------------------------------------------------------------ 2. set_task_recurrence
create or replace function public.set_task_recurrence(p_task_id uuid, p_recurrence text, p_pattern jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  if p_recurrence not in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom') then
    raise exception 'avora_recurrence_invalid' using errcode = '22023';
  end if;
  if p_recurrence = 'custom' and (p_pattern is null or coalesce((p_pattern ->> 'interval')::int, 0) < 1
      or coalesce(p_pattern ->> 'frequency', '') not in ('daily', 'weekly', 'monthly')) then
    raise exception 'avora_recurrence_invalid' using errcode = '22023';
  end if;
  update public.tasks
     set recurrence = p_recurrence,
         recurrence_pattern = case when p_recurrence = 'custom' then p_pattern else null end,
         updated_at = now()
   where id = p_task_id;
end $$;
revoke all on function public.set_task_recurrence(uuid, text, jsonb) from public, anon;
grant execute on function public.set_task_recurrence(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------ 3. task_files
create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_files_task_idx on public.task_files (task_id, created_at);
create index if not exists task_files_uploader_idx on public.task_files (uploaded_by);
alter table public.task_files enable row level security;

create or replace function private.task_file_task(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function private.task_file_task(text) from public, anon;
grant execute on function private.task_file_task(text) to authenticated;

create or replace function private.task_file_deletable(p_task uuid, p_uploader uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    p_uploader = p_user
    or exists (select 1 from public.tasks t where t.id = p_task and t.creator_id = p_user)
  ) and private.can_view_task(p_task, p_user)
$$;
revoke all on function private.task_file_deletable(uuid, uuid, uuid) from public, anon;
grant execute on function private.task_file_deletable(uuid, uuid, uuid) to authenticated;

create or replace function private.task_file_uploader(p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select uploaded_by from public.task_files where storage_path = p_name
$$;
revoke all on function private.task_file_uploader(text) from public, anon;
grant execute on function private.task_file_uploader(text) to authenticated;

drop policy if exists task_files_select on public.task_files;
create policy task_files_select on public.task_files for select to authenticated
  using (deleted_at is null and private.can_view_task(task_id, (select auth.uid())));
drop policy if exists task_files_insert on public.task_files;
create policy task_files_insert on public.task_files for insert to authenticated
  with check (uploaded_by = (select auth.uid())
    and storage_path like (task_id::text || '/%')
    and private.can_link_task(task_id, (select auth.uid())));
drop policy if exists task_files_delete on public.task_files;
create policy task_files_delete on public.task_files for delete to authenticated
  using (private.task_file_deletable(task_id, uploaded_by, (select auth.uid())));
drop policy if exists avora_session_allowed on public.task_files;
create policy avora_session_allowed on public.task_files as restrictive for all to authenticated
  using ((select private.session_allowed())) with check ((select private.session_allowed()));

revoke all on public.task_files from public, anon, authenticated;
grant select, insert, delete on public.task_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists task_files_read on storage.objects;
create policy task_files_read on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and private.can_view_task(private.task_file_task(name), (select auth.uid())));
drop policy if exists task_files_write on storage.objects;
create policy task_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and private.can_link_task(private.task_file_task(name), (select auth.uid())));
drop policy if exists task_files_remove on storage.objects;
create policy task_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'task-files'
    and private.task_file_deletable(private.task_file_task(name),
      coalesce(private.task_file_uploader(name), (select auth.uid())), (select auth.uid())));

-- A task purged from Thùng rác: its rows cascade away, its objects go to the K6 sweep queue.
alter table private.storage_delete_queue drop constraint if exists storage_delete_queue_reason_check;
alter table private.storage_delete_queue add constraint storage_delete_queue_reason_check
  check (reason in ('orphan', 'journal_trash', 'task_file'));

create or replace function private.queue_task_file_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  values ('task-files', old.storage_path, 'task_file')
  on conflict do nothing;
  return old;
end $$;
revoke all on function private.queue_task_file_object() from public, anon, authenticated;

drop trigger if exists task_files_queue_object on public.task_files;
create trigger task_files_queue_object after delete on public.task_files
  for each row execute function private.queue_task_file_object();
