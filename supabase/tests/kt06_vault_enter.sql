-- KT-06 · A: vault_enter (khoá + trạng thái một lời gọi), device_session (chỉ xin nonce khi cần),
-- lần chứng minh máy có hạn 12 giờ ở cửa Két sắt. Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; b uuid; s1 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s9 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); r jsonb; n int; out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('KT6-A'); b := private.test_ephemeral_user('KT6-B');
  insert into public.account_devices (user_id, device_id, device_public_key, rank, session_id) values
    (a, d1, 'k1', 1, s1), (a, d3, 'k3', 3, s3);

  -- 1. Máy chính, phiên đã chứng minh: vault_enter khoá rồi đọc trong một lời gọi, device_proven = true.
  begin
    insert into private.vault_secrets (user_id, code_hash) values (a, extensions.crypt('246813', extensions.gen_salt('bf', 4)));
    insert into private.vault_unlocks (user_id, session_id, expires_at) values (a, s1, now() + interval '5 minutes');
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, true);
    reset role;
    if (r->>'device_proven')::boolean and not (r->>'unlocked')::boolean and (r->>'has_code')::boolean and (r->>'device_allowed')::boolean
       and not exists (select 1 from private.vault_unlocks where user_id = a and session_id = s1) then
      out := out || E'ok   máy chính: vault_enter khoá + đọc, device_proven\n';
    else failures := failures + 1; out := out || format(E'FAIL máy chính: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL máy chính: %s\n', sqlerrm); end;

  -- 2. p_lock = false: không khoá phiên đang mở.
  begin
    insert into private.vault_unlocks (user_id, session_id, expires_at) values (a, s1, now() + interval '5 minutes');
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, false);
    reset role;
    if (r->>'unlocked')::boolean then out := out || E'ok   p_lock=false giữ phiên đang mở\n';
    else failures := failures + 1; out := out || format(E'FAIL p_lock=false: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL p_lock=false: %s\n', sqlerrm); end;

  -- 3. Đưa device_id của máy khác: device_proven = false (không cấp quyền gì), quyền vẫn theo phiên.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.vault_enter(d3, false);
    reset role;
    if not (r->>'device_proven')::boolean then out := out || E'ok   device_id không khớp phiên → chưa chứng minh\n';
    else failures := failures + 1; out := out || format(E'FAIL device_id lạ được coi là đã chứng minh: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL device lạ: %s\n', sqlerrm); end;

  -- 4. Máy khác (Ưu tiên 3) dù đưa device_id của máy chính: Két sắt vẫn không cho mở.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s3)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, false);
    begin
      perform public.vault_unlock('246813', d1);
      reset role; failures := failures + 1; out := out || E'FAIL máy khác mở được Két sắt\n';
    exception when others then
      reset role;
      if sqlerrm = 'avora_vault_device_not_allowed' and not (r->>'device_allowed')::boolean and not (r->>'device_proven')::boolean then
        out := out || E'ok   máy khác vẫn bị chặn (device_allowed=false)\n';
      else failures := failures + 1; out := out || format(E'FAIL máy khác: %s %s\n', sqlerrm, r); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL máy khác: %s\n', sqlerrm); end;

  -- 5. Lần chứng minh quá 12 giờ: máy chính không còn được coi là máy chính tới khi ký lại.
  begin
    update public.account_devices set proved_at = now() - interval '13 hours' where user_id = a and device_id = d1;
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, true);
    begin
      perform public.vault_unlock('246813', d1);
      reset role; failures := failures + 1; out := out || E'FAIL chứng minh hết hạn vẫn mở được\n';
    exception when others then
      reset role;
      if sqlerrm = 'avora_vault_device_not_allowed' and not (r->>'device_proven')::boolean and not (r->>'device_allowed')::boolean then
        out := out || E'ok   chứng minh hết hạn → phải ký lại\n';
      else failures := failures + 1; out := out || format(E'FAIL hết hạn: %s %s\n', sqlerrm, r); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL hết hạn: %s\n', sqlerrm); end;

  -- 6. device_session: hết hạn → trả nonce (ghi vào device_challenges); device_bind ký lại → trong hạn, không nonce.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.device_session(d1);
    reset role;
    if (r->>'proven')::boolean or r->>'nonce' is null then
      failures := failures + 1; out := out || format(E'FAIL device_session hết hạn: %s\n', r);
    else
      perform public.device_bind(a, s1, d1, 'k1', r->>'nonce', 'Máy 1', 'phone', false);
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
      set local role authenticated;
      r := public.device_session(d1);
      perform public.vault_unlock('246813', d1);
      reset role;
      if (r->>'proven')::boolean and r->>'nonce' is null then out := out || E'ok   device_session: nonce khi cần, ký lại thì trong hạn + mở được\n';
      else failures := failures + 1; out := out || format(E'FAIL sau khi ký lại: %s\n', r); end if;
    end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL device_session: %s\n', sqlerrm); end;

  -- 7. Phiên chưa gắn máy: vault_enter báo device_proven=false, device_session trả nonce.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s9)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, false) || jsonb_build_object('s', public.device_session(d1));
    reset role;
    if not (r->>'device_proven')::boolean and not (r->>'device_bound')::boolean and (r->'s'->>'nonce') is not null then
      out := out || E'ok   phiên chưa gắn máy: chưa chứng minh, có nonce\n';
    else failures := failures + 1; out := out || format(E'FAIL phiên chưa gắn: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL phiên chưa gắn: %s\n', sqlerrm); end;

  -- 8. Người khác (B) không đọc được trạng thái của A; vault_enter của B chỉ nói về B.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'session_id', s1)::text, true);
    set local role authenticated;
    r := public.vault_enter(d1, true);
    reset role;
    if not (r->>'has_code')::boolean and not (r->>'device_proven')::boolean and exists (select 1 from private.vault_secrets where user_id = a) then
      out := out || E'ok   B chỉ thấy Két sắt của B\n';
    else failures := failures + 1; out := out || format(E'FAIL B: %s\n', r); end if;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL B: %s\n', sqlerrm); end;

  -- 9. Quyền: anon không gọi được; device_bind chỉ service_role; hàm mới SECURITY DEFINER + search_path ''.
  if has_function_privilege('anon', 'public.vault_enter(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.device_session(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.device_bind(uuid, uuid, uuid, text, text, text, text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'private.device_proof_ttl()', 'execute')
     or not has_function_privilege('authenticated', 'public.vault_enter(uuid, boolean)', 'execute')
     or exists (select 1 from pg_proc p where p.oid in ('public.vault_enter(uuid, boolean)'::regprocedure, 'public.device_session(uuid)'::regprocedure)
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']))
     or has_column_privilege('authenticated', 'public.account_devices', 'proved_at', 'select') then
    failures := failures + 1; out := out || E'FAIL quyền hàm / cột mới\n';
  else out := out || E'ok   quyền tối thiểu, search_path rỗng, proved_at không lộ ra client\n'; end if;

  raise exception E'KT06_VAULT_ENTER failures=%\n%', failures, out;
end $test$;
