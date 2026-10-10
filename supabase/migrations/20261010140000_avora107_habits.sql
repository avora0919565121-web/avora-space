-- AVORA-107 · PHẦN 1 — Thói quen (nền).
-- Thói quen là kỷ luật, không phải nhiệm vụ: hai bảng riêng, không đụng `tasks`. Không chuỗi, không điểm.
-- Ghi chỉ qua RPC (SECURITY DEFINER, search_path = '', kiểm auth.uid(), session_allowed); đọc: chủ đọc của mình.
-- weekdays: 1 = Thứ Hai … 7 = Chủ nhật (ISO). local_date = ngày theo giờ máy người dùng (24:00), máy chủ
-- chỉ nhận trong khoảng hôm qua → ngày mai so với giờ máy chủ.

-- ---------------------------------------------------------------- habits
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null,
  target_minutes integer,
  weekdays integer[] not null default '{1,2,3,4,5,6,7}',
  windows jsonb not null,
  reminders_on boolean not null default true,
  paused_at timestamptz,
  archived_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habits_name check (char_length(btrim(name)) between 1 and 80),
  constraint habits_kind check (kind in ('timed', 'check')),
  constraint habits_target check (
    (kind = 'timed' and target_minutes is not null and target_minutes between 1 and 600) or (kind = 'check' and target_minutes is null)),
  constraint habits_weekdays check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]),
  constraint habits_windows check (jsonb_typeof(windows) = 'array' and jsonb_array_length(windows) between 1 and 12)
);
create index if not exists habits_user on public.habits (user_id);
alter table public.habits drop constraint if exists habits_target;
alter table public.habits add constraint habits_target check (
  (kind = 'timed' and target_minutes is not null and target_minutes between 1 and 600) or (kind = 'check' and target_minutes is null));

-- ---------------------------------------------------------------- habit_logs
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  window_index integer not null,
  status text not null,
  done_at timestamptz not null default now(),
  source text not null default 'manual',
  duration_seconds integer,
  note text,
  created_at timestamptz not null default now(),
  constraint habit_logs_window check (window_index between 0 and 11),
  constraint habit_logs_status check (status in ('done', 'abandoned')),
  constraint habit_logs_source check (source in ('manual', 'timer')),
  constraint habit_logs_duration check (duration_seconds is null or duration_seconds between 0 and 86400),
  constraint habit_logs_note check (note is null or char_length(note) <= 500)
);
-- Bấm hai lần không ghi đôi.
create unique index if not exists habit_logs_done_once on public.habit_logs (habit_id, local_date, window_index) where status = 'done';
create index if not exists habit_logs_user_date on public.habit_logs (user_id, local_date);
create index if not exists habit_logs_habit on public.habit_logs (habit_id, local_date);

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
drop policy if exists habits_own_select on public.habits;
drop policy if exists habit_logs_own_select on public.habit_logs;
drop policy if exists avora_session_allowed on public.habits;
drop policy if exists avora_session_allowed on public.habit_logs;
create policy habits_own_select on public.habits for select to authenticated using (user_id = (select auth.uid()));
create policy habit_logs_own_select on public.habit_logs for select to authenticated using (user_id = (select auth.uid()));
create policy avora_session_allowed on public.habits as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
create policy avora_session_allowed on public.habit_logs as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.habits, public.habit_logs from public, anon, authenticated;
grant select on public.habits, public.habit_logs to authenticated;

-- ---------------------------------------------------------------- helpers (private)
create or replace function private.habit_windows_clean(p_windows jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '[]'::jsonb; v_item jsonb; v_time text;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) not between 1 and 12 then
    raise exception 'avora_habit_windows' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_windows) loop
    v_time := v_item->>'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'avora_habit_windows' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('time', v_time, 'remind', coalesce((v_item->>'remind')::boolean, true)));
  end loop;
  -- Theo giờ trong ngày, không trùng giờ.
  select coalesce(jsonb_agg(w order by w->>'time'), '[]'::jsonb) into v_out from (select distinct on (w->>'time') w from jsonb_array_elements(v_out) w order by w->>'time') x;
  return v_out;
