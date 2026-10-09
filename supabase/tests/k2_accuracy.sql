-- AVORA-106 · K2 (server half): cursor paging, read-up-to, delivered-on-open, push claim, double tap.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  d uuid := gen_random_uuid();
  t timestamptz := now() - interval '1 hour';
  ids uuid[];
  n int;
  failures int := 0;
  log text := '';
  ok boolean;
  mark timestamptz;
  i int;
begin
  insert into public.conversations (id, type) values (d, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  -- 7 messages, 5 of them in the SAME microsecond (C6).
  for i in 1..7 loop
    insert into public.messages (id, conversation_id, sender_id, content, created_at)
    values (gen_random_uuid(), d, a, 'm' || i, case when i <= 5 then t else t + i * interval '1 second' end);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- C6: walk back 2 at a time with the (created_at, id) cursor; every message exactly once.
  declare cur_at timestamptz := null; cur_id uuid := null; seen uuid[] := '{}'; page record; got int;
  begin
    loop
      got := 0;
      for page in select * from public.messages_page(d, cur_at, cur_id, 2) loop
        seen := seen || page.id; cur_at := page.created_at; cur_id := page.id; got := got + 1;
      end loop;
      exit when got < 2;
    end loop;
    ok := array_length(seen, 1) = 7 and (select count(distinct x) from unnest(seen) x) = 7;
    log := log || format(E'%s C6 cursor pages: %s seen, all distinct\n', case when ok then 'ok  ' else 'FAIL' end, array_length(seen, 1));
    failures := failures + (not ok)::int;
  end;

  -- C7: read up to the 6th → the 7th stays unread.
  select array_agg(id order by created_at, id) into ids from public.messages where conversation_id = d;
  mark := public.mark_conversation_read(d, ids[6]);
  select count(*) into n from public.messages where conversation_id = d and created_at > mark;
  ok := n = 1;
  log := log || format(E'%s C7 read up to the shown message; %s left unread\n', case when ok then 'ok  ' else 'FAIL' end, n);
  failures := failures + (not ok)::int;

  -- C8: delivered on open, in one call.
  n := public.mark_conversation_delivered(d);
  ok := n = 7;
  log := log || format(E'%s C8 delivered on open: %s rows\n', case when ok then 'ok  ' else 'FAIL' end, n);
  failures := failures + (not ok)::int;

  -- C1 double tap: same id twice → one row.
  perform public.send_message('00000000-0000-4000-8000-00000000c001'::uuid, d, 'hai lần');
  perform public.send_message('00000000-0000-4000-8000-00000000c001'::uuid, d, 'hai lần');
  select count(*) into n from public.messages where id = '00000000-0000-4000-8000-00000000c001';
  ok := n = 1;
  log := log || format(E'%s C1 double tap → %s message\n', case when ok then 'ok  ' else 'FAIL' end, n);
  failures := failures + (not ok)::int;
  -- C14: forwarded words are a copy — editing / recalling the original changes nothing.
  declare src uuid := '00000000-0000-4000-8000-00000000c014'; fwd text;
  begin
    perform public.send_message(src, d, 'gốc');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    -- A forwards B's line into the same 1-1 (simplest room both are in)
    perform public.forward_messages(array[src], d);
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.edit_message(src, 'gốc đã sửa');
    perform public.recall_message(src);
    select content into fwd from public.messages where origin_content_id = src order by created_at desc limit 1;
    ok := fwd = 'gốc';
    log := log || format(E'%s C14 forwarded words unchanged after edit + recall (%s)\n', case when ok then 'ok  ' else 'FAIL' end, fwd);
    failures := failures + (not ok)::int;
  end;
  reset role;

  -- C12: push claim uses SKIP LOCKED and re-checks mute.
  ok := position('skip locked' in pg_get_functiondef('public.push_claim_batch()'::regprocedure)) > 0
    and position('push_mute_blocks' in pg_get_functiondef('public.push_claim_batch()'::regprocedure)) > 0;
  log := log || format(E'%s C12 push claim: SKIP LOCKED + mute at send time\n', case when ok then 'ok  ' else 'FAIL' end);
  failures := failures + (not ok)::int;

  -- C11: leaving fires the per-person notice trigger.
  ok := exists (select 1 from pg_trigger where tgname = 'conversation_participants_removed_notice');
  log := log || format(E'%s C11 removal notice trigger present\n', case when ok then 'ok  ' else 'FAIL' end);
  failures := failures + (not ok)::int;

  raise exception 'K2_ACCURACY failures=% %', failures, E'\n' || log;
end $test$;
