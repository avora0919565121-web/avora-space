-- AVORA-106 · K6 · đợt A — counters follow attachments; members read their conversation's store, others nothing;
-- expiry is recorded, never acted on; the sweep queue is service-only.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  d uuid := gen_random_uuid();
  mid uuid := gen_random_uuid();
  failures int := 0; log text := ''; ok boolean; n bigint; e timestamptz;
begin
  insert into public.conversations (id, type) values (d, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (d, a), (d, b);
  insert into public.messages (id, conversation_id, sender_id, content, attachment_count) values (mid, d, a, 'tệp', 1);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size)
  values (mid, d, a, 'file', d::text || '/x/a.pdf', 'a.pdf', 'application/pdf', 2048);
  select bytes into n from public.conversation_storage where conversation_id = d;
  ok := n = 2048;
  log := log || format(E'%s K6 conversation_storage counts the file (%s B)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;
  select cap_bytes into n from public.conversation_storage where conversation_id = d;
  ok := n = 1073741824;
  log := log || format(E'%s K6 1-1 cap = 1 GB\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select expires_at into e from public.message_attachments where message_id = mid;
  ok := e between now() + interval '29 days' and now() + interval '31 days';
  log := log || format(E'%s K6 expires_at = +30 days (recorded only)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  delete from public.message_attachments where message_id = mid;
  select bytes into n from public.conversation_storage where conversation_id = d;
  ok := n = 0;
  log := log || format(E'%s K6 removing the row subtracts it\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.conversation_storage where conversation_id = d;
  ok := n = 1;
  log := log || format(E'%s K6 member reads the store\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  begin perform public.storage_sweep_batch(10); ok := false; exception when others then ok := true; end;
  log := log || format(E'%s K6 sweep batch is service-only\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.conversation_storage where conversation_id = d;
  ok := n = 0;
  log := log || format(E'%s K6 outsider reads nothing\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  select count(*) into n from public.storage_usage where user_id = a;
  ok := n = 0;
  log := log || format(E'%s K6 storage_usage: only my own row\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;
  raise exception 'K6_STORAGE failures=% %', failures, E'\n' || log;
end $test$;