end $$;
revoke all on function private.habit_windows_clean(jsonb) from public, anon;
grant execute on function private.habit_windows_clean(jsonb) to authenticated;

create or replace function private.habit_date_ok(p_date date) returns boolean
language sql stable set search_path = '' as $$
  select p_date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
$$;
revoke all on function private.habit_date_ok(date) from public, anon;
grant execute on function private.habit_date_ok(date) to authenticated;

create or replace function private.habit_owned(p_habit uuid, p_uid uuid) returns public.habits
language plpgsql stable set search_path = '' as $$
declare v public.habits;
begin
  if p_uid is null or not private.session_allowed() then raise exception 'avora_not_signed_in' using errcode = '42501'; end if;
  select * into v from public.habits where id = p_habit;
  if v.id is null or v.user_id <> p_uid then raise exception 'avora_habit_not_found' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function private.habit_owned(uuid, uuid) from public, anon;
grant execute on function private.habit_owned(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- RPC: create / update / pause / archive
create or replace function public.create_habit(
  p_id uuid, p_name text, p_kind text, p_target_minutes integer, p_weekdays integer[], p_windows jsonb, p_reminders_on boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_owner uuid;
begin
  if v_uid is null or not private.session_allowed() then raise exception 'avora_not_signed_in' using errcode = '42501'; end if;
  if p_id is null then raise exception 'avora_habit_id' using errcode = '22023'; end if;
  select user_id into v_owner from public.habits where id = p_id;
  -- Gửi lại sau khi mất mạng: trả đúng thói quen đã tạo, không tạo đôi.
  if v_owner = v_uid then return p_id; end if;
  if v_owner is not null then raise exception 'avora_habit_id' using errcode = '42501'; end if;
  if (select count(*) from public.habits where user_id = v_uid and archived_at is null) >= 50 then
    raise exception 'avora_habit_too_many' using errcode = '22023';
  end if;
  insert into public.habits (id, user_id, name, kind, target_minutes, weekdays, windows, reminders_on)
  values (p_id, v_uid, btrim(p_name), p_kind, case when p_kind = 'timed' then p_target_minutes end,
          coalesce((select array_agg(distinct d order by d) from unnest(p_weekdays) d), '{}'),
          private.habit_windows_clean(p_windows), coalesce(p_reminders_on, true));
  return p_id;
end $$;

create or replace function public.update_habit(
  p_id uuid, p_name text, p_kind text, p_target_minutes integer, p_weekdays integer[], p_windows jsonb, p_reminders_on boolean, p_version integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  v := private.habit_owned(p_id, v_uid);
  -- ADR-025: bản sửa từ một phiên bản cũ hơn không đè bản mới hơn.
  if p_version is not null and p_version < v.version then raise exception 'avora_habit_conflict' using errcode = '40001'; end if;
  update public.habits set
    name = btrim(p_name), kind = p_kind, target_minutes = case when p_kind = 'timed' then p_target_minutes end,
    weekdays = coalesce((select array_agg(distinct d order by d) from unnest(p_weekdays) d), '{}'),
    windows = private.habit_windows_clean(p_windows), reminders_on = coalesce(p_reminders_on, true),
    version = v.version + 1, updated_at = now()
  where id = p_id;
  return v.version + 1;
end $$;

create or replace function public.pause_habit(p_id uuid, p_paused boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  v := private.habit_owned(p_id, v_uid);
  update public.habits set paused_at = case when p_paused then coalesce(v.paused_at, now()) end, version = v.version + 1, updated_at = now() where id = p_id;
  return v.version + 1;
end $$;

create or replace function public.archive_habit(p_id uuid, p_archived boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  v := private.habit_owned(p_id, v_uid);
  -- Lưu trữ không xoá lịch sử.
  update public.habits set archived_at = case when p_archived then coalesce(v.archived_at, now()) end, version = v.version + 1, updated_at = now() where id = p_id;
  return v.version + 1;
end $$;

-- ---------------------------------------------------------------- RPC: log / unlog / abandon
create or replace function public.log_habit(
  p_id uuid, p_habit uuid, p_local_date date, p_window integer, p_source text default 'manual', p_duration_seconds integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits; v_existing uuid;
begin
  v := private.habit_owned(p_habit, v_uid);
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  if p_window is null or p_window < 0 or p_window >= jsonb_array_length(v.windows) then raise exception 'avora_habit_window' using errcode = '22023'; end if;
  select id into v_existing from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  if v_existing is not null then return v_existing; end if;
  insert into public.habit_logs (id, habit_id, user_id, local_date, window_index, status, source, duration_seconds)
  values (coalesce(p_id, gen_random_uuid()), p_habit, v_uid, p_local_date, p_window, 'done',
          case when p_source = 'timer' then 'timer' else 'manual' end,
          case when v.kind = 'timed' then p_duration_seconds end)
  on conflict do nothing
  returning id into v_existing;
  if v_existing is null then
    select id into v_existing from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  end if;
  return v_existing;
end $$;

create or replace function public.unlog_habit(p_habit uuid, p_local_date date, p_window integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits; v_n integer;
begin
  v := private.habit_owned(p_habit, v_uid);
  -- Bỏ đánh dấu chỉ trong ngày (dung sai múi giờ: hôm qua → ngày mai theo giờ máy chủ).
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  delete from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

create or replace function public.abandon_habit_session(
  p_id uuid, p_habit uuid, p_local_date date, p_window integer, p_duration_seconds integer, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.habits; v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  v := private.habit_owned(p_habit, v_uid);
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  if p_window is null or p_window < 0 or p_window >= jsonb_array_length(v.windows) then raise exception 'avora_habit_window' using errcode = '22023'; end if;
  if exists (select 1 from public.habit_logs where id = v_id) then
    if exists (select 1 from public.habit_logs where id = v_id and user_id = v_uid) then return v_id; end if;
    raise exception 'avora_habit_id' using errcode = '42501';
  end if;
  insert into public.habit_logs (id, habit_id, user_id, local_date, window_index, status, source, duration_seconds, note)
  values (v_id, p_habit, v_uid, p_local_date, p_window, 'abandoned', 'timer', greatest(coalesce(p_duration_seconds, 0), 0),
          nullif(left(btrim(coalesce(p_note, '')), 500), ''));
  return v_id;
end $$;

-- Tổng số lần đã làm (cộng dồn, không nhấn mạnh). Security invoker: RLS chủ.
create or replace function public.my_habit_totals() returns table (habit_id uuid, done_total bigint)
language sql stable security invoker set search_path = '' as $$
  select l.habit_id, count(*) from public.habit_logs l where l.user_id = (select auth.uid()) and l.status = 'done' group by l.habit_id
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_habit(uuid, text, text, integer, integer[], jsonb, boolean)',
    'public.update_habit(uuid, text, text, integer, integer[], jsonb, boolean, integer)',
    'public.pause_habit(uuid, boolean)',
    'public.archive_habit(uuid, boolean)',
    'public.log_habit(uuid, uuid, date, integer, text, integer)',
    'public.unlog_habit(uuid, date, integer)',
    'public.abandon_habit_session(uuid, uuid, date, integer, integer, text)',
    'public.my_habit_totals()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- Bảng Avora mặc định `Thói quen` (bảng xem)
-- Ghi chú riêng mỗi dòng (cột tự thêm) dùng chung kho ★ + ghi chú của bảng xem.
alter table public.think_hub_view_row_meta drop constraint if exists view_row_meta_board;
alter table public.think_hub_view_row_meta add constraint view_row_meta_board check (board_key in (
  'decisions', 'memorable_days', 'my_projects', 'assigned_by_me', 'habits',
  'cashflow', 'summary', 'loans', 'payment_calendar', 'expiring_docs', 'assets'));

-- ---------------------------------------------------------------- Nhắc khi app đóng (send-push · loại `habit`)
alter table public.push_outbox drop constraint if exists push_outbox_kind;
alter table public.push_outbox add constraint push_outbox_kind check (kind in ('message', 'friend_request', 'reminder', 'security', 'board', 'habit'));

-- Một khung đến giờ, chưa làm, thói quen đang chạy, đúng ngày trong tuần → một dòng. Tuân chế độ yên lặng:
-- Chế độ tập trung đang bật, Tắt toàn AVORA, ngày nghỉ → không xếp hàng (thói quen vẫn treo trong Hôm nay).
create or replace function private.enqueue_due_habits() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with p as (
    select pr.id, coalesce(pr.timezone, 'Asia/Ho_Chi_Minh') tz, pr.rest_weekday,
           (now() at time zone coalesce(pr.timezone, 'Asia/Ho_Chi_Minh')) local_now
    from public.profiles pr
    where pr.push_reminders
      and (pr.focus_mode is null or (pr.focus_until is not null and pr.focus_until <= now()))
      and exists (select 1 from public.push_subscriptions s where s.user_id = pr.id)
      and not exists (select 1 from public.mute_settings m where m.user_id = pr.id and m.scope = 'avora' and m.muted_until > now())
  ), due as (
    select h.id habit_id, h.user_id, h.name, (w.ord - 1)::integer idx, w.value->>'time' at_time, p.local_now::date local_date
    from public.habits h
    join p on p.id = h.user_id
    cross join lateral jsonb_array_elements(h.windows) with ordinality w(value, ord)
    where h.paused_at is null and h.archived_at is null and h.reminders_on
      and extract(isodow from p.local_now)::integer = any (h.weekdays)
      and extract(dow from p.local_now)::integer <> coalesce(p.rest_weekday, -1)
      and coalesce((w.value->>'remind')::boolean, true)
      and (p.local_now::date + (w.value->>'time')::time) <= p.local_now
      and (p.local_now::date + (w.value->>'time')::time) > p.local_now - interval '1 hour'
      and not exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.local_date = p.local_now::date
                      and l.window_index = (w.ord - 1) and l.status = 'done')
  )
  insert into public.push_outbox (user_id, kind, dedupe_key, payload)
  select d.user_id, 'habit', 'hb:' || d.habit_id || ':' || d.local_date || ':' || d.idx,
         jsonb_build_object('habit_id', d.habit_id, 'title', d.name, 'at', d.at_time)
  from due d
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.enqueue_due_habits() from public, anon, authenticated;

-- send-push lấy thêm loại `habit` (bản đầy đủ của push_claim_batch hiện tại + một vòng mới).
CREATE OR REPLACE FUNCTION public.push_claim_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_out jsonb := '[]'::jsonb; g record; v_title text; v_body text; v_count integer; v_last messages%rowtype;
  v_read timestamptz; v_show boolean; v_tz text; v_task tasks%rowtype; v_subs jsonb; v_url text; v_ids uuid[];
  v_mention boolean;
begin
  perform private.assert_session_allowed();
  perform private.enqueue_due_reminders();
  perform private.enqueue_due_habits();
  -- Rows a crashed run left half-sent go back in the queue; old rows are cleared (7 days).
  update push_outbox set status = 'pending' where status in ('sending', 'claimed') and sent_at is null and created_at < now() - interval '5 minutes';
  delete from push_outbox where created_at < now() - interval '7 days';

  -- Messages and friend requests: one notification per (person, conversation), replacing the last (tag).
  -- K2 · C12: rows are locked (SKIP LOCKED) and marked before grouping, so a parallel run cannot take them.
  update push_outbox set status = 'claimed' where id in (
    select o.id from push_outbox o where o.status = 'pending' and o.kind in ('message', 'friend_request')
      and o.send_after <= now() order by o.id limit 2000 for update skip locked);
  for g in
    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest
    from push_outbox o
    where o.status = 'claimed' and o.kind in ('message', 'friend_request')
    group by o.user_id, o.conversation_id, o.kind
    having min(o.send_after) <= now()
    limit 200
  loop
    update push_outbox set status = 'sending' where id = any (g.ids);
    select last_read_at into v_read from conversation_read_marks where conversation_id = g.conversation_id and user_id = g.user_id;
    select count(*) into v_count from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
        and m.created_at > coalesce(v_read, '-infinity'::timestamptz);
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id)
       or private.push_mute_blocks(g.user_id, coalesce(private.push_surface(g.conversation_id), 'direct'), g.conversation_id,
            false, exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}'))),
            exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and m.is_urgent)) then
      -- Already read in the app (or nothing left to say): no push.
      update push_outbox set status = 'skipped', sent_at = now() where id = any (g.ids);
      continue;
    end if;
    select m.* into v_last from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
      order by m.created_at desc limit 1;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_mention := g.user_id = any (coalesce(v_last.mentioned_user_ids, '{}'));
    if g.kind = 'friend_request' then
      v_title := 'AVORA';
      v_body := 'Có người muốn kết bạn';
    else
      v_title := coalesce((select name from conversation_groups where conversation_id = g.conversation_id), private.push_display_name(v_last.sender_id));
      if coalesce(v_show, false) then
        v_body := case
          when btrim(v_last.content) <> '' then left(btrim(v_last.content), 80)
          when exists (select 1 from message_attachments a where a.message_id = v_last.id and a.kind = 'image') then '[Ảnh]'
          else '[Tệp]' end;
        if v_count > 1 then v_body := format('(%s) %s', v_count, v_body); end if;
      elsif exists (select 1 from push_outbox o join messages m on m.id = o.message_id
                    where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')))
            and exists (select 1 from conversations where id = g.conversation_id and type = 'group') then
        -- Being named is what matters most: said first, the count after.
        v_body := format('%s nhắc đến bạn', private.push_display_name(
          (select m.sender_id from push_outbox o join messages m on m.id = o.message_id
           where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')) order by m.created_at desc limit 1)))
          || case when v_count > 1 then format(' · %s tin nhắn mới', v_count) else '' end;
      elsif v_count > 1 then
        v_body := format('%s tin nhắn mới', v_count);
      else
        v_body := 'Tin nhắn mới';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', to_jsonb(g.ids), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', v_title, 'body', v_body, 'tag', g.conversation_id::text,
        'url', '/tin-nhan/' || g.conversation_id)));
  end loop;

  -- Reminders: one each.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'reminder' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    select push_show_content, coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_show, v_tz from profiles where id = g.user_id;
    v_task := null;
    if g.task_id is not null then select * into v_task from tasks where id = g.task_id; end if;
    if v_subs is null or (g.task_id is not null and (v_task.id is null or v_task.status in ('done', 'skipped'))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_body := case when (g.payload->>'go') = 'true' then 'Đến giờ đi: ' else 'Đến giờ: ' end
      || to_char(((g.payload->>'at')::timestamptz) at time zone v_tz, 'HH24:MI');
    if coalesce(v_show, false) then
      v_body := v_body || ' · ' || left(coalesce(v_task.title, g.payload->>'title', ''), 80);
    end if;
    v_url := case when g.task_id is not null then '/nhiem-vu?muc=viec&mo=' || g.task_id
                  else '/ke-hoach?bang=' || (g.payload->>'table_id') || '&hang-muc=' || (g.payload->>'record_id') end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'Nhắc việc', 'body', v_body, 'tag', 'nhac:' || coalesce(g.task_id::text, g.payload->>'record_id'), 'url', v_url)));
  end loop;
  -- AVORA-62 · board updates: only to the people a change concerns; mute was checked when queued.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'board' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', coalesce(g.payload->>'title', 'Kế hoạch'),
        'body', case when coalesce(v_show, false) then coalesce(g.payload->>'body', 'Bảng chung có thay đổi') else 'Bảng chung có thay đổi liên quan đến bạn' end,
        'tag', 'bang:' || coalesce(g.payload->>'table_id', g.id::text), 'url', coalesce(g.payload->>'url', '/ke-hoach'))));
  end loop;
  -- AVORA-51 · security alarms (Két sắt code reset / changed): always sent, no mute applies.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'security' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'AVORA · Két sắt', 'body', coalesce(g.payload->>'text', 'Mã Két sắt vừa thay đổi.'), 'tag', 'ket-sat:' || g.id, 'url', '/ket-sat')));
  end loop;
  -- AVORA-107 · Thói quen: nhẹ hơn nhắc việc; chỉ tên thói quen, theo luật ẩn nội dung. Khung đã làm thì bỏ.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'habit' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null or not exists (select 1 from habits h where h.id = (g.payload->>'habit_id')::uuid and h.paused_at is null and h.archived_at is null)
       or exists (select 1 from habit_logs l where l.habit_id = (g.payload->>'habit_id')::uuid and l.status = 'done'
                  and l.local_date = split_part(g.dedupe_key, ':', 3)::date and l.window_index = split_part(g.dedupe_key, ':', 4)::integer) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'Thói quen',
        'body', case when coalesce(v_show, false) then left(coalesce(g.payload->>'title', ''), 80) else 'Đến giờ thói quen của bạn' end,
        'tag', 'thoi-quen:' || (g.payload->>'habit_id'), 'url', '/nhiem-vu?muc=thoi-quen')));
  end loop;
  return v_out;
