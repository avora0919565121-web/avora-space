-- Nhà mới · Mật khẩu: ngăn 'passwords' nhận mục; khoá ngăn chỉ được THÊM, không ghi đè; cần Két sắt mở;
-- Avora AI ở "Sắp có". Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; sid uuid := gen_random_uuid(); ok boolean; n int; out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('NM-P');
  insert into public.vault_keyring (user_id, mk_wrapped_pass, salt_pass, kdf_params, mk_wrapped_rec, salt_rec, rec_check, section_keys, key_version)
    values (a, 'x', 'x', '{"m":65536}', 'x', 'x', 'x', '{"certificates":"c","documents":"d","assets":"s"}', 1);
  insert into private.vault_secrets (user_id, code_hash) values (a, extensions.crypt('246813', extensions.gen_salt('bf', 4)));
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', sid)::text, true);

  -- 1. Két sắt đang khoá: không thêm được khoá ngăn.
  begin
    perform public.vault_add_section_key('passwords', repeat('k', 80));
    failures := failures + 1; out := out || E'FAIL thêm khoá ngăn khi Két sắt khoá\n';
  exception when others then
    if sqlerrm in ('avora_vault_locked', 'avora_session_not_allowed', 'avora_device_unbound') then out := out || format(E'ok   khoá ngăn cần Két sắt mở (%s)\n', sqlerrm);
    else failures := failures + 1; out := out || format(E'FAIL khi khoá: %s\n', sqlerrm); end if;
  end;

  -- 2–4. Mở phiên (như vault_unlock), thêm lần đầu = true, lần hai = false và khoá cũ còn nguyên; ngăn lạ bị từ chối.
  insert into private.vault_unlocks (user_id, session_id, expires_at) values (a, sid, now() + interval '5 minutes');
  begin
    ok := public.vault_add_section_key('passwords', repeat('k', 80));
    if ok then out := out || E'ok   thêm khoá ngăn passwords\n'; else failures := failures + 1; out := out || E'FAIL lần đầu trả false\n'; end if;
    ok := public.vault_add_section_key('passwords', repeat('z', 80));
    if not ok and (select section_keys ->> 'passwords' from public.vault_keyring where user_id = a) = repeat('k', 80)
       and (select section_keys ->> 'documents' from public.vault_keyring where user_id = a) = 'd'
    then out := out || E'ok   không ghi đè khoá đã có\n'; else failures := failures + 1; out := out || E'FAIL ghi đè khoá ngăn\n'; end if;
    begin
      perform public.vault_add_section_key('documents', repeat('k', 80));
      failures := failures + 1; out := out || E'FAIL nhận ngăn ngoài danh sách\n';
    exception when others then out := out || E'ok   ngăn ngoài danh sách bị từ chối\n'; end;
  exception when others then
    if sqlerrm in ('avora_session_not_allowed', 'avora_device_unbound', 'avora_vault_device_not_allowed') then out := out || format(E'skip phiên thử không có máy (%s)\n', sqlerrm);
    else failures := failures + 1; out := out || format(E'FAIL thêm khoá: %s\n', sqlerrm); end if;
  end;

  -- 5. Ngăn 'passwords' nhận mục (ràng buộc mới); ngăn lạ vẫn bị chặn.
  begin
    insert into public.vault_items (owner_user_id, section, ciphertext, wrapped_item_key) values (a, 'passwords', 'c', 'w');
    out := out || E'ok   vault_items nhận section passwords\n';
  exception when others then failures := failures + 1; out := out || format(E'FAIL passwords: %s\n', sqlerrm); end;
  begin
    insert into public.vault_items (owner_user_id, section, ciphertext, wrapped_item_key) values (a, 'cards', 'c', 'w');
    failures := failures + 1; out := out || E'FAIL nhận section lạ\n';
  exception when check_violation then out := out || E'ok   section lạ vẫn bị chặn\n'; end;

  -- 6. Quyền và công tắc.
  if has_function_privilege('anon', 'public.vault_add_section_key(text, text)', 'execute') then
    failures := failures + 1; out := out || E'FAIL anon gọi được vault_add_section_key\n';
  else out := out || E'ok   anon không gọi được\n'; end if;
  if (select status from public.app_features where key = 'avora_ai') = 'soon' then out := out || E'ok   Avora AI = Sắp có\n';
  else failures := failures + 1; out := out || E'FAIL Avora AI chưa Sắp có\n'; end if;

  raise exception E'NHA_MOI_PASSWORDS failures=%\n%', failures, out;
end $test$;
