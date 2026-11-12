-- KT-08 · QA04-07: gửi theo lô giữ đúng thứ tự, không trùng, dừng đúng chỗ lỗi, vẫn theo hạn mức. Luôn rollback.
do $test$
declare
  a uuid; b uuid; o uuid; g uuid := gen_random_uuid();
  ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  res jsonb; n int; ordered uuid[]; t timestamptz[];
  out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('KT8-07A'); b := private.test_ephemeral_user('KT8-07B'); o := private.test_ephemeral_user('KT8-07O');
  -- Staging bật invite_required: coi như tài khoản cũ (chỉ trong giao dịch này).
  update public.profiles set created_at = timestamptz '2020-01-01' where id in (a, b, o);
  insert into public.conversations (id, type) values (g, 'group');
  insert into public.conversation_participants (conversation_id, user_id) values (g, a), (g, b);
  insert into public.conversation_groups (conversation_id, owner_id, name) values (g, a, 'KT-08 lô');

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Lô 3 tin → 3 dòng, created_at tăng dần đúng thứ tự gửi (không trùng giờ trong một giao dịch).
  begin
    res := public.send_messages(jsonb_build_array(
      jsonb_build_object('id', ids[1], 'conversation_id', g, 'content', 'lô #1'),
      jsonb_build_object('id', ids[2], 'conversation_id', g, 'content', 'lô #2', 'mentioned', jsonb_build_array(b)),
      jsonb_build_object('id', ids[3], 'conversation_id', g, 'content', 'lô #3')));
    select array_agg(m.id order by m.created_at, m.id), array_agg(m.created_at order by m.created_at, m.id) into ordered, t
      from public.messages m where m.conversation_id = g;
    if jsonb_array_length(res->'sent') = 3 and res->>'error' is null and ordered = ids and t[1] < t[2] and t[2] < t[3]
       and (res->'sent'->1->>'id')::uuid = ids[2] and (select mentioned_user_ids from public.messages where id = ids[2]) = array[b] then
      out := out || E'ok   lô 3 tin: đủ 3, giờ tăng dần, thứ tự (created_at, id) = thứ tự gửi\n';
    else failures := failures + 1; out := out || format(E'FAIL lô 3 tin: %s\n', res); end if;
  exception when others then failures := failures + 1; out := out || format(E'FAIL lô 3 tin: %s\n', sqlerrm); end;

  -- 2. Gửi lại đúng lô đó (mạng chập chờn) → không thêm dòng nào.
  begin
    res := public.send_messages(jsonb_build_array(
      jsonb_build_object('id', ids[1], 'conversation_id', g, 'content', 'lô #1'),
      jsonb_build_object('id', ids[2], 'conversation_id', g, 'content', 'lô #2')));
    select count(*) into n from public.messages where conversation_id = g;
    if n = 3 and jsonb_array_length(res->'sent') = 2 then out := out || E'ok   gửi lại cùng id: không trùng\n';
    else failures := failures + 1; out := out || format(E'FAIL gửi lại: %s dòng\n', n); end if;
  exception when others then failures := failures + 1; out := out || format(E'FAIL gửi lại: %s\n', sqlerrm); end;

  -- 3. Tin giữa lô lỗi (trống) → tin trước đi, dừng ở tin lỗi, tin sau KHÔNG đi (giữ thứ tự).
  declare x uuid := gen_random_uuid(); y uuid := gen_random_uuid(); z uuid := gen_random_uuid();
  begin
    res := public.send_messages(jsonb_build_array(
      jsonb_build_object('id', x, 'conversation_id', g, 'content', 'trước lỗi'),
      jsonb_build_object('id', y, 'conversation_id', g, 'content', '   '),
      jsonb_build_object('id', z, 'conversation_id', g, 'content', 'sau lỗi')));
    if jsonb_array_length(res->'sent') = 1 and (res->>'failed_id')::uuid = y and res->>'error' like 'messages_content%'
       and exists (select 1 from public.messages where id = x) and not exists (select 1 from public.messages where id in (y, z)) then
      out := out || E'ok   lỗi giữa lô: tin trước đi, dừng đúng tin lỗi, tin sau chờ\n';
    else failures := failures + 1; out := out || format(E'FAIL lỗi giữa lô: %s\n', res); end if;
  exception when others then failures := failures + 1; out := out || format(E'FAIL lỗi giữa lô: %s\n', sqlerrm); end;

  -- 4. Hạn mức 5 tin/giây vẫn giữ: B (chưa gửi tin nào) gửi lô 6 tin → 5 đi, tin 6 báo avora_rate_limited.
  --    (trong một giao dịch now() đứng yên nên dùng người khác thay vì chờ hết cửa sổ 1 giây)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'conversation_id', g, 'content', 'nhanh #' || i) order by i)
      into res from generate_series(1, 6) i;
    res := public.send_messages(res);
    if jsonb_array_length(res->'sent') = 5 and res->>'error' = 'avora_rate_limited' then
      out := out || E'ok   hạn mức 5 tin/giây vẫn áp trong lô (tin 6 chờ)\n';
    else failures := failures + 1; out := out || format(E'FAIL hạn mức: %s tin, %s\n', jsonb_array_length(res->'sent'), res->>'error'); end if;
  exception when others then failures := failures + 1; out := out || format(E'FAIL hạn mức: %s\n', sqlerrm); end;
  reset role;

  -- 5. Người ngoài nhóm: không gửi được tin nào.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    res := public.send_messages(jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'conversation_id', g, 'content', 'lạ')));
    reset role;
    if jsonb_array_length(res->'sent') = 0 and res->>'error' like '%not_a_participant%' then out := out || E'ok   người ngoài: bị từ chối\n';
    else failures := failures + 1; out := out || format(E'FAIL người ngoài: %s\n', res); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL người ngoài: %s\n', sqlerrm); end;

  -- 6. Quá 10 tin/lô bị từ chối cả lô; anon không gọi được; có cổng phiên.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'conversation_id', g, 'content', 'x')) into res from generate_series(1, 11);
      perform public.send_messages(res);
      reset role; failures := failures + 1; out := out || E'FAIL lô 11 tin lọt\n';
    exception when others then
      reset role;
      if sqlerrm = 'avora_batch_too_large' and not has_function_privilege('anon', 'public.send_messages(jsonb)', 'EXECUTE')
         and not exists (select 1 from private.session_guard_gaps() where name = 'send_messages') then
        out := out || E'ok   lô > 10 bị từ chối; anon không gọi được; có cổng phiên\n';
      else failures := failures + 1; out := out || format(E'FAIL giới hạn/quyền: %s\n', sqlerrm); end if;
    end;
  end;

  -- 7. Tin đơn lẻ (send_message) vẫn như cũ; created_at mặc định là clock_timestamp().
  begin
    if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'created_at') = 'clock_timestamp()' then
      out := out || E'ok   messages.created_at mặc định clock_timestamp()\n';
    else failures := failures + 1; out := out || E'FAIL mặc định created_at\n'; end if;
  end;

  raise exception E'%kt08_qa0407_gui_theo_lo failures=%', out, failures;
end $test$;
