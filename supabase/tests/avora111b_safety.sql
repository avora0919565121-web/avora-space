-- 111-B · An toàn nội dung: lý do mới, 4 loại điểm vào, chỉ ops đọc, khoá chặn ghi (lối xoá tài khoản vẫn mở),
-- bộ lọc không dấu, không quét tin riêng, điều khoản, hỗ trợ, chặn. Tài khoản tạm, luôn rollback.
do $test$
declare
  a uuid := private.test_ephemeral_user('A');   -- bị báo cáo
  b uuid := private.test_ephemeral_user('B');   -- người báo cáo
  c uuid := private.test_ephemeral_user('C');   -- ops
  e uuid := private.test_ephemeral_user('E');   -- người ngoài nhóm
  d uuid := gen_random_uuid();   -- 1-1 A, B (bạn bè, không xác minh)
  d2 uuid := gen_random_uuid();  -- 1-1 A, E đang xác minh (người lạ)
  g uuid := gen_random_uuid();   -- nhóm A, B
  m uuid := gen_random_uuid(); fm uuid := gen_random_uuid(); att uuid := gen_random_uuid();
  r_msg uuid; r_grp uuid; r_file uuid; r_av uuid; r_minor uuid;
  v_json jsonb; v_n bigint; v_text text;
  failures int := 0; log text := ''; ok boolean;
