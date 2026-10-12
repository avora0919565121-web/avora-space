-- AVORA-109 · B5 — tin tự biến mất, có dấu vết. 3 tài khoản + 1 người ngoài + anon. Always rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-2ae1-4b0d-906c-08a1965461bd';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();   -- 1-1 A, B
  g uuid := gen_random_uuid();   -- group A (owner), B, C
  m1 uuid; m2 uuid; m3 uuid; pid uuid; res text; n bigint; first_run int; second_run int;
  v_path text;
  failures int := 0; log text := ''; ok boolean;
begin
  insert into public.conversations (id, type) values (d, 'direct'), (g, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'N2 probe', a);
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner'), (g, b, 'member'), (g, c, 'member');

  -- 1. 1-1: A proposes 24 h → nothing expires yet; B accepts → new messages get expires_at; B turns off alone.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.set_disappear_timer(d, 86400);
  reset role;
  insert into public.messages (conversation_id, sender_id, content) values (d, a, 'trước khi đồng ý') returning id into m1;
  ok := res = 'proposed' and (select expires_at from public.messages where id = m1) is null
    and (select disappear_after_seconds from public.conversations where id = d) is null;
  select id into pid from public.disappear_proposals where conversation_id = d and status = 'open';
  -- A cannot accept their own proposal.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.answer_disappear_proposal(pid, true);
    ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_proposal_own%';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.answer_disappear_proposal(pid, true);
  reset role;
  -- Even a client that sends its own expires_at gets the server's.
  insert into public.messages (conversation_id, sender_id, content, expires_at) values (d, a, 'sau khi đồng ý', now() + interval '100 years') returning id into m2;
  ok := ok and res = 'accepted'
    and (select disappear_after_seconds from public.conversations where id = d) = 86400
    and (select expires_at - created_at from public.messages where id = m2) = interval '24 hours';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.set_disappear_timer(d, null);
  reset role;
  ok := ok and res = 'applied' and (select disappear_after_seconds from public.conversations where id = d) is null
    and (select count(*) from public.messages where conversation_id = d and system_kind = 'disappear_changed') = 2;
  log := log || format(E'%s 1 1-1: A đề nghị 24 giờ → chưa đồng ý thì tin không hết hạn; B đồng ý → tin sau có expires_at = +24h (client gửi expires_at bị bỏ); B tắt → tắt ngay\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 2. Group: an ordinary member → avora_not_admin; the owner → applied + a system line.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_disappear_timer(g, 3600);
    ok := false;
  exception when others then ok := sqlerrm like '%avora_not_admin%';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.set_disappear_timer(g, 3600);
  reset role;
  ok := ok and res = 'applied' and (select disappear_after_seconds from public.conversations where id = g) = 3600
    and exists (select 1 from public.messages where conversation_id = g and system_kind = 'disappear_changed' and content like '%đã đặt tin tự biến mất sau 1 giờ');
  log := log || format(E'%s 2 Nhóm: thành viên thường gọi RPC → avora_not_admin; chủ nhóm đặt 1 giờ → có dòng hệ thống\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. Expired message: B reads content '' ; attachment row gone + file queued for deletion; reactions gone; row keeps sender + expired_at.
  insert into public.messages (conversation_id, sender_id, content, attachment_count) values (g, a, 'ảnh bí mật', 1) returning id into m3;
  v_path := g::text || '/' || m3::text || '/a.jpg';
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size)
  values (m3, g, a, 'image', v_path, 'a.jpg', 'image/jpeg', 10);
  insert into public.message_reactions (message_id, user_id, emoji) values (m3, b, '👍');
  insert into public.message_pins (message_id, conversation_id, pinned_by, scope) values (m3, g, a, 'group');
  perform set_config('avora.expiring', '1', true);
  update public.messages set expires_at = now() - interval '1 second' where id = m3;
  perform set_config('avora.expiring', '', true);
  first_run := private.sweep_expired_messages();
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select content from public.messages where id = m3) = ''
    and (select sender_id from public.messages where id = m3) = a
    and (select expired_at from public.messages where id = m3) is not null
    and (select count(*) from public.message_reactions where message_id = m3) = 0
    and (select count(*) from public.message_attachments where message_id = m3) = 0;
  reset role;
  ok := ok and first_run >= 1
    and (select count(*) from public.message_pins where message_id = m3) = 0
    and exists (select 1 from private.storage_delete_queue q where q.bucket = 'chat-attachments' and q.path = v_path and q.reason = 'expired');
  log := log || format(E'%s 3 Tin hết hạn: B đọc content → rỗng; tệp → hàng đợi xoá Storage (expired), dòng tệp mất; cảm xúc, ghim mất; còn người gửi + expired_at\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 4. Outsider O and anon: cannot read the conversation's setting, its messages' expires_at, or proposals.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.conversations where id in (d, g)) = 0
    and (select count(*) from public.messages where id in (m1, m2, m3)) = 0
    and (select count(*) from public.disappear_proposals where conversation_id = d) = 0;
  begin
    perform public.set_disappear_timer(d, 3600);
    ok := false;
  exception when others then ok := ok and sqlerrm not like '%proposed%';
  end;
  begin
    perform public.set_hide_tombstones(g, true);
    ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_not_allowed%';
  end;
  reset role;
  set local role anon;
  begin
    perform public.set_disappear_timer(d, 3600);
    ok := false;
  exception when others then ok := ok and sqlerrm like '%permission denied%';
  end;
  reset role;
  log := log || format(E'%s 4 Người ngoài O: 0 dòng cuộc / tin / đề nghị; gọi RPC bị từ chối; anon → permission denied\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 5. Sweep twice in a row → same result.
  second_run := private.sweep_expired_messages();
  ok := second_run = 0 and (select content from public.messages where id = m3) = ''
    and (select count(*) from public.messages where conversation_id = g and expired_at is not null) = 1;
  log := log || format(E'%s 5 Quét hai lần liên tiếp → lần hai 0 dòng, kết quả như nhau\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 6. hide_tombstones: only mine; RLS only the owner reads it.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_hide_tombstones(g, true);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.conversation_member_prefs where conversation_id = g and user_id = b) = 0;
  reset role;
  ok := ok and (select hide_tombstones from public.conversation_member_prefs where conversation_id = g and user_id = b)
    and coalesce((select hide_tombstones from public.conversation_member_prefs where conversation_id = g and user_id = c), false) = false;
  log := log || format(E'%s 6 Ẩn dấu vết: B bật chỉ cho B; C không đọc được tuỳ chọn của B\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA109B failures=% %', failures, E'\n' || log;
end $test$;
