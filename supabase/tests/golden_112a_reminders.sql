-- 112-A · Luồng 4.4 (nhắc việc báo đúng một lần, đúng giờ) — đo trên máy chủ thật, mọi thứ rollback.
-- Đo, không sửa: dòng 'late' ghi lại điều xảy ra khi nhắc đã quá 1 giờ (cron trễ / máy chủ nghỉ).
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  t uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  late uuid := gen_random_uuid();
  failures int := 0; log text := ''; ok boolean; n int; n_late int;
begin
  update public.profiles set push_reminders = true where id = a;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (a, 'https://probe.invalid/' || gen_random_uuid(), repeat('p', 87), repeat('a', 22), 'probe') on conflict do nothing;
  insert into public.tasks (id, type, creator_id, title, description, status, deadline_date)
  values (t, 'personal', a, 'Probe nhắc', 'đo 112-A', 'confirmed', (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1);
  -- A reminder can only be SET in the future (trigger avora_reminder_in_past); time then passes. To stand
  -- one minute after it, the rows are written with triggers off (this transaction only).
  set local session_replication_role = replica;
  insert into public.task_reminders (id, task_id, user_id, reminder_time) values (r, t, a, now() - interval '1 minute');
  insert into public.task_reminders (id, task_id, user_id, reminder_time) values (late, t, a, now() - interval '61 minutes');
  set local session_replication_role = origin;

  perform private.enqueue_due_reminders();
  perform private.enqueue_due_reminders();
  select count(*) into n from public.push_outbox where user_id = a and dedupe_key = 'tr:' || r;
  ok := n = 1;
  log := log || format(E'%s 4.4 nhắc đến hạn → đúng một dòng gửi (gọi hai lần): %s\n', case when ok then 'ok  ' else 'FAIL' end, n);
  failures := failures + (not ok)::int;

  select count(*) into n_late from public.push_outbox where user_id = a and dedupe_key = 'tr:' || late;
  log := log || format(E'PROBE 4.4 nhắc đã quá 61 phút khi cron chạy → %s dòng gửi (is_sent=%s)\n', n_late,
    (select is_sent from public.task_reminders where id = late));

  raise exception E'GOLDEN_112A_REMINDERS failures=% \n%', failures, log;
end $test$;
