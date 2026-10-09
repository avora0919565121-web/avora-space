-- AVORA-106 · K3 — open_thread returns only what the page needs, members only; broadcasts go to conv-<id>.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();
  j jsonb; failures int := 0; log text := ''; ok boolean; n int; i int;
begin
  insert into public.conversations (id, type) values (d, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  for i in 1..40 loop
    insert into public.messages (conversation_id, sender_id, content, created_at) values (d, a, 'm' || i, now() - (40 - i) * interval '1 minute');
  end loop;
  select count(*) into n from realtime.messages where topic = 'conv-' || d;
  ok := n >= 40;
  log := log || format(E'%s N1 every insert broadcast to conv-<id> (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.open_thread(d, null, null, 30);
  ok := jsonb_array_length(j -> 'messages') = 30 and (j ->> 'has_more')::boolean and (j -> 'summary' ->> 'can_send')::boolean is not null;
  log := log || format(E'%s N2 open_thread: 30 messages + summary in one call\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  ok := (j -> 'messages' -> 29 ->> 'content') = 'm40';
  log := log || format(E'%s N2 newest last (oldest-first order)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin j := public.open_thread(d); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s N2 outsider refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;
  raise exception 'K3_SPEED failures=% %', failures, E'\n' || log;
end $test$;
