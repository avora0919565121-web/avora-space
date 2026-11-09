-- 111-A · Xoá tài khoản trong app (ADR-092).
-- Nguyên tắc: dữ liệu riêng mất hết; nội dung trong không gian chung (tin nhắn chữ, dự án, bảng chung, việc nhóm)
-- ở lại với người còn lại. Tin của người đã xoá hiện "Người dùng đã xoá" (sender_id = null).
-- Hằng 14 ngày nằm DUY NHẤT ở private.account_deletion_grace_days(); client đọc qua account_deletion_status().

-- ------------------------------------------------------------------ 1. Khoá ngoại: tin chung và báo cáo ở lại
alter table public.messages alter column sender_id drop not null;
alter table public.messages drop constraint messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references auth.users(id) on delete set null;

alter table public.user_reports alter column reporter_id drop not null;
alter table public.user_reports alter column reported_user_id drop not null;
alter table public.user_reports drop constraint user_reports_reporter_id_fkey;
alter table public.user_reports drop constraint user_reports_reported_user_id_fkey;
alter table public.user_reports add constraint user_reports_reporter_id_fkey
  foreign key (reporter_id) references auth.users(id) on delete set null;
alter table public.user_reports add constraint user_reports_reported_user_id_fkey
  foreign key (reported_user_id) references auth.users(id) on delete set null;

-- ------------------------------------------------------------------ 2. Bảng
create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  execute_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'done')),
  cancelled_at timestamptz,
  method text not null check (method in ('password', 'otp')),
  reminded_at timestamptz,
  done_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon;
grant select on public.account_deletion_requests to authenticated;
drop policy if exists account_deletion_requests_select_own on public.account_deletion_requests;
create policy account_deletion_requests_select_own on public.account_deletion_requests
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists avora_session_allowed on public.account_deletion_requests;
create policy avora_session_allowed on public.account_deletion_requests as restrictive for all to authenticated
  using ((select private.session_allowed()));

-- Nhật ký KHÔNG có dữ liệu cá nhân: không uid, không email, chỉ thời điểm, cách xác nhận, lý do và số dòng đã xử lý.
create table if not exists public.account_deletions_log (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz,
  executed_at timestamptz not null default now(),
  method text,
  reason text not null check (reason in ('self', 'demo', 'abandoned')),
  counts jsonb not null default '{}'::jsonb
);
alter table public.account_deletions_log enable row level security;
revoke all on public.account_deletions_log from public, anon, authenticated;
drop policy if exists avora_session_allowed on public.account_deletions_log;
create policy avora_session_allowed on public.account_deletions_log as restrictive for all to authenticated
  using ((select private.session_allowed()));

