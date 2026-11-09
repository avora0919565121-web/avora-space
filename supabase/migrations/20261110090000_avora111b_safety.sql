-- AVORA-111 · 111-B — An toàn nội dung (Apple 1.2): điều khoản, báo cáo, quản trị báo cáo, khoá tài khoản,
-- bộ lọc từ khoá ở chỗ người lạ thấy, liên hệ hỗ trợ. ADR-093.
--
-- session_allowed: phần kiểm thiết bị cũ giữ nguyên, đổi tên thành private.session_device_ok();
-- session_allowed() = session_device_ok() + một lần đọc khoá chính private.account_suspensions.
-- Lối thoát của người bị khoá (xem màn hạn chế, xoá tài khoản, đồng ý điều khoản) gọi bản _base,
-- không bị khoá chặn.

-- ───────────────────────── 0. session_allowed tách đôi ─────────────────────────
create table if not exists private.account_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  until timestamptz not null,
  reason_code text not null check (reason_code in ('harassment', 'scam', 'inappropriate', 'impersonation', 'sexual', 'violence', 'minor_safety', 'self_harm', 'other')),
  report_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
revoke all on private.account_suspensions from public, anon, authenticated;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.session_allowed()'::regprocedure);
  v_def := replace(v_def, 'FUNCTION private.session_allowed()', 'FUNCTION private.session_device_ok()');
  execute v_def;
end $$;
revoke execute on function private.session_device_ok() from public;
grant execute on function private.session_device_ok() to anon, authenticated, service_role;

create or replace function private.session_allowed()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.session_device_ok() then return false; end if;
  -- 111-B: một lần đọc theo khoá chính; không có user (service_role, cron) thì auth.uid() null → không khớp.
  return not exists (select 1 from private.account_suspensions s where s.user_id = auth.uid() and s.until > now());
end $$;

create or replace function private.assert_session_allowed_base()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.session_device_ok() then raise exception 'avora_session_not_allowed'; end if;
end $$;
revoke execute on function private.assert_session_allowed_base() from public;
grant execute on function private.assert_session_allowed_base() to anon, authenticated, service_role;

-- Xoá tài khoản (111-A) phải còn chạy được khi bị khoá: chỉ kiểm thiết bị.
do $$
declare r record; v_def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('account_reauth_password', 'account_request_otp', 'account_verify_otp', 'request_account_deletion', 'cancel_account_deletion')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('private.assert_session_allowed()' in v_def) > 0 then
      execute replace(v_def, 'private.assert_session_allowed()', 'private.assert_session_allowed_base()');
    end if;
  end loop;
end $$;

-- ───────────────────────── 1. Điều khoản ─────────────────────────
create table if not exists public.terms_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.terms_acceptances enable row level security;
revoke all on public.terms_acceptances from public, anon, authenticated;
grant select on public.terms_acceptances to authenticated;
drop policy if exists terms_acceptances_select_own on public.terms_acceptances;
create policy terms_acceptances_select_own on public.terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists avora_session_allowed on public.terms_acceptances;
create policy avora_session_allowed on public.terms_acceptances as restrictive for all to authenticated
  using ((select private.session_allowed()));

-- Một chỗ duy nhất; web/src/lib/safety.ts · TERMS_VERSION phải bằng giá trị này (test so khớp).
create or replace function private.terms_version()
returns text language sql immutable set search_path = '' as $$ select '2026-11-10'::text $$;
grant execute on function private.terms_version() to authenticated, service_role;

create or replace function private.accept_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed_base();
  if p_version is distinct from private.terms_version() then raise exception 'avora_terms_version'; end if;
  insert into public.terms_acceptances (user_id, version) values (v_uid, p_version) on conflict do nothing;
end $$;
revoke execute on function private.accept_terms(text) from public, anon;
grant execute on function private.accept_terms(text) to authenticated;

create or replace function public.accept_terms(p_version text)
returns void language plpgsql security invoker set search_path = '' as $$
begin perform private.accept_terms(p_version); end $$;
revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- Đăng ký mới: hộp đồng ý (không chọn sẵn) gửi terms_version trong metadata → ghi ngay khi tạo tài khoản.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;

  if new.raw_user_meta_data ->> 'terms_version' = private.terms_version() then
    insert into public.terms_acceptances (user_id, version) values (new.id, private.terms_version()) on conflict do nothing;
  end if;

  perform public.ensure_personal_journal(new.id);
  perform private.ensure_opportunity_board(new.id);

  return new;
end;
$function$;

