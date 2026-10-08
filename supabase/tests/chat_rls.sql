-- AVORA-106 · K0.2 — RLS of every chat table, for: owner (A), member (B), former member (C),
-- outsider (O) and anon. Builds its own group inside one transaction and always rolls back.
-- Run: `bun run test:sql` (web/) — prints one line per check and fails on the first wrong one.
--
-- Accounts are the probe accounts of the project (see docs); nothing real is read or kept.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-2ae1-4b0d-906c-08a1965461bd';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  g uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  log text := '';
  n int;
  failures int := 0;
  who record;
  t text;
  expect_rows boolean;
begin
  -- Fixture (as the system): a group with A (owner), B, C; one message with a file, a reaction,
  -- a pin, a read mark and a delivery; then C leaves.
  insert into public.conversations (id, type) values (g, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'Nhóm thử RLS', a);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner'), (g, b, 'member'), (g, c, 'member');
  insert into public.messages (id, conversation_id, sender_id, content) values (m, g, a, 'tin thử RLS');
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
    values (m, g, a, 'file', g::text || '/rls-test.pdf', 'rls-test.pdf', 'application/pdf', 10, 'view');
  insert into public.message_reactions (message_id, user_id, emoji) values (m, b, '❤️');
  insert into public.message_pins (message_id, conversation_id, pinned_by, scope) values (m, g, a, 'group');
  insert into public.conversation_read_marks (conversation_id, user_id, last_read_at) values (g, b, now()) on conflict do nothing;
  insert into public.message_deliveries (message_id, user_id) values (m, b) on conflict do nothing;
  delete from public.conversation_participants where conversation_id = g and user_id = c;

  for who in select * from (values ('A owner', a, true), ('B member', b, true), ('C left', c, false), ('O outsider', o, false), ('anon', null::uuid, false)) v(label, uid, sees) loop
    if who.uid is null then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', who.uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    foreach t in array array['conversations', 'conversation_groups', 'conversation_participants', 'messages', 'message_attachments', 'message_reactions', 'message_pins', 'conversation_read_marks', 'message_deliveries'] loop
      begin
        execute format(
          'select count(*) from public.%I where %s', t,
          case when t in ('conversations') then format('id = %L', g)
               when t in ('conversation_groups', 'conversation_participants', 'messages', 'message_attachments', 'message_pins', 'conversation_read_marks') then format('conversation_id = %L', g)
               else format('message_id = %L', m) end
        ) into n;
      exception when insufficient_privilege then n := -1;
      end;
      -- Own read mark / delivery rows are B's only: A sees B's delivery? Members see deliveries of the thread.
      expect_rows := who.sees;
      -- Own rows only: a read mark is its owner's; "đã nhận" is read by the sender only (ADR-028).
      if t = 'conversation_read_marks' then expect_rows := who.label = 'B member'; end if;
      if t = 'message_deliveries' then expect_rows := who.label = 'A owner'; end if;
      if (n > 0) <> expect_rows then
        failures := failures + 1;
        log := log || format(E'FAIL %s · %s · rows=%s (expected %s)\n', who.label, t, n, case when expect_rows then '>0' else '0' end);
      else
        log := log || format(E'ok   %s · %s · rows=%s\n', who.label, t, n);
      end if;
    end loop;
    reset role;
  end loop;

  -- Always roll back: the result travels in the exception text, read by scripts/test-sql.sh.
  raise exception 'CHAT_RLS failures=% %', failures, E'\n' || log;
end $test$;