end $function$;
revoke all on function public.push_claim_batch() from public, anon, authenticated;

-- Tìm kiếm: thêm loại `habit` (bản đầy đủ của search_avora hiện tại + một khối mới).
CREATE OR REPLACE FUNCTION public.search_avora(p_query text, p_here jsonb, p_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(kind text, id uuid, title text, snippet text, place_kind text, place_id uuid, place_name text, conversation_id uuid, at timestamp with time zone, in_here boolean, scope text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_first text;
  v_like text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_tab text := coalesce(p_here->>'tab', '');
  v_here_conv uuid := nullif(p_here->>'conversation_id', '')::uuid;
  v_types text[] := coalesce(p_types, array['message', 'file', 'task', 'note', 'record', 'table', 'contact', 'conversation', 'habit']);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := left(v_q, 120);
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(public.f_unaccent(v_q), '\s+')) w where w <> '';
  if v_words is null then return; end if;
  select w into v_first from unnest(v_words) w order by char_length(w) desc limit 1;
  v_like := '%' || replace(replace(replace(v_first, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- messages (not recalled, not in the journal bin, not system lines)
  if 'message' = any (v_types) then
    return query
    select 'message'::text, m.id, null::text, left(m.content, 240), c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, m.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct'
                when exists (select 1 from projects p where p.conversation_id = c.id) then 'project' else 'group' end
    from messages m
    join conversations c on c.id = m.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where m.deleted_at is null and m.trashed_at is null and m.system_kind is null
      and public.f_unaccent(m.content) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(m.content) not like '%' || w || '%')
    order by m.created_at desc
    limit v_limit * 3;
  end if;

  if 'file' = any (v_types) then
    return query
    select 'file'::text, a.message_id, a.file_name, null::text, c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, a.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from message_attachments a
    join messages m on m.id = a.message_id and m.deleted_at is null and m.trashed_at is null
    join conversations c on c.id = a.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where public.f_unaccent(a.file_name) like v_like
    order by a.created_at desc
    limit v_limit * 2;
  end if;

  if 'task' = any (v_types) then
    return query
    select 'task'::text, t.id, t.title, left(coalesce(t.description, ''), 200),
           case when t.conversation_id is null then 'personal' else coalesce(c.type, 'personal') end,
           t.conversation_id, coalesce(g.name, case when t.conversation_id is null then 'Của tôi' when c.type = 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           t.conversation_id, t.updated_at,
           v_tab = 'nhiem-vu' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = t.conversation_id),
           case when t.type = 'personal' then 'personal' when t.type = '1-1-shared' then 'direct' else 'group' end
    from tasks t
    left join conversations c on c.id = t.conversation_id
    left join conversation_groups g on g.conversation_id = t.conversation_id
    where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) not like '%' || w || '%')
      and not (t.creator_id = v_uid and t.deleted_by_creator) and not (t.creator_id <> v_uid and t.deleted_by_peer)
    order by t.updated_at desc
    limit v_limit * 2;
  end if;

  if 'note' = any (v_types) then
    return query
    select 'note'::text, n.id, coalesce(nullif(btrim(n.title), ''), 'Ghi chép'), left(n.search_text, 200),
           'personal'::text, n.folder_id, coalesce(f.name, 'Chưa xếp'), null::uuid, n.updated_at,
           v_tab = 'nhat-ky', 'personal'::text
    from notes n
    left join note_folders f on f.id = n.folder_id
    where n.deleted_at is null and n.search_text like v_like
      and not exists (select 1 from unnest(v_words) w where n.search_text not like '%' || w || '%')
    order by n.updated_at desc
    limit v_limit * 2;
  end if;

  if 'record' = any (v_types) then
    return query
    select 'record'::text, r.id, r.title, case when r.archived_at is not null then 'Đã cất · ' else '' end || left(coalesce(r.notes, ''), 200),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, r.updated_at,
           v_tab = 'ke-hoach' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = tb.conversation_id),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_record r
    join think_hub_table tb on tb.id = r.table_id and tb.deleted_at is null
    left join conversations c on c.id = tb.conversation_id
    where r.deleted_at is null
      and public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) not like '%' || w || '%')
    order by r.updated_at desc
    limit v_limit * 2;
  end if;

  if 'table' = any (v_types) then
    return query
    select 'table'::text, tb.id, tb.name, coalesce(tb.purpose, ''),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, tb.updated_at, v_tab = 'ke-hoach',
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_table tb
    left join conversations c on c.id = tb.conversation_id
    where tb.deleted_at is null and public.f_unaccent(tb.name) like v_like
    order by tb.updated_at desc
    limit v_limit;
  end if;

  if 'contact' = any (v_types) then
    return query
    select 'contact'::text, ct.id, ct.name, null::text, 'contact'::text, ct.id, 'Liên hệ', null::uuid, ct.updated_at,
           v_tab = 'ket-noi' and v_here_conv is null, 'personal'::text
    from contact ct
    where public.f_unaccent(ct.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(ct.name) not like '%' || w || '%')
    order by ct.name
    limit v_limit;
  end if;

  if 'conversation' = any (v_types) then
    return query
    select 'conversation'::text, g.conversation_id, g.name, null::text, 'group'::text, g.conversation_id, g.name, g.conversation_id, g.updated_at,
           v_tab = 'ket-noi', 'group'::text
    from conversation_groups g
    join conversations c on c.id = g.conversation_id and c.deleted_at is null
    where public.f_unaccent(g.name) like v_like
    order by g.updated_at desc
    limit v_limit;
  end if;
  -- AVORA-107 · Thói quen: tìm được như Hạng mục (chỉ của mình — RLS chủ). Đã lưu trữ thì ghi rõ.
  if 'habit' = any (v_types) then
    return query
    select 'habit'::text, h.id, h.name,
           case when h.archived_at is not null then 'Đã lưu trữ' when h.paused_at is not null then 'Đang tạm nghỉ'
                when h.kind = 'timed' then 'Có đồng hồ · ' || h.target_minutes || ' phút' else 'Chỉ đánh dấu' end,
           'personal'::text, null::uuid, 'Thói quen', null::uuid, h.updated_at,
           v_tab = 'nhiem-vu', 'personal'::text
    from habits h
    where h.user_id = v_uid
      and public.f_unaccent(h.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(h.name) not like '%' || w || '%')
    order by h.archived_at nulls first, h.updated_at desc
    limit v_limit;
  end if;
