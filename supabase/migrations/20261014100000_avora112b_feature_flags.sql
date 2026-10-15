-- AVORA-112-B · Công tắc tính năng 3 trạng thái (stable · soon · hidden) — Chuan-On-Dinh mục 2, ADR-090.
--
-- * public.app_features: một dòng cho mỗi tính năng người dùng nhìn thấy (khoá trùng FEATURE_KEYS ở
--   web/src/lib/features.ts). Mọi người đăng nhập đọc được; chỉ ops đổi, qua ops_set_feature.
-- * public.app_feature_changes: lịch sử đổi; chỉ ops đọc.
-- * private.assert_feature(key): RPC chính của tính năng từ chối `avora_feature_off` khi trạng thái
--   khác stable — gọi thẳng API cũng không vượt được. Khoá chưa có dòng → stable (không tắt nhầm).
-- * Khối này KHÔNG đổi trạng thái tính năng nào: mọi dòng gieo `stable`. Hạ xuống soon/hidden ở 112-G
--   khi VMT duyệt.

create table if not exists public.app_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  status text not null default 'stable' check (status in ('stable', 'soon', 'hidden')),
  min_app_version text check (min_app_version is null or min_app_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  note text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_features enable row level security;
revoke all on public.app_features from public, anon, authenticated;
grant select on public.app_features to authenticated;
drop policy if exists app_features_read on public.app_features;
create policy app_features_read on public.app_features for select to authenticated using (true);
drop policy if exists avora_session_allowed on public.app_features;
create policy avora_session_allowed on public.app_features as restrictive for all to authenticated
  using ((select private.session_allowed()));

create table if not exists public.app_feature_changes (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists app_feature_changes_at on public.app_feature_changes (at desc);
alter table public.app_feature_changes enable row level security;
revoke all on public.app_feature_changes from public, anon, authenticated;
grant select on public.app_feature_changes to authenticated;
drop policy if exists app_feature_changes_ops_read on public.app_feature_changes;
create policy app_feature_changes_ops_read on public.app_feature_changes for select to authenticated
  using ((select private.is_ops(auth.uid())));
drop policy if exists avora_session_allowed on public.app_feature_changes;
create policy avora_session_allowed on public.app_feature_changes as restrictive for all to authenticated
  using ((select private.session_allowed()));

insert into public.app_features (key, status, note) values
  ('journal', 'stable', 'Nhật ký'),
  ('chat_direct', 'stable', 'Chat 1-1'),
  ('groups', 'stable', 'Nhóm'),
  ('contacts', 'stable', 'Liên hệ'),
  ('contact_import', 'stable', 'Nhập danh bạ'),
  ('contact_link', 'stable', 'Liên kết liên hệ ↔ tài khoản'),
  ('projects', 'stable', 'Dự án'),
  ('tasks', 'stable', 'Nhiệm vụ'),
  ('calendar', 'stable', 'Lịch'),
  ('think_hub', 'stable', 'Kế hoạch'),
  ('meeting_notes', 'stable', 'Biên bản họp'),
  ('habits', 'stable', 'Thói quen'),
  ('finance', 'stable', 'Tài chính'),
  ('vault_passwords', 'stable', 'Két sắt · Mật khẩu'),
  ('vault_certificates', 'stable', 'Két sắt · Chứng chỉ'),
  ('vault_documents', 'stable', 'Két sắt · Tài liệu'),
  ('vault_assets', 'stable', 'Két sắt · Tài sản'),
  ('books', 'stable', 'Sách'),
  ('feedback', 'stable', 'Góp ý'),
  ('invite_codes', 'stable', 'Mã mời'),
  ('reactions', 'stable', 'Cảm xúc nổi'),
  ('read_receipts', 'stable', 'Đã xem'),
  ('disappearing', 'stable', 'Tin tự biến mất'),
  ('scheduled_messages', 'stable', 'Hẹn giờ gửi'),
  ('chat_lock', 'stable', 'Khoá Kết nối'),
  ('message_sound', 'stable', 'Âm báo tin nhắn'),
  ('avatars', 'stable', 'Ảnh đại diện'),
  ('avora_ai', 'stable', 'Avora AI'),
  ('push', 'stable', 'Thông báo đẩy')
on conflict (key) do nothing;

create or replace function private.feature_status(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select f.status from public.app_features f where f.key = p_key), 'stable')
$$;
revoke execute on function private.feature_status(text) from public, anon;
grant execute on function private.feature_status(text) to authenticated;

create or replace function private.assert_feature(p_key text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if private.feature_status(p_key) <> 'stable' then
    raise exception 'avora_feature_off' using detail = p_key;
  end if;
end $$;
revoke execute on function private.assert_feature(text) from public, anon;
grant execute on function private.assert_feature(text) to authenticated;

create or replace function private.feature_set(p_actor uuid, p_key text, p_status text, p_note text)
returns public.app_features language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  v_row public.app_features%rowtype;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then
    raise exception 'avora_not_allowed';
  end if;
  if p_status not in ('stable', 'soon', 'hidden') then raise exception 'avora_feature_status'; end if;
  select status into v_old from public.app_features where key = p_key for update;
  if not found then raise exception 'avora_feature_unknown'; end if;
  update public.app_features
    set status = p_status, note = coalesce(nullif(btrim(p_note), ''), note), updated_at = now(), updated_by = p_actor
    where key = p_key returning * into v_row;
  insert into public.app_feature_changes (key, from_status, to_status, note, changed_by)
    values (p_key, v_old, p_status, nullif(btrim(p_note), ''), p_actor);
  return v_row;
end $$;
revoke execute on function private.feature_set(uuid, text, text, text) from public, anon;
grant execute on function private.feature_set(uuid, text, text, text) to authenticated;

create or replace function public.ops_set_feature(p_key text, p_status text, p_note text default null)
returns public.app_features language plpgsql security invoker set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  return private.feature_set(auth.uid(), p_key, p_status, p_note);
end $$;
revoke execute on function public.ops_set_feature(text, text, text) from public, anon;
grant execute on function public.ops_set_feature(text, text, text) to authenticated;

-- ------------------------------------------------------------------ cổng trên RPC chính
-- Chèn `perform private.assert_feature('<khoá>')` ngay sau `begin` đầu tiên của thân hàm; chạy lại an toàn.
do $do$
declare
  r record;
  v_def text;
  v_new text;
  v_count int := 0;
begin
  for r in
    select p.oid, m.key
    from (values
      ('create_habit', 'habits'), ('update_habit', 'habits'), ('log_habit', 'habits'), ('unlog_habit', 'habits'),
      ('archive_habit', 'habits'), ('pause_habit', 'habits'), ('set_habit_alarm', 'habits'),
      ('search_book_catalog', 'books'), ('set_book_cover', 'books'), ('set_book_pin', 'books'), ('save_reading_state', 'books'),
      ('submit_feedback', 'feedback'),
      ('create_invite_code', 'invite_codes'), ('set_invite_code_active', 'invite_codes'),
      ('set_disappear_timer', 'disappearing'), ('answer_disappear_proposal', 'disappearing'),
      ('create_group_conversation', 'groups'), ('add_group_members', 'groups'), ('join_group_with_invite', 'groups'),
      ('create_direct_conversation', 'chat_direct'),
      ('create_project', 'projects'), ('create_project_task', 'projects'),
      ('create_shared_task', 'tasks'), ('create_1_1_shared_task', 'tasks'),
      ('create_think_hub_table', 'think_hub'), ('create_think_hub_record', 'think_hub'),
      ('schedule_message', 'scheduled_messages'), ('send_scheduled_message_now', 'scheduled_messages'),
      ('start_meeting_note', 'meeting_notes'),
      ('set_avatar', 'avatars'),
      ('unlink_contact', 'contact_link'), ('relink_contact', 'contact_link'), ('link_contact_to_friend', 'contact_link'),
      ('get_message_receipts', 'read_receipts'), ('set_conversation_share_read', 'read_receipts'),
      ('create_obligation_transaction', 'finance'), ('settle_transaction', 'finance'),
      ('create_contacts_bulk', 'contact_import')
    ) m(fn, key)
    join pg_proc p on p.proname = m.fn
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('private.assert_feature(' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, '(\$function\$.*?\mbegin\M)',
      E'\\1\n  perform private.assert_feature(''' || r.key || E''');', 'i');
    if position('private.assert_feature(' in v_new) = 0 then
      raise exception '112-B: không đặt được cổng cho % (thân hàm đã đổi)', r.oid::regprocedure;
    end if;
    execute v_new;
    v_count := v_count + 1;
  end loop;
  raise notice '112-B: đã đặt cổng cho % hàm', v_count;
end $do$;

-- Cảm xúc nổi không có RPC riêng: cổng nằm ở trigger ghi.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.reaction_guard()'::regprocedure);
  if position('private.assert_feature(' in v_def) = 0 then
    v_def := regexp_replace(v_def, '(\$function\$.*?\mbegin\M)',
      E'\\1\n  if tg_op = ''INSERT'' then perform private.assert_feature(''reactions''); end if;', 'i');
    if position('private.assert_feature(' in v_def) = 0 then raise exception '112-B: reaction_guard đã đổi'; end if;
    execute v_def;
  end if;
end $do$;
