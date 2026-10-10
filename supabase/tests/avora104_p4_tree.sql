-- AVORA-104 · PHẦN 4 — think_hub_tree: root = project (or the top board), counts summed up every level,
-- only what the caller may see, sub-board opens inside its whole tree, 600 Hạng mục fast.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid;
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  pc uuid := gen_random_uuid(); proj uuid := gen_random_uuid();
  board_p uuid := gen_random_uuid(); board_n uuid := gen_random_uuid(); sub uuid := gen_random_uuid();
  rec_p1 uuid := gen_random_uuid(); rec_p2 uuid := gen_random_uuid(); rec_s1 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid();
  bp uuid := gen_random_uuid(); bs uuid := gen_random_uuid(); rp uuid := gen_random_uuid(); rs uuid := gen_random_uuid(); tp uuid := gen_random_uuid();
  failures int := 0; log text := ''; ok boolean; n bigint; d int; tt int; ms numeric; started timestamptz;
begin
  select id into c from auth.users where id::text like '151a54b2%' limit 1;
  insert into public.conversations (id, type) values (pc, 'group');
  insert into public.conversation_participants (conversation_id, user_id) values (pc, a), (pc, b);
  insert into public.conversation_groups (conversation_id, owner_id, name) values (pc, a, 'Kênh dự án');
  insert into public.projects (id, conversation_id, created_by, title, objective, value_orientation, start_date, target_end_date)
  values (proj, pc, a, 'Hoiana – chiếu sáng', 'Đèn sảnh', 'quality', current_date, current_date + 60);

  -- Dự án (its root board) › Sảnh chính › (bảng con) Vật tư sảnh › Đèn panel; Hành lang › (bảng con) Nhà cung cấp.
  insert into public.think_hub_table (id, owner_user_id, name, project_id, share_mode) values (board_p, a, 'Dự án gốc', proj, 'edit');
  insert into public.think_hub_record (id, table_id, owner_user_id, title, created_at) values
    (rec_p1, board_p, a, 'Sảnh chính', now() - interval '2 minutes'), (rec_p2, board_p, a, 'Hành lang tầng 2', now() - interval '1 minute');
  insert into public.think_hub_table (id, owner_user_id, name, project_id, parent_record_id, depth, share_mode)
  values (sub, a, 'Vật tư sảnh', proj, rec_p1, 2, 'edit'), (board_n, a, 'Nhà cung cấp', proj, rec_p2, 2, 'edit');
  insert into public.think_hub_record (id, table_id, owner_user_id, title) values (rec_s1, sub, a, 'Đèn panel 600×600');

  insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date)
  values (t1, 'group-shared', a, b, pc, 'Xin mẫu thử', '', 'pending_confirmation', current_date + 2),
         (t2, 'group-shared', a, b, pc, 'Đặt 120 bộ panel', '', 'pending_confirmation', current_date + 2),
         (t3, 'group-shared', a, b, pc, 'Đo hành lang', '', 'pending_confirmation', current_date + 2),
         (t4, 'group-shared', a, b, pc, 'Chốt ngày giao', '', 'pending_confirmation', current_date + 2);
  update public.tasks set status = 'done', confirmed_at = now(), done_at = now(), completed_confirmed_at = now() where id = t1;
  insert into public.project_tasks (task_id, project_id, linked_by, record_id) values
    (t1, proj, a, rec_s1), (t2, proj, a, rec_s1), (t3, proj, a, rec_p2), (t4, proj, a, null);

  -- A's private board with a sub-board and one personal task under the sub-board's Hạng mục.
  insert into public.think_hub_table (id, owner_user_id, name) values (bp, a, 'Khách hàng');
  insert into public.think_hub_record (id, table_id, owner_user_id, title) values (rp, bp, a, 'Cty Hoà Phát');
  insert into public.think_hub_table (id, owner_user_id, name, parent_record_id, depth) values (bs, a, 'Liên hệ Hoà Phát', rp, 2);
  insert into public.think_hub_record (id, table_id, owner_user_id, title) values (rs, bs, a, 'Anh Tuấn');
  insert into public.tasks (id, type, creator_id, title, description, status, deadline_date) values (tp, 'personal', a, 'Gọi lại', '', 'confirmed', current_date + 1);
  insert into public.think_hub_record_tasks (task_id, record_id, linked_by) values (tp, rs, a);

  for i in 1..2 loop
    perform set_config('request.jwt.claims', json_build_object('sub', case when i = 1 then a else b end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select t.done, t.total into d, tt from public.think_hub_tree(sub) t where t.node_kind = 'project' and t.node_id = board_p and t.title = 'Hoiana – chiếu sáng';
    ok := d = 1 and tt = 4;
    log := log || format(E'%s P4 %s: mở bảng con → gốc là dự án, 1/4 (gồm việc chưa gắn) — %s/%s\n', case when ok then 'ok  ' else 'FAIL' end, case when i = 1 then 'A' else 'B' end, d, tt); failures := failures + (not ok)::int;
    select t.done, t.total into d, tt from public.think_hub_tree(board_p) t where t.node_id = sub;
    ok := d = 1 and tt = 2;
    log := log || format(E'%s P4 %s: bảng con Vật tư sảnh 1/2\n', case when ok then 'ok  ' else 'FAIL' end, case when i = 1 then 'A' else 'B' end); failures := failures + (not ok)::int;
    select count(*) into n from public.think_hub_tree(board_p) t
    where (t.node_id = rec_p1 and t.done = 1 and t.total = 2 and t.own_total = 0 and t.parent_id = board_p)
       or (t.node_id = sub and t.parent_id = rec_p1 and t.total = 2)
       or (t.node_id = rec_s1 and t.own_total = 2 and t.parent_id = sub)
       or (t.node_id = rec_p2 and t.total = 1)
       or (t.node_id = board_n and t.total = 0 and t.parent_id = rec_p2)
       or (t.node_kind = 'unlinked' and t.total = 1 and t.done = 0 and t.parent_id = board_p);
    ok := n = 6;
    log := log || format(E'%s P4 %s: cây Bảng › Hạng mục › Bảng con › Hạng mục + Việc chưa gắn đúng (%s/6)\n', case when ok then 'ok  ' else 'FAIL' end, case when i = 1 then 'A' else 'B' end, n); failures := failures + (not ok)::int;
    reset role;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.think_hub_tree(bs) t where t.node_kind = 'project' or t.node_kind = 'unlinked';
  ok := n = 0;
  log := log || format(E'%s P4 bảng riêng: không có nút dự án / chưa gắn\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.think_hub_tree(bs) t where (t.node_id = bp and t.total = 1 and t.parent_id is null) or (t.node_id = rs and t.own_total = 1);
  ok := n = 2;
  log := log || format(E'%s P4 bảng riêng: mở bảng con → gốc là bảng trên cùng, đếm 1\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.think_hub_tree(sub) t where t.title in ('Xin mẫu thử', 'Đặt 120 bộ panel');
  ok := n = 0;
  log := log || format(E'%s P4 không trả nội dung việc\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.think_hub_tree(bs);
  ok := n = 0;
  log := log || format(E'%s P4 B: bảng riêng của A rỗng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(c, o), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.think_hub_tree(sub);
  ok := n = 0;
  log := log || format(E'%s P4 C (không trong dự án): rỗng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.think_hub_tree(board_p);
  ok := n = 0;
  log := log || format(E'%s P4 người ngoài: rỗng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform * from public.think_hub_tree(board_p); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P4 anon: từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- 600 Hạng mục under the project board, each with a linked task every 3rd one.
  insert into public.think_hub_record (table_id, owner_user_id, title) select board_n, a, 'NCC ' || g from generate_series(1, 600) g;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  started := clock_timestamp();
  select count(*) into n from public.think_hub_tree(sub);
  ms := extract(epoch from clock_timestamp() - started) * 1000;
  reset role;
  ok := n >= 606 and ms < 1000;
  log := log || format(E'%s P4 600 Hạng mục: %s nút trong %s ms\n', case when ok then 'ok  ' else 'FAIL' end, n, round(ms)); failures := failures + (not ok)::int;

  raise exception 'AVORA104_P4 failures=% %', failures, E'\n' || log;
end $test$;
