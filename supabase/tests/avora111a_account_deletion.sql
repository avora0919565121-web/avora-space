-- 111-A · Xoá tài khoản: xác nhận danh tính, yêu cầu/huỷ, thực thi, probe mục 1/2/3 và quét uid cũ.
-- Tài khoản tạm (A, B, C), mọi thứ trong một giao dịch, luôn rollback.
do $test$
declare
  a uuid := private.test_ephemeral_user('A');
  b uuid := private.test_ephemeral_user('B');
  c uuid := private.test_ephemeral_user('C');
  d uuid := gen_random_uuid();   -- 1-1 A, B
  g uuid := gen_random_uuid();   -- nhóm: A chủ, B thành viên (vào trước), C admin
  g2 uuid := gen_random_uuid();  -- nhóm chỉ có A → bị xoá
  j uuid := gen_random_uuid();   -- Nhật ký riêng của A
  prj uuid := gen_random_uuid(); tk uuid := gen_random_uuid(); tp uuid := gen_random_uuid(); fm uuid := gen_random_uuid();
  v_pin text; v_res jsonb; v_n bigint; v_hits text := ''; r record;
  failures int := 0; log text := ''; ok boolean;
begin
  insert into public.conversations (id, type) values (d, 'direct'), (g, 'group'), (g2, 'group'), (j, 'personal');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, '111A nhóm', a), (g2, '111A một mình', a);
  insert into public.conversation_participants (conversation_id, user_id, role, joined_at) values
    (g, a, 'owner', now() - interval '3 days'), (g, b, 'member', now() - interval '2 days'), (g, c, 'admin', now() - interval '1 day'),
    (g2, a, 'owner', now()), (d, a, 'member', now()), (d, b, 'member', now()), (j, a, 'member', now());
  insert into public.messages (conversation_id, sender_id, content, created_at)
    select x.conv, a, 'Tin ' || i, now() - make_interval(mins => 10 - i)
      from generate_series(1, 5) i cross join (values (d), (g), (j)) x(conv);
  insert into public.messages (id, conversation_id, sender_id, content, attachment_count) values (fm, g, a, '', 1);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
    values (fm, g, a, 'file', g || '/' || fm || '/a.pdf', 'a.pdf', 'application/pdf', 10, 'view');
  insert into public.scheduled_messages (conversation_id, sender_id, content, send_at) values (g, a, 'Hẹn', now() + interval '1 day');
  insert into public.projects (id, conversation_id, created_by, title, objective, value_orientation, start_date, target_end_date)
    values (prj, g, a, 'Dự án nhóm', 'Mục tiêu', 'Giá trị', current_date, current_date + 30);
  insert into public.tasks (id, type, creator_id, conversation_id, title, status, confirmed_at, deadline_date, assignee_id)
    values (tk, 'group-shared', a, g, 'Việc nhóm', 'confirmed', now(), current_date + 3, b);
  insert into public.tasks (id, type, creator_id, title, status, deadline_date)
    values (tp, 'personal', a, 'Việc riêng', 'confirmed', current_date + 3);
  insert into public.user_reports (reporter_id, reported_user_id, reason, reported_content, status)
    values (b, a, 'scam', 'Bản sao nội dung', 'open');
  -- Tài khoản tạm chưa có PIN: cấp một PIN hợp lệ chưa ai dùng.
  loop
    v_pin := 'A-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') from generate_series(1, 8));
    exit when private.user_pin_problem(v_pin) is null and not exists (select 1 from public.user_pins where pin = v_pin)
      and not exists (select 1 from private.retired_pins where pin = v_pin);
  end loop;
  insert into public.user_pins (user_id, pin, source) values (a, v_pin, 'generated')
  on conflict (user_id) do nothing;
  select pin into v_pin from public.user_pins where user_id = a;
  update public.app_features set status = 'stable' where key = 'account_deletion';

  -- 1. Không xác nhận danh tính → bị từ chối.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_account_deletion(null);
    ok := false;
  exception when others then ok := sqlerrm like '%avora_account_reauth_required%';
  end;
  reset role;
  log := log || format(E'%s 1 chưa xác nhận danh tính → avora_account_reauth_required\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 2. Mật khẩu sai (tài khoản tạm không có mật khẩu) → false, không mở cửa.
  set local role authenticated;
  ok := public.account_reauth_password('sai-mat-khau') = false and not (public.account_deletion_status()->>'reauth_valid')::boolean;
  reset role;
  log := log || format(E'%s 2 mật khẩu sai → false, không có lần xác nhận\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. OTP: sai → wrong; đúng → ok; yêu cầu → pending đúng 14 ngày; gọi lặp không nhân đôi.
  set local role authenticated;
  v_res := public.account_request_otp();
  reset role;
  update private.account_otp_codes set code_hash = extensions.crypt('123456', extensions.gen_salt('bf', 4)) where user_id = a and used_at is null;
  set local role authenticated;
  ok := v_res->>'channel' = 'email' and (public.account_verify_otp('000000'))->>'reason' = 'wrong'
    and (public.account_verify_otp('123456'))->>'ok' = 'true';
  v_res := public.request_account_deletion(null);
  ok := ok and v_res->>'status' = 'pending' and (v_res->>'repeated')::boolean = false
    and abs(extract(epoch from ((v_res->>'execute_after')::timestamptz - now() - interval '14 days'))) < 60;
  v_res := public.request_account_deletion(null);
  ok := ok and (v_res->>'repeated')::boolean = true and (public.account_deletion_status()->>'grace_days')::int = 14;
  reset role;
  ok := ok and (select count(*) from public.account_deletion_requests where user_id = a) = 1
    and (select method from public.account_deletion_requests where user_id = a) = 'otp'
    and (select count(*) from public.push_outbox where user_id = a and kind = 'account') = 1;
  log := log || format(E'%s 3 OTP sai/đúng; yêu cầu pending +14 ngày; gọi lặp không nhân đôi; 1 push account\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 4. Huỷ → cancelled; chưa đến hạn thì thực thi bị từ chối.
  set local role authenticated;
  v_res := public.cancel_account_deletion();
  ok := v_res->>'status' = 'cancelled' and public.account_deletion_status()->>'status' = 'cancelled';
  reset role;
  begin
    perform private.account_purge(a, 'self');
    ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_account_purge_not_due%'; v_hits := sqlerrm;
  end;
  if not ok then log := log || format(E'     (huỷ: %s · lỗi: %s)\n', v_res, v_hits); end if;
  v_hits := '';
  log := log || format(E'%s 4 huỷ → cancelled; thực thi khi không đến hạn → avora_account_purge_not_due\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 5. Đến hạn: thực thi (2 lần, chạy lại an toàn) rồi xoá auth.users như admin API.
  update public.account_deletion_requests set status = 'pending', execute_after = now() - interval '1 minute' where user_id = a;
  perform set_config('request.jwt.claims', '', true);  -- Edge Function chạy bằng service_role: auth.uid() rỗng
  v_res := private.account_purge(a, 'self');
  v_res := private.account_purge(a, 'self');
  delete from auth.users where id = a;
  ok := not exists (select 1 from auth.users where id = a) and (select count(*) from public.account_deletions_log l where l.counts ? 'messages_kept' and l.executed_at >= now()) >= 1;
  log := log || format(E'%s 5 thực thi 2 lần không lỗi; auth.users đã xoá; nhật ký có dòng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 6. Mục 1 · tin chung: B thấy đủ 5 tin ở 1-1 và 5 tin ở nhóm, người gửi rỗng ("Người dùng đã xoá").
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.messages where conversation_id = d and sender_id is null and content like 'Tin %') = 5
    and (select count(*) from public.messages where conversation_id = g and sender_id is null and content like 'Tin %') = 5
    and (select deleted_at is not null from public.messages where id = fm);
  reset role;
  ok := ok and not exists (select 1 from public.message_attachments where message_id = fm)
    and exists (select 1 from private.storage_delete_queue where bucket = 'chat-attachments' and path = g || '/' || fm || '/a.pdf')
    and not exists (select 1 from public.scheduled_messages where conversation_id = g)
    and exists (select 1 from public.user_reports where reported_user_id is null and reported_content = 'Bản sao nội dung');
  log := log || format(E'%s 6 mục 1: B thấy 5+5 tin, người gửi rỗng; tệp vào hàng đợi; tin hẹn xoá; báo cáo giữ bản sao\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 7. Mục 2 · nhóm: admin C nhận chủ (cả participants lẫn conversation_groups); nhóm một mình và Nhật ký riêng bị xoá;
  --    dự án và việc nhóm ở lại (người kế / người được giao); việc riêng mất.
  ok := (select role from public.conversation_participants where conversation_id = g and user_id = c) = 'owner'
    and (select owner_id from public.conversation_groups where conversation_id = g) = c
    and (select count(*) from public.conversation_participants where conversation_id = g and role = 'owner') = 1
    and not exists (select 1 from public.conversations where id in (g2, j))
    and (select created_by from public.projects where id = prj) = c
    and (select creator_id from public.tasks where id = tk) = b
    and not exists (select 1 from public.tasks where id = tp);
  log := log || format(E'%s 7 mục 2: admin nhận chủ (2 nơi); nhóm 1 người + Nhật ký xoá; dự án → C, việc nhóm → B\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 8. Mục 3 · PIN: nằm trong retired_pins, kiểm lại trả 'taken'.
  set local role authenticated;
  ok := v_pin is not null and public.check_user_pin(v_pin) = 'taken';
  reset role;
  ok := ok and exists (select 1 from private.retired_pins where pin = v_pin) and not exists (select 1 from public.user_pins where pin = v_pin);
  log := log || format(E'%s 8 mục 3: PIN %s nghỉ hưu, check_user_pin → taken\n', case when ok then 'ok  ' else 'FAIL' end, coalesce(v_pin, '?')); failures := failures + (not ok)::int;

  -- 9. Quét mọi cột uuid / uuid[] trong public, private, auth, storage: không còn uid cũ.
  for r in
    select c2.table_schema s, c2.table_name t, c2.column_name col, c2.data_type dt
      from information_schema.columns c2 join information_schema.tables t2
        on t2.table_schema = c2.table_schema and t2.table_name = c2.table_name and t2.table_type = 'BASE TABLE'
     where c2.table_schema in ('public', 'private', 'auth', 'storage')
       and (c2.udt_name = 'uuid' or c2.udt_name = '_uuid')
  loop
    if r.dt = 'ARRAY' then
      execute format('select count(*) from %I.%I where $1 = any(%I)', r.s, r.t, r.col) into v_n using a;
    else
      execute format('select count(*) from %I.%I where %I = $1', r.s, r.t, r.col) into v_n using a;
    end if;
    if v_n > 0 then v_hits := v_hits || format('%s.%s.%s=%s ', r.s, r.t, r.col, v_n); end if;
  end loop;
  ok := v_hits = '';
  log := log || format(E'%s 9 quét uuid: %s\n', case when ok then 'ok  ' else 'FAIL' end, case when ok then 'không còn uid cũ' else v_hits end); failures := failures + (not ok)::int;

  raise exception E'AVORA111A failures=% \n%', failures, log;
end $test$;
