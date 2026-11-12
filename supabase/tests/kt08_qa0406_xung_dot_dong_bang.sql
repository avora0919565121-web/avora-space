-- KT-08 · QA04-06: hai người cùng sửa một dòng bảng — người lưu sau không ghi đè lặng lẽ.
-- Kiểm phiên bản lạc quan theo updated_at. Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; b uuid; g uuid := gen_random_uuid(); board uuid := gen_random_uuid(); rec uuid := gen_random_uuid();
  opened constant timestamptz := now() - interval '1 hour';  -- lúc cả hai cùng mở dòng
  row_now public.think_hub_record%rowtype; d jsonb; n int; b_name text;
  out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('KT8-06A'); b := private.test_ephemeral_user('KT8-06B');
  -- Staging bật invite_required: coi như tài khoản cũ (chỉ trong giao dịch này).
  update public.profiles set created_at = timestamptz '2020-01-01' where id in (a, b);
  select display_name into b_name from public.profiles where id = b;
  insert into public.conversations (id, type) values (g, 'group');
  insert into public.conversation_participants (conversation_id, user_id) values (g, a), (g, b);
  insert into public.conversation_groups (conversation_id, owner_id, name) values (g, a, 'KT-08 nhóm thử');
  insert into public.think_hub_table (id, owner_user_id, name, conversation_id, share_mode, column_defs)
  values (board, a, 'KT-08 bảng chung', g, 'edit', '[{"id":"so_luong","key":"so_luong","label":"Số lượng","type":"text"},{"id":"ghi_chu","key":"ghi_chu","label":"Ghi chú","type":"text"}]'::jsonb);
  insert into public.think_hub_record (id, table_id, owner_user_id, title, notes, extension_fields, updated_at)
  values (rec, board, a, 'Đèn sảnh', 'bản gốc', '{"so_luong":"10","ghi_chu":"gốc"}'::jsonb, opened);

  -- 1. B lưu trước (từ bản đã mở) → được.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    row_now := public.update_think_hub_record(rec, '{"extension_fields":{"so_luong":"12","ghi_chu":"gốc"}}'::jsonb, opened);
    reset role;
    if row_now.extension_fields->>'so_luong' = '12' and row_now.updated_at > opened then
      out := out || E'ok   người lưu trước (B) lưu được\n';
    else failures := failures + 1; out := out || E'FAIL B lưu trước\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL B lưu trước: %s\n', sqlerrm); end;

  -- 2. A lưu sau từ bản cũ → avora_think_hub_record_conflict, kèm tên B và updated_at mới; dữ liệu B còn nguyên.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.update_think_hub_record(rec, '{"title":"Đèn sảnh chính","extension_fields":{"so_luong":"10","ghi_chu":"A sửa"}}'::jsonb, opened);
      reset role; failures := failures + 1; out := out || E'FAIL A ghi đè lặng lẽ\n';
    exception when others then
      get stacked diagnostics d = pg_exception_detail;
      reset role;
      select * into row_now from public.think_hub_record where id = rec;
      if sqlerrm = 'avora_think_hub_record_conflict' and (d->>'by_id')::uuid = b and d->>'by_name' = b_name
         and (d->>'by_me')::boolean = false and (d->>'updated_at')::timestamptz = row_now.updated_at
         and row_now.extension_fields->>'so_luong' = '12' and row_now.title = 'Đèn sảnh' then
        out := out || format(E'ok   người lưu sau (A) bị báo xung đột: "vừa được %s cập nhật"; bản B giữ nguyên\n', d->>'by_name');
      else failures := failures + 1; out := out || format(E'FAIL xung đột: %s %s\n', sqlerrm, d); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL A lưu sau: %s\n', sqlerrm); end;

  -- 3. "Vẫn lưu của tôi": A gửi lại với updated_at mới (đã thấy bản B) → được.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    row_now := public.update_think_hub_record(rec, '{"title":"Đèn sảnh chính","extension_fields":{"so_luong":"10","ghi_chu":"A sửa"}}'::jsonb, (d->>'updated_at')::timestamptz);
    reset role;
    if row_now.title = 'Đèn sảnh chính' and row_now.extension_fields->>'ghi_chu' = 'A sửa' then
      out := out || E'ok   "Vẫn lưu của tôi" (với bản mới) lưu được\n';
    else failures := failures + 1; out := out || E'FAIL Vẫn lưu của tôi\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL Vẫn lưu của tôi: %s\n', sqlerrm); end;

  -- 4. Gọi kiểu cũ (2 tham số, không gửi phiên bản) vẫn chạy như trước.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    row_now := public.update_think_hub_record(rec, '{"status":"dang_lam"}'::jsonb);
    reset role;
    if row_now.status = 'dang_lam' then out := out || E'ok   gọi 2 tham số (app cũ) vẫn lưu\n';
    else failures := failures + 1; out := out || E'FAIL gọi 2 tham số\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL gọi 2 tham số: %s\n', sqlerrm); end;

  -- 5. Chỉ đặt "Nhắc tôi" (không đụng dòng) không bị chặn bởi phiên bản cũ.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.update_think_hub_record(rec, jsonb_build_object('remind_at', now() + interval '1 day'), opened);
    reset role;
    out := out || E'ok   chỉ đặt nhắc riêng: không báo xung đột\n';
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL nhắc riêng: %s\n', sqlerrm); end;

  -- 6. Cùng một người ở hai tab: by_me = true.
  begin
    update public.think_hub_record set notes = 'tab 1' where id = rec;  -- giả lập: chính A vừa lưu ở tab khác
    -- (trong một giao dịch mọi now() bằng nhau nên đặt giờ ghi sau một giây cho rõ thứ tự)
    insert into public.think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, created_at)
    values (board, a, 'record_edit', rec, a, 'Đèn sảnh chính', 1, now() + interval '1 second');
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.update_think_hub_record(rec, '{"notes":"tab 2"}'::jsonb, opened);
      reset role; failures := failures + 1; out := out || E'FAIL tab cũ ghi đè\n';
    exception when others then
      get stacked diagnostics d = pg_exception_detail;
      reset role;
      if sqlerrm = 'avora_think_hub_record_conflict' and (d->>'by_me')::boolean then out := out || E'ok   hai tab của cùng người: báo "bạn vừa cập nhật ở nơi khác"\n';
      else failures := failures + 1; out := out || format(E'FAIL hai tab: %s %s\n', sqlerrm, d); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL hai tab: %s\n', sqlerrm); end;

  -- 7. Quyền và chữ ký: chỉ còn một hàm, anon không gọi được.
  select count(*) into n from pg_proc where proname = 'update_think_hub_record' and pronamespace = 'public'::regnamespace;
  if n = 1 and not has_function_privilege('anon', 'public.update_think_hub_record(uuid, jsonb, timestamptz)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.update_think_hub_record(uuid, jsonb, timestamptz)', 'EXECUTE')
     and not exists (select 1 from private.session_guard_gaps() where name = 'update_think_hub_record') then
    out := out || E'ok   một hàm duy nhất, anon không gọi được, có cổng phiên\n';
  else failures := failures + 1; out := out || format(E'FAIL quyền / chữ ký (%s hàm)\n', n); end if;

  raise exception E'%kt08_qa0406_xung_dot_dong_bang failures=%', out, failures;
end $test$;
