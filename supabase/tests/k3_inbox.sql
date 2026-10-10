-- AVORA-106 · K3 · N9 — inbox_page pages 1-1 threads, keeps groups whole, includes asked ids; unread capped at 100.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();
  failures int := 0; log text := ''; ok boolean; n int; n2 int; i int; total int; uc int; oldest uuid;
begin
  insert into public.conversations (id, type) values (d, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  for i in 1..120 loop
    insert into public.messages (conversation_id, sender_id, content) values (d, a, 'u' || i);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into total from public.list_my_conversations() where conversation_type = 'direct';
  select count(*) into n from public.inbox_page(1) where conversation_type = 'direct';
  ok := n = least(total, 1);
  log := log || format(E'%s N9 page of 1 returns one 1-1 thread (%s of %s)\n', case when ok then 'ok  ' else 'FAIL' end, n, total); failures := failures + (not ok)::int;
  select count(*) into n from public.inbox_page(1) where conversation_type <> 'direct';
  select count(*) into n2 from public.list_my_conversations() where conversation_type <> 'direct';
  ok := n = n2;
  log := log || format(E'%s N9 Nhật ký / Nhóm / Dự án always whole (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  select conversation_id into oldest from public.list_my_conversations() where conversation_type = 'direct' order by sort_at asc limit 1;
  select count(*) into n from public.inbox_page(1, null, null, array[oldest]) where conversation_id = oldest;
  ok := n = 1;
  log := log || format(E'%s N9 p_include brings a thread outside the page\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select unread_count into uc from public.list_my_conversations() where conversation_id = d;
  ok := uc = 100;
  log := log || format(E'%s N9 unread counting stops at 100 (%s)\n', case when ok then 'ok  ' else 'FAIL' end, uc); failures := failures + (not ok)::int;
  select coalesce(sum(unread_messages), 0) into n from public.inbox_unread_counts();
  ok := n >= 100;
  log := log || format(E'%s N9 inbox_unread_counts sums per kind (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.inbox_page(200) where conversation_id = d;
  ok := n = 0;
  log := log || format(E'%s N9 outsider never sees the thread\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  set local role anon;
  begin perform public.inbox_page(); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s N9 anon refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;
  raise exception 'K3_INBOX failures=% %', failures, E'\n' || log;
end $test$;
