-- AVORA-100 · PHẦN G — góp ý, /gop-y, mã mời, cờ invite_required. One transaction, always rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  fresh uuid := gen_random_uuid();
  fresh2 uuid := gen_random_uuid();
  f uuid; n bigint; out jsonb;
  failures int := 0; log text := ''; ok boolean;
begin
  -- fixture: O is on the team; one screenshot object of A; two codes.
  update public.app_config set value = jsonb_build_array(o::text) where key = 'ops_user_ids';
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('feedback-shots', a || '/probe.webp', a::text, '{"size": 40000, "mimetype": "image/webp"}'),
    ('feedback-shots', b || '/probe.webp', b::text, '{"size": 40000, "mimetype": "image/webp"}');

  -- G.1 gửi góp ý kèm ảnh; người khác không đọc được; đội đọc được.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  f := public.submit_feedback('loi', 'Nút Gửi bị che', '/tin-nhan', '1.0.0', 'Safari iOS', '390×844', 'vi', a || '/probe.webp');
  ok := (select count(*) from public.feedback where id = f) = 1;
  begin
    perform public.submit_feedback('loi', 'ảnh của B', null, null, null, null, null, b || '/probe.webp');
    ok := false;
  exception when others then null;
  end;
  begin
    insert into public.feedback (user_id, kind, body) values (a, 'loi', 'ghi thẳng');
    ok := false;
  exception when others then null;
  end;
  reset role;
  ok := ok and (select attachment_path from public.feedback where id = f) = a || '/probe.webp'
           and (select source from public.feedback where id = f) = 'app';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.feedback where id = f) = 0
           and (select count(*) from storage.objects where bucket_id = 'feedback-shots' and name = a || '/probe.webp') = 0;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.feedback where id = f) = 1
           and (select count(*) from storage.objects where bucket_id = 'feedback-shots' and name = a || '/probe.webp') = 1;
  perform public.set_feedback_status(f, 'dang_xem');
  reset role;
  ok := ok and (select status from public.feedback where id = f) = 'dang_xem';
  log := log || format(E'%s G.1 góp ý + ảnh; ảnh của người khác bị từ chối; B không đọc; đội đọc + đổi trạng thái\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- G.2 /gop-y khi chưa đăng nhập; trường bẫy.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := public.submit_public_feedback('y_tuong', 'Thêm lịch tuần', 'ban@example.com', '', '/gop-y');
  ok := ok and public.submit_public_feedback('y_tuong', 'bot spam probe-trap', null, 'http://spam', '/gop-y');
  begin
    perform public.submit_public_feedback('y_tuong', repeat('x', 2001), null, '', '/gop-y');
    ok := false;
  exception when others then null;
  end;
  begin
    perform 1 from public.feedback limit 1;
    ok := false;
  exception when others then null;
  end;
  reset role;
  ok := ok and (select count(*) from public.feedback where body = 'Thêm lịch tuần' and source = 'web' and user_id is null and email = 'ban@example.com') = 1
           and (select count(*) from public.feedback where body = 'bot spam probe-trap') = 0;
  log := log || format(E'%s G.2 /gop-y lưu được; bẫy → bỏ; > 2.000 ký tự → từ chối; anon không đọc bảng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- G.6 người ngoài đội: tạo mã / đọc mã / đổi cờ → từ chối.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin perform public.create_invite_code('AVR-XX-99', 'VN'); ok := false; exception when others then null; end;
  begin perform public.set_invite_required(true); ok := false; exception when others then null; end;
  begin perform public.set_feedback_status(f, 'da_lam'); ok := false; exception when others then null; end;
  begin insert into public.invite_code (code, country) values ('AVR-XX-98', 'VN'); ok := false; exception when others then null; end;
  ok := ok and not public.am_i_ops() and (select count(*) from public.app_config where key = 'ops_user_ids') = 0;
  reset role;
  ok := ok and (select status from public.feedback where id = f) = 'dang_xem';
  log := log || format(E'%s G.6 ngoài đội: tạo mã / bật cờ / đổi trạng thái / ghi thẳng → từ chối; không thấy danh sách đội\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- Đội tạo mã.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_invite_code('avr-de-01', 'DE', 'Probe partner', 1, 'en', 5);
  perform public.create_invite_code('AVR-VN-01', 'VN', null, 0, 'vi', 1);
  ok := public.am_i_ops() and (select count(*) from public.invite_code where code in ('AVR-DE-01', 'AVR-VN-01')) = 2;
  reset role;

  -- G.3 đăng ký kèm mã (metadata) → country DE, ngôn ngữ en, used + 1.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  out := public.check_invite('AVR-DE-01');
  ok := ok and (out ->> 'ok')::boolean and out ->> 'country' = 'DE' and out ->> 'locale' = 'en';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (fresh, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-g3-' || fresh || '@probe.invalid',
          jsonb_build_object('display_name', 'Probe G3', 'invite_code', 'AVR-DE-01'), now(), now());
  ok := ok and (select invite_code from public.profiles where id = fresh) = 'AVR-DE-01'
           and (select country from public.profiles where id = fresh) = 'DE'
           and (select prefs ->> 'locale' from public.profiles where id = fresh) = 'en'
           and (select used from public.invite_code where code = 'AVR-DE-01') = 1;
  -- A profile cannot write its own code / country.
  perform set_config('request.jwt.claims', json_build_object('sub', fresh, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set country = 'US', invite_code = null where id = fresh;
  exception when others then null;
  end;
  reset role;
  ok := ok and (select country from public.profiles where id = fresh) = 'DE';
  log := log || format(E'%s G.3 mã AVR-DE-01: điền được, country DE, ngôn ngữ en, đã dùng 1; tự sửa country → giữ\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- G.4 hết lượt.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.invite_code set used = max_uses where code = 'AVR-VN-01';
  set local role authenticated;
  out := public.check_invite('AVR-VN-01');
  ok := out ->> 'reason' = 'used_up';
  reset role;
  log := log || format(E'%s G.4 max_uses đã hết → used_up (`Mã mời đã dùng hết`)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- G.5 bật cờ: tài khoản cũ vẫn vào; tài khoản mới không mã bị chặn; nhập mã đúng thì vào; tắt cờ → vào.
  update public.invite_code set used = 0, max_uses = 5 where code = 'AVR-VN-01';
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_invite_required(true);
  reset role;
  perform pg_sleep(0.01);
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (fresh2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-g5-' || fresh2 || '@probe.invalid',
          jsonb_build_object('display_name', 'Probe G5'), clock_timestamp(), clock_timestamp());
  update public.profiles set created_at = clock_timestamp() where id = fresh2;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.profiles where id = a) = 1 and not (public.my_invite_gate() ->> 'blocked')::boolean;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', fresh2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (public.my_invite_gate() ->> 'blocked')::boolean
           and (select count(*) from public.profiles where id = fresh2) = 0
           and (select count(*) from public.conversations) = 0;
  out := public.redeem_invite('AVR-VN-01');
  ok := ok and (out ->> 'ok')::boolean and not (public.my_invite_gate() ->> 'blocked')::boolean
           and (select count(*) from public.profiles where id = fresh2) = 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_invite_required(false);
  reset role;
  update public.profiles set invite_code = null where id = fresh2;
  perform set_config('request.jwt.claims', json_build_object('sub', fresh2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and not (public.my_invite_gate() ->> 'blocked')::boolean and (select count(*) from public.profiles where id = fresh2) = 1;
  reset role;
  log := log || format(E'%s G.5 cờ bật: cũ vào; mới không mã bị chặn (API); nhập mã → vào; tắt cờ → vào\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA100_G failures=% %', failures, E'\n' || log;
end $test$;
