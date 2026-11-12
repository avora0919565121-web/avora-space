-- KT-07a · Lời mời Đợt 0: không lộ ghi chú khi nhận lời, chỉ "đã mời" khi xác nhận đã gửi,
-- trang mời công khai + Từ chối không cần tài khoản, sổ chống làm phiền theo mã băm người nhận.
-- Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; b uuid; c uuid; k1 uuid; k2 uuid; k3 uuid;
  r record; t1 text; t2 text; id1 uuid; id2 uuid; n int; v text; out text := ''; failures int := 0;
  claims_a text; claims_b text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'avora_invite_pepper') then
    raise exception 'kt07a_loi_moi failures=1 (thiếu secret avora_invite_pepper trong Vault)';
  end if;
  a := private.test_ephemeral_user('KT7A'); b := private.test_ephemeral_user('KT7B'); c := private.test_ephemeral_user('KT7C');
  update public.profiles set display_name = 'Minh Anh' where id = a;
  claims_a := json_build_object('sub', a, 'role', 'authenticated')::text;
  claims_b := json_build_object('sub', b, 'role', 'authenticated')::text;
  insert into public.contact (owner_user_id, contact_type, name, phone, email, note)
  values (a, 'individual', 'Cô Lan', '0912 345 678', 'lan@example.invalid', 'Ghi chú riêng của A về cô Lan')
  returning id into k1;

  -- 1. prepare tạo bản nháp, chưa "đã mời"; sổ chưa ghi.
  begin
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    select * into r from public.prepare_contact_invite(k1, 'sms', null, false, false);
    reset role;
    t1 := r.invite_token; id1 := r.invite_id;
    select count(*) into n from private.invite_ledger where inviter_id = a;
    if r.status = 'draft' and not r.reused and n = 0
       and (select count(*) from private.contact_invite_key where invite_id = id1) = 2 then
      out := out || E'ok   prepare → bản nháp, sổ chưa ghi, khoá theo số + email\n';
    else failures := failures + 1; out := out || format(E'FAIL prepare: %s ledger=%s\n', r, n); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL prepare: %s\n', sqlerrm); end;

  -- 2. "Chưa gửi" → bỏ bản nháp, không tính.
  begin
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    perform public.discard_invite_draft(id1);
    reset role;
    if not exists (select 1 from public.contact_invite where id = id1) and not exists (select 1 from private.invite_ledger where inviter_id = a) then
      out := out || E'ok   Chưa gửi → bản nháp bỏ, không vào sổ\n';
    else failures := failures + 1; out := out || E'FAIL bản nháp còn\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL discard: %s\n', sqlerrm); end;

  -- 3. Đã gửi → pending, sent_at, sổ +1; prepare lần nữa trả lại đúng lời mời (không tạo thêm).
  begin
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    select * into r from public.prepare_contact_invite(k1, 'sms', null, false, false); id1 := r.invite_id; t1 := r.invite_token;
    select * into r from public.confirm_invite_sent(id1);
    select * into r from public.prepare_contact_invite(k1, 'email', null, false, false);
    reset role;
    select count(*) into n from public.contact_invite where invited_by = a;
    if r.reused and r.invite_token = t1 and r.status = 'pending' and n = 1
       and (select sent_at is not null and status = 'pending' from public.contact_invite where id = id1)
       and (select min(invites) = 1 from private.invite_ledger where inviter_id = a) then
      out := out || E'ok   Đã gửi → pending + sổ; mời lần 2 dùng lại lời mời đang chờ\n';
    else failures := failures + 1; out := out || format(E'FAIL confirm/reuse: %s n=%s\n', r, n); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL confirm: %s\n', sqlerrm); end;

  -- 4. Xoá liên hệ, thêm lại với số viết khác (+84…): vẫn là lời mời đang chờ đó.
  begin
    delete from public.contact where id = k1;
    insert into public.contact (owner_user_id, contact_type, name, phone) values (a, 'individual', 'Lan', '+84912345678') returning id into k2;
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    select * into r from public.prepare_contact_invite(k2, 'link', null, false, false);
    reset role;
    if r.reused and r.invite_token = t1 and exists (select 1 from public.contact_invite where id = id1 and contact_id = k2) then
      out := out || E'ok   xoá liên hệ + thêm lại (số khác dạng) không tạo lời mời mới\n';
    else failures := failures + 1; out := out || format(E'FAIL xoá-thêm lại: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL xoá-thêm lại: %s\n', sqlerrm); end;

  -- 5. Người chưa có tài khoản (anon): xem trước được, không thấy số/email; không gọi được hàm khác.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;
    select * into r from public.preview_invite_public(t1);
    reset role;
    if r.inviter_name = 'Minh Anh' and r.status = 'pending' and not r.signed_in and not r.is_own_invite
       and not has_function_privilege('anon', 'public.prepare_contact_invite(uuid, text, text, boolean, boolean)', 'execute')
       and not has_function_privilege('anon', 'public.accept_invite(text)', 'execute')
       and not has_function_privilege('anon', 'public.confirm_invite_sent(uuid)', 'execute')
       and has_function_privilege('anon', 'public.decline_invite(text)', 'execute')
       and not has_table_privilege('authenticated', 'public.contact_invite', 'insert')
       and not has_table_privilege('authenticated', 'private.invite_ledger', 'select') then
      out := out || E'ok   anon xem trước (tên người mời), quyền tối thiểu\n';
    else failures := failures + 1; out := out || format(E'FAIL anon preview: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL anon preview: %s\n', sqlerrm); end;

  -- 6. Từ chối không cần tài khoản → declined, sổ ghi; nhận lời sau đó bị chặn.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;
    v := public.decline_invite(t1);
    reset role;
    perform set_config('request.jwt.claims', claims_b, true); set local role authenticated;
    begin
      perform public.accept_invite(t1); reset role;
      failures := failures + 1; out := out || E'FAIL nhận lời được lời mời đã từ chối\n';
    exception when others then
      reset role;
      if v = 'declined' and sqlerrm like '%từ chối%' and (select max(declines) = 1 from private.invite_ledger where inviter_id = a) then
        out := out || E'ok   Từ chối (anon) → declined, sổ ghi, không nhận lời được nữa\n';
      else failures := failures + 1; out := out || format(E'FAIL decline: %s %s\n', v, sqlerrm); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL decline: %s\n', sqlerrm); end;

  -- 7. Mời lại người đã từ chối: chặn khi không chủ động / trong lô / thiếu lời nhắn / lời nhắn có link;
  --    xoá liên hệ cũng không lách được.
  begin
    delete from public.contact where id = k2;
    insert into public.contact (owner_user_id, contact_type, name, email) values (a, 'individual', 'Lan mới', 'LAN@example.invalid ') returning id into k3;
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    v := '';
    begin perform public.prepare_contact_invite(k3, 'email', null, false, false); v := v || 'plain-ok '; exception when others then v := v || sqlerrm || ' '; end;
    begin perform public.prepare_contact_invite(k3, 'email', 'Cô ơi con mời lại cô nhé', true, true); v := v || 'batch-ok '; exception when others then v := v || sqlerrm || ' '; end;
    begin perform public.prepare_contact_invite(k3, 'email', null, true, false); v := v || 'nonote-ok '; exception when others then v := v || sqlerrm || ' '; end;
    begin perform public.prepare_contact_invite(k3, 'email', 'Cô xem ở avora.vn nhé cô', true, false); v := v || 'link-ok '; exception when others then v := v || sqlerrm || ' '; end;
    reset role;
    if v = 'avora_invite_declined avora_invite_declined_not_in_batch avora_invite_note_required avora_invite_note_invalid ' then
      out := out || E'ok   người đã từ chối: chỉ mời lại từng người, chủ động, có lời nhắn (xoá liên hệ không lách)\n';
    else failures := failures + 1; out := out || format(E'FAIL luật mời lại: %s\n', v); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL luật mời lại: %s\n', sqlerrm); end;

  -- 8. Mời lại đúng luật được; lần thứ hai trong 30 ngày bị chặn.
  begin
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    select * into r from public.prepare_contact_invite(k3, 'email', 'Cô ơi, con mời lại cô vào cùng nhà mình nhé.', true, false);
    id2 := r.invite_id; t2 := r.invite_token;
    perform public.confirm_invite_sent(id2);
    reset role;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;
    perform public.decline_invite(t2);
    reset role;
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    v := '';
    begin perform public.prepare_contact_invite(k3, 'email', 'Con xin mời cô thêm một lần nữa ạ.', true, false); exception when others then v := sqlerrm; end;
    reset role;
    if (select is_reinvite and note is not null from public.contact_invite where id = id2) and v = 'avora_invite_reinvite_too_soon' then
      out := out || E'ok   mời lại có lời nhắn được; lần nữa trong 30 ngày bị chặn\n';
    else failures := failures + 1; out := out || format(E'FAIL mời lại: %s\n', v); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL mời lại: %s\n', sqlerrm); end;

  -- 9. accept_invite (lỗi 1): liên hệ ngược không có ghi chú / số / email của liên hệ người mời.
  --    Lời mời mới cho C, mở link khi còn là bản nháp vẫn nhận được (mở link = đã gửi).
  begin
    insert into public.contact (owner_user_id, contact_type, name, phone, email, note)
    values (a, 'individual', 'Chú Tư', '0987000111', 'tu@example.invalid', 'Chú Tư hay quên, nhắc trước 2 ngày')
    returning id into k1;
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    select * into r from public.prepare_contact_invite(k1, 'sms', null, false, false);
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true); set local role authenticated;
    id2 := public.accept_invite(r.invite_token);
    reset role;
    select count(*) into n from public.contact x where x.id = id2 and x.owner_user_id = c and x.linked_user_id = a
      and x.name = 'Minh Anh' and x.note is null and x.phone is null and x.email is null;
    if n = 1 and (select linked_user_id = c and status = 'accepted' from public.contact k join public.contact_invite i on i.contact_id = k.id where k.id = k1 and i.id = r.invite_id)
       and exists (select 1 from public.user_connections where user_low = least(a, c) and user_high = greatest(a, c) and status = 'active') then
      out := out || E'ok   nhận lời: liên hệ ngược chỉ có tên + liên kết (không lộ ghi chú/số/email)\n';
    else failures := failures + 1; out := out || format(E'FAIL nhận lời: n=%s\n', n); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL nhận lời: %s\n', sqlerrm); end;

  -- 10. Hàm cũ create_contact_invite đi qua cùng luật (đã từ chối → chặn) và tự xác nhận.
  begin
    insert into public.contact (owner_user_id, contact_type, name, email) values (a, 'individual', 'Lan bản cũ', 'lan@example.invalid') returning id into k2;
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    v := '';
    begin perform public.create_contact_invite(k2, 'email'); v := 'ok'; exception when others then v := sqlerrm; end;
    insert into public.contact (owner_user_id, contact_type, name, phone) values (a, 'individual', 'Người mới', '0900000222') returning id into k3;
    t2 := public.create_contact_invite(k3, 'sms');
    reset role;
    if v = 'avora_invite_declined' and (select status = 'pending' and sent_at is not null from public.contact_invite where invite_token = t2) then
      out := out || E'ok   create_contact_invite (bản cũ) theo cùng luật\n';
    else failures := failures + 1; out := out || format(E'FAIL bản cũ: %s\n', v); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL bản cũ: %s\n', sqlerrm); end;

  -- 11. Người mời không tự từ chối; người khác không xác nhận/bỏ được lời mời của A.
  begin
    perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
    v := '';
    begin perform public.decline_invite(t2); v := 'ok'; exception when others then v := sqlerrm; end;
    reset role;
    perform set_config('request.jwt.claims', claims_b, true); set local role authenticated;
    begin perform public.confirm_invite_sent((select id from public.contact_invite where invite_token = t2)); v := v || ' b-ok'; exception when others then v := v || ' ' || sqlerrm; end;
    select count(*) into n from public.contact_invite;  -- RLS: B chỉ thấy lời mời của B
    reset role;
    if v = 'avora_invite_own avora_invite_missing' and n = 0 then out := out || E'ok   không tự từ chối; B không đụng được lời mời của A\n';
    else failures := failures + 1; out := out || format(E'FAIL quyền: %s n=%s\n', v, n); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL quyền: %s\n', sqlerrm); end;

  -- 12. Hàm mới đều qua cổng phiên + search_path rỗng.
  begin
    select count(*) into n from private.session_guard_gaps() g where g.name in ('prepare_contact_invite','confirm_invite_sent','discard_invite_draft','preview_invite_public','decline_invite','create_contact_invite','accept_invite');
    if n = 0 and not exists (select 1 from pg_proc p where p.proname in ('prepare_contact_invite','confirm_invite_sent','discard_invite_draft','preview_invite_public','decline_invite','invite_pepper','invite_recipient_keys')
         and p.prosecdef and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])) then
      out := out || E'ok   cổng phiên + search_path rỗng\n';
    else failures := failures + 1; out := out || format(E'FAIL guard gaps=%s\n', n); end if;
  end;

  raise exception E'%kt07a_loi_moi failures=%', out, failures;
end $test$;
