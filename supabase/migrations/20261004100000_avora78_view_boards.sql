-- AVORA-81 · PHẦN 1 (AVORA-78) · Bảng Avora lập sẵn: 10 "Bảng xem" (view boards).
--
-- A view board copies nothing into think_hub_record: it reads its source live every time. What a
-- person adds on top — ★ and one private note per row — lives here. Két sắt boards keep the note
-- sealed on the device (AES-GCM, key derived from the vault master key); the server only ever holds
-- the ciphertext, never a clear note, never an amount (ADR-020 / ADR-034 / ADR-041).
--
-- Three read RPCs serve the Kết nối / Nhiệm vụ boards, each limited to conversations the caller is
-- still in (leaving a group drops its rows). No RPC / view returns money or vault content.
set search_path = '';

-- ---------------------------------------------------------------- per-person settings home
-- profiles already holds every personal setting (one column each). One small JSON for the
-- Kế hoạch / reader preferences that do not deserve a column each: hidden view boards (78),
-- arrangement and reader settings (79).
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_prefs_shape;
alter table public.profiles add constraint profiles_prefs_shape
  check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 8192);
grant select (prefs), update (prefs) on public.profiles to authenticated;

-- ---------------------------------------------------------------- ★ + private note per view row
create table if not exists public.think_hub_view_row_meta (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_key text not null,
  source_key text not null,
  starred boolean not null default false,
  note text,
  note_sealed text,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_key, source_key),
  constraint view_row_meta_board check (board_key in (
    'decisions', 'memorable_days', 'my_projects', 'assigned_by_me',
    'cashflow', 'summary', 'loans', 'payment_calendar', 'expiring_docs', 'assets')),
  constraint view_row_meta_source check (char_length(source_key) between 1 and 200),
  constraint view_row_meta_note_len check (note is null or char_length(note) <= 500),
  constraint view_row_meta_sealed_len check (note_sealed is null or char_length(note_sealed) <= 4000),
  -- Két sắt rows: never a clear note. Other rows: never a sealed one (nothing to open it with).
  constraint view_row_meta_vault_sealed check (
    case when board_key in ('cashflow', 'summary', 'loans', 'payment_calendar', 'expiring_docs', 'assets')
      then note is null else note_sealed is null end)
);

alter table public.think_hub_view_row_meta enable row level security;
drop policy if exists view_row_meta_own_select on public.think_hub_view_row_meta;
drop policy if exists view_row_meta_own_insert on public.think_hub_view_row_meta;
drop policy if exists view_row_meta_own_update on public.think_hub_view_row_meta;
drop policy if exists view_row_meta_own_delete on public.think_hub_view_row_meta;
drop policy if exists avora_session_allowed on public.think_hub_view_row_meta;
create policy view_row_meta_own_select on public.think_hub_view_row_meta for select to authenticated using (user_id = (select auth.uid()));
create policy view_row_meta_own_insert on public.think_hub_view_row_meta for insert to authenticated with check (user_id = (select auth.uid()));
create policy view_row_meta_own_update on public.think_hub_view_row_meta for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy view_row_meta_own_delete on public.think_hub_view_row_meta for delete to authenticated using (user_id = (select auth.uid()));
create policy avora_session_allowed on public.think_hub_view_row_meta as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.think_hub_view_row_meta from public, anon;
grant select, insert, update, delete on public.think_hub_view_row_meta to authenticated;

create or replace function private.touch_view_row_meta() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_view_row_meta_touch on public.think_hub_view_row_meta;
create trigger trg_view_row_meta_touch before update on public.think_hub_view_row_meta
  for each row execute function private.touch_view_row_meta();

