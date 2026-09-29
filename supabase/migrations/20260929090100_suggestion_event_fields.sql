-- AVORA-39 Phần 3 · Nhóm D4 — gợi ý mang đủ Sự kiện / Hiện diện / Hạng mục / Dự án, và phần riêng
-- tư của người nhận (thời gian đi, giờ nhắc, Các bước, Mang theo).
--
-- 1. task_suggestions: proposed_start_at, proposed_end_at, proposed_location (≤300),
--    proposed_requires_presence (NOT NULL DEFAULT false), proposed_record_id, proposed_project_id
--    (VMT 28/09 mục 3: nullable, attached to the task when the suggestion is accepted).
--    CHECKs mirror tasks. Column-level SELECT granted one by one (not inherited).
-- 2. task_travel_plans: travel + reminder of the ASSIGNEE for a task that came from a suggestion
--    (VMT duyệt mục 2). Only the owner reads it; nobody writes it directly — set_task_travel and
--    update_shared_task_schedule do. For those tasks tasks.travel_duration_minutes /
--    departure_reminder_at stay NULL, so the proposer (who can read the tasks row) never sees them.
--    The proposer gets only a yes/no through suggestion_travel_flags (20260929090200).
-- 3. Các bước / Mang theo of such a task: readable and writable by the assignee only.
--    Deviation from "sửa can_view_task", on purpose: can_view_task also gates the Hạng mục link,
--    dependencies, participants and task_flags, which the proposer should keep. So a narrower
--    private.can_view_task_private is used by the two SELECT policies instead, and can_link_task
--    (their write gate) gets the assignee-only clause. Tightening only — nothing is widened.

alter table public.task_suggestions
  add column proposed_start_at timestamptz,
  add column proposed_end_at timestamptz,
  add column proposed_location text,
  add column proposed_requires_presence boolean not null default false,
  add column proposed_record_id uuid references public.think_hub_record (id) on delete set null,
  add column proposed_project_id uuid references public.projects (id) on delete set null;

alter table public.task_suggestions
  add constraint task_suggestions_location_length
    check (proposed_location is null or char_length (proposed_location) <= 300),
  add constraint task_suggestions_event_needs_start
    check ((proposed_end_at is null and proposed_location is null) or proposed_start_at is not null),
  add constraint task_suggestions_event_end_after_start
    check (proposed_end_at is null or proposed_end_at >= proposed_start_at),
  add constraint task_suggestions_presence_needs_start
    check ((not proposed_requires_presence) or proposed_start_at is not null);

grant select (proposed_start_at, proposed_end_at, proposed_location, proposed_requires_presence,
              proposed_record_id, proposed_project_id)
  on public.task_suggestions to authenticated;
revoke truncate on public.task_suggestions from authenticated, anon;

-- ---------------------------------------------------------------------------------------
create table public.task_travel_plans (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  travel_duration_minutes integer not null check (travel_duration_minutes between 0 and 1440),
  reminder_offset_minutes integer not null default 0 check (reminder_offset_minutes between 0 and 1440),
  departure_reminder_at timestamptz,
  updated_at timestamptz not null default now()
);
create index task_travel_plans_user_idx on public.task_travel_plans (user_id);

alter table public.task_travel_plans enable row level security;
revoke all on public.task_travel_plans from public, anon, authenticated;
grant select (task_id, user_id, travel_duration_minutes, reminder_offset_minutes,
              departure_reminder_at, updated_at)
  on public.task_travel_plans to authenticated;

create policy task_travel_plans_select_own on public.task_travel_plans
  for select to authenticated
  using (user_id = (select auth.uid ()));

-- ---------------------------------------------------------------------------------------
create or replace function private.can_view_task_private (p_task uuid, p_user uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select private.can_view_task (p_task, p_user)
    and (
      not private.task_owned_by_assignee (p_task)
      or exists (select 1 from public.tasks t where t.id = p_task and public.is_task_assignee (t, p_user))
    );
$$;
revoke all on function private.can_view_task_private (uuid, uuid) from public, anon;
grant execute on function private.can_view_task_private (uuid, uuid) to authenticated;

drop policy checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select to authenticated
  using (private.can_view_task_private (task_id, (select auth.uid ())));

drop policy task_resources_select on public.task_resources;
create policy task_resources_select on public.task_resources
  for select to authenticated
  using (private.can_view_task_private (task_id, (select auth.uid ())));

CREATE OR REPLACE FUNCTION private.can_link_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and (t.creator_id = p_user or public.is_task_assignee (t, p_user))
            -- AVORA-39 Phần 3 · D3: once a suggestion was accepted into it, only the assignee.
            and (public.is_task_assignee (t, p_user) or not private.task_owned_by_assignee (t.id)))
      )
  );
$function$;

-- ---------------------------------------------------------------------------------------
-- Previous definitions (live, 2026-09-29).
-- checklist_items_select: USING private.can_view_task(task_id, ( SELECT auth.uid() AS uid))
-- task_resources_select:  USING private.can_view_task(task_id, ( SELECT auth.uid() AS uid))
--
-- CREATE OR REPLACE FUNCTION private.can_link_task(p_task uuid, p_user uuid)
--  RETURNS boolean
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
--   select exists (
--     select 1 from public.tasks t
--     where t.id = p_task
--       and t.pending_decision_id is null
--       and (
--         (t.type = 'personal' and t.creator_id = p_user)
--         or (t.type in ('1-1-shared', 'group-shared')
--             and private.is_conversation_participant (t.conversation_id, p_user)
--             and (t.creator_id = p_user or public.is_task_assignee (t, p_user)))
--       )
--   );
-- $function$