end $function$;

-- Bảng `Thói quen` được mở / đếm như các Bảng Avora khác (thêm 'habits' vào danh sách khoá).
CREATE OR REPLACE FUNCTION public.mark_board_opened(p_board_key text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_id uuid; v_at timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_board_key is null or char_length(p_board_key) not between 1 and 64 then raise exception 'avora_bad_board'; end if;
  if p_board_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := p_board_key::uuid;
    if not private.think_hub_table_visible(v_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  elsif p_board_key not in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','habits','cashflow','summary','loans','payment_calendar','expiring_docs','assets') then
    raise exception 'avora_bad_board';
  end if;
  insert into public.think_hub_board_opened as o (user_id, board_key, opened_at)
  values (v_user, p_board_key, now())
  on conflict (user_id, board_key) do update set opened_at = excluded.opened_at
    where o.opened_at < now() - interval '10 minutes'
  returning opened_at into v_at;
  if v_at is null then select opened_at into v_at from public.think_hub_board_opened where user_id = v_user and board_key = p_board_key; end if;
  return v_at;
end $function$;
CREATE OR REPLACE FUNCTION private.activity_board_key_ok(p_key text, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.think_hub_table_visible(p_key::uuid, p_user);
  end if;
  return p_key in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','habits','cashflow','summary','loans','payment_calendar','expiring_docs','assets');
end $function$;