-- ───────────────────────── 2. Thông báo trong app ─────────────────────────
create table if not exists private.account_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('warning', 'report_reviewed')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists account_notices_unread on private.account_notices (user_id) where read_at is null;
revoke all on private.account_notices from public, anon, authenticated;

-- Màn cổng: một lần gọi khi mở app — khoá, điều khoản, thông báo chưa đọc.
create or replace function private.account_gate()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s private.account_suspensions%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed_base();
  select * into v_s from private.account_suspensions where user_id = v_uid and until > now();
  return jsonb_build_object(
    'suspendedUntil', case when v_s.user_id is null then null when v_s.until = 'infinity' then 'infinity' else to_char(v_s.until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'termsVersion', private.terms_version(),
    'termsAccepted', exists (select 1 from public.terms_acceptances t where t.user_id = v_uid and t.version = private.terms_version()),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'createdAt', n.created_at) order by n.created_at)
      from private.account_notices n where n.user_id = v_uid and n.read_at is null), '[]'::jsonb)
  );
end $$;
revoke execute on function private.account_gate() from public, anon;
grant execute on function private.account_gate() to authenticated;

create or replace function public.my_account_gate()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin return private.account_gate(); end $$;
revoke execute on function public.my_account_gate() from public, anon;
grant execute on function public.my_account_gate() to authenticated;