-- ---------------------------------------------------------------- Sổ quyết định
create or replace function public.list_my_decisions()
returns table (decision_id uuid, conversation_id uuid, kind text, title text, summary text, settled_at timestamptz, settled_by uuid, settled_by_name text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.conversation_id, d.kind, d.title,
         left(coalesce(nullif(btrim(m.decisions_made), ''), d.body), 300),
         d.settled_at, d.settled_by,
         coalesce(nullif(btrim(p.display_name), ''), 'Người dùng AVORA')
  from public.group_decisions d
  left join public.meeting_note_details m on m.decision_id = d.id
  left join public.profiles p on p.id = d.settled_by
  where (select private.session_allowed())
    and d.status in ('finalized', 'closed')
    and private.is_conversation_participant(d.conversation_id, (select auth.uid()))
    and private.conversation_is_live(d.conversation_id)
  order by d.settled_at desc
  limit 500;
$$;
revoke all on function public.list_my_decisions() from public, anon;
grant execute on function public.list_my_decisions() to authenticated;

-- ---------------------------------------------------------------- Dự án của tôi
create or replace function public.list_my_projects_summary()
returns table (project_id uuid, conversation_id uuid, parent_group_id uuid, title text, status text, target_end_date date, total integer, done integer, overdue integer)
language sql stable security definer set search_path = '' as $$
  select p.id, p.conversation_id, c.parent_group_id, p.title, p.status, p.target_end_date,
         count(t.id)::integer,
         count(t.id) filter (where t.done_at is not null)::integer,
         count(t.id) filter (where t.done_at is null and t.status <> 'skipped' and t.deadline_date < current_date)::integer
  from public.projects p
  join public.conversations c on c.id = p.conversation_id
  left join public.project_tasks pt on pt.project_id = p.id
  left join public.tasks t on t.id = pt.task_id and t.pending_decision_id is null and not t.deleted_by_creator
  where (select private.session_allowed())
    and p.deleted_at is null
    and private.is_conversation_participant(p.conversation_id, (select auth.uid()))
    and private.conversation_is_live(p.conversation_id)
  group by p.id, c.parent_group_id
  order by p.updated_at desc
  limit 200;
$$;
revoke all on function public.list_my_projects_summary() from public, anon;
grant execute on function public.list_my_projects_summary() to authenticated;

-- ---------------------------------------------------------------- Việc tôi giao
-- Only what I asked of someone else: title, who, when, where it stands. Never the assignee's own
-- part of the task (description, output, progress note — ADR-030).
create or replace function public.list_assigned_by_me()
returns table (kind text, item_id uuid, conversation_id uuid, title text, assignee_id uuid, assignee_name text, deadline date, status text, done_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid)
  select 'task'::text, t.id, t.conversation_id, t.title, a.uid,
         coalesce(nullif(btrim(pr.display_name), ''), 'Người dùng AVORA'),
         t.deadline_date, t.status, t.done_at
  from public.tasks t
  cross join me
  cross join lateral (
    select case
      when t.assignee_id is not null then t.assignee_id
      when t.type = '1-1-shared' then (
        select cp.user_id from public.conversation_participants cp
        where cp.conversation_id = t.conversation_id and cp.user_id <> t.creator_id limit 1)
    end as uid
  ) a
  left join public.profiles pr on pr.id = a.uid
  where (select private.session_allowed())
    and t.creator_id = me.uid
    and t.type <> 'personal'
    and a.uid is not null and a.uid <> me.uid
    and t.pending_decision_id is null
    and not t.deleted_by_creator
    and t.status <> 'skipped'
    and (t.done_at is null or t.done_at > now() - interval '30 days')
    and private.is_conversation_participant(t.conversation_id, me.uid)
    and private.conversation_is_live(t.conversation_id)
  union all
  select 'suggestion'::text, s.id, s.conversation_id, s.proposed_title, s.assignee_id,
         coalesce(nullif(btrim(pr.display_name), ''), 'Người dùng AVORA'),
         s.proposed_deadline, 'pending'::text, null::timestamptz
  from public.task_suggestions s
  cross join me
  left join public.profiles pr on pr.id = s.assignee_id
  where (select private.session_allowed())
    and s.proposer_id = me.uid
    and s.status = 'pending'
    and s.assignee_id is not null and s.assignee_id <> me.uid
    and private.is_conversation_participant(s.conversation_id, me.uid)
    and private.conversation_is_live(s.conversation_id)
  limit 500;
$$;
revoke all on function public.list_assigned_by_me() from public, anon;
grant execute on function public.list_assigned_by_me() to authenticated;