begin
  insert into public.conversations (id, type) values (d, 'direct'), (g, 'group');
  insert into public.conversations (id, type, verification_status, verification_started_at, verification_expires_at, verification_opened_by)
    values (d2, 'direct', 'pending', now(), now() + interval '1 day', e);
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, '111B nhóm', a);
  insert into public.conversation_participants (conversation_id, user_id, role, joined_at) values
    (g, a, 'owner', now()), (g, b, 'member', now()), (d, a, 'member', now()), (d, b, 'member', now()),
    (d2, a, 'member', now()), (d2, e, 'member', now());
  insert into public.messages (id, conversation_id, sender_id, content) values (m, d, a, 'Tin bị báo cáo');
  insert into public.messages (id, conversation_id, sender_id, content, attachment_count) values (fm, g, a, '', 1);
  insert into public.message_attachments (id, message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, permission)
    values (att, fm, g, a, 'file', g || '/' || fm || '/x.pdf', 'x.pdf', 'application/pdf', 10, 'view');
  update public.app_config set value = '[]'::jsonb where key = 'ops_user_ids';

  -- 1. Lý do mới + bốn điểm vào (tin, nhóm, tệp, ảnh đại diện) + lý do sai bị từ chối.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r_msg := public.report_user(a, 'sexual', null, d, m, true, false);
  r_grp := public.report_user(null, 'violence', 'Nhóm bạo lực', null, null, false, false, 'group', g);
  r_file := public.report_user(null, 'self_harm', null, null, null, true, false, 'file', null, att);
  r_av := public.report_user(a, 'inappropriate', null, null, null, false, false, 'avatar');
  begin perform public.report_user(a, 'xyz'); ok := false; exception when others then ok := sqlerrm like '%avora_report_reason_invalid%'; end;
  reset role;
  ok := ok
    and (select target_kind = 'message' and reported_content = 'Tin bị báo cáo' from public.user_reports where id = r_msg)
    and (select target_kind = 'group' and group_id = g and reported_user_id is null from public.user_reports where id = r_grp)
    and (select target_kind = 'file' and file_id = att and reported_user_id = a and reported_content = 'x.pdf' from public.user_reports where id = r_file)
    and (select target_kind = 'avatar' and conversation_id is null from public.user_reports where id = r_av);
  log := log || format(E'%s 1 lý do mới, 4 điểm vào (tin/nhóm/tệp/ảnh), lý do sai bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 2. Người ngoài nhóm không báo cáo được nhóm.
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.report_user(null, 'other', null, null, null, false, false, 'group', g); ok := false;
  exception when others then ok := sqlerrm like '%avora_report_target_invalid%'; end;
  reset role;
  log := log || format(E'%s 2 người ngoài nhóm → avora_report_target_invalid\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. Chỉ ops đọc: C chưa là ops → bị từ chối; người báo chỉ thấy báo cáo của mình.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.ops_list_reports(); ok := false; exception when others then ok := sqlerrm like '%avora_not_allowed%'; end;
  ok := ok and (select count(*) from public.user_reports) = 0;
  begin perform public.ops_handle_report(r_msg, 'dismiss'); ok := false; exception when others then ok := ok and sqlerrm like '%avora_not_allowed%'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.user_reports) = 0;  -- người bị báo không bao giờ thấy
  reset role;
  log := log || format(E'%s 3 người thường không đọc / xử lý được; người bị báo không thấy báo cáo\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 4. Ops: minor_safety lên đầu; số báo cáo trước đó.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r_minor := public.report_user(a, 'minor_safety', null, d, null, false, false);
  reset role;
  update public.app_config set value = jsonb_build_array(c::text) where key = 'ops_user_ids';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.ops_list_reports();
  reset role;
  ok := jsonb_array_length(v_json) >= 5 and (v_json->0->>'id')::uuid = r_minor and (v_json->0->>'priorCount')::int >= 3;
  log := log || format(E'%s 4 ops đọc được; minor_safety ở đầu; priorCount=%s\n', case when ok then 'ok  ' else 'FAIL' end, v_json->0->>'priorCount'); failures := failures + (not ok)::int;

  -- 5. Bộ lọc: không dấu, không hoa thường, cụm nguyên vẹn.
  ok := private.text_blocked('ĐỊT MẸ!') and private.text_blocked('Việc Nhẹ Lương Cao nè') and private.text_blocked('go FUCK')
    and not private.text_blocked('admin dm') and not private.text_blocked('Nhóm lớn') and not private.text_blocked('Từ từ thôi');
  log := log || format(E'%s 5 bộ lọc so khớp không dấu / hoa thường, không bắt nhầm\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 6. Chỗ người lạ thấy: tên nhóm, tên hiển thị, tên dự án chia sẻ, chat xác minh → từ chối.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ok := true;
  begin update public.conversation_groups set name = 'Việc nhẹ lương cao' where conversation_id = g; ok := false; exception when others then ok := sqlerrm like '%avora_blocked_term%'; end;
  begin update public.profiles set display_name = 'Fuck' where id = a; ok := false; exception when others then ok := ok and sqlerrm like '%avora_blocked_term%'; end;
  begin insert into public.projects (conversation_id, created_by, title, objective, value_orientation, start_date, target_end_date)
    values (g, a, 'Bán ma tuý', 'x', 'x', current_date, current_date + 1); ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_blocked_term%'; end;
  begin insert into public.messages (conversation_id, sender_id, content) values (d2, a, 'địt mẹ'); ok := false;
  exception when others then ok := ok and sqlerrm like '%avora_blocked_term%'; end;
  update public.conversation_groups set name = '111B nhóm mới' where conversation_id = g;  -- tên sạch vẫn đổi được
  log := log || format(E'%s 6 tên nhóm / tên hiển thị / dự án chia sẻ / chat xác minh → avora_blocked_term\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 7. Không quét tin riêng giữa bạn bè.
  insert into public.messages (conversation_id, sender_id, content) values (d, a, 'địt mẹ vcl');
  ok := exists (select 1 from public.messages where conversation_id = d and content = 'địt mẹ vcl');
  log := log || format(E'%s 7 tin riêng giữa bạn bè không qua bộ lọc\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 8. Xử lý: cảnh cáo → A có thông báo; khoá tạm → A bị chặn ghi, đọc; lối xoá tài khoản vẫn mở; B nhận "đã xem xét".
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.ops_handle_report(r_av, 'warn');
  perform public.ops_handle_report(r_msg, 'suspend_temp', 3);
  begin perform public.ops_handle_report(r_msg, 'dismiss'); ok := false; exception when others then ok := sqlerrm like '%avora_report_handled%'; end;
  reset role;
  ok := ok and (select count(*) from private.account_notices where user_id = a and kind = 'warning') = 1
    and (select count(*) from private.account_notices where user_id = b and kind = 'report_reviewed') = 2
    and (select status = 'actioned' and action = 'suspend_temp' and handled_by = c from public.user_reports where id = r_msg);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and not private.session_allowed() and (select count(*) from public.messages) = 0;
  begin perform public.block_user(e); ok := false; exception when others then ok := ok and sqlerrm like '%avora_session_not_allowed%'; end;
  v_json := public.my_account_gate();
  ok := ok and v_json->>'suspendedUntil' is not null and jsonb_array_length(v_json->'notices') = 1;
  -- Lối xoá tài khoản: bị từ chối vì chưa xác nhận danh tính, không phải vì bị khoá.
  begin perform public.request_account_deletion(null); ok := false; exception when others then ok := ok and sqlerrm like '%avora_account_reauth_required%'; end;
  reset role;
  log := log || format(E'%s 8 cảnh cáo, khoá tạm chặn ghi + đọc, lối xoá vẫn mở, người báo nhận "đã xem xét"\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 9. Điều khoản: sai phiên bản bị từ chối; đúng thì ghi nhận.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (public.my_account_gate()->>'termsAccepted')::boolean = false;
  begin perform public.accept_terms('1999-01-01'); ok := false; exception when others then ok := ok and sqlerrm like '%avora_terms_version%'; end;
  perform public.accept_terms(private.terms_version());
  ok := ok and (public.my_account_gate()->>'termsAccepted')::boolean;
  -- 10. Hỗ trợ: người gửi không đọc lại được; ops đọc được.
  perform public.submit_support_request('Bình', 'binh@example.com', 'Cần giúp');
  ok := ok and (select count(*) from public.support_requests) = 0;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.support_requests) >= 1;
  reset role;
  log := log || format(E'%s 9-10 điều khoản theo phiên bản; hỗ trợ chỉ ops đọc\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 11. Chặn: B chặn E → E không mở 1-1, không thêm B vào nhóm.
  delete from private.account_suspensions where user_id = a;
  insert into public.conversation_participants (conversation_id, user_id, role, joined_at) values (g, e, 'admin', now());
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.block_user(e);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := not private.can_talk_direct(e, b);
  begin perform public.create_direct_conversation(b); ok := false; exception when others then ok := ok; end;
  reset role;
  log := log || format(E'%s 11 người bị chặn không nhắn 1-1 được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA111B failures=%\n%', failures, log;
end $test$;
