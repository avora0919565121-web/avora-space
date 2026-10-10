-- AVORA-107 · PHẦN 1 — Thói quen: chỉ chủ đọc / ghi qua RPC; không ghi đôi; bỏ đánh dấu trong ngày;
-- lưu trữ giữ lịch sử; nhắc tuân chế độ yên lặng; B / C / người ngoài / anon không đọc, không ghi được.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid;
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  h uuid := gen_random_uuid(); h2 uuid := gen_random_uuid(); l1 uuid := gen_random_uuid(); l2 uuid;
  today date := (now() at time zone 'utc')::date;
  failures int := 0; log text := ''; ok boolean; n bigint; v int; tz text; win text;
begin
  select id into c from auth.users where id::text like '151a54b2%' limit 1;

  -- ---------------------------------------------------------------- A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_habit(h, 'Uống đủ nước', 'check', 30, '{1,2,3,4,5,6,7}',
    '[{"time":"07:00","remind":true},{"time":"10:00","remind":true},{"time":"14:00","remind":true},{"time":"17:00","remind":false}]'::jsonb, true);
  select count(*) into n from public.habits where id = h and target_minutes is null and jsonb_array_length(windows) = 4;
  ok := n = 1;
  log := log || format(E'%s 107.1 A tạo `Uống đủ nước` 4 khung (chỉ đánh dấu: không số phút)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  ok := public.create_habit(h, 'Uống đủ nước', 'check', null, '{1}', '[{"time":"07:00"}]'::jsonb, true) = h
        and (select count(*) from public.habits where id = h) = 1 and (select jsonb_array_length(windows) from public.habits where id = h) = 4;
  log := log || format(E'%s 107.6 gửi lại create_habit (mất mạng) → cùng thói quen, không đôi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform public.log_habit(l1, h, today, 0);
  l2 := public.log_habit(gen_random_uuid(), h, today, 0);
  perform public.log_habit(null, h, today, 1);
  perform public.log_habit(l1, h, today, 0);
  select count(*) into n from public.habit_logs where habit_id = h and local_date = today and status = 'done';
  ok := n = 2 and l2 = l1;
  log := log || format(E'%s 107.1 đánh dấu 2 khung, bấm lại / gửi lại → vẫn 2 dòng (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  ok := public.unlog_habit(h, today, 1);
  select count(*) into n from public.habit_logs where habit_id = h and local_date = today and status = 'done';
  ok := ok and n = 1;
  perform public.log_habit(null, h, today, 1);
  log := log || format(E'%s 107.1 bỏ đánh dấu trong ngày được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  begin perform public.log_habit(null, h, today - 5, 0); ok := false; exception when others then ok := sqlerrm = 'avora_habit_date'; end;
  log := log || format(E'%s ngày xa (5 ngày trước) bị từ chối — không ghi khống lịch sử\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.unlog_habit(h, today - 5, 0); ok := false; exception when others then ok := sqlerrm = 'avora_habit_date'; end;
  log := log || format(E'%s bỏ đánh dấu ngày cũ bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.log_habit(null, h, today, 4); ok := false; exception when others then ok := sqlerrm = 'avora_habit_window'; end;
  log := log || format(E'%s khung không có (5/4) bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform public.abandon_habit_session(null, h, today, 2, 360, 'Có khách');
  select done_total into n from public.my_habit_totals() where habit_id = h;
  ok := n = 2 and exists (select 1 from public.habit_logs where habit_id = h and status = 'abandoned' and note = 'Có khách' and duration_seconds = 360);
  log := log || format(E'%s phiên bỏ ghi lại, không tính `Đã làm`; Tổng = %s\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  v := public.update_habit(h, 'Uống đủ nước', 'check', null, '{1,2,3,4,5}', '[{"time":"10:00"},{"time":"07:00"},{"time":"14:00"},{"time":"17:00"}]'::jsonb, true, 1);
  begin perform public.update_habit(h, 'Bản cũ', 'check', null, '{1}', '[{"time":"07:00"}]'::jsonb, true, 1); ok := false; exception when others then ok := sqlerrm = 'avora_habit_conflict'; end;
  ok := ok and v = 2 and (select windows->0->>'time' from public.habits where id = h) = '07:00' and (select name from public.habits where id = h) = 'Uống đủ nước';
  log := log || format(E'%s sửa theo version; bản cũ hơn không đè (khung xếp theo giờ)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  begin perform public.create_habit(gen_random_uuid(), 'Vận động', 'timed', null, '{1}', '[{"time":"06:00"}]'::jsonb, true); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s `Có đồng hồ` thiếu số phút bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.create_habit(gen_random_uuid(), 'Dậy sớm', 'check', null, '{1}', '[]'::jsonb, true); ok := false; exception when others then ok := sqlerrm = 'avora_habit_windows'; end;
  log := log || format(E'%s thiếu khung giờ bị từ chối (khung bắt buộc)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  begin insert into public.habits (user_id, name, kind, windows) values (a, 'Lách', 'check', '[{"time":"07:00"}]'); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s A ghi thẳng vào bảng bị từ chối (chỉ qua RPC)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin delete from public.habit_logs where habit_id = h; ok := false; exception when others then ok := true; end;
  ok := ok and (select count(*) from public.habit_logs where habit_id = h) = 3;
  log := log || format(E'%s A xoá thẳng lịch sử bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  insert into public.think_hub_view_row_meta (user_id, board_key, source_key, note) values (a, 'habits', h::text, 'Vì sức khoẻ');
  begin insert into public.think_hub_view_row_meta (user_id, board_key, source_key, note) values (a, 'thoi_quen_khac', h::text, 'x'); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s 107.5 bảng `Thói quen`: ghi chú dòng của chủ được; khoá bảng lạ bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.search_avora('uong du nuoc', '{"tab":"nhiem-vu"}'::jsonb, array['habit'], 10) r where r.id = h and r.in_here;
  ok := n = 1;
  log := log || format(E'%s tìm `uong du nuoc` (không dấu) → thấy thói quen của mình\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- B · C · người ngoài
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', case i when 1 then b when 2 then coalesce(c, o) else o end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.habits where id = h;
    ok := n = 0 and (select count(*) from public.habit_logs where habit_id = h) = 0
          and not exists (select 1 from public.my_habit_totals() where habit_id = h)
          and (select count(*) from public.think_hub_view_row_meta where source_key = h::text) = 0;
    ok := ok and not exists (select 1 from public.search_avora('uong du nuoc', '{"tab":"nhiem-vu"}'::jsonb, null, 20) r where r.id = h);
    begin perform public.log_habit(null, h, today, 3); ok := false; exception when others then ok := ok and sqlerrm = 'avora_habit_not_found'; end;
    begin perform public.unlog_habit(h, today, 0); ok := false; exception when others then ok := ok; end;
    begin perform public.update_habit(h, 'Của tôi', 'check', null, '{1}', '[{"time":"07:00"}]'::jsonb, true, null); ok := false; exception when others then ok := ok; end;
    begin perform public.archive_habit(h, true); ok := false; exception when others then ok := ok; end;
    begin perform public.pause_habit(h, true); ok := false; exception when others then ok := ok; end;
    begin perform public.create_habit(h, 'Chiếm id', 'check', null, '{1}', '[{"time":"07:00"}]'::jsonb, true); ok := false; exception when others then ok := ok and sqlerrm = 'avora_habit_id'; end;
    log := log || format(E'%s 107.8 %s: không đọc, không ghi, không chiếm id thói quen của A\n', case when ok then 'ok  ' else 'FAIL' end, case i when 1 then 'B' when 2 then 'C' else 'người ngoài' end); failures := failures + (not ok)::int;
    reset role;
  end loop;
  ok := (select count(*) from public.habit_logs where habit_id = h and status = 'done') = 2 and (select archived_at from public.habits where id = h) is null;
  log := log || format(E'%s 107.8 dữ liệu A nguyên vẹn sau khi B / C / người ngoài thử\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin select count(*) into n from public.habits; ok := false; exception when others then ok := true; end;
  begin perform public.create_habit(gen_random_uuid(), 'x', 'check', null, '{1}', '[{"time":"07:00"}]'::jsonb, true); ok := false; exception when others then ok := ok; end;
  begin perform public.log_habit(null, h, today, 0); ok := false; exception when others then ok := ok; end;
  log := log || format(E'%s 107.8 anon: không đọc, không ghi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- Nhắc (send-push) tuân chế độ yên lặng
  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into tz from public.profiles where id = a;
  win := to_char((now() at time zone tz) - interval '10 minutes', 'HH24:MI');
  update public.profiles set push_reminders = true, focus_mode = null, focus_until = null,
    rest_weekday = (extract(dow from now() at time zone tz)::int + 3) % 7 where id = a;
  delete from public.mute_settings where user_id = a and scope = 'avora';
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label) values (a, 'https://probe.invalid/' || gen_random_uuid(), repeat('p', 87), repeat('a', 22), 'probe')
  on conflict do nothing;
  insert into public.habits (id, user_id, name, kind, target_minutes, windows, reminders_on)
  values (h2, a, 'Vận động', 'timed', 10, jsonb_build_array(jsonb_build_object('time', win, 'remind', true)), true);
  delete from public.push_outbox where user_id = a and kind = 'habit';
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit' and payload->>'habit_id' = h2::text) = 1;
  perform private.enqueue_due_habits();
  ok := ok and (select count(*) from public.push_outbox where user_id = a and kind = 'habit' and payload->>'habit_id' = h2::text) = 1;
  log := log || format(E'%s nhắc: khung vừa tới → một dòng `habit` (gọi lại không đôi)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  delete from public.push_outbox where user_id = a and kind = 'habit';
  update public.profiles set focus_mode = 'quiet', focus_until = now() + interval '1 hour' where id = a;
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  log := log || format(E'%s 107.3 Chế độ tập trung · Yên lặng → không đẩy\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  update public.profiles set focus_mode = null, focus_until = null, rest_weekday = extract(dow from now() at time zone tz)::int where id = a;
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  log := log || format(E'%s nhắc: ngày nghỉ → không đẩy\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  update public.profiles set rest_weekday = (extract(dow from now() at time zone tz)::int + 3) % 7 where id = a;
  insert into public.mute_settings (user_id, scope, muted_until) values (a, 'avora', now() + interval '1 hour');
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  log := log || format(E'%s nhắc: Tắt toàn AVORA → không đẩy\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  delete from public.mute_settings where user_id = a and scope = 'avora';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.pause_habit(h2, true);
  reset role;
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  set local role authenticated;
  perform public.pause_habit(h2, false);
  perform public.archive_habit(h2, true);
  reset role;
  perform private.enqueue_due_habits();
  ok := ok and (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  set local role authenticated;
  perform public.archive_habit(h, true);
  ok := ok and (select count(*) from public.habit_logs where habit_id = h) = 3 and (select archived_at from public.habits where id = h) is not null;
  reset role;
  log := log || format(E'%s 107.4 Tạm nghỉ / Lưu trữ → không nhắc; lịch sử còn\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  set local role authenticated;
  perform public.archive_habit(h2, false);
  perform public.log_habit(null, h2, (now() at time zone tz)::date, 0, 'manual', 600);
  reset role;
  perform private.enqueue_due_habits();
  ok := (select count(*) from public.push_outbox where user_id = a and kind = 'habit') = 0;
  log := log || format(E'%s nhắc: khung đã làm → không đẩy\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA107_P1 failures=% %', failures, E'\n' || log;
end $test$;
