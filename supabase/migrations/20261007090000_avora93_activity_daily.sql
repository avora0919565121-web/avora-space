-- AVORA-93 · PHẦN 2 (ADR-058) — what I opened and how long I stayed, per day, for my eyes only.
-- Feeds kệ 2 (numbers) and kệ 5 (reading time). No streaks, no goals, no comparison.
set search_path = '';

create table if not exists public.activity_daily (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('board', 'book')),
  -- board: a think_hub_table id or a view-board key (same list as mark_board_opened); book: a record id on my own Kệ sách
  item_key text not null check (char_length(item_key) between 1 and 64),
  day date not null,
  opens integer not null default 0 check (opens >= 0),
  active_seconds integer not null default 0 check (active_seconds between 0 and 57600),
  -- internal: the 30-minute window for counting an open
  last_open_at timestamptz,
  primary key (user_id, kind, item_key, day)
);
create index if not exists activity_daily_user_day on public.activity_daily (user_id, day);
alter table public.activity_daily enable row level security;
drop policy if exists activity_daily_own_select on public.activity_daily;
drop policy if exists avora_session_allowed on public.activity_daily;
create policy activity_daily_own_select on public.activity_daily for select to authenticated using (user_id = (select auth.uid()));
create policy avora_session_allowed on public.activity_daily as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.activity_daily from public, anon, authenticated;
grant select on public.activity_daily to authenticated;

-- Once a day per person, rows older than 180 days go.
create table if not exists private.activity_pruned (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pruned_on date not null
);
revoke all on private.activity_pruned from public, anon, authenticated;

