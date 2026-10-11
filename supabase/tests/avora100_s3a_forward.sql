-- AVORA-100 · S.3 (a) — chuyển tiếp file Nhật ký, file trong ghi chép, cả ghi chép. Always rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  journal uuid := '78a9b22f-d31d-474f-bfad-9b3f162cb4c1';
  d uuid := '5684d208-6942-46ef-9eaa-03594063556a';
  jm uuid := gen_random_uuid();
  note uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid();
  m1 uuid; m2 uuid; m3 uuid; mine uuid;
  objects_before bigint; n bigint;
  failures int := 0; log text := ''; ok boolean;
begin
  -- fixture (system): a journal message of A with a photo; a ghi chép of A with two files.
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('chat-attachments', journal || '/x/anh.jpg', a::text, '{"size": 2000, "mimetype": "image/jpeg"}'),
    ('note-files', a || '/' || note || '/bai-giang.pdf', a::text, '{"size": 3000, "mimetype": "application/pdf"}'),
    ('note-files', a || '/' || note || '/so-do.png', a::text, '{"size": 4000, "mimetype": "image/png"}');
  insert into public.messages (id, conversation_id, sender_id, content, attachment_count) values (jm, journal, a, '', 1);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
  values (jm, journal, a, 'image', journal || '/x/anh.jpg', 'anh.jpg', 'image/jpeg', 2000, 'export');
  insert into public.notes (id, owner_user_id, title, blocks)
  values (note, a, 'Bài giảng Chương 3', '[{"id":"b1","text":"I. Mở đầu","level":0},{"id":"b2","text":"1. Khái niệm","level":1},{"id":"b3","text":"A. Ví dụ","level":2}]');
  insert into public.note_attachments (id, note_id, owner_user_id, kind, storage_path, file_name, mime_type, byte_size)
  values (f1, note, a, 'file', a || '/' || note || '/bai-giang.pdf', 'bai-giang.pdf', 'application/pdf', 3000),
         (f2, note, a, 'image', a || '/' || note || '/so-do.png', 'so-do.png', 'image/png', 4000);
  select count(*) into objects_before from storage.objects;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m1 := public.forward_journal_file(jm, d, 'view');
  m2 := public.forward_note(note, d, 'export');
  m3 := public.forward_note_files(array[f2], d, 'forward');
  -- Két sắt / someone else's things / bad permission: refused.
  ok := true;
  begin perform public.forward_note_files(array[gen_random_uuid()], d); ok := false; exception when others then null; end;
  begin perform public.forward_journal_file(jm, d, 'all'); ok := false; exception when others then null; end;
  reset role;
  select count(*) into n from storage.objects;
  ok := ok and n = objects_before
    and (select storage_path from public.message_attachments where message_id = m1) = journal || '/x/anh.jpg'
    and (select permission from public.message_attachments where message_id = m1) = 'view'
    and (select count(*) from public.message_attachments where message_id = m2) = 2
    and (select note_card ->> 'title' from public.messages where id = m2) = 'Bài giảng Chương 3'
    and (select jsonb_array_length(note_card -> 'blocks') from public.messages where id = m2) = 3
    and (select (note_card -> 'blocks' -> 2 ->> 'level')::int from public.messages where id = m2) = 2
    and (select storage_path from public.message_attachments where message_id = m3) = 'note-files:' || a || '/' || note || '/so-do.png';
  log := log || format(E'%s S3a.1 ảnh File của tôi + ghi chép 2 tệp + 1 tệp ghi chép → 1-1; không object mới; quyền đúng; cấu trúc I./1./A. giữ\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- B reads the forwarded note files; O (outside) does not.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from storage.objects where bucket_id = 'note-files' and name like a || '/' || note || '/%') = 2
    and (select count(*) from public.messages where id = m2 and note_card is not null) = 1;
  -- B cannot edit A's note directly.
  update public.notes set title = 'B sửa' where id = note;
  begin
    perform public.forward_note(note, d);
    ok := false;
  exception when others then null;
  end;
  mine := public.save_note_card(m2);
  ok := ok and (select owner_user_id from public.notes where id = mine) = b
           and (select jsonb_array_length(blocks) from public.notes where id = mine) = 3;
  reset role;
  ok := ok and (select title from public.notes where id = note) = 'Bài giảng Chương 3';
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from storage.objects where bucket_id = 'note-files' and name like a || '/' || note || '/%') = 0;
  reset role;
  log := log || format(E'%s S3a.2 B mở được tệp gửi tới; O không; B sửa thẳng ghi chép của A → không đổi; B `Lưu vào Nhật ký` → bản riêng của B\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- A cannot delete a note file someone was sent: the delete policy's own test, as A (Storage refuses SQL deletes).
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from storage.objects o where o.bucket_id = 'note-files' and o.name = a || '/' || note || '/so-do.png'
           and (storage.foldername(o.name))[1] = auth.uid()::text
           and not exists (select 1 from public.message_attachments x where x.storage_path = 'note-files:' || o.name)) = 0
    and (select count(*) from pg_policies where policyname = 'note_files_delete_own' and qual like '%note-files:%') = 1;
  reset role;
  log := log || format(E'%s S3a.3 tệp ghi chép đã gửi đi không bị chủ xoá mất (người nhận vẫn mở được)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA100_S3A failures=% %', failures, E'\n' || log;
end $test$;
