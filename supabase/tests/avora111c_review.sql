-- 111-C · Tài khoản demo cho người duyệt: chỉ ops đánh dấu/gieo; ngoại lệ chỉ cho tài khoản demo
-- (khoá thiết bị, Két sắt trên máy lạ, mã mời, xoá ≤ 5 phút); tài khoản thường giữ nguyên. Luôn rollback.
do $test$
declare
  rv uuid := private.test_ephemeral_user('R');   -- người duyệt
  hp uuid := private.test_ephemeral_user('H');   -- tài khoản phụ của VMT
  nu uuid := private.test_ephemeral_user('N');   -- tài khoản thường
  op uuid := private.test_ephemeral_user('O');   -- ops
  rv_email text; v_json jsonb; v_n int; v_n2 int; v_q int;
  failures int := 0; log text := ''; ok boolean;
begin
  select email into rv_email from auth.users where id = rv;
  update public.app_config set value = jsonb_build_array(op::text) where key = 'ops_user_ids';

  -- 1. Người thường không đánh dấu được; ops đánh dấu được bằng email.
  perform set_config('request.jwt.claims', json_build_object('sub', nu, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.ops_mark_review_account(rv_email); exception when others then ok := sqlerrm = 'avora_not_allowed'; end;
  reset role;
  log := log || format(E'%s 1 người thường gọi ops_mark_review_account → avora_not_allowed\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.ops_mark_review_account(upper(rv_email), 'Apple review');
  reset role;
  ok := private.is_review_account(rv) and not private.is_review_account(nu) and (v_json ->> 'user_id')::uuid = rv;
  log := log || format(E'%s 2 ops đánh dấu (email không phân biệt hoa thường) → chỉ người duyệt là demo\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. Khoá thiết bị: máy chưa gắn → thường bị chặn, demo vẫn vào.
  insert into public.account_devices (id, user_id, device_id, device_public_key, rank) values
    (gen_random_uuid(), nu, gen_random_uuid(), 'k', 1), (gen_random_uuid(), rv, gen_random_uuid(), 'k', 1);
  insert into public.account_device_lock (user_id, locked_by_device, locked_rank)
    select user_id, id, 1 from public.account_devices where user_id in (nu, rv);
  perform set_config('request.jwt.claims', json_build_object('sub', nu, 'role', 'authenticated')::text, true);
  ok := not private.session_device_ok();
  perform set_config('request.jwt.claims', json_build_object('sub', rv, 'role', 'authenticated')::text, true);
  ok := ok and private.session_device_ok() and (public.device_status() ->> 'allowed')::boolean;
  perform set_config('request.jwt.claims', json_build_object('sub', nu, 'role', 'authenticated')::text, true);
  ok := ok and not (public.device_status() ->> 'allowed')::boolean;
  log := log || format(E'%s 3 khoá thiết bị: thường bị chặn trên máy lạ, demo vẫn vào\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 4. Két sắt trên máy chưa xếp Ưu tiên: thường không, demo có.
  ok := not private.vault_device_allowed(nu) and private.vault_device_allowed(rv);
  log := log || format(E'%s 4 Két sắt trên máy lạ: thường bị chặn, demo mở được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 5. Bắt buộc mã mời: tài khoản không mã → thường bị chặn, demo không.
  insert into public.app_config (key, value) values ('invite_required', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
  insert into public.app_config (key, value) values ('invite_required_since', to_jsonb((now() - interval '1 day')::text)) on conflict (key) do update set value = excluded.value;
  update public.profiles set invite_code = null where id in (nu, rv);
  ok := private.invite_blocks(nu) and not private.invite_blocks(rv);
  log := log || format(E'%s 5 thiếu mã mời: thường bị chặn, demo không\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  update public.app_config set value = 'false'::jsonb where key = 'invite_required';

  -- 6. Thời gian chờ xoá: demo 0, thường 14 ngày.
  ok := private.account_deletion_grace(rv) = interval '0' and private.account_deletion_grace(nu) = make_interval(days => 14);
  log := log || format(E'%s 6 chờ xoá: demo 0 · thường 14 ngày\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 7. Gửi yêu cầu xoá: demo gọi thực thi ngay (một lệnh gọi Edge Function); thường thì không.
  -- Supabase chỉ cho tạo khoá qua vault.create_secret (ghi thẳng vault.secrets bị từ chối trên dự án thật).
  if not exists (select 1 from vault.secrets where name = 'avora_push_cron_secret') then
    perform vault.create_secret('test-secret', 'avora_push_cron_secret');
  end if;
  select count(*) into v_q from net.http_request_queue where url like '%/delete-account';
  insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method)
    values (nu, now(), now() + private.account_deletion_grace(nu), 'pending', 'password');
  select count(*) into v_n from net.http_request_queue where url like '%/delete-account';
  insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method)
    values (rv, now(), now() + private.account_deletion_grace(rv), 'pending', 'password');
  select count(*) into v_n2 from net.http_request_queue where url like '%/delete-account';
  ok := v_n = v_q and v_n2 = v_q + 1;
  log := log || format(E'%s 7 yêu cầu xoá: demo gọi thực thi ngay (%s → %s), thường không (%s)\n', case when ok then 'ok  ' else 'FAIL' end, v_q, v_n2, v_n); failures := failures + (not ok)::int;
  delete from public.account_deletion_requests where user_id in (nu, rv);

  -- 8. Lịch: riêng cho demo mỗi 5 phút, lịch chung 37 phút mỗi giờ giữ nguyên.
  ok := exists (select 1 from cron.job where jobname = 'avora_delete_review_account' and schedule = '*/5 * * * *')
    and exists (select 1 from cron.job where jobname = 'avora_delete_account' and schedule = '37 * * * *');
  log := log || format(E'%s 8 lịch riêng */5 cho demo; lịch chung 37 * * * * giữ nguyên\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 9. Gieo dữ liệu: chỉ ops; gieo lại không nhân đôi.
  perform set_config('request.jwt.claims', json_build_object('sub', nu, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.ops_seed_review_data(rv, hp); exception when others then ok := sqlerrm = 'avora_not_allowed'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.ops_seed_review_data(rv, hp);
  reset role;
  v_n := (v_json ->> 'rows')::int;
  select count(*) into v_q from public.messages where conversation_id = (v_json ->> 'direct')::uuid;
  insert into public.messages (id, conversation_id, sender_id, content) values ('11111111-0000-4000-8000-0000000111c9', (v_json ->> 'direct')::uuid, hp, 'Tin thật giữa hai lần gieo');
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.ops_seed_review_data(rv, hp);
  reset role;
  select count(*) into v_n2 from public.messages where conversation_id = (v_json ->> 'direct')::uuid;
  ok := ok and v_n >= 20 and (v_json ->> 'rows')::int = v_n and v_q = 3 and v_n2 = 4
    and exists (select 1 from public.messages where id = '11111111-0000-4000-8000-0000000111c9')
    and (select count(*) from public.habits where user_id = rv) = 3
    and exists (select 1 from public.habits where user_id = rv and kind = 'timed')
    and (select count(*) from public.user_reports where reporter_id = rv) = 1
    and exists (select 1 from public.projects p join private.review_seed_rows s on s.id = p.id where s.reviewer = rv)
    and (select count(*) from public.transactions where user_id = rv) = 2;
  log := log || format(E'%s 9 gieo: người thường bị từ chối; ops gieo %s dòng; gieo lại vẫn 3 tin mẫu và giữ tin thật gõ giữa hai lần gieo, 3 thói quen (1 đồng hồ), 1 báo cáo, 1 dự án, 2 giao dịch\n', case when ok then 'ok  ' else 'FAIL' end, v_n); failures := failures + (not ok)::int;

  -- 10. Gieo cho tài khoản chưa đánh dấu hoặc tự làm người phụ → từ chối.
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.ops_seed_review_data(nu, hp); exception when others then ok := sqlerrm = 'avora_not_review_account'; end;
  begin perform public.ops_seed_review_data(rv, rv); ok := false; exception when others then ok := ok and sqlerrm = 'avora_review_helper_invalid'; end;
  reset role;
  log := log || format(E'%s 10 gieo cho tài khoản thường / người phụ trùng → từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 11. Gỡ đánh dấu → mất mọi ngoại lệ.
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.ops_unmark_review_account(rv_email);
  reset role;
  ok := not private.is_review_account(rv) and private.account_deletion_grace(rv) = make_interval(days => 14);
  log := log || format(E'%s 11 gỡ đánh dấu → mất ngoại lệ\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 12. Quyền: anon không gọi được RPC ops; authenticated không đọc trực tiếp bảng demo.
  ok := not has_function_privilege('anon', 'public.ops_mark_review_account(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.ops_seed_review_data(uuid, uuid)', 'execute')
    and not has_table_privilege('authenticated', 'private.review_accounts', 'select')
    and not has_function_privilege('authenticated', 'private.is_review_account(uuid)', 'execute');
  log := log || format(E'%s 12 quyền: anon không gọi RPC ops; client không đọc bảng demo\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 10b. Người duyệt tự xoá tài khoản sau khi đã gieo: xoá được ngay, không sót dữ liệu riêng.
  insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method)
    values (rv, now(), now(), 'pending', 'password');
  perform set_config('request.jwt.claims', '', true);  -- Edge Function chạy bằng service_role, không có auth.uid()
  v_json := private.account_purge(rv, 'self');
  delete from auth.users where id = rv;  -- bước cuối của Edge Function delete-account (API quản trị)
  ok := not exists (select 1 from public.habits where user_id = rv)
    and not exists (select 1 from public.tasks where creator_id = rv and type = 'personal')
    and not exists (select 1 from public.accounts where user_id = rv)
    and exists (select 1 from public.conversation_groups g where g.name = 'Gia đình · Family (demo)' and g.owner_id = hp);
  log := log || format(E'%s 10b người duyệt xoá tài khoản sau khi gieo: xoá được ngay (không kẹt ở bảng dự án), việc riêng / thói quen / tài khoản tiền mất, nhóm chuyển cho tài khoản phụ (%s)\n', case when ok then 'ok  ' else 'FAIL' end, v_json::text); failures := failures + (not ok)::int;

  raise exception E'AVORA111C failures=%\n%', failures, log;
end $test$;
