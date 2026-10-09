-- AVORA-106 · K1 — probe of every hole in the K1 table, as A (owner), B, C (removed), O (outsider), anon.
-- One transaction, always rolled back (the result travels in the exception text).
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-2ae1-4b0d-906c-08a1965461bd';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  g uuid := gen_random_uuid();      -- group A, B, C
  d uuid := gen_random_uuid();      -- 1-1 A, B
  m uuid := gen_random_uuid();      -- A's message in g
  mv uuid := gen_random_uuid();     -- A's message in d with a `view` file
  mf uuid := gen_random_uuid();     -- A's message in d with a `forward` file
  t uuid;
  n int;
  r public.messages%rowtype;
  failures int := 0;
  log text := '';
  ok boolean;
  err text;
  procedure_name text;
begin
  -- ---------------------------------------------------------------- fixture (system)
  insert into public.conversations (id, type) values (g, 'group'), (d, 'direct');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'K1 probe', a);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner'), (g, b, 'member'), (g, c, 'member');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('chat-attachments', d || '/x/view.pdf', a::text, '{"size": 1000, "mimetype": "application/pdf"}'),
    ('chat-attachments', d || '/x/fwd.jpg', a::text, '{"size": 1000, "mimetype": "image/jpeg"}'),
    ('chat-attachments', g || '/x/page.jpg', b::text, '{"size": 1000, "mimetype": "text/html"}'),
    ('chat-attachments', g || '/x/big.mp4', b::text, '{"size": 62914560, "mimetype": "video/mp4"}'),
    ('chat-attachments', g || '/x/ok.png', b::text, '{"size": 1000, "mimetype": "image/png"}');
  insert into public.messages (id, conversation_id, sender_id, content) values (m, g, a, 'tin nhóm'), (mv, d, a, 'xem'), (mf, d, a, 'chuyển');
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
  values (mv, d, a, 'file', d || '/x/view.pdf', 'view.pdf', 'application/pdf', 1000, 'view'),
         (mf, d, a, 'image', d || '/x/fwd.jpg', 'fwd.jpg', 'image/jpeg', 1000, 'forward');
  insert into public.tasks (id, type, creator_id, conversation_id, title, status, assignee_id, confirmed_at, deadline_date)
  values (gen_random_uuid(), 'group-shared', a, g, 'Việc của C', 'confirmed', c, now(), current_date + 3) returning id into t;
  insert into public.task_flags (task_id, user_id, is_important) values (t, c, true);

  -- ---------------------------------------------------------------- as B
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- K1.1: B attaches A's `view` file to the group (old direct path + RPC path).
  begin
    insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
    values (m, g, b, 'file', d || '/x/view.pdf', 'view.pdf', 'application/pdf', 1000, 'export');
    ok := false;
  exception when others then ok := true; end;
  log := log || format(E'%s K1.1 direct attach of a view file refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin
    perform public.send_message(gen_random_uuid(), g, '', null, jsonb_build_array(jsonb_build_object('storage_path', d || '/x/view.pdf', 'file_name', 'v.pdf', 'permission', 'export')));
    ok := false;
  exception when others then ok := sqlerrm like '%avora_attachment_path_invalid%'; end;
  log := log || format(E'%s K1.1 send_message with a path from another conversation refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- K1.2: forward A's `forward` file into the group — permission stays `forward`.
  perform public.forward_messages(array[mf], g);
  select count(*) into n from public.message_attachments where conversation_id = g and storage_path = d || '/x/fwd.jpg' and permission = 'forward';
  ok := n = 1;
  log := log || format(E'%s K1.2 forwarded file keeps permission forward (rows=%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  select count(*) into n from public.message_attachments where conversation_id = g and storage_path = d || '/x/view.pdf';
  ok := n = 0;
  log := log || format(E'%s K1.2 view file never reaches the group\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- K1.5: direct inserts.
  begin insert into public.messages (conversation_id, sender_id, content) values (g, b, 'thẳng'); ok := false;
  exception when insufficient_privilege then ok := true; end;
  log := log || format(E'%s K1.5 INSERT messages → permission denied\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- K1.6: created_at / system_kind are not parameters; reply_to from another conversation is refused.
  begin perform public.send_message(gen_random_uuid(), g, 'trả lời', mv); ok := false;
  exception when others then ok := sqlerrm like '%avora_reply_out_of_scope%'; end;
  log := log || format(E'%s K1.6 reply_to in another conversation refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  r := public.send_message('00000000-0000-4000-8000-0000000000b1'::uuid, g, 'một lần');
  ok := r.system_kind is null and r.created_at > now() - interval '1 minute' and r.sender_id = b;
  log := log || format(E'%s K1.6 server sets created_at / sender, system_kind null\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  r := public.send_message('00000000-0000-4000-8000-0000000000b1'::uuid, g, 'một lần');
  select count(*) into n from public.messages where id = '00000000-0000-4000-8000-0000000000b1';
  ok := n = 1;
  log := log || format(E'%s K2.C1 same id twice → one message\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- K1.9: html renamed .jpg (real type text/html) and a 60 MB video.
  begin perform public.send_message(gen_random_uuid(), g, '', null, jsonb_build_array(jsonb_build_object('storage_path', g || '/x/page.jpg', 'file_name', 'page.jpg'))); ok := false;
  exception when others then ok := sqlerrm like '%avora_attachment_type_blocked%'; end;
  log := log || format(E'%s K1.9 .html renamed .jpg refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.send_message(gen_random_uuid(), g, '', null, jsonb_build_array(jsonb_build_object('storage_path', g || '/x/big.mp4', 'file_name', 'big.mp4'))); ok := false;
  exception when others then ok := sqlerrm like '%avora_attachment_too_large%'; end;
  log := log || format(E'%s K1.9 60 MB video refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata) values ('chat-attachments', g || '/y/a.html', b::text, '{"mimetype":"text/html"}');
    ok := false;
  exception when others then ok := true; end;
  log := log || format(E'%s K1.9 upload of a .html object refused by storage\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  -- L1: the declared size / type are ignored, storage's are kept.
  r := public.send_message(gen_random_uuid(), g, '', null, jsonb_build_array(jsonb_build_object('storage_path', g || '/x/ok.png', 'file_name', 'ok.png', 'mime_type', 'application/pdf', 'byte_size', 5, 'kind', 'file')));
  select count(*) into n from public.message_attachments where message_id = r.id and mime_type = 'image/png' and byte_size = 1000 and kind = 'image';
  ok := n = 1;
  log := log || format(E'%s L1 type / size read from storage\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.send_message(gen_random_uuid(), g, 'nhiều @', null, '[]', null, (select array_agg(gen_random_uuid()) from generate_series(1, 21))); ok := false;
  exception when others then ok := sqlerrm like '%avora_mentions_too_many%'; end;
  log := log || format(E'%s L4 21 mentions refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- C is removed (K1.3, K1.4)
  delete from public.conversation_participants where conversation_id = g and user_id = c;
  select count(*) into n from public.tasks where id = t and assignee_id = a;
  ok := n = 1;
  log := log || format(E'%s K1.4 C''s task returns to A\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.messages where conversation_id = g and system_kind = 'member_left_task';
  ok := n = 1;
  log := log || format(E'%s K1.4 system line written\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.task_flags where task_id = t and user_id = c;
  ok := n = 0;
  log := log || format(E'%s K1.4 C''s own part removed\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach procedure_name in array array['edit', 'recall', 'pin', 'react', 'read', 'send'] loop
    begin
      case procedure_name
        when 'edit' then perform public.edit_message(m, 'sửa');
        when 'recall' then perform public.recall_message(m);
        when 'pin' then perform public.pin_message(m, 'personal');
        when 'react' then insert into public.message_reactions (message_id, user_id, emoji) values (m, c, '❤️');
        when 'read' then perform public.mark_conversation_read(g);
        when 'send' then perform public.send_message(gen_random_uuid(), g, 'vẫn còn?');
      end case;
      ok := false;
    exception when others then ok := true; end;
    log := log || format(E'%s K1.3 C %s refused\n', case when ok then 'ok  ' else 'FAIL' end, procedure_name); failures := failures + (not ok)::int;
  end loop;
  select count(*) into n from public.messages where conversation_id = g;
  ok := n = 0;
  log := log || format(E'%s K1.3 C selects 0 messages (got %s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  select count(*) into n from storage.objects where bucket_id = 'chat-attachments' and name like g || '/%';
  ok := n = 0;
  log := log || format(E'%s K1.3 C cannot read / sign any file of the group\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role; -- topic checks read auth.uid() from the claims; called as the system (policies need no schema usage)
  ok := not private.realtime_topic_ok('thread-' || g) and not private.realtime_topic_ok('conv-' || g);
  log := log || format(E'%s K1.3 C cannot join thread- / conv- topics\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  ok := not private.realtime_topic_ok('avora-milestone');
  log := log || format(E'%s K1.7 avora-milestone topic is gone\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  ok := not private.realtime_topic_ok('user-' || a) and private.realtime_topic_ok('user-' || c);
  log := log || format(E'%s N1 user- topic only for its owner\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- outsider and anon
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.messages where conversation_id in (g, d);
  reset role;
  ok := n = 0 and not private.realtime_topic_ok('conv-' || g);
  set local role authenticated;
  log := log || format(E'%s O sees nothing, joins nothing\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.send_message(gen_random_uuid(), g, 'lạ'); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s O send refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.send_message(gen_random_uuid(), g, 'anon'); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s anon send refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- K1.8 rate limit (as A)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from private.chat_rate_events where user_id = a;
  set local role authenticated;
  err := null;
  for n in 1..31 loop
    begin
      -- fake the clock for the per-second window: only the per-minute one is under test here.
      perform public.send_message(gen_random_uuid(), g, 'tin ' || n);
      reset role; delete from private.chat_rate_events where user_id = a and kind = 'msg_s';
      set local role authenticated;
    exception when others then err := n || ':' || sqlerrm; exit;
    end;
  end loop;
  reset role;
  ok := err like '31:%avora_rate_limited%';
  log := log || format(E'%s K1.8 31st message in a minute → avora_rate_limited (%s)\n', case when ok then 'ok  ' else 'FAIL' end, err); failures := failures + (not ok)::int;

  raise exception 'K1_SAFETY failures=% %', failures, E'\n' || log;
end $test$;
