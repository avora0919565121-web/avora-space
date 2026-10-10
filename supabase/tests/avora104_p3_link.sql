-- AVORA-104 · PHẦN 3 — Gắn việc ↔ Hạng mục: who may link, "cùng nơi", moving, unlinking, pickers, change log.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid;
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  gx uuid := gen_random_uuid(); gy uuid := gen_random_uuid(); d uuid := gen_random_uuid(); pc uuid := gen_random_uuid();
  board_priv uuid := gen_random_uuid(); board_x uuid := gen_random_uuid(); board_x_view uuid := gen_random_uuid(); board_y uuid := gen_random_uuid(); board_p uuid := gen_random_uuid();
  rec_priv uuid := gen_random_uuid(); rec_x1 uuid := gen_random_uuid(); rec_x2 uuid := gen_random_uuid(); rec_x_view uuid := gen_random_uuid();
  rec_y uuid := gen_random_uuid(); rec_p uuid := gen_random_uuid();
  t_priv uuid := gen_random_uuid(); t_x uuid := gen_random_uuid(); t_p uuid := gen_random_uuid();
  proj uuid := gen_random_uuid();
  failures int := 0; log text := ''; ok boolean; n bigint; msg text; r jsonb;
begin
  select id into c from auth.users where id::text like '151a54b2%' limit 1;
  -- Two groups X (A, B, C) and Y (A, B); a project chat P (A, B) with its project; A's private board.
  insert into public.conversations (id, type) values (gx, 'group'), (gy, 'group'), (pc, 'group');
  insert into public.conversation_participants (conversation_id, user_id)
  values (gx, a), (gx, b), (gx, coalesce(c, o)), (gy, a), (gy, b), (pc, a), (pc, b);
  insert into public.conversation_groups (conversation_id, owner_id, name) values (gx, a, 'Hoiana X'), (gy, a, 'Nhóm Y'), (pc, a, 'Kênh dự án');
  insert into public.projects (id, conversation_id, created_by, title, objective, value_orientation, start_date, target_end_date)
  values (proj, pc, a, 'Hoiana – chiếu sáng', 'Đèn sảnh', 'quality', current_date, current_date + 60);

  insert into public.think_hub_table (id, owner_user_id, name) values (board_priv, a, 'Khách hàng');
  insert into public.think_hub_table (id, owner_user_id, name, conversation_id, share_mode) values
    (board_x, a, 'Hạng mục X', gx, 'edit'), (board_x_view, a, 'Chỉ xem X', gx, 'view'), (board_y, a, 'Hạng mục Y', gy, 'edit');
  insert into public.think_hub_table (id, owner_user_id, name, project_id, share_mode) values (board_p, a, 'Hạng mục thi công', proj, 'edit');
  insert into public.think_hub_record (id, table_id, owner_user_id, title) values
    (rec_priv, board_priv, a, 'Cty Hoà Phát'), (rec_x1, board_x, a, 'Sảnh chính'), (rec_x2, board_x, a, 'Hành lang tầng 2'),
    (rec_x_view, board_x_view, a, 'Chỉ xem'), (rec_y, board_y, a, 'Việc nhóm Y'), (rec_p, board_p, a, 'Đèn panel 600×600');

  insert into public.tasks (id, type, creator_id, title, description, status, deadline_date)
  values (t_priv, 'personal', a, 'Gọi lại cho anh Tuấn', '', 'confirmed', current_date + 2);
  insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date)
  values (t_x, 'group-shared', a, b, gx, 'Đặt 120 bộ panel', '', 'pending_confirmation', current_date + 2),
         (t_p, 'group-shared', a, b, pc, 'Kiểm hàng về kho', '', 'pending_confirmation', current_date + 3);

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Personal task → group board: refused, saying where the task lives.
  begin perform public.link_task_to_record(t_priv, rec_x1); ok := false; msg := '';
  exception when others then ok := sqlerrm like 'Việc này thuộc Nhật ký%cùng nơi.'; msg := sqlerrm; end;
  log := log || format(E'%s P3 việc riêng → bảng nhóm: từ chối (%s)\n', case when ok then 'ok  ' else 'FAIL' end, msg); failures := failures + (not ok)::int;
  -- Group X task → group Y board: refused.
  begin perform public.link_task_to_record(t_x, rec_y); ok := false; msg := '';
  exception when others then ok := sqlerrm like 'Việc này thuộc Nhóm Hoiana X%'; msg := sqlerrm; end;
  log := log || format(E'%s P3 việc nhóm X → bảng nhóm Y: từ chối (%s)\n', case when ok then 'ok  ' else 'FAIL' end, msg); failures := failures + (not ok)::int;
  -- Personal task → own private board: ok.
  r := public.link_task_to_record(t_priv, rec_priv);
  select count(*) into n from public.think_hub_record_tasks where task_id = t_priv and record_id = rec_priv;
  ok := n = 1;
  log := log || format(E'%s P3 việc riêng → bảng riêng: gắn\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  -- Group X task → X record 1, then move to X record 2: one row, moved.
  r := public.link_task_to_record(t_x, rec_x1);
  r := public.link_task_to_record(t_x, rec_x2);
  select count(*) into n from public.think_hub_record_tasks where task_id = t_x;
  ok := n = 1 and (select record_id from public.think_hub_record_tasks where task_id = t_x) = rec_x2 and (r ->> 'moved_from')::uuid = rec_x1;
  log := log || format(E'%s P3 gắn sang Hạng mục khác: chuyển, chỉ 1 dòng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  -- Shared board logs it for Báo nhóm.
  select count(*) into n from public.think_hub_change_log where table_id = board_x and kind in ('task_link', 'task_unlink');
  ok := n = 3;
  log := log || format(E'%s P3 bảng chung: nhật ký thay đổi ghi gắn/bỏ (%s dòng)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  -- Project task → project record: written to project_tasks.record_id.
  r := public.link_task_to_record(t_p, rec_p);
  select count(*) into n from public.project_tasks where task_id = t_p and record_id = rec_p and project_id = proj;
  ok := n = 1;
  log := log || format(E'%s P3 việc dự án → Hạng mục dự án: project_tasks.record_id\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  -- Project task → X board: refused (Dự án …).
  begin perform public.link_task_to_record(t_p, rec_x1); ok := false; msg := '';
  exception when others then ok := sqlerrm like 'Việc này thuộc Dự án Hoiana – chiếu sáng%'; msg := sqlerrm; end;
  log := log || format(E'%s P3 việc dự án → bảng nhóm khác: từ chối (%s)\n', case when ok then 'ok  ' else 'FAIL' end, msg); failures := failures + (not ok)::int;
  -- Pickers.
  select count(*) into n from public.list_linkable_records(t_x, null) where record_id in (rec_x1, rec_x2);
  ok := n = 2 and not exists (select 1 from public.list_linkable_records(t_x, null) where record_id in (rec_y, rec_priv, rec_p));
  log := log || format(E'%s P3 list_linkable_records: chỉ Hạng mục cùng nơi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.list_linkable_records(t_x, 'hanh lang');
  ok := n = 1;
  log := log || format(E'%s P3 list_linkable_records: tìm không dấu ("hanh lang")\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.list_linkable_tasks(rec_priv, null);
  ok := n = 0;
  log := log || format(E'%s P3 list_linkable_tasks: việc đã ở Hạng mục này không hiện lại\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.task_record_of(t_x) where record_id = rec_x2 and path = 'Bảng Hạng mục X';
  ok := n = 1;
  log := log || format(E'%s P3 task_record_of: Hạng mục hiện tại + đường dẫn\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- B (assignee of t_x, member of X) cannot link into a view-only board; outsider/C cannot touch.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.link_task_to_record(t_x, rec_x_view); ok := false; exception when others then ok := sqlerrm like 'avora_record_not_editable%'; end;
  log := log || format(E'%s P3 người không sửa được bảng: từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.link_task_to_record(t_priv, rec_priv); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P3 B không gắn được việc riêng của A\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(c, o), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.unlink_task_from_record(t_x); ok := false; exception when others then ok := sqlerrm like 'avora_task_not_editable%'; end;
  log := log || format(E'%s P3 C (thành viên, không phải người làm) không bỏ gắn được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.list_linkable_records(t_x, null);
  ok := n = 0;
  log := log || format(E'%s P3 C: list_linkable_records rỗng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.link_task_to_record(t_x, rec_x1); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P3 người ngoài: từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.task_record_of(t_x);
  ok := n = 0;
  log := log || format(E'%s P3 người ngoài: task_record_of rỗng\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform public.link_task_to_record(t_x, rec_x1); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P3 anon: từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform * from public.list_linkable_tasks(rec_x1, null); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P3 anon: list_linkable_tasks từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- A unlinks.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.unlink_task_from_record(t_x);
  perform public.unlink_task_from_record(t_p);
  reset role;
  ok := not exists (select 1 from public.think_hub_record_tasks where task_id = t_x)
    and exists (select 1 from public.project_tasks where task_id = t_p and record_id is null);
  log := log || format(E'%s P3 bỏ gắn: hết nối (việc dự án vẫn ở dự án)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  -- A task with a record, then a 600-record board: picker still fast.
  insert into public.think_hub_record (table_id, owner_user_id, title)
  select board_x, a, 'Hạng mục ' || g from generate_series(1, 600) g;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.list_linkable_records(t_x, null);
  reset role;
  ok := n = 30;
  log := log || format(E'%s P3 600 Hạng mục: picker trả tối đa 30\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA104_P3 failures=% %', failures, E'\n' || log;
end $test$;
