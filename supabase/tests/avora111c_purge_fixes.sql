-- 111-C · sửa 111-A: xoá tài khoản không được kẹt ở bất kỳ nội dung chia sẻ nào. Mỗi tình huống: tạo, gửi yêu cầu,
-- account_purge (như Edge Function), rồi xoá auth.users (như API quản trị). Trước bản sửa: 13/17 tình huống đỏ
-- (docs/reliability/do-111c/red-before-purge.txt). Luôn rollback.
do $test$
declare
  a uuid; b uuid; c uuid; g uuid; tb uuid; pr uuid; prt uuid; d uuid; o uuid; v_ct uuid; v jsonb; msg text; ctx text; out text := '';
  scen text; f uuid; acc uuid; cat uuid;
  failures int := 0;
begin
  foreach scen in array array['group_board_own_record','record_on_others_board','meeting_note_draft','meeting_note_final','poll_closed','project_task_linked','closed_project_record','task_list','shared_task'] loop
    begin
      a := private.test_ephemeral_user('A'); b := private.test_ephemeral_user('B'); c := private.test_ephemeral_user('C'); g := gen_random_uuid();
      insert into public.conversations (id, type) values (g, 'group');
      insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'k ' || scen, case when scen = 'record_on_others_board' then b else a end);
      insert into public.conversation_participants (conversation_id, user_id, role) values
        (g, a, case when scen = 'record_on_others_board' then 'member' else 'owner' end),
        (g, b, case when scen = 'record_on_others_board' then 'owner' else 'member' end), (g, c, 'member');
      if scen = 'group_board_own_record' then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        tb := (public.create_think_hub_table('Bảng nhóm', null, g)).id;
        perform public.create_think_hub_record(tb, 'rec', null,null,null,null,null,null,null, g, null);
      elsif scen = 'record_on_others_board' then
        perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
        tb := (public.create_think_hub_table('Bảng của B', null, g)).id;
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        perform public.create_think_hub_record(tb, 'A viết', null,null,null,null,null,null,null, g, null);
      elsif scen in ('meeting_note_draft','meeting_note_final') then
        insert into public.group_decisions (conversation_id, kind, title, created_by, status, settled_at)
          values (g, 'meeting_note', 'Họp', a, case when scen = 'meeting_note_final' then 'finalized' else 'draft' end, case when scen = 'meeting_note_final' then now() end);
      elsif scen = 'poll_closed' then
        insert into public.group_decisions (conversation_id, kind, title, created_by, status, settled_at) values (g, 'poll', 'Bầu', a, 'closed', now());
      elsif scen in ('project_task_linked','closed_project_record') then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        pr := (public.create_project(g, 'P', 'v', 'o', current_date, current_date + 5)).id;
        perform public.create_project_task(pr, null, gen_random_uuid(), 'việc', 'mô tả', current_date + 1, b, null, 'Asia/Ho_Chi_Minh',
          jsonb_build_object('conversation_type','group','conversation_id',(select conversation_id from public.projects where id = pr),'conversation_name','P',
            'original_message_id',null,'original_message_text','x','original_message_sender_id',a,'original_message_sender_name',null,
            'original_message_created_at',now(),'user_response',null,'snapshot_created_at',now()));
        select id into prt from public.think_hub_table where project_id = pr limit 1;
        if prt is not null then perform public.create_think_hub_record(prt, 'rec dự án', null,null,null,null,null,null,null, null, pr); end if;
        if scen = 'closed_project_record' then perform set_config('request.jwt.claims', '', true); update public.projects set status = 'done', closed_at = now() where id = pr; end if;
      elsif scen = 'task_list' then
        insert into public.task_lists (conversation_id, name, created_by) values (g, 'Danh sách', a);
      elsif scen = 'shared_task' then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        perform public.create_shared_task(g, 'group-shared', 'việc nhóm', 'mô tả', current_date + 2, gen_random_uuid(), b, null, 'Asia/Ho_Chi_Minh', null, false, 'none', null,
          jsonb_build_object('conversation_type','group','conversation_id',g,'conversation_name','k','original_message_id',null,'original_message_text','x',
            'original_message_sender_id',a,'original_message_sender_name',null,'original_message_created_at',now(),'user_response',null,'snapshot_created_at',now()));
      end if;
      perform set_config('request.jwt.claims', '', true);
      insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method) values (a, now(), now(), 'pending', 'password');
      v := private.account_purge(a, 'self');
      delete from auth.users where id = a;
      out := out || format(E'ok   %s\n', scen);
    exception when others then
      get stacked diagnostics ctx = pg_exception_context;
      failures := failures + 1; out := out || format(E'FAIL %s: %s | %s\n', scen, sqlerrm, left(regexp_replace(ctx, E'\\s+', ' ', 'g'), 160));
    end;
  end loop;

  foreach scen in array array['vote_open_poll','vote_closed_poll','reading_folder','opportunity_record','contact_and_obligation'] loop
    begin
      a := private.test_ephemeral_user('A'); b := private.test_ephemeral_user('B'); c := private.test_ephemeral_user('C'); g := gen_random_uuid();
      insert into public.conversations (id, type) values (g, 'group');
      insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'k2 ' || scen, b);
      insert into public.conversation_participants (conversation_id, user_id, role) values (g, b, 'owner'), (g, a, 'member'), (g, c, 'member');
      if scen in ('vote_open_poll','vote_closed_poll') then
        d := gen_random_uuid(); o := gen_random_uuid();
        insert into public.group_decisions (id, conversation_id, kind, title, created_by, status) values (d, g, 'poll', 'Bầu', b, 'open');
        insert into public.group_decision_options (id, decision_id, label) values (o, d, 'Có');
        insert into public.group_decision_votes (decision_id, option_id, voter_id) values (d, o, a);
        if scen = 'vote_closed_poll' then update public.group_decisions set status = 'closed', settled_at = now() where id = d; end if;
      elsif scen = 'reading_folder' then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        perform public.ensure_reading_folder();
      elsif scen = 'opportunity_record' then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        v_ct := (select id from public.create_contact_quick('Khách', null, null) limit 1);
        perform public.create_opportunity(v_ct, 'Cơ hội', 1000);
      elsif scen = 'contact_and_obligation' then
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        v_ct := (select id from public.create_contact_quick('Bạn vay', null, null) limit 1);
        insert into public.accounts (id, user_id, name, type, currency) values (gen_random_uuid(), a, 'TM', 'cash', 'VND');
        insert into public.transactions (user_id, account_id, type, amount, transaction_date, currency, contact_id, due_date, status)
          select a, id, 'cho_vay', 500, current_date, 'VND', v_ct, current_date + 30, 'den_han' from public.accounts where user_id = a limit 1;
      end if;
      perform set_config('request.jwt.claims', '', true);
      insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method) values (a, now(), now(), 'pending', 'password');
      v := private.account_purge(a, 'self');
      delete from auth.users where id = a;
      out := out || format(E'ok   %s\n', scen);
    exception when others then
      get stacked diagnostics ctx = pg_exception_context;
      failures := failures + 1; out := out || format(E'FAIL %s: %s | %s\n', scen, sqlerrm, left(regexp_replace(ctx, E'\\s+', ' ', 'g'), 200));
    end;
  end loop;

  -- Người có giao dịch Tài chính (danh mục xoá dây chuyền bị chặn nếu còn giao dịch).
  begin
    f := private.test_ephemeral_user('F'); acc := gen_random_uuid();
    perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    perform public.seed_finance_categories(f);
    select id into cat from public.categories where user_id = f and applies_to = 'expense' limit 1;
    insert into public.accounts (id, user_id, name, type, currency) values (acc, f, 'Tiền mặt', 'cash', 'VND');
    insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date, currency) values (f, acc, cat, 'expense', 1000, current_date, 'VND');
    perform set_config('request.jwt.claims', '', true);
    insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method) values (f, now(), now(), 'pending', 'password');
    v := private.account_purge(f, 'self'); delete from auth.users where id = f;
    out := out || E'ok   finance_transactions\n';
  exception when others then failures := failures + 1; out := out || format(E'FAIL finance_transactions: %s\n', sqlerrm); end;

  -- Bản ghi trên bảng nhóm đã lưu trữ (block_archived_record) và người cuối cùng của nhóm có biểu quyết đã đóng
  -- mà người cũ đã bầu (nhóm bị xoá → biểu quyết + phiếu đi theo).
  foreach scen in array array['archived_board_record','last_member_closed_poll'] loop
    begin
      a := private.test_ephemeral_user('A'); b := private.test_ephemeral_user('B'); g := gen_random_uuid();
      insert into public.conversations (id, type) values (g, 'group');
      if scen = 'archived_board_record' then
        insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'k3', b);
        insert into public.conversation_participants (conversation_id, user_id, role) values (g, b, 'owner'), (g, a, 'member');
        perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
        tb := (public.create_think_hub_table('Bảng lưu trữ', null, g)).id;
        perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
        perform public.create_think_hub_record(tb, 'A viết', null,null,null,null,null,null,null, g, null);
        perform set_config('request.jwt.claims', '', true);
        update public.think_hub_table set archived_at = now() where id = tb;
      else
        insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'k4', a);
        insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner');
        d := gen_random_uuid(); o := gen_random_uuid();
        insert into public.group_decisions (id, conversation_id, kind, title, created_by, status) values (d, g, 'poll', 'Bầu', a, 'open');
        insert into public.group_decision_options (id, decision_id, label) values (o, d, 'Có');
        insert into public.group_decision_votes (decision_id, option_id, voter_id) values (d, o, b);
        update public.group_decisions set status = 'closed', settled_at = now(), settled_by = a where id = d;
      end if;
      perform set_config('request.jwt.claims', '', true);
      insert into public.account_deletion_requests (user_id, requested_at, execute_after, status, method) values (a, now(), now(), 'pending', 'password');
      v := private.account_purge(a, 'self');
      delete from auth.users where id = a;
      out := out || format(E'ok   %s\n', scen);
    exception when others then
      get stacked diagnostics ctx = pg_exception_context;
      failures := failures + 1; out := out || format(E'FAIL %s: %s | %s\n', scen, sqlerrm, left(regexp_replace(ctx, E'\\s+', ' ', 'g'), 200));
    end;
  end loop;

  -- Bất biến vẫn giữ ngoài lúc xoá tài khoản: không xoá được biểu quyết đã đóng, không sửa bản ghi trên bảng lưu trữ.
  begin
    a := private.test_ephemeral_user('A'); g := gen_random_uuid(); d := gen_random_uuid();
    insert into public.conversations (id, type) values (g, 'group');
    insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'k5', a);
    insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner');
    insert into public.group_decisions (id, conversation_id, kind, title, created_by, status, settled_at) values (d, g, 'poll', 'Bầu', a, 'closed', now());
    begin delete from public.group_decisions where id = d; failures := failures + 1; out := out || E'FAIL xoá được biểu quyết đã đóng\n';
    exception when others then if sqlerrm = 'avora_decision_settled_immutable' then out := out || E'ok   biểu quyết đã đóng vẫn bất biến\n';
      else failures := failures + 1; out := out || format(E'FAIL bất biến biểu quyết: %s\n', sqlerrm); end if; end;
  end;

  if has_function_privilege('authenticated', 'private.account_purge(uuid, text)', 'execute')
     or (to_regprocedure('private.account_purge_core(uuid, text)') is not null
         and has_function_privilege('authenticated', 'private.account_purge_core(uuid, text)', 'execute')) then
    failures := failures + 1; out := out || E'FAIL hàm xoá mở cho client\n';
  else out := out || E'ok   hàm xoá không mở cho client\n'; end if;

  raise exception E'AVORA111C_PURGE failures=%\n%', failures, out;
end $test$;
