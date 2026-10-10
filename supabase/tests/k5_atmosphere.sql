-- AVORA-106 · K5 — Không khí, hiệu ứng, sticker: who may change what, the 3 / 10 min effect cap, sticker catalogue.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-5cd3-44c1-a8b8-2b2d1b4e9a4c';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  m public.messages%rowtype;
  failures int := 0; log text := ''; ok boolean; n int; i int; err text;
begin
  select id into c from auth.users where id::text like '151a54b2%' limit 1;
  insert into public.conversations (id, type) values (d, 'direct'), (g, 'group');
  insert into public.conversation_participants (conversation_id, user_id, role) values
    (d, a, 'member'), (d, b, 'member'), (g, a, 'owner'), (g, b, 'member'), (g, c, 'member');

  -- 84.1: either person in a 1-1 may change colour + backdrop; a system line is written.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_conversation_appearance(d, 'bien', 'la');
  select count(*) into n from public.conversation_appearance where conversation_id = d and color_key = 'bien' and backdrop_key = 'la';
  ok := n = 1;
  log := log || format(E'%s 84.1 1-1: B sets Biển + Lá, both read it\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.messages where conversation_id = d and system_kind = 'appearance_changed';
  ok := n = 1;
  log := log || format(E'%s 84.1 one quiet system line\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 84.2: a plain group member is refused.
  begin perform public.set_conversation_appearance(g, 'tim', null); ok := false; exception when others then ok := sqlerrm like '%avora_not_admin%'; end;
  log := log || format(E'%s 84.2 group member → avora_not_admin\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.set_group_icon(g, 'leaf', null); ok := false; exception when others then ok := sqlerrm like '%avora_not_admin%'; end;
  log := log || format(E'%s 84.3 group icon: member refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 84.9: an unknown sticker is refused; a known one is a message with no words.
  begin perform public.send_message(gen_random_uuid(), d, '', null, '[]', null, '{}', null, null, false, null, 'abc.xyz'); ok := false; exception when others then ok := sqlerrm like '%avora_sticker_unknown%'; end;
  log := log || format(E'%s 84.9 sticker abc.xyz refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  m := public.send_message(gen_random_uuid(), d, '', null, '[]', null, '{}', null, null, false, null, 'miu.okela');
  ok := m.sticker_id = 'miu.okela' and m.content = '';
  log := log || format(E'%s 84.9 sticker miu.okela sent\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 84.5: 3 effects per 10 minutes; the 4th goes through without its effect.
  for i in 1..4 loop
    m := public.send_message(gen_random_uuid(), d, 'vui ' || i, null, '[]', null, '{}', null, null, false, 'fireworks', null);
  end loop;
  ok := m.effect is null and m.content = 'vui 4';
  select count(*) into n from public.messages where conversation_id = d and sender_id = b and effect is not null;
  ok := ok and n = 3;
  log := log || format(E'%s 84.5 4th effect in 10 min dropped by the server (%s kept)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  -- own prefs only
  perform public.set_my_conversation_prefs(d, 'off');
  select count(*) into n from public.conversation_member_prefs where conversation_id = d;
  ok := n = 1;
  log := log || format(E'%s prefs: B sees only B''s row\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_group_icon(g, 'leaf', null);
  select count(*) into n from public.conversation_appearance where conversation_id = g and icon_key = 'leaf';
  ok := n = 1;
  log := log || format(E'%s 84.3 owner sets group icon\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.conversation_member_prefs where conversation_id = d;
  ok := n = 0;
  log := log || format(E'%s prefs: A cannot read B''s effects level\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.set_conversation_appearance(d, 'tim', 'song'); ok := true; exception when others then ok := false; end;
  log := log || format(E'%s 84.1 the other person in the 1-1 may also change it\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.conversation_appearance where conversation_id in (d, g);
  ok := n = 0;
  log := log || format(E'%s outsider reads no appearance\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.set_conversation_appearance(d, 'than', null); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s outsider cannot change it\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  set local role anon;
  begin perform public.set_conversation_appearance(d, 'than', null); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s anon refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;
  raise exception 'K5_ATMOSPHERE failures=% %', failures, E'\n' || log;
end $test$;
