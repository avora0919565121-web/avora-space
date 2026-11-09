-- 111-B · đo session_allowed (trước / sau khoá tài khoản). Chạy trong giao dịch, không ghi gì.
do $$
declare
  v_uid uuid := (select id from auth.users where email like 'testera%' limit 1);
  t0 timestamptz; v_calls numeric; v_query numeric; n int;
  i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  -- warm-up
  perform private.session_allowed() from generate_series(1, 200);
  t0 := clock_timestamp();
  perform private.session_allowed() from generate_series(1, 5000);
  v_calls := extract(epoch from clock_timestamp() - t0) * 1e6 / 5000;
  t0 := clock_timestamp();
  for i in 1..50 loop
    select count(*) into n from public.messages;
  end loop;
  v_query := extract(epoch from clock_timestamp() - t0) * 1000 / 50;
  raise exception 'MEASURE per_call_us=% messages_count_ms=% rows=%', round(v_calls, 2), round(v_query, 3), n;
end $$;
