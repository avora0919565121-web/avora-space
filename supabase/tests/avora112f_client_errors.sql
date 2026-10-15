-- AVORA-112-F — ghi lỗi từ máy người dùng. Ghi thật trong một giao dịch, luôn rollback. A testera (thêm tạm vào
-- ops_user_ids) · B testerb (người thường) · anon.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  log text := '';
  failures int := 0;
  ok boolean;
  n int;
  r record;
  i int;
  summary jsonb;
begin
  update public.app_config set value = jsonb_build_array(a::text) where key = 'ops_user_ids';
  delete from public.client_errors where user_id in (a, b);

  -- ---------------------------------------------------------------- B ghi; nội dung được lọc
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.log_client_error('1.12.0+20261014', 'ios',
    '/tin-nhan/0b1f7a2c-0000-4000-8000-0000000112ff?q=nguyen%20van%20a#x', 'chat', 'avora_contact_unavailable <script>', 'abc123');
  perform public.log_client_error('1.12.0', 'ios', '/tin-nhan', 'chat', 'avora_contact_unavailable', 'abc123');
  select count(*) into n from public.client_errors; -- B không đọc được, kể cả dòng của mình
  ok := n = 0;
  reset role;
  select * into r from public.client_errors where user_id = b;
  ok := ok and r.route = '/tin-nhan/:id' and r.message_short = 'avora_contact_unavailable script' and r.count = 2
    and r.error_name = 'chat' and r.platform = 'ios';
  log := log || format(E'%s ghi được; đường dẫn bỏ id + query; ký tự lạ bị lọc; trùng trong ngày → đếm (%s · %s · %s)\n',
    case when ok then 'ok  ' else 'FAIL' end, r.route, r.message_short, r.count); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- 20 / giờ
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin
    for i in 1..25 loop
      perform public.log_client_error('1.12.0', 'web', '/nhiem-vu', 'tasks', 'avora_x', 'h' || i);
    end loop;
  exception when others then ok := sqlerrm = 'avora_rate_limited';
  end;
  reset role;
  select count(*) into n from public.client_errors where user_id = b;
  ok := ok and n <= 21;
  log := log || format(E'%s giới hạn 20 lỗi mới / giờ / người (%s dòng)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- không ghi hộ người khác
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform private.client_error_write(a, '1', 'web', '/', 'x', 'y', 'zz'); exception when others then ok := sqlerrm = 'avora_not_signed_in'; end;
  begin insert into public.client_errors (user_id, app_version, platform, route, error_name, message_short, stack_hash) values (b, '1', 'web', '/', 'x', 'y', 'q'); ok := false;
  exception when insufficient_privilege then null; end;
  begin perform public.ops_health_summary(7); ok := false; exception when others then ok := ok and sqlerrm = 'avora_not_allowed'; end;
  reset role;
  log := log || format(E'%s không ghi hộ người khác; không ghi thẳng bảng; người thường không xem Sức khoẻ\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- ops đọc + tóm tắt
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.log_client_error('1.12.0', 'web', '/tin-nhan', 'outbox', 'send_failed avora_x', 'of1');
  perform public.log_client_error('1.12.0', 'web', '/tin-nhan', 'realtime', 'zombie_reconnect', 'rt1');
  select count(*) into n from public.client_errors where user_id = b;
  summary := public.ops_health_summary(7);
  reset role;
  ok := n >= 1 and (summary ->> 'sendFailed')::int = 1 and (summary ->> 'realtimeReconnects')::int = 1
    and jsonb_array_length(summary -> 'top') between 1 and 10 and jsonb_array_length(summary -> 'byDay') >= 1;
  log := log || format(E'%s ops đọc mọi dòng; Sức khoẻ: tin gửi lỗi, nối lại realtime, 10 lỗi thường gặp\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false;
  begin perform public.log_client_error('1', 'web', '/', 'x', 'y', 'z'); exception when insufficient_privilege then ok := true; end;
  reset role;
  log := log || format(E'%s anon không ghi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA112F failures=%\n%', failures, log;
end $test$;