-- Lần xác nhận danh tính thành công gần nhất (hiệu lực 5 phút, dùng một lần).
create table if not exists private.account_reauth (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null check (method in ('password', 'otp')),
  verified_at timestamptz not null default now()
);
create table if not exists private.account_otp_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  channel text not null default 'email' check (channel in ('email', 'sms')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists account_otp_codes_user_idx on private.account_otp_codes (user_id, created_at desc);
revoke all on private.account_reauth, private.account_otp_codes from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. Hằng số và thời gian chờ
create or replace function private.account_deletion_grace_days()
returns integer language sql immutable set search_path = '' as $$ select 14 $$;

-- 111-C ghi đè hàm này cho tài khoản demo (≤ 5 phút). Mọi nơi tính ngày xoá đều đi qua đây.
create or replace function private.account_deletion_grace(p_uid uuid)
returns interval language sql stable set search_path = '' as $$
  select make_interval(days => private.account_deletion_grace_days())
$$;
revoke all on function private.account_deletion_grace_days() from public, anon, authenticated;
revoke all on function private.account_deletion_grace(uuid) from public, anon, authenticated;

create or replace function private.account_mail(p_uid uuid, p_action text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text; v_tz text; v_when text; v_at timestamptz;
begin
  select u.email into v_email from auth.users u where u.id = p_uid;
  if coalesce(v_email, '') = '' then return; end if;
  select coalesce(p.timezone, 'Asia/Ho_Chi_Minh') into v_tz from public.profiles p where p.id = p_uid;
  select r.execute_after into v_at from public.account_deletion_requests r where r.user_id = p_uid;
  v_when := to_char(coalesce(v_at, now()) at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI "ngày" DD/MM/YYYY');
  perform private.vault_send_mail(jsonb_build_object('kind', 'account', 'action', p_action, 'email', v_email,
    'when', v_when, 'link', private.app_origin_primary() || '/cai-dat?muc=tai-khoan') || coalesce(p_extra, '{}'::jsonb));
end $$;
revoke all on function private.account_mail(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ 4. Xác nhận danh tính
create or replace function private.account_reauth_password(p_password text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ok boolean;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_ok := public.verify_account_password(p_password);  -- 5 lần / 15 phút, ghi private.password_checks
  if v_ok then
    insert into private.account_reauth (user_id, method, verified_at) values (v_uid, 'password', now())
    on conflict (user_id) do update set method = 'password', verified_at = now();
  end if;
  return v_ok;
end $$;

create or replace function private.account_request_otp()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_code text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' then raise exception 'avora_account_no_email'; end if;
  if (select count(*) from private.account_otp_codes c where c.user_id = v_uid and c.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_account_otp_rate';
  end if;
  update private.account_otp_codes set used_at = now() where user_id = v_uid and used_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.account_otp_codes (user_id, code_hash, channel, expires_at)
  values (v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), 'email', now() + interval '10 minutes');
  perform private.vault_send_mail(jsonb_build_object('kind', 'account_code', 'email', v_email, 'code', v_code));
  return jsonb_build_object('ok', true, 'channel', 'email', 'expires_in_minutes', 10,
    'to', regexp_replace(v_email, '^(.).*(@.*)$', '\1•••\2'));
end $$;

create or replace function private.account_verify_otp(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row private.account_otp_codes%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from private.account_otp_codes c
    where c.user_id = v_uid and c.used_at is null and c.expires_at > now()
    order by c.created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or extensions.crypt(p_code, v_row.code_hash) <> v_row.code_hash then
    update private.account_otp_codes set attempts = attempts + 1,
      used_at = case when attempts + 1 >= 5 then now() else null end
    where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', case when v_row.attempts + 1 >= 5 then 'expired' else 'wrong' end);
  end if;
  update private.account_otp_codes set used_at = now() where id = v_row.id;
  insert into private.account_reauth (user_id, method, verified_at) values (v_uid, 'otp', now())
  on conflict (user_id) do update set method = 'otp', verified_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ 5. Yêu cầu / huỷ / trạng thái
create or replace function private.account_deletion_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.account_deletion_requests%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.account_deletion_requests r where r.user_id = v_uid;
  return jsonb_build_object(
    'grace_days', private.account_deletion_grace_days(),
    'status', coalesce(v_row.status, 'none'),
    'requested_at', v_row.requested_at,
    'execute_after', v_row.execute_after,
    'method', v_row.method,
    'reauth_valid', exists (select 1 from private.account_reauth a where a.user_id = v_uid and a.verified_at > now() - interval '5 minutes'));
end $$;

create or replace function private.request_account_deletion(p_except_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.account_deletion_requests%rowtype; v_method text; v_tz text; v_when text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_feature('account_deletion');
  select * into v_row from public.account_deletion_requests r where r.user_id = v_uid for update;
  -- Gọi lặp: trả lại yêu cầu đang chờ, không tạo thêm, không gửi thêm thư.
  if found and v_row.status = 'pending' then
    return jsonb_build_object('status', 'pending', 'execute_after', v_row.execute_after, 'repeated', true);
  end if;
  select a.method into v_method from private.account_reauth a
    where a.user_id = v_uid and a.verified_at > now() - interval '5 minutes';
  if v_method is null then raise exception 'avora_account_reauth_required'; end if;
  delete from private.account_reauth where user_id = v_uid;  -- dùng một lần

  insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, cancelled_at, method, reminded_at, done_at)
  values (v_uid, now(), now() + private.account_deletion_grace(v_uid), 'pending', null, v_method, null, null)
  on conflict (user_id) do update set requested_at = excluded.requested_at, execute_after = excluded.execute_after,
    status = 'pending', cancelled_at = null, method = excluded.method, reminded_at = null, done_at = null
  returning * into v_row;

  select coalesce(p.timezone, 'Asia/Ho_Chi_Minh') into v_tz from public.profiles p where p.id = v_uid;
  v_when := to_char(v_row.execute_after at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'DD/MM/YYYY');
  insert into public.push_outbox (user_id, kind, payload)
  values (v_uid, 'account', jsonb_build_object(
    'text', format('Tài khoản AVORA của bạn sẽ bị xoá vào ngày %s. Không phải bạn? Mở AVORA và bấm Giữ tài khoản.', v_when),
    'except_endpoint', p_except_endpoint));
  perform private.account_mail(v_uid, 'requested');
  return jsonb_build_object('status', 'pending', 'execute_after', v_row.execute_after, 'repeated', false);
end $$;

create or replace function private.cancel_account_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
   where user_id = v_uid and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n > 0 then perform private.account_mail(v_uid, 'cancelled'); end if;
  return jsonb_build_object('status', case when v_n > 0 then 'cancelled' else 'none' end);
end $$;

alter table private.storage_delete_queue drop constraint storage_delete_queue_reason_check;
alter table private.storage_delete_queue add constraint storage_delete_queue_reason_check
  check (reason = any (array['orphan', 'journal_trash', 'task_file', 'expired', 'account_deleted']));

-- ------------------------------------------------------------------ 6. Thực thi (chạy lại an toàn)
-- Người kế của một cuộc: nhóm → chủ (đã chuyển); 1-1 → người còn lại. null = không còn ai.
create or replace function private.account_successor(p_conv uuid, p_uid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select cp.user_id from public.conversation_participants cp
   where cp.conversation_id = p_conv and cp.user_id <> p_uid
   order by case cp.role when 'owner' then 0 when 'admin' then 1 else 2 end, cp.joined_at, cp.user_id
   limit 1
$$;

-- Chuyển chủ mọi nhóm của p_uid theo đúng logic transfer_group_ownership (hạ chủ cũ → nâng người mới → cờ → sidecar).
-- Người nhận: admin → thành viên lâu nhất. Trả số nhóm đã chuyển.
create or replace function private.account_transfer_groups(p_uid uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_new uuid; v_n integer := 0;
begin
  for v_conv in
    select g.conversation_id from public.conversation_groups g where g.owner_id = p_uid
    union
    select cp.conversation_id from public.conversation_participants cp where cp.user_id = p_uid and cp.role = 'owner'
  loop
    select cp.user_id into v_new from public.conversation_participants cp
     where cp.conversation_id = v_conv and cp.user_id <> p_uid and cp.role in ('admin', 'member')
     order by case cp.role when 'admin' then 0 else 1 end, cp.joined_at, cp.user_id limit 1;
    if v_new is null then continue; end if;   -- không còn ai: nhóm bị xoá ở bước sau
    update public.conversation_participants set role = 'member' where conversation_id = v_conv and user_id = p_uid;
    update public.conversation_participants set role = 'owner' where conversation_id = v_conv and user_id = v_new;
    perform set_config('avora.owner_transfer', v_conv::text, true);
    update public.conversation_groups set owner_id = v_new where conversation_id = v_conv;
    perform set_config('avora.owner_transfer', '', true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function private.account_purge(p_uid uuid, p_reason text default 'self')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req public.account_deletion_requests%rowtype;
  v_counts jsonb := '{}'::jsonb; v_n integer;
begin
  if p_uid is null then raise exception 'avora_account_purge_no_user'; end if;
  select * into v_req from public.account_deletion_requests r where r.user_id = p_uid for update;
  if p_reason = 'self' and (not found or v_req.status not in ('pending', 'done') or v_req.execute_after > now()) then
    raise exception 'avora_account_purge_not_due';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_uid) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- a. Nhóm: chuyển chủ TRƯỚC khi xoá hồ sơ.
  v_counts := v_counts || jsonb_build_object('groups_transferred', private.account_transfer_groups(p_uid));

  -- b. Người kế cho mọi cuộc p_uid đang ở.
  create temp table if not exists _avora_succ (conv uuid primary key, succ uuid) on commit drop;
  truncate _avora_succ;
  insert into _avora_succ
    select cp.conversation_id, private.account_successor(cp.conversation_id, p_uid)
      from public.conversation_participants cp where cp.user_id = p_uid;
  -- Cuộc không còn ai khác (Nhật ký riêng, nhóm một mình, 1-1 người kia đã rời) → xoá cả cuộc.
  create temp table if not exists _avora_dead (conv uuid primary key) on commit drop;
  truncate _avora_dead;
  insert into _avora_dead select conv from _avora_succ where succ is null;
  delete from _avora_succ where succ is null;

  -- c. Nội dung chung ở lại: chuyển cột tác giả sang người kế.
  update public.projects p set created_by = s.succ from _avora_succ s where p.created_by = p_uid and p.conversation_id = s.conv;
  update public.group_decisions d set created_by = s.succ from _avora_succ s where d.created_by = p_uid and d.conversation_id = s.conv;
  update public.meeting_note_files f set uploaded_by = s.succ from _avora_succ s where f.uploaded_by = p_uid and f.conversation_id = s.conv;
  update public.task_lists l set created_by = s.succ from _avora_succ s where l.created_by = p_uid and l.conversation_id = s.conv;
  update public.tasks t set creator_id = case when t.assignee_id is not null and t.assignee_id <> p_uid then t.assignee_id else s.succ end
    from _avora_succ s where t.creator_id = p_uid and t.conversation_id = s.conv;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tasks_kept', v_n);
  update public.tasks t set creator_id = t.assignee_id
   where t.creator_id = p_uid and t.conversation_id is null and t.assignee_id is not null and t.assignee_id <> p_uid;
  update public.think_hub_table t set owner_user_id = s.succ from _avora_succ s
   where t.owner_user_id = p_uid and t.conversation_id = s.conv;
  update public.think_hub_table t set owner_user_id = p.created_by from public.projects p
   where t.owner_user_id = p_uid and t.project_id = p.id and p.created_by <> p_uid;
  update public.think_hub_record r set owner_user_id = t.owner_user_id from public.think_hub_table t
   where r.owner_user_id = p_uid and r.table_id = t.id and t.owner_user_id <> p_uid;
  update public.think_hub_cell_files f set uploaded_by = t.owner_user_id from public.think_hub_table t
   where f.uploaded_by = p_uid and f.table_id = t.id and t.owner_user_id <> p_uid;
  update public.think_hub_conclusions c set created_by = t.owner_user_id from public.think_hub_table t
   where c.created_by = p_uid and c.table_id = t.id and t.owner_user_id <> p_uid;
  update public.project_success_criteria c set created_by = p.created_by from public.projects p
   where c.created_by = p_uid and c.project_id = p.id and p.created_by <> p_uid;
  update public.project_tasks x set linked_by = p.created_by from public.projects p
   where x.linked_by = p_uid and x.project_id = p.id and p.created_by <> p_uid;
  update public.think_hub_record_tasks x set linked_by = r.owner_user_id from public.think_hub_record r
   where x.linked_by = p_uid and x.record_id = r.id and r.owner_user_id <> p_uid;
  update public.task_files f set uploaded_by = t.creator_id from public.tasks t
   where f.uploaded_by = p_uid and f.task_id = t.id and t.creator_id <> p_uid;
  update public.task_resources x set created_by = t.creator_id from public.tasks t
   where x.created_by = p_uid and x.task_id = t.id and t.creator_id <> p_uid;
  update public.task_dependencies x set created_by = t.creator_id from public.tasks t
   where x.created_by = p_uid and x.task_id = t.id and t.creator_id <> p_uid;
  delete from public.task_dependencies where created_by = p_uid;

  -- d. Khoá ngoại NO ACTION (sẽ chặn xoá người dùng).
  delete from public.group_invite_links where created_by = p_uid;
  delete from public.group_removal_requests where requested_by = p_uid or target_user_id = p_uid;
  update public.group_removal_requests set resolved_by = null where resolved_by = p_uid;

  -- e. Tệp sẽ mất → hàng đợi xoá Storage (SQL không xoá file trực tiếp). Đường dẫn còn bản khác dùng thì giữ.
  insert into private.storage_delete_queue (bucket, path, reason)
    select distinct 'chat-attachments', a.storage_path, 'account_deleted'
      from public.message_attachments a
     where (a.attached_by = p_uid or a.conversation_id in (select conv from _avora_dead))
       and not exists (select 1 from public.message_attachments o where o.storage_path = a.storage_path and o.id <> a.id
                         and o.attached_by <> p_uid and o.conversation_id not in (select conv from _avora_dead))
  on conflict do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('chat_files_queued', v_n);
  insert into private.storage_delete_queue (bucket, path, reason)
    select distinct 'conversation-icons', ap.icon_path, 'account_deleted' from public.conversation_appearance ap
     where ap.conversation_id in (select conv from _avora_dead) and ap.icon_path is not null
  on conflict do nothing;
  insert into private.storage_delete_queue (bucket, path, reason)
    select distinct 'task-files', f.storage_path, 'account_deleted' from public.task_files f join public.tasks t on t.id = f.task_id
     where t.creator_id = p_uid or f.uploaded_by = p_uid
  on conflict do nothing;
  insert into private.storage_delete_queue (bucket, path, reason)
    select distinct 'board-files', f.storage_path, 'account_deleted' from public.think_hub_cell_files f join public.think_hub_table t on t.id = f.table_id
     where t.owner_user_id = p_uid or f.uploaded_by = p_uid
  on conflict do nothing;
  insert into private.storage_delete_queue (bucket, path, reason)
    select distinct 'meeting-files', f.storage_path, 'account_deleted' from public.meeting_note_files f
     where f.uploaded_by = p_uid or f.conversation_id in (select conv from _avora_dead)
  on conflict do nothing;

  -- f. Tin nhắn: tệp đính kèm của họ thu hồi; tin chữ ở lại với người gửi "Người dùng đã xoá"; tin chỉ có tệp thành đã thu hồi.
  -- Tin chỉ có tệp đánh dấu thu hồi TRƯỚC khi xoá tệp (ràng buộc messages_content_not_blank).
  update public.messages m set deleted_at = coalesce(m.deleted_at, now())
   where m.sender_id = p_uid and btrim(coalesce(m.content, '')) = '' and m.system_kind is null
     and m.contact_card_user_id is null and m.sticker_id is null and m.note_card is null
     and m.conversation_id in (select conv from _avora_succ);
  delete from public.message_attachments where attached_by = p_uid;
  update public.messages set sender_id = null where sender_id = p_uid and conversation_id in (select conv from _avora_succ);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('messages_kept', v_n);
  delete from public.scheduled_messages where sender_id = p_uid;

  -- g. Rời các cuộc còn người (trigger on_participant_left còn đọc được hồ sơ), rồi xoá các cuộc không còn ai.
  delete from public.conversation_participants where user_id = p_uid and conversation_id in (select conv from _avora_succ);
  delete from public.conversations where id in (select conv from _avora_dead);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('conversations_removed', v_n);

  -- h. Cột người dùng không có khoá ngoại.
  delete from private.blocked_sessions where user_id = p_uid;
  delete from private.chat_rate_events where user_id = p_uid;
  delete from private.device_alarm_log where user_id = p_uid;
  delete from private.vault_proof_attempts where user_id = p_uid;
  delete from public.client_errors where user_id = p_uid;
  delete from public.shared_proposals where target_id = p_uid;
  update public.contact_link_changes set linked_user_id = null where linked_user_id = p_uid;
  update public.user_connections set removed_by = null where removed_by = p_uid;
  update public.app_features set updated_by = null where updated_by = p_uid;
  update public.app_feature_changes set changed_by = null where changed_by = p_uid;

  -- i. Đánh dấu xong + nhật ký (một lần) + thư cuối. Xoá auth.users do Edge Function gọi admin API sau đó.
  if not exists (select 1 from public.account_deletion_requests r where r.user_id = p_uid and r.status = 'done') then
    perform private.account_mail(p_uid, 'done');
    insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method, done_at)
    values (p_uid, now(), now(), 'done', 'password', now())
    on conflict (user_id) do update set status = 'done', done_at = now();
    insert into public.account_deletions_log (requested_at, method, reason, counts)
    values (v_req.requested_at, v_req.method, coalesce(p_reason, 'self'), v_counts);
  end if;
  return jsonb_build_object('ok', true, 'counts', v_counts);
end $$;

revoke all on function private.account_successor(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_transfer_groups(uuid) from public, anon, authenticated;
revoke all on function private.account_purge(uuid, text) from public, anon, authenticated;

-- Lô cho Edge Function: yêu cầu đến hạn, hoặc đã 'done' mà auth.users còn (lần trước dở dang).
create or replace function private.account_deletion_batch(p_limit integer)
returns table (user_id uuid, status text) language sql stable security definer set search_path = '' as $$
  select r.user_id, r.status from public.account_deletion_requests r
   where (r.status = 'pending' and r.execute_after <= now()) or r.status = 'done'
   order by r.execute_after limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;
revoke all on function private.account_deletion_batch(integer) from public, anon, authenticated;

-- Nhắc trước 3 ngày (một lần).
create or replace function private.account_deletion_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_n integer := 0;
begin
  for v_uid in
    select r.user_id from public.account_deletion_requests r
     where r.status = 'pending' and r.reminded_at is null
       and r.execute_after <= now() + interval '3 days' and r.execute_after > now()
       and r.execute_after - r.requested_at > interval '3 days'
     for update skip locked
  loop
    perform private.account_mail(v_uid, 'reminder');
    update public.account_deletion_requests set reminded_at = now() where user_id = v_uid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.account_deletion_reminders() from public, anon, authenticated;

create or replace function private.call_delete_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  perform private.account_deletion_reminders();
  if not exists (select 1 from public.account_deletion_requests r
                  where (r.status = 'pending' and r.execute_after <= now()) or r.status = 'done') then return; end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/delete-account',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.call_delete_account() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('avora_delete_account');
exception when others then null; end $$;
select cron.schedule('avora_delete_account', '37 * * * *', 'select private.call_delete_account()');

-- ------------------------------------------------------------------ 7. RPC public (SECURITY INVOKER → private)
create or replace function public.account_reauth_password(p_password text)
returns boolean language sql security invoker set search_path = '' as $$ select private.account_reauth_password(p_password) $$;
create or replace function public.account_request_otp()
returns jsonb language sql security invoker set search_path = '' as $$ select private.account_request_otp() $$;
create or replace function public.account_verify_otp(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.account_verify_otp(p_code) $$;
create or replace function public.account_deletion_status()
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.account_deletion_status() $$;
create or replace function public.request_account_deletion(p_except_endpoint text default null)
returns jsonb language sql security invoker set search_path = '' as $$ select private.request_account_deletion(p_except_endpoint) $$;
create or replace function public.cancel_account_deletion()
returns jsonb language sql security invoker set search_path = '' as $$ select private.cancel_account_deletion() $$;
-- Chỉ service_role (Edge Function delete-account). service_role không có quyền vào schema private,
-- nên hai cửa này là SECURITY DEFINER như storage_sweep_batch/storage_sweep_done.
create or replace function public.account_deletion_batch(p_limit integer default 20)
returns table (user_id uuid, status text) language sql stable security definer set search_path = '' as $$
  select * from private.account_deletion_batch(p_limit) $$;
create or replace function public.account_deletion_execute(p_user uuid, p_reason text default 'self')
returns jsonb language sql security definer set search_path = '' as $$ select private.account_purge(p_user, p_reason) $$;

do $$ declare f text; begin
  foreach f in array array['account_reauth_password(text)', 'account_request_otp()', 'account_verify_otp(text)',
    'account_deletion_status()', 'request_account_deletion(text)', 'cancel_account_deletion()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
  foreach f in array array['account_deletion_batch(integer)', 'account_deletion_execute(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function private.account_reauth_password(text), private.account_request_otp(), private.account_verify_otp(text),
  private.account_deletion_status(), private.request_account_deletion(text), private.cancel_account_deletion() from public, anon;

-- ------------------------------------------------------------------ 8. Công tắc + loại push
insert into public.app_features (key, status, note) values ('account_deletion', 'hidden', '111-A · Xoá tài khoản trong app')
on conflict (key) do nothing;

alter table public.push_outbox drop constraint push_outbox_kind;
alter table public.push_outbox add constraint push_outbox_kind
  check (kind = any (array['message', 'friend_request', 'reminder', 'security', 'board', 'habit', 'account']));