create or replace function private.ack_account_notice(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed_base();
  update private.account_notices set read_at = now() where id = p_id and user_id = auth.uid() and read_at is null;
end $$;
revoke execute on function private.ack_account_notice(uuid) from public, anon;
grant execute on function private.ack_account_notice(uuid) to authenticated;

create or replace function public.ack_account_notice(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin perform private.ack_account_notice(p_id); end $$;
revoke execute on function public.ack_account_notice(uuid) from public, anon;
grant execute on function public.ack_account_notice(uuid) to authenticated;

-- ───────────────────────── 3. Báo cáo ─────────────────────────
alter table public.user_reports drop constraint if exists user_reports_reason_check;
alter table public.user_reports add constraint user_reports_reason_check check (
  reason in ('harassment', 'scam', 'inappropriate', 'impersonation', 'sexual', 'violence', 'minor_safety', 'self_harm', 'other'));
alter table public.user_reports
  add column if not exists target_kind text not null default 'user',
  add column if not exists group_id uuid references public.conversations (id) on delete set null,
  add column if not exists file_id uuid references public.message_attachments (id) on delete set null,
  add column if not exists handled_by uuid references auth.users (id) on delete set null,
  add column if not exists handled_at timestamptz,
  add column if not exists action text;
alter table public.user_reports drop constraint if exists user_reports_target_kind_check;
alter table public.user_reports add constraint user_reports_target_kind_check check (target_kind in ('user', 'message', 'group', 'file', 'avatar'));
alter table public.user_reports drop constraint if exists user_reports_action_check;
alter table public.user_reports add constraint user_reports_action_check check (action is null or action in ('dismiss', 'warn', 'suspend_temp', 'suspend_permanent'));
update public.user_reports set status = 'open' where status is null or status not in ('open', 'reviewing', 'actioned', 'dismissed');
alter table public.user_reports drop constraint if exists user_reports_status_check;
alter table public.user_reports add constraint user_reports_status_check check (status in ('open', 'reviewing', 'actioned', 'dismissed'));
-- AVORA-115 · 7 ghi báo cáo ảnh bằng ghi chú; nay có loại riêng.
update public.user_reports set target_kind = 'avatar' where note = 'Ảnh đại diện không phù hợp' and target_kind = 'user';
update public.user_reports set target_kind = 'message' where message_id is not null and target_kind = 'user';
create index if not exists user_reports_queue on public.user_reports (status, created_at);
create index if not exists user_reports_reported on public.user_reports (reported_user_id);
create index if not exists user_reports_group on public.user_reports (group_id) where group_id is not null;
create index if not exists user_reports_file on public.user_reports (file_id) where file_id is not null;
create index if not exists user_reports_handled_by on public.user_reports (handled_by) where handled_by is not null;

drop function if exists public.report_user(uuid, text, text, uuid, uuid, boolean, boolean);

create or replace function private.report_submit(
  p_user_id uuid, p_reason text, p_note text, p_conversation_id uuid, p_message_id uuid,
  p_include_message boolean, p_also_block boolean, p_target_kind text, p_group_id uuid, p_file_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_kind text := coalesce(p_target_kind, case when p_message_id is not null then 'message' else 'user' end);
  v_reported uuid := p_user_id;
  v_conversation uuid := p_conversation_id;
  v_group uuid;
  v_file uuid;
  v_content text;
  v_msg public.messages%rowtype;
  v_att public.message_attachments%rowtype;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_kind not in ('user', 'message', 'group', 'file', 'avatar') then raise exception 'avora_report_kind_invalid'; end if;
  if p_reason is null or p_reason not in ('harassment', 'scam', 'inappropriate', 'impersonation', 'sexual', 'violence', 'minor_safety', 'self_harm', 'other') then
    raise exception 'avora_report_reason_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'avora_report_note_max_len'; end if;

  if v_kind = 'group' then
    -- Báo cáo nhóm: chỉ người trong nhóm; không nhắm vào một người nào.
    if p_group_id is null or not exists (select 1 from public.conversations c where c.id = p_group_id and c.type = 'group')
       or not private.is_conversation_participant(p_group_id, v_uid) then
      raise exception 'avora_report_target_invalid';
    end if;
    v_group := p_group_id; v_conversation := p_group_id; v_reported := null;
  elsif v_kind = 'file' then
    select * into v_att from public.message_attachments where id = p_file_id;
    if not found or not private.is_conversation_participant(v_att.conversation_id, v_uid) then
      raise exception 'avora_report_target_invalid';
    end if;
    v_file := v_att.id; v_conversation := v_att.conversation_id; v_reported := v_att.attached_by;
    if v_reported is null then raise exception 'avora_user_not_found'; end if;
    if coalesce(p_include_message, false) then v_content := left(v_att.file_name, 4000); end if;
  end if;

  if v_reported is not null then
    if v_reported = v_uid then raise exception 'avora_report_self'; end if;
    if not exists (select 1 from auth.users u where u.id = v_reported) then raise exception 'avora_user_not_found'; end if;
  elsif v_kind <> 'group' then
    raise exception 'avora_user_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('avora_report:' || v_uid::text, 0));
  if (select count(*) from public.user_reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'avora_report_limit';
  end if;

  if v_kind in ('user', 'message', 'avatar') then
    if v_conversation is not null and not private.is_conversation_participant(v_conversation, v_uid) then
      v_conversation := null;
    end if;
    if v_kind = 'avatar' then v_conversation := null; end if;
    if p_message_id is not null and v_kind = 'message' then
      select * into v_msg from public.messages where id = p_message_id;
      if found and private.is_conversation_participant(v_msg.conversation_id, v_uid) and v_msg.sender_id = v_reported then
        v_conversation := v_msg.conversation_id;
        if coalesce(p_include_message, false) and v_msg.deleted_at is null then v_content := left(v_msg.content, 4000); end if;
      else
        v_msg := null;
      end if;
    end if;
  end if;

  insert into public.user_reports (reporter_id, reported_user_id, conversation_id, message_id, reason, note, reported_content, target_kind, group_id, file_id)
  values (v_uid, v_reported, v_conversation, v_msg.id, p_reason, v_note, v_content, v_kind, v_group, v_file)
  returning id into v_id;

  if coalesce(p_also_block, false) and v_reported is not null then
    perform public.block_user(v_reported);
  end if;
  return v_id;
end $$;
revoke execute on function private.report_submit(uuid, text, text, uuid, uuid, boolean, boolean, text, uuid, uuid) from public, anon;
grant execute on function private.report_submit(uuid, text, text, uuid, uuid, boolean, boolean, text, uuid, uuid) to authenticated;

create or replace function public.report_user(
  p_user_id uuid default null, p_reason text default null, p_note text default null, p_conversation_id uuid default null,
  p_message_id uuid default null, p_include_message boolean default false, p_also_block boolean default true,
  p_target_kind text default null, p_group_id uuid default null, p_file_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  return private.report_submit(p_user_id, p_reason, p_note, p_conversation_id, p_message_id, p_include_message, p_also_block, p_target_kind, p_group_id, p_file_id);
end $$;
revoke execute on function public.report_user(uuid, text, text, uuid, uuid, boolean, boolean, text, uuid, uuid) from public, anon;
grant execute on function public.report_user(uuid, text, text, uuid, uuid, boolean, boolean, text, uuid, uuid) to authenticated;

-- ───────────────────────── 4. Quản trị báo cáo (chỉ ops, kiểm ở máy chủ) ─────────────────────────
create or replace function private.ops_reports(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then raise exception 'avora_not_allowed'; end if;
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.sort_open, x.sort_minor, x."createdAt") from (
    select r.id, r.target_kind as kind, r.reason, r.note, r.reported_content as content, r.status, r.action,
      r.created_at as "createdAt", r.handled_at as "handledAt",
      r.reported_user_id as "reportedUserId",
      (select p.display_name from public.profiles p where p.id = r.reported_user_id) as "reportedName",
      (select g.name from public.conversation_groups g where g.conversation_id = r.group_id) as "groupName",
      case when r.target_kind = 'group' then
        (select count(*) from public.user_reports o where o.group_id = r.group_id and o.id <> r.id and o.created_at <= r.created_at)
      else
        (select count(*) from public.user_reports o where o.reported_user_id = r.reported_user_id and o.id <> r.id and o.created_at <= r.created_at)
      end as "priorCount",
      (select s.until from private.account_suspensions s where s.user_id = r.reported_user_id and s.until > now()) as "suspendedUntil",
      case when r.status in ('open', 'reviewing') then 0 else 1 end as sort_open,
      case when r.reason = 'minor_safety' and r.status in ('open', 'reviewing') then 0 else 1 end as sort_minor
    from public.user_reports r
    order by sort_open, sort_minor, r.created_at
    limit 300
  ) x), '[]'::jsonb);
end $$;
revoke execute on function private.ops_reports(uuid) from public, anon;
grant execute on function private.ops_reports(uuid) to authenticated;

create or replace function public.ops_list_reports()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.ops_reports(auth.uid());
end $$;
revoke execute on function public.ops_list_reports() from public, anon;
grant execute on function public.ops_list_reports() to authenticated;

create or replace function private.ops_report_handle(p_actor uuid, p_id uuid, p_action text, p_days int)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.user_reports%rowtype; v_until timestamptz;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then raise exception 'avora_not_allowed'; end if;
  select * into r from public.user_reports where id = p_id for update;
  if not found then raise exception 'avora_report_not_found'; end if;
  if p_action = 'review' then
    update public.user_reports set status = 'reviewing' where id = p_id and status = 'open';
    return;
  end if;
  if r.status in ('actioned', 'dismissed') then raise exception 'avora_report_handled'; end if;
  if p_action not in ('dismiss', 'warn', 'suspend_temp', 'suspend_permanent') then raise exception 'avora_report_action_invalid'; end if;
  if p_action <> 'dismiss' and r.reported_user_id is null then raise exception 'avora_report_no_person'; end if;

  if p_action = 'warn' then
    insert into private.account_notices (user_id, kind) values (r.reported_user_id, 'warning');
  elsif p_action in ('suspend_temp', 'suspend_permanent') then
    if p_action = 'suspend_temp' and (p_days is null or p_days < 1 or p_days > 365) then raise exception 'avora_report_days_invalid'; end if;
    v_until := case when p_action = 'suspend_permanent' then 'infinity'::timestamptz else now() + make_interval(days => p_days) end;
    insert into private.account_suspensions (user_id, until, reason_code, report_id, created_by)
    values (r.reported_user_id, v_until, r.reason, r.id, p_actor)
    on conflict (user_id) do update set
      until = greatest(case when private.account_suspensions.until > now() then private.account_suspensions.until else now() end, excluded.until),
      reason_code = excluded.reason_code, report_id = excluded.report_id, created_by = excluded.created_by, created_at = now();
  end if;

  update public.user_reports
    set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
        action = p_action, handled_by = p_actor, handled_at = now()
    where id = p_id;
  -- Người báo cáo chỉ biết "đã được xem xét", không biết xử lý ra sao. Người bị báo không biết ai báo.
  if r.reporter_id is not null then
    insert into private.account_notices (user_id, kind) values (r.reporter_id, 'report_reviewed');
  end if;
end $$;
revoke execute on function private.ops_report_handle(uuid, uuid, text, int) from public, anon;
grant execute on function private.ops_report_handle(uuid, uuid, text, int) to authenticated;

create or replace function public.ops_handle_report(p_report_id uuid, p_action text, p_days int default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  perform private.ops_report_handle(auth.uid(), p_report_id, p_action, p_days);
end $$;
revoke execute on function public.ops_handle_report(uuid, text, int) from public, anon;
grant execute on function public.ops_handle_report(uuid, text, int) to authenticated;

-- ───────────────────────── 5. Bộ lọc từ khoá (chỉ chỗ người lạ thấy) ─────────────────────────
-- So khớp theo cụm từ nguyên vẹn, không dấu, không phân biệt hoa thường: " dit me " khớp "Địt Mẹ!",
-- nhưng "admin" không khớp "dm". Tin nhắn riêng giữa bạn bè KHÔNG đi qua bộ lọc.
create or replace function private.normalize_term(p text)
returns text language sql stable set search_path = '' as $$
  select btrim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;
grant execute on function private.normalize_term(text) to authenticated, service_role;

create table if not exists private.blocked_terms (
  id bigint generated always as identity primary key,
  term text not null check (char_length(term) between 2 and 80),
  term_norm text not null unique,
  locale text not null check (locale in ('vi', 'en')),
  severity text not null default 'high' check (severity in ('high', 'medium')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists blocked_terms_created_by on private.blocked_terms (created_by) where created_by is not null;
revoke all on private.blocked_terms from public, anon, authenticated;

-- Bộ khởi đầu nhỏ (VMT và người xử lý bổ sung). Chỉ cụm rõ nghĩa sau khi bỏ dấu, tránh trùng từ thường
-- (ví dụ "lồn" → "lon" trùng "lớn", nên không có trong danh sách).
insert into private.blocked_terms (term, term_norm, locale, severity)
select t, private.normalize_term(t), l, s from (values
  ('địt mẹ', 'vi', 'high'), ('địt con mẹ', 'vi', 'high'), ('đụ má', 'vi', 'high'), ('đụ mẹ', 'vi', 'high'),
  ('đmm', 'vi', 'high'), ('dcm', 'vi', 'high'), ('vcl', 'vi', 'medium'), ('vkl', 'vi', 'medium'), ('clgt', 'vi', 'medium'),
  ('cách tự tử', 'vi', 'high'), ('rạch cổ tay', 'vi', 'high'),
  ('bán ma tuý', 'vi', 'high'), ('mua ma tuý', 'vi', 'high'), ('ma tuý đá', 'vi', 'high'), ('thuốc lắc', 'vi', 'high'), ('cỏ mỹ', 'vi', 'high'),
  ('nạp tiền nhận thưởng', 'vi', 'high'), ('việc nhẹ lương cao', 'vi', 'high'), ('nhận hoa hồng mỗi ngày', 'vi', 'high'),
  ('fuck', 'en', 'high'), ('motherfucker', 'en', 'high'), ('cunt', 'en', 'high'), ('kill yourself', 'en', 'high'), ('kys', 'en', 'high'),
  ('suicide method', 'en', 'high'), ('buy cocaine', 'en', 'high'), ('buy meth', 'en', 'high'),
  ('crypto giveaway', 'en', 'high'), ('double your bitcoin', 'en', 'high')
) v(t, l, s)
on conflict (term_norm) do nothing;

create or replace function private.text_blocked(p text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p is null or btrim(p) = '' then return false; end if;
  v := ' ' || private.normalize_term(p) || ' ';
  return exists (select 1 from private.blocked_terms b where position(' ' || b.term_norm || ' ' in v) > 0);
end $$;
revoke execute on function private.text_blocked(text) from public, anon;
grant execute on function private.text_blocked(text) to authenticated, service_role;

create or replace function private.filter_public_text()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_new text; v_old text;
begin
  if tg_table_name = 'profiles' then
    v_new := new.display_name; v_old := case when tg_op = 'UPDATE' then old.display_name end;
  elsif tg_table_name = 'conversation_groups' then
    v_new := new.name; v_old := case when tg_op = 'UPDATE' then old.name end;
  elsif tg_table_name = 'projects' then
    if new.conversation_id is null then return new; end if; -- dự án riêng: không ai khác thấy
    v_new := new.title; v_old := case when tg_op = 'UPDATE' then old.title end;
  end if;
  if v_new is not distinct from v_old or not private.text_blocked(v_new) then return new; end if;
  -- Tạo tài khoản không được hỏng vì tên: tên lúc đăng ký bị bỏ trống, đặt lại sau trong Hồ sơ.
  if tg_table_name = 'profiles' and tg_op = 'INSERT' then new.display_name := null; return new; end if;
  raise exception 'avora_blocked_term';
end $$;
revoke execute on function private.filter_public_text() from public, anon, authenticated;

drop trigger if exists profiles_filter_public_text on public.profiles;
create trigger profiles_filter_public_text before insert or update of display_name on public.profiles
  for each row execute function private.filter_public_text();
drop trigger if exists conversation_groups_filter_public_text on public.conversation_groups;
create trigger conversation_groups_filter_public_text before insert or update of name on public.conversation_groups
  for each row execute function private.filter_public_text();
drop trigger if exists projects_filter_public_text on public.projects;
create trigger projects_filter_public_text before insert or update of title on public.projects
  for each row execute function private.filter_public_text();

-- Khung chat xác minh (trước khi thành bạn): một lần đọc khoá chính conversations, chỉ khi đang chờ.
create or replace function private.filter_pending_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.content is null or btrim(new.content) = '' then return new; end if;
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.type = 'direct' and c.verification_status = 'pending')
     and private.verification_is_live(new.conversation_id)
     and private.text_blocked(new.content) then
    raise exception 'avora_blocked_term';
  end if;
  return new;
end $$;
revoke execute on function private.filter_pending_message() from public, anon, authenticated;
drop trigger if exists messages_filter_pending on public.messages;
create trigger messages_filter_pending before insert or update of content on public.messages
  for each row execute function private.filter_pending_message();

-- ops sửa danh sách
create or replace function private.ops_terms(p_actor uuid, p_op text, p_term text, p_locale text, p_severity text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_norm text;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then raise exception 'avora_not_allowed'; end if;
  if p_op = 'add' then
    v_norm := private.normalize_term(p_term);
    if char_length(v_norm) < 2 or char_length(btrim(p_term)) > 80 then raise exception 'avora_term_invalid'; end if;
    insert into private.blocked_terms (term, term_norm, locale, severity, created_by)
    values (btrim(p_term), v_norm, coalesce(p_locale, 'vi'), coalesce(p_severity, 'high'), p_actor)
    on conflict (term_norm) do nothing;
  elsif p_op = 'remove' then
    delete from private.blocked_terms where id = p_id;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'term', b.term, 'locale', b.locale, 'severity', b.severity) order by b.locale, b.term)
    from private.blocked_terms b), '[]'::jsonb);
end $$;
revoke execute on function private.ops_terms(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function private.ops_terms(uuid, text, text, text, text, bigint) to authenticated;

create or replace function public.ops_blocked_terms(p_op text default 'list', p_term text default null, p_locale text default null, p_severity text default null, p_id bigint default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.ops_terms(auth.uid(), p_op, p_term, p_locale, p_severity, p_id);
end $$;
revoke execute on function public.ops_blocked_terms(text, text, text, text, bigint) from public, anon;
grant execute on function public.ops_blocked_terms(text, text, text, text, bigint) to authenticated;

-- ───────────────────────── 6. Liên hệ hỗ trợ ─────────────────────────
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  reply_email text not null check (char_length(reply_email) between 3 and 254 and reply_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_requests_user on public.support_requests (user_id);
alter table public.support_requests enable row level security;
revoke all on public.support_requests from public, anon, authenticated;
grant select on public.support_requests to authenticated;
drop policy if exists support_requests_ops_read on public.support_requests;
create policy support_requests_ops_read on public.support_requests for select to authenticated
  using ((select private.is_ops((select auth.uid()))));
drop policy if exists avora_session_allowed on public.support_requests;
create policy avora_session_allowed on public.support_requests as restrictive for all to authenticated
  using ((select private.session_allowed()));

create or replace function private.support_submit(p_name text, p_email text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed_base();
  perform private.rate_take(v_uid, 'support_request', 5, interval '1 day');
  insert into public.support_requests (user_id, name, reply_email, body)
  values (v_uid, btrim(p_name), lower(btrim(p_email)), btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.support_submit(text, text, text) from public, anon;
grant execute on function private.support_submit(text, text, text) to authenticated;

create or replace function public.submit_support_request(p_name text, p_email text, p_body text)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin return private.support_submit(p_name, p_email, p_body); end $$;
revoke execute on function public.submit_support_request(text, text, text) from public, anon;
grant execute on function public.submit_support_request(text, text, text) to authenticated;

-- ───────────────────────── 7. session_allowed một lần mỗi truy vấn ─────────────────────────
-- 5 chính sách còn gọi theo từng dòng; bọc (select …) để Postgres tính một lần (initplan), bù phần đọc khoá mới.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' and (qual = 'private.session_allowed()' or with_check = 'private.session_allowed()')
  loop
    if r.qual = 'private.session_allowed()' then
      execute format('alter policy %I on %I.%I using ((select private.session_allowed()))', r.policyname, r.schemaname, r.tablename);
    end if;
    if r.with_check = 'private.session_allowed()' then
      execute format('alter policy %I on %I.%I with check ((select private.session_allowed()))', r.policyname, r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
