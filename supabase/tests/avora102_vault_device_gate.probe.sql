do $$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d'; b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  s1 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); r jsonb; log text := ''; ok boolean; n int; msg text;
  procedure_names text[] := array['vault_set_code','vault_confirm_reset','vault_request_reset','vault_reset_code_by_passphrase','vault_unlock','vault_prove','vault_setup'];
begin
  -- clean slate for A inside the rollback block
  delete from public.account_devices where user_id in (a, b);
  delete from public.account_device_lock where user_id in (a, b);
  delete from private.vault_secrets where user_id in (a, b);
  delete from private.vault_proof_attempts where user_id in (a, b);
  delete from private.vault_proofs where user_id in (a,b);
  update public.profiles set vault_other_devices_allowed = false where id in (a, b);
  insert into public.account_devices (user_id, device_id, device_public_key, rank, session_id) values (a, gen_random_uuid(), 'k1', 1, s1), (a, gen_random_uuid(), 'k3', 3, s3);

  set local role authenticated;
  -- 102.1 : rank-3 session
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s3)::text, true);
  r := public.vault_status(); log := log || format(E'102.1 status device_allowed=%s bound=%s main=%s\n', r->>'device_allowed', r->>'device_bound', r->>'has_main_device');
  begin perform public.vault_set_code('123456'); log := log || format(E'102.1 set_code FAIL (allowed)\n'); exception when others then log := log || format(E'102.1 set_code -> %s\n', sqlerrm); end;
  begin perform public.vault_confirm_reset('000000','123456'); log := log || format(E'102.1 confirm_reset FAIL\n'); exception when others then log := log || format(E'102.1 confirm_reset -> %s\n', sqlerrm); end;
  begin perform public.vault_request_reset(); log := log || format(E'102.1 request_reset FAIL\n'); exception when others then log := log || format(E'102.1 request_reset -> %s\n', sqlerrm); end;
  begin perform public.vault_reset_code_by_passphrase('123456'); log := log || format(E'102.1 by_pass FAIL\n'); exception when others then log := log || format(E'102.1 reset_by_pass -> %s\n', sqlerrm); end;
  begin perform public.vault_prove('pass','x'); log := log || format(E'102.1 prove FAIL\n'); exception when others then log := log || format(E'102.1 prove -> %s\n', sqlerrm); end;
  begin perform public.vault_unlock('123456', null); log := log || format(E'102.1 unlock FAIL\n'); exception when others then log := log || format(E'102.1 unlock -> %s\n', sqlerrm); end;
  begin perform public.vault_register_device_share(gen_random_uuid()); log := log || format(E'102.1 share FAIL\n'); exception when others then log := log || format(E'102.1 share -> %s\n', sqlerrm); end;
  begin perform public.vault_setup('{}'::jsonb,'x','y'); log := log || format(E'102.1 setup FAIL\n'); exception when others then log := log || format(E'102.1 setup -> %s\n', sqlerrm); end;
  -- unbound session (no device row) is also refused while a main exists
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  begin perform public.vault_set_code('123456'); log := log || format(E'unbound set_code FAIL\n'); exception when others then log := log || format(E'unbound set_code -> %s\n', sqlerrm); end;

  -- 102.2 : rank-1 session sets, locks, unlocks
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s1)::text, true);
  r := public.vault_status(); log := log || format(E'102.2 rank1 device_allowed=%s\n', r->>'device_allowed');
  perform public.vault_set_code('246810'); perform public.vault_lock();
  r := public.vault_unlock('246810', null); log := log || format(E'102.2 unlock ok=%s\n', r->>'ok');
  -- 102.3 : new session, same device (re-bound) → still allowed
  reset role;
  update public.account_devices set session_id = s3 where user_id = a and rank = 1; -- re-login binds the same device to a new session
  update public.account_devices set session_id = null where user_id = a and rank = 3;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'session_id', s3)::text, true);
  r := public.vault_unlock('246810', null); log := log || format(E'102.3 new session unlock ok=%s\n', r->>'ok');

  -- 102.5 : 6 right proofs in a row
  reset role;
  insert into private.vault_proofs (user_id, pass_proof_hash, rec_proof_hash) values (a, extensions.crypt('RIGHTPROOF', extensions.gen_salt('bf', 4)), extensions.crypt('REC', extensions.gen_salt('bf', 4)));
  set local role authenticated;
  for i in 1..6 loop ok := public.vault_prove('pass', 'RIGHTPROOF'); log := log || format(E'102.5 right #%s -> %s\n', i, ok); end loop;
  for i in 1..5 loop ok := public.vault_prove('pass', 'WRONG'); end loop;
  begin ok := public.vault_prove('pass', 'RIGHTPROOF'); log := log || format(E'102.5 after 5 wrong FAIL (should wait)\n'); exception when others then log := log || format(E'102.5 after 5 wrong -> %s\n', sqlerrm); end;

  -- 102.8 : B has no main device at all
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  r := public.vault_status(); log := log || format(E'102.8 B allowed=%s main=%s\n', r->>'device_allowed', r->>'has_main_device');
  perform public.vault_set_code('135790'); perform public.vault_lock();
  r := public.vault_unlock('135790', null); log := log || format(E'102.8 B unlock ok=%s\n', r->>'ok');

  -- anon
  reset role; set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform public.vault_set_code('123456'); log := log || format(E'anon FAIL\n'); exception when others then log := log || format(E'anon set_code -> %s\n', sqlerrm); end;
  raise exception 'PROBE%', E'\n' || log;
end $$;
