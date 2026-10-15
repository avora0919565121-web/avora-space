-- AVORA-117 — gỡ / chuyển / gắn liên kết liên hệ ↔ tài khoản. Ghi thật trên public.contact trong một giao
-- dịch, luôn rollback. A chủ danh bạ (testera) · B bạn của A (testerb), là tài khoản được liên kết.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  x uuid := gen_random_uuid();  -- liên hệ bị gắn nhầm
  y uuid := gen_random_uuid();  -- liên hệ đúng
  z uuid := gen_random_uuid();  -- liên hệ khác, đã gắn với chính A (để thử "đích đã có liên kết")
  biz uuid := gen_random_uuid();
  bx uuid := gen_random_uuid(); -- liên hệ của B
  b_email text;
  before_x jsonb;
  after_x jsonb;
  chg uuid;
  log text := '';
  failures int := 0;
  ok boolean;
  err text;
begin
  select email into b_email from auth.users where id = b;
  insert into public.user_connections (user_low, user_high, status, source)
  values (least(a, b), greatest(a, b), 'active', 'pin')
  on conflict (user_low, user_high) do update set status = 'active', removed_at = null;
  update public.contact set linked_user_id = null where owner_user_id = a and linked_user_id is not null;
  insert into public.contact (id, owner_user_id, contact_type, name, phone, email, note, relationship_tag, linked_user_id)
  values (x, a, 'individual', 'Liên hệ gắn nhầm', '0900000117', b_email, 'ghi chú giữ nguyên', 'Bạn bè', b),
         (y, a, 'individual', 'Liên hệ đúng', '0900000118', null, null, null, null),
         (z, a, 'individual', 'Đã gắn', '0900000119', null, null, null, null);
  insert into public.contact (id, owner_user_id, contact_type, name, phone, tax_code, representative_name)
  values (biz, a, 'business', 'Công ty thử', '0900000120', '0100000117', 'Người đại diện');
  insert into public.contact (id, owner_user_id, contact_type, name, phone) values (bx, b, 'individual', 'Của B', '0900000121');
  select to_jsonb(c) - 'linked_user_id' - 'link_suggestion_dismissed' - 'updated_at' into before_x from public.contact c where c.id = x;

  -- ---------------------------------------------------------------- máy khách không sửa thẳng
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin update public.contact set linked_user_id = b where id = y; exception when others then ok := sqlerrm = 'avora_contact_link_server_only'; end;
  begin update public.contact set linked_user_id = null where id = x; ok := false; exception when others then ok := ok and sqlerrm = 'avora_contact_link_server_only'; end;
  begin insert into public.contact (owner_user_id, contact_type, name, phone, linked_user_id) values (a, 'individual', 'Lén', '0900000122', b); ok := false;
  exception when others then ok := ok and sqlerrm = 'avora_contact_link_server_only'; end;
  -- Sửa cột khác vẫn được như cũ (ví dụ bảng cơ hội ghi thẳng contact).
  update public.contact set note = 'ghi chú giữ nguyên' where id = x;
  ok := ok and found;
  log := log || format(E'%s linked_user_id không sửa/chèn thẳng được; cột khác vẫn sửa được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- người khác không gỡ / chuyển được
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin perform public.unlink_contact(x); exception when others then ok := sqlerrm = 'avora_contact_not_yours'; end;
  begin perform public.relink_contact(x, bx); ok := false; exception when others then ok := ok and sqlerrm = 'avora_contact_not_yours'; end;
  reset role;
  ok := ok and (select linked_user_id from public.contact where id = x) = b;
  log := log || format(E'%s người không phải chủ không gỡ/chuyển được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- lỗi có mã rõ
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  for err in select unnest(array['same', 'biz', 'notlinked']) loop
    begin
      if err = 'same' then perform public.relink_contact(x, x);
      elsif err = 'biz' then perform public.relink_contact(x, biz);
      else perform public.relink_contact(y, z); end if;
      ok := false;
    exception when others then
      ok := ok and sqlerrm = case err when 'same' then 'avora_contact_same' when 'biz' then 'avora_contact_not_individual' else 'avora_contact_not_linked' end;
    end;
  end loop;
  reset role;
  log := log || format(E'%s mã lỗi: trùng id · đích doanh nghiệp · nguồn chưa liên kết\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- ràng buộc duy nhất
  ok := false;
  begin update public.contact set linked_user_id = b where id = y; exception when unique_violation then ok := true; end;
  log := log || format(E'%s một tài khoản không gắn được với hai liên hệ của cùng một chủ\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- đích đã có liên kết
  update public.contact set linked_user_id = a where id = z; -- (hệ thống) z gắn tạm với chính A để làm đích "đã liên kết"
  set local role authenticated;
  ok := false;
  begin perform public.relink_contact(x, z); exception when others then ok := sqlerrm = 'avora_contact_target_linked'; end;
  reset role;
  ok := ok and (select linked_user_id from public.contact where id = x) = b;
  log := log || format(E'%s đích đã có liên kết bị từ chối, nguồn giữ nguyên\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  update public.contact set linked_user_id = null where id = z;

  -- ---------------------------------------------------------------- nguyên tử: lỗi giữa chừng
  create function pg_temp.fail_on_y() returns trigger language plpgsql as $f$
  begin if new.linked_user_id is not null and new.name = 'Liên hệ đúng' then raise exception 'boom_giua_chung'; end if; return new; end $f$;
  create trigger zz_fail_on_y before update on public.contact for each row execute function pg_temp.fail_on_y();
  set local role authenticated;
  ok := false;
  begin perform public.relink_contact(x, y); exception when others then ok := sqlerrm = 'boom_giua_chung'; end;
  reset role;
  drop trigger zz_fail_on_y on public.contact;
  ok := ok and (select linked_user_id from public.contact where id = x) = b
           and (select linked_user_id from public.contact where id = y) is null
           and (select count(*) from public.contact_link_changes where owner_user_id = a and from_contact_id = x) = 0;
  log := log || format(E'%s chuyển nguyên tử: lỗi ở bước gắn → nguồn vẫn gắn, đích vẫn trống, không có dòng kiểm toán\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- chuyển thật
  set local role authenticated;
  chg := public.relink_contact(x, y);
  reset role;
  select to_jsonb(c) - 'linked_user_id' - 'link_suggestion_dismissed' - 'updated_at' into after_x from public.contact c where c.id = x;
  ok := (select linked_user_id from public.contact where id = x) is null
    and (select linked_user_id from public.contact where id = y) = b
    and (select link_suggestion_dismissed from public.contact where id = y) is null
    and (select link_suggestion_dismissed from public.contact where id = x) = private.contact_link_fingerprint(x, b)
    and before_x = after_x;
  log := log || format(E'%s chuyển x → y: y gắn với B, x giữ nguyên mọi cột khác (tên, số, email, ghi chú, nhãn)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  set local role authenticated;
  ok := (select count(*) from public.contact_link_changes where id = chg and kind = 'relink' and from_contact_id = x and to_contact_id = y) = 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := ok and (select count(*) from public.contact_link_changes where id = chg) = 0;
  reset role;
  ok := ok and (select count(*) from public.push_outbox where created_at > now() - interval '1 minute' and user_id = b) = 0;
  log := log || format(E'%s kiểm toán: A đọc được dòng của mình; B không thấy và không nhận thông báo nào\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- hoàn tác chuyển
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.undo_contact_link_change(chg);
  ok := (select linked_user_id from public.contact where id = x) = b and (select linked_user_id from public.contact where id = y) is null;
  begin perform public.undo_contact_link_change(chg); ok := false; exception when others then ok := ok and sqlerrm = 'avora_contact_undo_expired'; end;
  reset role;
  log := log || format(E'%s hoàn tác chuyển trả về như cũ; hoàn tác lần hai bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- gỡ + dấu vân tay
  set local role authenticated;
  chg := public.unlink_contact(x);
  select to_jsonb(c) - 'linked_user_id' - 'link_suggestion_dismissed' - 'updated_at' into after_x from public.contact c where c.id = x;
  ok := (select linked_user_id from public.contact where id = x) is null and before_x = after_x
    -- x có email của B, B không còn gắn ở đâu: không có dấu vân tay thì gợi ý sẽ quay lại.
    and public.preview_contact_link(x) is null
    and public.preview_contact_link(y) is null;
  begin perform public.unlink_contact(x); ok := false; exception when others then ok := ok and sqlerrm = 'avora_contact_not_linked'; end;
  reset role;
  update public.contact set email = b_email where id = y;
  set local role authenticated;
  ok := ok and public.preview_contact_link(y) = 'email';
  reset role;
  update public.contact set email = null where id = y;
  log := log || format(E'%s gỡ: liên hệ giữ nguyên; gợi ý đúng cặp cũ không quay lại (liên hệ khác cùng email vẫn được gợi ý)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  set local role authenticated;
  perform public.undo_contact_link_change(chg);
  ok := (select linked_user_id from public.contact where id = x) = b;
  reset role;
  log := log || format(E'%s hoàn tác gỡ gắn lại đúng người\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- gắn từ phía người
  set local role authenticated;
  ok := false;
  begin perform public.link_contact_to_friend(y, b); exception when others then ok := sqlerrm = 'avora_contact_account_linked_elsewhere'; end;
  perform public.unlink_contact(x);
  chg := public.link_contact_to_friend(y, b);
  ok := ok and (select linked_user_id from public.contact where id = y) = b;
  reset role;
  delete from public.user_connections where user_low = least(a, b) and user_high = greatest(a, b);
  set local role authenticated;
  perform public.unlink_contact(y);
  begin perform public.link_contact_to_friend(z, b); ok := false; exception when others then ok := ok and sqlerrm = 'avora_contact_not_friend'; end;
  reset role;
  log := log || format(E'%s gắn với bạn: chỉ khi đang là bạn và tài khoản chưa gắn liên hệ khác\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false;
  begin perform public.unlink_contact(x); exception when insufficient_privilege then ok := true; end;
  begin perform public.relink_contact(x, y); ok := false; exception when insufficient_privilege then ok := ok; end;
  reset role;
  log := log || format(E'%s anon không gọi được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA117 failures=%\n%', failures, log;
end $test$;
