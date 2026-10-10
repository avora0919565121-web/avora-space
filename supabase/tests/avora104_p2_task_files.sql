-- AVORA-104 · PHẦN 2 · T.10 — task_files: who reads, who adds, who removes; set_task_recurrence; weekdays spawn.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-0c6e-4d0f-8a3a-7a4b7d4c1f10';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();
  pt uuid := gen_random_uuid();
  st uuid := gen_random_uuid();
  fa uuid; fb uuid;
  failures int := 0; log text := ''; ok boolean; n bigint; v text; nd date;
begin
  select id into c from auth.users where id::text like '151a54b2%' limit 1;
  insert into public.conversations (id, type) values (d, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  insert into public.tasks (id, type, creator_id, title, description, status, deadline_date)
  values (pt, 'personal', a, 'Việc riêng của A', '', 'confirmed', current_date + 1);
  insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date)
  values (st, '1-1-shared', a, b, d, 'Việc chung A–B', '', 'pending_confirmation', current_date + 1);

  -- A adds a file to her own task and to the shared one.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values (pt, a, pt::text || '/x-a.pdf', 'a.pdf', 'application/pdf', 1000) returning id into fa;
  insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values (st, a, st::text || '/x-s.pdf', 's.pdf', 'application/pdf', 1000);
  begin
    insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
    values (pt, a, pt::text || '/big.bin', 'big.bin', 'application/octet-stream', 26214401);
    ok := false;
  exception when others then ok := true; end;
  log := log || format(E'%s T.10 > 25 MB refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin
    insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
    values (pt, a, st::text || '/wrong-folder.pdf', 'w.pdf', 'application/pdf', 10);
    ok := false;
  exception when others then ok := true; end;
  log := log || format(E'%s T.10 path must sit under the task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  perform public.set_task_recurrence(pt, 'weekdays', null);
  reset role;
  select recurrence into v from public.tasks where id = pt;
  ok := v = 'weekdays';
  log := log || format(E'%s P2 A sets Lặp lại · Ngày làm việc on her task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- B: reads the shared file, not A's private one; cannot add to A's task; cannot remove A's file.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.task_files where task_id = st;
  ok := n = 1;
  log := log || format(E'%s T.10 B (assignee) reads the shared task''s file\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.task_files where task_id = pt;
  ok := n = 0;
  log := log || format(E'%s T.10 B cannot read A''s personal task files\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin
    insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
    values (pt, b, pt::text || '/b.pdf', 'b.pdf', 'application/pdf', 10);
    ok := false;
  exception when others then ok := true; end;
  log := log || format(E'%s T.10 B cannot add to A''s task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  delete from public.task_files where task_id = st and uploaded_by = a;
  get diagnostics n = row_count;
  ok := n = 0;
  log := log || format(E'%s T.10 B cannot remove A''s file on A''s task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
  values (st, b, st::text || '/x-b.pdf', 'b.pdf', 'application/pdf', 10) returning id into fb;
  log := log || E'ok   T.10 B (assignee, may edit) adds to the shared task\n';
  begin perform public.set_task_recurrence(pt, 'daily', null); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P2 B cannot change recurrence of A''s task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- A (creator) may remove B's file on her task.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.task_files where id = fb;
  get diagnostics n = row_count;
  ok := n = 1;
  log := log || format(E'%s T.10 creator A removes B''s file on her task\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- C and outsider O: nothing.
  foreach v in array array[coalesce(c, o)::text, o::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.task_files where task_id in (pt, st);
    ok := n = 0;
    log := log || format(E'%s T.10 %s reads nothing\n', case when ok then 'ok  ' else 'FAIL' end, case when v = o::text then 'outsider O' else 'C' end); failures := failures + (not ok)::int;
    begin
      insert into public.task_files (task_id, uploaded_by, storage_path, file_name, mime_type, byte_size)
      values (st, v::uuid, st::text || '/o.pdf', 'o.pdf', 'application/pdf', 10);
      ok := false;
    exception when others then ok := true; end;
    log := log || format(E'%s T.10 %s cannot add\n', case when ok then 'ok  ' else 'FAIL' end, case when v = o::text then 'outsider O' else 'C' end); failures := failures + (not ok)::int;
    reset role;
  end loop;

  -- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin select count(*) into n from public.task_files; ok := false; exception when others then ok := true; end;
  log := log || format(E'%s T.10 anon refused\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.set_task_recurrence(pt, 'daily', null); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s P2 anon cannot call set_task_recurrence\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- Purge: rows go with the task, objects go to the sweep queue.
  delete from public.tasks where id = pt;
  select count(*) into n from public.task_files where id = fa;
  ok := n = 0 and exists (select 1 from private.storage_delete_queue where bucket = 'task-files' and path = pt::text || '/x-a.pdf');
  log := log || format(E'%s T.10 purged task: rows gone, object queued\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- Weekdays: done on a Friday spawns Monday.
  nd := current_date + ((5 - extract(isodow from current_date)::int + 7) % 7) + 7;
  pt := gen_random_uuid();
  insert into public.tasks (id, type, creator_id, title, description, status, deadline_date, recurrence)
  values (pt, 'personal', a, 'Lặp ngày làm việc', '', 'confirmed', nd, 'weekdays');
  update public.tasks set status = 'done', done_at = now() where id = pt;
  select deadline_date into nd from public.tasks where recurrence_origin_id = pt;
  ok := extract(isodow from nd) = 1;
  log := log || format(E'%s P2 weekdays: Friday done → next on Monday (%s)\n', case when ok then 'ok  ' else 'FAIL' end, nd); failures := failures + (not ok)::int;

  raise exception 'AVORA104_P2 failures=% %', failures, E'\n' || log;
end $test$;
