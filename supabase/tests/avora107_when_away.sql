-- AVORA-107 · sửa sau 2E (VMT 10/10 21:11): "Khi rời Avora" (Cứ chạy / Dừng khi rời) + báo đủ giờ khi app đóng.
-- Mặc định Cứ chạy; chỉ chủ hẹn / huỷ giờ báo; một giờ báo một lúc; Dừng khi rời không hẹn; chế độ yên lặng xét lúc gửi.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  h uuid := gen_random_uuid(); hs uuid := gen_random_uuid(); hc uuid := gen_random_uuid();
  tz text; today date;
  failures int := 0; log text := ''; ok boolean; n bigint; out jsonb; v_ver int;
begin
  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into tz from public.profiles where id = a;
  today := (now() at time zone tz)::date;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_habit(h, 'Đọc sách', 'timed', 15, '{1,2,3,4,5,6,7}', '[{"time":"21:00","remind":true}]'::jsonb, true);
  perform public.create_habit(hs, 'Vận động', 'timed', 20, '{1,2,3,4,5,6,7}', '[{"time":"06:30","remind":true}]'::jsonb, true, 'stop');
  perform public.create_habit(hc, 'Dậy sớm', 'check', null, '{1,2,3,4,5,6,7}', '[{"time":"06:00","remind":true}]'::jsonb, true);
  ok := (select when_away from public.habits where id = h) = 'keep' and (select when_away from public.habits where id = hs) = 'stop';
  log := log || format(E'%s WA.1 mặc định Cứ chạy; chọn Dừng khi rời lưu được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  select version into v_ver from public.habits where id = hs;
  perform public.update_habit(hs, 'Vận động', 'timed', 25, '{1,2,3,4,5,6,7}', '[{"time":"06:30","remind":true}]'::jsonb, true, v_ver);
  ok := (select when_away from public.habits where id = hs) = 'stop';
  select version into v_ver from public.habits where id = hs;
  perform public.update_habit(hs, 'Vận động', 'timed', 25, '{1,2,3,4,5,6,7}', '[{"time":"06:30","remind":true}]'::jsonb, true, v_ver, 'keep');
  ok := ok and (select when_away from public.habits where id = hs) = 'keep';
  perform public.update_habit(hs, 'Vận động', 'timed', 25, '{1,2,3,4,5,6,7}', '[{"time":"06:30","remind":true}]'::jsonb, true, v_ver + 1, 'stop');
  ok := ok and (select when_away from public.habits where id = hs) = 'stop';
  log := log || format(E'%s WA.2 sửa không gửi lựa chọn → giữ; gửi → đổi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  ok := public.set_habit_alarm(h, today, 0, now() + interval '15 minutes');
  ok := ok and public.set_habit_alarm(h, today, 0, now() + interval '9 minutes');
  reset role;
  select count(*) into n from public.push_outbox where user_id = a and kind = 'habit' and status = 'pending' and dedupe_key like 'ht:%';
  ok := ok and n = 1 and (select send_after from public.push_outbox where user_id = a and dedupe_key like 'ht:%' and status = 'pending') between now() + interval '8 minutes' and now() + interval '10 minutes';
  log := log || format(E'%s WA.3 Cứ chạy: hẹn báo đủ giờ; hẹn lại (tiếp tục) → vẫn một giờ báo (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  set local role authenticated;
  ok := not public.set_habit_alarm(hs, today, 0, now() + interval '5 minutes') and not public.set_habit_alarm(hc, today, 0, now() + interval '5 minutes');
  reset role;
  ok := ok and (select count(*) from public.push_outbox where user_id = a and dedupe_key like 'ht:%' and status = 'pending') = 0;
  log := log || format(E'%s WA.4 Dừng khi rời / chỉ đánh dấu → không hẹn (và huỷ giờ báo cũ)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  set local role authenticated;
  perform public.set_habit_alarm(h, today, 0, now() + interval '5 minutes');
  ok := not public.set_habit_alarm(h, today, 0, null);
  reset role;
  ok := ok and (select count(*) from public.push_outbox where user_id = a and dedupe_key like 'ht:%' and status = 'pending') = 0;
  log := log || format(E'%s WA.5 Dừng / Hoàn thành / Bỏ phiên → huỷ giờ báo\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- B và người ngoài không hẹn được trên thói quen của A; anon không gọi được.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_habit_alarm(h, today, 0, now() + interval '5 minutes');
    ok := false;
  exception when others then ok := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin
    perform public.set_habit_alarm(h, today, 0, now() + interval '5 minutes');
    ok := false;
  exception when others then ok := ok and true;
  end;
  reset role;
  set local role anon;
  begin
    perform public.set_habit_alarm(h, today, 0, now() + interval '5 minutes');
    ok := false;
  exception when insufficient_privilege then ok := ok and true;
  end;
  reset role;
  ok := ok and (select count(*) from public.push_outbox where dedupe_key like 'ht:' || h || '%') = 0;
  log := log || format(E'%s WA.6 B / người ngoài / anon không hẹn được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- Lúc gửi: Chế độ tập trung → bỏ; bình thường → gửi, chữ ẩn nội dung.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (a, 'https://probe.invalid/wa-' || gen_random_uuid(), repeat('x', 87), repeat('y', 22));
  update public.profiles set focus_mode = 'quiet', focus_until = null, push_show_content = false where id = a;
  insert into public.push_outbox (user_id, kind, dedupe_key, send_after, payload)
  values (a, 'habit', 'ht:' || h || ':' || today || ':0:1', now() - interval '1 second', jsonb_build_object('habit_id', h, 'title', 'Đọc sách', 'alarm', true));
  perform public.push_claim_batch();
  ok := (select status from public.push_outbox where user_id = a and dedupe_key = 'ht:' || h || ':' || today || ':0:1') = 'skipped';
  log := log || format(E'%s WA.7 Chế độ tập trung lúc đủ giờ → không báo\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  update public.profiles set focus_mode = null, focus_until = null, rest_weekday = (extract(dow from now() at time zone tz)::int + 3) % 7 where id = a;
  insert into public.push_outbox (user_id, kind, dedupe_key, send_after, payload)
  values (a, 'habit', 'ht:' || h || ':' || today || ':0:2', now() - interval '1 second', jsonb_build_object('habit_id', h, 'title', 'Đọc sách', 'alarm', true));
  out := public.push_claim_batch();
  select count(*) into n from jsonb_array_elements(out) e
    where e->'notification'->>'tag' = 'thoi-quen-dong-ho:' || h and e->'notification'->>'body' = 'Đồng hồ thói quen đã đủ giờ';
  ok := n = 1;
  log := log || format(E'%s WA.8 bình thường → một thông báo `Đồng hồ thói quen đã đủ giờ` (ẩn tên)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA107_WA failures=% %', failures, E'\n' || log;
end $test$;
