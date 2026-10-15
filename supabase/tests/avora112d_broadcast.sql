-- AVORA-112-D — Broadcast có phân quyền thay postgres_changes. Đọc thẳng realtime.messages (mỗi realtime.send
-- là một dòng) trong một giao dịch, luôn rollback. A testera · B testerb (cùng một cuộc 1-1 tạo trong test) ·
-- người thứ ba = một id không thuộc cuộc (không có tài khoản thật nào khác).
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := gen_random_uuid();
  t0 timestamptz := clock_timestamp();
  t uuid := gen_random_uuid();
  tp uuid := gen_random_uuid();
  log text := '';
  failures int := 0;
  ok boolean;
  n int;
  topics text[];
begin
  insert into public.conversations (id, type) values (c, 'direct');
  insert into public.conversation_participants (conversation_id, user_id) values (c, a), (c, b);
  delete from realtime.messages where inserted_at >= t0 - interval '1 second' and topic in ('user-' || a, 'user-' || b);

  -- ---------------------------------------------------------------- việc chung → cả hai, chỉ hai
  insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, deadline_date, status)
  values (t, '1-1-shared', a, b, c, 'Thử 112-D', current_date, 'pending_confirmation');
  select array_agg(distinct topic order by topic) into topics from realtime.messages
    where event = 'task' and payload -> 'old' ->> 'id' = t::text;
  ok := topics = array(select unnest(array['user-' || a, 'user-' || b]) order by 1)
    and (select payload ->> 'eventType' from realtime.messages where event = 'task' and payload -> 'old' ->> 'id' = t::text limit 1) = 'INSERT'
    and (select payload -> 'new' ->> 'title' from realtime.messages where event = 'task' and payload -> 'old' ->> 'id' = t::text limit 1) = 'Thử 112-D';
  log := log || format(E'%s việc chung: sự kiện tới user-A và user-B, không ai khác (%s)\n', case when ok then 'ok  ' else 'FAIL' end, topics); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- việc riêng → chỉ người tạo
  insert into public.tasks (id, type, creator_id, title, deadline_date, status) values (tp, 'personal', a, 'Riêng của A', current_date, 'confirmed');
  select array_agg(distinct topic) into topics from realtime.messages where event = 'task' and payload -> 'old' ->> 'id' = tp::text;
  ok := topics = array['user-' || a];
  log := log || format(E'%s việc riêng: chỉ user-A\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- đã đọc → chỉ người đọc
  insert into public.conversation_read_marks (conversation_id, user_id, last_read_at) values (c, b, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
  select array_agg(distinct topic) into topics from realtime.messages where event = 'read_mark' and payload -> 'new' ->> 'conversation_id' = c::text;
  ok := coalesce(topics = array['user-' || b], false);
  log := log || format(E'%s đã đọc: chỉ các thiết bị của chính người đọc\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- người rời cuộc không nhận thêm
  delete from public.conversation_participants where conversation_id = c and user_id = b;
  update public.tasks set title = 'Sau khi B rời' where id = t;
  select count(*) into n from realtime.messages where event = 'task' and topic = 'user-' || b and payload -> 'new' ->> 'title' = 'Sau khi B rời';
  ok := n = 0 and exists (select 1 from realtime.messages where event = 'task' and topic = 'user-' || a and payload -> 'new' ->> 'title' = 'Sau khi B rời');
  log := log || format(E'%s B rời cuộc: không nhận sự kiện mới; A vẫn nhận\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- không còn thấy được → gửi như xoá, không kèm nội dung
  insert into public.conversation_participants (conversation_id, user_id) values (c, b);
  delete from public.tasks where id = t;
  ok := exists (select 1 from realtime.messages where event = 'task' and payload -> 'old' ->> 'id' = t::text and payload ->> 'eventType' = 'DELETE' and payload -> 'new' = '{}'::jsonb);
  log := log || format(E'%s xoá việc: sự kiện DELETE chỉ mang id\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- thêm thành viên → mọi thành viên làm mới danh sách
  ok := exists (select 1 from realtime.messages where event = 'participant_added' and topic = 'user-' || a and payload ->> 'conversation_id' = c::text);
  log := log || format(E'%s thêm thành viên: thành viên cũ được báo làm mới danh sách\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- phân quyền kênh
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := private.realtime_topic_ok('user-' || b) and not private.realtime_topic_ok('user-' || a);
  reset role;
  log := log || format(E'%s kênh user-<id>: chỉ chủ kênh nghe được (B không nghe user-A)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- đường lui
  ok := (select value from public.app_config where key = 'realtime_mode') = '"broadcast"'::jsonb
    and (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('tasks', 'task_suggestions', 'conversation_read_marks', 'group_removal_requests', 'conversation_participants')) = 5;
  log := log || format(E'%s realtime_mode = broadcast; ấn phẩm legacy còn đủ 5 bảng (đường lui)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA112D failures=%\n%', failures, log;
end $test$;
