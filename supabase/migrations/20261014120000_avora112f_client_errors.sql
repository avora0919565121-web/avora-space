-- AVORA-112-F · Lỗi được thấy và được ghi. Lỗi từ máy người dùng vào `client_errors` qua `log_client_error`:
-- chỉ tên lỗi, mã ngắn, đường dẫn đã bỏ id / query, phiên bản, nền tảng, dấu vân tay ngăn xếp — KHÔNG nội dung
-- tin, tên, email (máy khách đã lọc qua lib/log.ts, máy chủ lọc lại). Gộp trùng theo (người, dấu vân tay,
-- ngày); 20 lần ghi / giờ / người. Chỉ ops đọc. Màn /quan-tri/suc-khoe đọc qua ops_health_summary.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  app_version text not null,
  platform text not null,
  route text not null,
  error_name text not null,
  message_short text not null,
  stack_hash text not null,
  day date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  count int not null default 1,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (user_id, stack_hash, day)
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from public, anon, authenticated;
grant select on public.client_errors to authenticated;
drop policy if exists client_errors_ops_read on public.client_errors;
create policy client_errors_ops_read on public.client_errors for select to authenticated
  using ((select private.is_ops((select auth.uid()))));
drop policy if exists avora_session_allowed on public.client_errors;
create policy avora_session_allowed on public.client_errors as restrictive for all to authenticated
  using ((select private.session_allowed()));

create or replace function private.clean_short(p_value text, p_max int, p_pattern text)
returns text language sql immutable set search_path = '' as $$
  select left(regexp_replace(coalesce(p_value, ''), p_pattern, '', 'g'), p_max)
$$;
revoke execute on function private.clean_short(text, int, text) from public, anon, authenticated;

create or replace function private.client_error_write(
  p_user uuid, p_app_version text, p_platform text, p_route text, p_error_name text, p_message_short text, p_stack_hash text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_route text;
  v_hash text := private.clean_short(p_stack_hash, 32, '[^a-z0-9]');
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if p_user is null or p_user is distinct from auth.uid() then raise exception 'avora_not_signed_in'; end if;
  if v_hash = '' then raise exception 'avora_client_error_invalid'; end if;
  -- A repeat of today's same error only bumps its counter (no new row, no rate cost beyond the limit).
  update public.client_errors set count = count + 1, last_at = now()
    where user_id = p_user and stack_hash = v_hash and day = v_day;
  if found then return; end if;
  perform private.rate_take(p_user, 'client_error', 20, interval '1 hour');
  -- Paths keep their shape, never their ids: /tin-nhan/<uuid>?q=… → /tin-nhan/:id
  v_route := regexp_replace(split_part(split_part(coalesce(p_route, ''), '?', 1), '#', 1),
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9]{3,}', ':id', 'g');
  insert into public.client_errors (user_id, app_version, platform, route, error_name, message_short, stack_hash, day)
  values (
    p_user,
    private.clean_short(p_app_version, 24, '[^A-Za-z0-9.+-]'),
    private.clean_short(p_platform, 16, '[^a-z]'),
    private.clean_short(v_route, 120, '[^A-Za-z0-9/:_.-]'),
    private.clean_short(p_error_name, 64, '[^A-Za-z0-9_.-]'),
    private.clean_short(p_message_short, 120, '[^A-Za-z0-9_. -]'),
    v_hash, v_day)
  on conflict (user_id, stack_hash, day) do update set count = public.client_errors.count + 1, last_at = now();
end $$;
revoke execute on function private.client_error_write(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function private.client_error_write(uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.log_client_error(
  p_app_version text, p_platform text, p_route text, p_error_name text, p_message_short text, p_stack_hash text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.client_error_write(auth.uid(), p_app_version, p_platform, p_route, p_error_name, p_message_short, p_stack_hash);
end $$;
revoke execute on function public.log_client_error(text, text, text, text, text, text) from public, anon;
grant execute on function public.log_client_error(text, text, text, text, text, text) to authenticated;

-- Màn Sức khoẻ: lỗi theo ngày / luồng / phiên bản, tin gửi lỗi, lần nối lại realtime, 10 lỗi thường gặp.
create or replace function private.health_summary(p_actor uuid, p_days int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_since date := (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(1, least(coalesce(p_days, 7), 90)) + 1;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then raise exception 'avora_not_allowed'; end if;
  return jsonb_build_object(
    'since', v_since,
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n, 'people', d.p) order by d.day)
      from (select day, sum(count) n, count(distinct user_id) p from public.client_errors where day >= v_since group by day) d), '[]'),
    'byScope', coalesce((select jsonb_agg(jsonb_build_object('scope', d.s, 'count', d.n) order by d.n desc)
      from (select error_name s, sum(count) n from public.client_errors where day >= v_since group by error_name) d), '[]'),
    'byVersion', coalesce((select jsonb_agg(jsonb_build_object('version', d.v, 'count', d.n) order by d.n desc)
      from (select app_version v, sum(count) n from public.client_errors where day >= v_since group by app_version) d), '[]'),
    'sendFailed', coalesce((select sum(count) from public.client_errors where day >= v_since and error_name = 'outbox' and message_short like 'send_failed%'), 0),
    'realtimeReconnects', coalesce((select sum(count) from public.client_errors where day >= v_since and error_name = 'realtime'), 0),
    'top', coalesce((select jsonb_agg(t) from (
      select jsonb_build_object('scope', error_name, 'code', message_short, 'route', min(route), 'count', sum(count), 'people', count(distinct user_id)) t
      from public.client_errors where day >= v_since group by error_name, message_short order by sum(count) desc limit 10) x), '[]')
  );
end $$;
revoke execute on function private.health_summary(uuid, int) from public, anon;
grant execute on function private.health_summary(uuid, int) to authenticated;

create or replace function public.ops_health_summary(p_days int default 7)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.health_summary(auth.uid(), p_days);
end $$;
revoke execute on function public.ops_health_summary(int) from public, anon;
grant execute on function public.ops_health_summary(int) to authenticated;