create or replace function private.activity_board_key_ok(p_key text, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.think_hub_table_visible(p_key::uuid, p_user);
  end if;
  return p_key in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','cashflow','summary','loans','payment_calendar','expiring_docs','assets');
end $$;
revoke all on function private.activity_board_key_ok(text, uuid) from public, anon, authenticated;

create or replace function public.log_activity(p_kind text, p_item_key text, p_day date, p_open boolean, p_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_seconds integer := greatest(0, least(coalesce(p_seconds, 0), 120));
  v_open boolean := coalesce(p_open, false);
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_kind is null or p_item_key is null or p_day is null then raise exception 'avora_activity_not_allowed'; end if;
  -- The device's own day, within a day of the server's.
  if p_day < current_date - 1 or p_day > current_date + 1 then raise exception 'avora_activity_bad_day'; end if;
  if p_kind = 'board' then
    if not private.activity_board_key_ok(p_item_key, v_user) then raise exception 'avora_activity_not_allowed'; end if;
    -- Két sắt boards: only that it was opened (ADR-034).
    if p_item_key in ('cashflow','loans','payment_calendar','expiring_docs','assets') then v_seconds := 0; end if;
  elsif p_kind = 'book' then
    if p_item_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
      select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
      where r.id = p_item_key::uuid and r.owner_user_id = v_user and t.owner_user_id = v_user and t.kind = 'bookshelf' and r.deleted_at is null
    ) then raise exception 'avora_activity_not_allowed'; end if;
  else
    raise exception 'avora_activity_not_allowed';
  end if;
  if not v_open and v_seconds = 0 then return; end if;

  insert into public.activity_daily as a (user_id, kind, item_key, day, opens, active_seconds, last_open_at)
  values (v_user, p_kind, p_item_key, p_day, case when v_open then 1 else 0 end, v_seconds, case when v_open then now() end)
  on conflict (user_id, kind, item_key, day) do update set
    active_seconds = least(57600, a.active_seconds + excluded.active_seconds),
    opens = a.opens + case when v_open and (a.last_open_at is null or a.last_open_at < now() - interval '30 minutes') then 1 else 0 end,
    last_open_at = case when v_open and (a.last_open_at is null or a.last_open_at < now() - interval '30 minutes') then now() else a.last_open_at end;

  -- A day can roll over between rows: an open 20 minutes ago yesterday still counts as the same visit.
  if v_open then
    update public.activity_daily set opens = opens - 1, last_open_at = null
    where user_id = v_user and kind = p_kind and item_key = p_item_key and day = p_day and opens > 0 and last_open_at = now()
      and exists (select 1 from public.activity_daily y where y.user_id = v_user and y.kind = p_kind and y.item_key = p_item_key
                  and y.day <> p_day and y.last_open_at >= now() - interval '30 minutes');
  end if;

  insert into private.activity_pruned as p (user_id, pruned_on) values (v_user, current_date)
  on conflict (user_id) do update set pruned_on = excluded.pruned_on where p.pruned_on < excluded.pruned_on;
  if found then delete from public.activity_daily where user_id = v_user and day < current_date - 180; end if;
end $$;
revoke all on function public.log_activity(text, text, date, boolean, integer) from public, anon;
grant execute on function public.log_activity(text, text, date, boolean, integer) to authenticated;

-- Kệ 2's numbers: only the caller's data and boards the caller can still see. Names read now, never copied.
create or replace function public.think_hub_room_stats(p_since date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_out jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_since is null or p_since < current_date - 180 or p_since > current_date + 1 then raise exception 'avora_activity_bad_day'; end if;

  with boards as (
    select t.id, t.name, coalesce(t.lifecycle, 'waiting') as lifecycle
    from public.think_hub_table t
    where t.deleted_at is null and t.archived_at is null and coalesce(t.lifecycle, 'waiting') <> 'archived'
      and t.kind is distinct from 'bookshelf' and t.parent_record_id is null
      and private.think_hub_table_visible(t.id, v_user)
  ),
  recs as (
    select r.id, r.table_id, r.created_at from public.think_hub_record r join boards b on b.id = r.table_id where r.deleted_at is null
  ),
  linked as (
    select rt.task_id from public.think_hub_record_tasks rt join recs on recs.id = rt.record_id
    union
    select pt.task_id from public.project_tasks pt join recs on recs.id = pt.record_id
  ),
  open_tasks as (
    select distinct k.id from public.tasks k join linked l on l.task_id = k.id
    where k.status <> 'done' and (k.creator_id = v_user or k.assignee_id = v_user)
      and not (k.creator_id = v_user and coalesce(k.deleted_by_creator, false))
  ),
  act as (
    select a.kind, a.item_key, sum(a.opens)::int as opens, sum(a.active_seconds)::int as seconds, max(a.day) as last_day
    from public.activity_daily a where a.user_id = v_user and a.day >= p_since group by a.kind, a.item_key
  ),
  board_act as (
    select act.*, b.name from act left join boards b on b.id::text = act.item_key
    where act.kind = 'board' and (b.id is not null or act.item_key !~ '^[0-9a-f]{8}-')
  ),
  book_act as (
    select act.*, r.title as name from act join public.think_hub_record r on r.id::text = act.item_key
    where act.kind = 'book' and r.owner_user_id = v_user and r.deleted_at is null
  ),
  counts as (select table_id, count(*)::int as n from recs group by table_id)
  select jsonb_build_object(
    'boards_by_status', jsonb_build_object(
      'waiting', (select count(*) from boards where lifecycle = 'waiting'),
      'thinking', (select count(*) from boards where lifecycle = 'thinking'),
      'concluded', (select count(*) from boards where lifecycle = 'concluded')),
    'records_total', (select count(*) from recs),
    'records_new', (select count(*) from recs where created_at >= p_since::timestamptz),
    'open_tasks', (select count(*) from open_tasks),
    'top_items', coalesce((select jsonb_agg(x order by x.value desc, x.name) from (
        select b.id::text as board_key, b.name, c.n as value from boards b join counts c on c.table_id = b.id order by c.n desc, b.name limit 3) x), '[]'::jsonb),
    'top_opens', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, opens as value from board_act where opens > 0 order by opens desc, item_key limit 3) x), '[]'::jsonb),
    'top_time', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, seconds as value from board_act where seconds > 0 order by seconds desc, item_key limit 3) x), '[]'::jsonb),
    'viewed', coalesce((select jsonb_agg(x order by x.last_day desc, x.seconds desc) from (
        select 'board' as kind, item_key, name, opens, seconds, last_day from board_act
        union all
        select 'book', item_key, name, opens, seconds, last_day from book_act) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.think_hub_room_stats(date) from public, anon;
grant execute on function public.think_hub_room_stats(date) to authenticated;
