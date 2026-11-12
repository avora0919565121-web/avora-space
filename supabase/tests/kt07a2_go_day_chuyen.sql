-- KT-07a2 · QA04-03: gỡ khỏi nhóm cha thì rời luôn mọi nhóm con bên dưới. Luôn rollback.
do $test$
declare
  o uuid; m uuid; k uuid; g1 uuid; g2 uuid; g3 uuid; g2b uuid; n int; out text := ''; failures int := 0;
begin
  o := private.test_ephemeral_user('KT7A2O'); m := private.test_ephemeral_user('KT7A2M'); k := private.test_ephemeral_user('KT7A2K');
  insert into public.conversations (type) values ('group') returning id into g1;
  insert into public.conversations (type, parent_group_id) values ('group', g1) returning id into g2;
  insert into public.conversations (type, parent_group_id) values ('group', g2) returning id into g3;
  insert into public.conversations (type, parent_group_id) values ('group', g1) returning id into g2b;
  insert into public.conversation_participants (conversation_id, user_id, role) values
    (g1, o, 'owner'), (g1, m, 'member'), (g1, k, 'member'),
    (g2, o, 'owner'), (g2, m, 'member'), (g2, k, 'member'),
    (g3, m, 'owner'), (g3, k, 'member'),
    (g2b, o, 'owner'), (g2b, k, 'member');

  -- 1. Chủ gỡ M khỏi nhóm gốc qua RPC thật → M rời g2 và g3; quyền chủ g3 sang người còn lại.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.remove_group_participant(g1, m);
    reset role;
    select count(*) into n from public.conversation_participants where user_id = m and conversation_id in (g1, g2, g3);
    if n = 0 and exists (select 1 from public.conversation_participants where conversation_id = g3 and user_id = k and role = 'owner') then
      out := out || E'ok   gỡ ở nhóm gốc → rời mọi nhóm con, nhóm con vẫn có chủ\n';
    else failures := failures + 1; out := out || format(E'FAIL dây chuyền: còn %s chỗ\n', n); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL gỡ: %s\n', sqlerrm); end;

  -- 2. Gỡ ở nhóm tầng 2 chỉ lan xuống dưới nó: K rời g2 + g3, vẫn ở g1 và nhóm anh em g2b.
  begin
    delete from public.conversation_participants where conversation_id = g2 and user_id = k;
    if not exists (select 1 from public.conversation_participants where user_id = k and conversation_id in (g2, g3))
       and exists (select 1 from public.conversation_participants where user_id = k and conversation_id = g1)
       and exists (select 1 from public.conversation_participants where user_id = k and conversation_id = g2b) then
      out := out || E'ok   chỉ lan xuống, không đụng nhóm cha / nhóm anh em\n';
    else failures := failures + 1; out := out || E'FAIL phạm vi lan\n'; end if;
  end;

  -- 3. Nhóm cha bị xoá hẳn: nhóm con đứng riêng, giữ nguyên người.
  begin
    delete from public.conversations where id = g1;
    if exists (select 1 from public.conversation_participants where conversation_id = g2b and user_id = k) then
      out := out || E'ok   xoá nhóm cha không làm trống nhóm con\n';
    else failures := failures + 1; out := out || E'FAIL xoá nhóm cha làm trống nhóm con\n'; end if;
  exception when others then failures := failures + 1; out := out || format(E'FAIL xoá nhóm cha: %s\n', sqlerrm); end;

  raise exception E'%kt07a2_go_day_chuyen failures=%', out, failures;
end $test$;
