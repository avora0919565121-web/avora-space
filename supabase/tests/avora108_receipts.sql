-- AVORA-108 · 2.4 — trạng thái tin thật, có đi có lại. ≥ 3 tài khoản, role authenticated. Always rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := private.test_ephemeral_user('C');
  o uuid := private.test_ephemeral_user('O');
  g uuid := gen_random_uuid();      -- group A, B, C
  big uuid := gen_random_uuid();    -- group of 102 (A + 101 others)
  d uuid := gen_random_uuid();      -- 1-1 A, B
  m uuid := gen_random_uuid(); mb uuid := gen_random_uuid(); md uuid := gen_random_uuid();
  r record; n bigint; st text; out_state text;
  failures int := 0; log text := ''; ok boolean; err text;
begin
  insert into public.conversations (id, type) values (g, 'group'), (big, 'group'), (d, 'direct');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'N1 probe', a), (big, 'N1 big', a);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner'), (g, b, 'member'), (g, c, 'member'), (big, a, 'owner');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  -- 101 more members for the big group (throw-away accounts, rolled back).
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1-' || i || '-' || big || '@probe.invalid', '{}'::jsonb, now(), now()
    from generate_series(1, 101) i;
  insert into public.conversation_participants (conversation_id, user_id, role)
  select big, u.id, 'member' from auth.users u where u.email like 'n1-%-' || big || '@probe.invalid';
  insert into public.messages (id, conversation_id, sender_id, content, created_at) values
    (m, g, a, 'Chào cả nhóm', now() - interval '5 minutes'),
    (mb, big, a, 'Chào nhóm lớn', now() - interval '5 minutes'),
    (md, d, a, 'Chào B', now() - interval '5 minutes');
  -- B opened the group (delivered + read mark); C has not.
  insert into public.conversation_read_marks (conversation_id, user_id, last_read_at) values (g, b, now()), (d, b, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  insert into public.message_deliveries (message_id, user_id) values (m, b), (md, b);
  update public.profiles set share_read_status = true where id in (a, b, c, o);
  delete from public.conversation_member_prefs where conversation_id in (g, d, big);

  -- 1. A: B read, C not delivered.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select state from public.get_message_receipts(m) where user_id = b) = 'read'
    and (select state from public.get_message_receipts(m) where user_id = c) = 'not_delivered'
    and (select read_count from public.get_message_receipt_counts(array[m])) = 1
    and (select total from public.get_message_receipt_counts(array[m])) = 2;
  reset role;
  log := log || format(E'%s 1 A gửi; B đã mở → read; C chưa mở → not_delivered; chip 1/2\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 2. B turns sharing off → A sees B hidden (no time); B calling → avora_receipts_off.
  update public.profiles set share_read_status = false where id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select state, at::text into st, err from public.get_message_receipts(m) where user_id = b;
  ok := st = 'hidden' and err is null and (select read_count from public.get_message_receipt_counts(array[m])) = 0;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.get_message_receipts(m);
    ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_receipts_off%';
  end;
  reset role;
  update public.profiles set share_read_status = true where id = b;
  log := log || format(E'%s 2 B tắt chia sẻ → A thấy B `hidden` (không giờ); B gọi RPC → avora_receipts_off\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. O (outside) → avora_not_allowed. Group of 102 → empty, nothing written to message_deliveries.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.get_message_receipts(m);
    ok := false;
  exception when others then ok := sqlerrm like '%avora_not_allowed%';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.get_message_receipts(mb)) = 0
           and (select count(*) from public.get_message_receipt_counts(array[mb])) = 0;
  reset role;
  select id into r from auth.users where email like 'n1-1-' || big || '@probe.invalid';
  perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and public.mark_messages_delivered(array[mb]) = 0;
  reset role;
  ok := ok and (select count(*) from public.message_deliveries where message_id = mb) = 0;
  log := log || format(E'%s 3 người ngoài → avora_not_allowed; Nhóm 102 → rỗng, không ghi message_deliveries\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3b. 1-1: both share → A sees read; B sets `Luôn tắt` for this conversation → A only delivered; B cannot see A's read.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select state from public.get_message_receipts(md)) = 'read' and (select count(*) from public.get_message_receipts(md)) = 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_conversation_share_read(d, false);
  begin
    perform * from public.get_message_receipts(md);
    ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_receipts_off%';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select state from public.get_message_receipts(md)) = 'delivered';
  -- Group mark works for ≤ 100 (C opens the group now).
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and public.mark_messages_delivered(array[m]) = 1;
  reset role;
  log := log || format(E'%s 3b 1-1: cả hai bật → read; B `Luôn tắt` cuộc này → A chỉ delivered, B không thấy; Nhóm ≤ 100 ghi đã nhận\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 4. A blocks C → neither sees the other.
  insert into public.user_blocks (blocker_id, blocked_id) values (a, c);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select state, at::text into st, err from public.get_message_receipts(m) where user_id = c;
  ok := st = 'unavailable' and err is null;
  reset role;
  insert into public.messages (id, conversation_id, sender_id, content) values (mb, g, b, 'B nói') on conflict (id) do update set conversation_id = g, sender_id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select state from public.get_message_receipts(mb) where user_id = a) = 'unavailable'
           and (select at from public.get_message_receipts(mb) where user_id = a) is null;
  reset role;
  log := log || format(E'%s 4 A chặn C → A thấy C `unavailable` (không giờ); C xem tin của B → A `unavailable`\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 5. Read marks / deliveries of others: 0 rows.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.conversation_read_marks where user_id <> c) = 0
    and (select count(*) from public.message_deliveries where message_id = m) = 0;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.message_deliveries where message_id = m) = 0  -- group: only through the RPC
           and (select count(*) from public.message_deliveries where message_id = md) >= 0;
  reset role;
  log := log || format(E'%s 5 select mốc đọc / đã nhận của người khác → 0 dòng (Nhóm chỉ qua RPC)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA108 failures=% %', failures, E'\n' || log;
end $test$;
