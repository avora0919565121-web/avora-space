-- Nhà mới · Két sắt không ép đặt mã. Chưa có mã → Tài chính mở cho chủ; có mã → như cũ (khoá theo phiên);
-- Giấy tờ (vault_items) vẫn cần mã; người khác không bao giờ đọc được. Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; b uuid; acc uuid; cat uuid; n int; out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('NM-A'); b := private.test_ephemeral_user('NM-B'); acc := gen_random_uuid();

  -- 1. Chưa có mã: A ghi và đọc được Tài chính của mình (RLS + RPC).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.ensure_default_categories();
    select id into cat from public.categories where user_id = a and applies_to = 'expense' limit 1;
    insert into public.accounts (id, user_id, name, type, currency) values (acc, a, 'Tiền mặt', 'cash', 'VND');
    insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date) values (a, acc, cat, 'expense', 45000, current_date);
    select count(*) into n from public.transactions where user_id = a;
    reset role;
    if n = 1 and cat is not null then out := out || E'ok   chưa có mã: ghi và đọc được Tài chính\n';
    else failures := failures + 1; out := out || format(E'FAIL chưa có mã: thấy %s giao dịch, danh mục %s\n', n, cat); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL chưa có mã: %s\n', sqlerrm); end;

  -- 2. Người khác (B) không thấy gì của A.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions where user_id = a;
    reset role;
    if n = 0 then out := out || E'ok   người khác không thấy Tài chính\n';
    else failures := failures + 1; out := out || E'FAIL người khác thấy Tài chính\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL người khác: %s\n', sqlerrm); end;

  -- 3. Chưa có mã: vẫn không cất được Giấy tờ (vault_items cần mã để mã hoá).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.vault_items;
    reset role;
    if n = 0 and not private.vault_is_unlocked() then out := out || E'ok   Giấy tờ vẫn cần mã\n';
    else failures := failures + 1; out := out || E'FAIL Giấy tờ mở khi chưa có mã\n'; end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL Giấy tờ: %s\n', sqlerrm); end;

  -- 4. Có mã, phiên chưa mở: Tài chính khoá lại như trước (đọc 0 dòng, RPC báo avora_vault_locked).
  begin
    insert into private.vault_secrets (user_id, code_hash) values (a, extensions.crypt('246813', extensions.gen_salt('bf', 4)));
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
    set local role authenticated;
    select count(*) into n from public.transactions where user_id = a;
    begin
      perform public.ensure_default_categories();
      reset role;
      failures := failures + 1; out := out || E'FAIL có mã: RPC chạy khi Két sắt khoá\n';
    exception when others then
      reset role;
      if sqlerrm = 'avora_vault_locked' and n = 0 then out := out || E'ok   có mã: Tài chính khoá như cũ\n';
      else failures := failures + 1; out := out || format(E'FAIL có mã: %s, thấy %s\n', sqlerrm, n); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL có mã: %s\n', sqlerrm); end;

  -- 5. Hàm mới không mở cho khách.
  if has_function_privilege('anon', 'private.finance_is_open()', 'execute') or has_function_privilege('authenticated', 'private.vault_has_code(uuid)', 'execute') then
    failures := failures + 1; out := out || E'FAIL hàm mới mở quá rộng\n';
  else out := out || E'ok   hàm mới đúng quyền\n'; end if;

  raise exception E'NHA_MOI_FINANCE failures=%\n%', failures, out;
end $test$;
