-- KT-08 · QA05-01: "hôm nay" của khoản thu/chi theo múi giờ hồ sơ, không theo UTC; ví "Tiền mặt" chỉ có
-- khi khoản ghi thành công. Giả lập 00:30 giờ VN. Luôn rollback (raise ở cuối).
do $test$
declare
  a uuid; cat uuid; acc uuid; res jsonb; n int; zone text; local_today date; h int;
  vn_0030 constant timestamptz := '2026-11-12 17:30:00+00';  -- = 00:30 ngày 13/11 giờ VN, còn 12/11 theo UTC
  out text := ''; failures int := 0;
begin
  a := private.test_ephemeral_user('KT8-01');
  -- Staging bật invite_required: người thử tạo sau mốc đó coi như tài khoản cũ (chỉ trong giao dịch này).
  update public.profiles set created_at = timestamptz '2020-01-01' where id = a;

  -- 1. Giả lập 00:30 VN: ngày 13/11 không phải tương lai (UTC lúc đó còn 12/11 — luật cũ chặn), 14/11 vẫn là tương lai.
  if (vn_0030 at time zone 'UTC')::date = date '2026-11-12'
     and not private.txn_date_is_future(a, date '2026-11-13', vn_0030)
     and private.txn_date_is_future(a, date '2026-11-14', vn_0030)
     and private.local_day('Asia/Ho_Chi_Minh', vn_0030) = date '2026-11-13' then
    out := out || E'ok   00:30 VN: ghi được ngày 13/11 (UTC còn 12/11), 14/11 vẫn bị chặn\n';
  else failures := failures + 1; out := out || E'FAIL 00:30 VN\n'; end if;

  -- 2. Cả khung 00:00–06:59 VN đều ghi được "hôm nay"; 07:00 trở đi vẫn đúng.
  begin
    select count(*) into n from generate_series(0, 23) as g(hr)
     where private.txn_date_is_future(a, date '2026-11-13', timestamptz '2026-11-12 17:00:00+00' + make_interval(hours => g.hr));
    if n = 0 then out := out || E'ok   mọi giờ trong ngày 13/11 VN đều nhận ngày 13/11\n';
    else failures := failures + 1; out := out || format(E'FAIL %s giờ trong ngày bị chặn\n', n); end if;
  end;

  -- 3. Múi giờ hồ sơ trống / không hợp lệ → Asia/Ho_Chi_Minh (không bao giờ chặt hơn).
  if private.local_day(null, vn_0030) = date '2026-11-13' and private.local_day('', vn_0030) = date '2026-11-13'
     and private.local_day('Mars/Olympus', vn_0030) = date '2026-11-13'
     and private.local_day('America/New_York', vn_0030) = date '2026-11-12' then
    out := out || E'ok   múi giờ trống/không hợp lệ → giờ VN; múi giờ khác tính theo múi đó\n';
  else failures := failures + 1; out := out || E'FAIL múi giờ dự phòng\n'; end if;

  -- 4. Trigger thật, bây giờ, qua RLS: đặt múi giờ hồ sơ sao cho ĐANG là 00:xx, ghi ngày hôm nay địa phương được;
  --    ngày mai địa phương vẫn bị chặn avora_txn_date_future.
  begin
    h := extract(hour from now() at time zone 'UTC')::int;
    zone := case when h >= 10 then format('Etc/GMT-%s', 24 - h) when h = 0 then 'UTC' else format('Etc/GMT+%s', h) end;
    update public.profiles set timezone = zone where id = a;
    local_today := private.local_day(zone, now());
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.ensure_default_categories();
    select id into cat from public.categories where user_id = a and applies_to = 'expense' limit 1;
    insert into public.accounts (user_id, name, type, currency) values (a, 'Ví thử', 'cash', 'VND') returning id into acc;
    insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date)
    values (a, acc, cat, 'expense', 45000, local_today);
    begin
      insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date)
      values (a, acc, cat, 'expense', 1000, local_today + 1);
      reset role; failures := failures + 1; out := out || E'FAIL ngày mai địa phương lọt qua\n';
    exception when others then
      reset role;
      if sqlerrm = 'avora_txn_date_future' and extract(hour from now() at time zone zone) = 0 then
        out := out || format(E'ok   trigger thật lúc 00:%s giờ %s: hôm nay %s ghi được, ngày mai bị chặn\n',
                             to_char(now() at time zone zone, 'MI'), zone, local_today);
      else failures := failures + 1; out := out || format(E'FAIL ngày mai: %s\n', sqlerrm); end if;
    end;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL trigger thật: %s\n', sqlerrm); end;

  -- 5. Múi giờ VN (mặc định), ngay bây giờ: ngày VN hôm nay luôn ghi được, kể cả khi UTC còn hôm qua.
  begin
    update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = a;
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date)
    values (a, acc, cat, 'expense', 2000, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    reset role;
    out := out || format(E'ok   hôm nay giờ VN (%s, UTC %s) ghi được\n', (now() at time zone 'Asia/Ho_Chi_Minh')::date, current_date);
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL hôm nay giờ VN: %s\n', sqlerrm); end;

  -- 6. record_first_expense: ghi lỗi (ngày tương lai) → KHÔNG có ví nào được tạo.
  declare b uuid; bcat uuid;
  begin
    b := private.test_ephemeral_user('KT8-01B');
    update public.profiles set created_at = timestamptz '2020-01-01' where id = b;
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.ensure_default_categories();
    select id into bcat from public.categories where user_id = b and applies_to = 'expense' limit 1;
    begin
      perform public.record_first_expense(bcat, 45000, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1, null, 'VND', 'Tiền mặt');
      out := out || E'FAIL ngày tương lai lọt qua\n'; failures := failures + 1;
    exception when others then
      if sqlerrm <> 'avora_txn_date_future' then failures := failures + 1; out := out || format(E'FAIL lỗi lạ: %s\n', sqlerrm); end if;
    end;
    select count(*) into n from public.accounts where user_id = b;
    if n = 0 then out := out || E'ok   ghi bị chặn → không tạo ví Tiền mặt\n';
    else failures := failures + 1; out := out || format(E'FAIL còn %s ví sau khi ghi lỗi\n', n); end if;

    -- 7. Ghi đúng → đúng 1 ví "Tiền mặt" + 1 khoản chi; lần 2 dùng lại ví, không tạo thêm.
    res := public.record_first_expense(bcat, 45000, (now() at time zone 'Asia/Ho_Chi_Minh')::date, ' chợ sáng ', 'VND', 'Tiền mặt');
    perform public.record_first_expense(bcat, 12000, (now() at time zone 'Asia/Ho_Chi_Minh')::date, null, 'VND', 'Tiền mặt');
    select count(*) into n from public.accounts where user_id = b and name = 'Tiền mặt' and type = 'cash';
    if n = 1 and (res->>'created_wallet')::boolean and res->'transaction'->>'description' = 'chợ sáng'
       and (select count(*) from public.transactions where user_id = b) = 2 then
      out := out || E'ok   ghi được → 1 ví Tiền mặt + khoản chi; lần sau dùng lại ví\n';
    else failures := failures + 1; out := out || format(E'FAIL ghi đầu: %s ví, %s\n', n, res); end if;

    -- 8. Không ghi hộ người khác: B không dùng được danh mục của A.
    begin
      perform public.record_first_expense(cat, 1000, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
      failures := failures + 1; out := out || E'FAIL dùng danh mục người khác\n';
    exception when others then
      out := out || format(E'ok   danh mục người khác bị chặn (%s)\n', sqlerrm);
    end;
    reset role;
  exception when others then reset role; failures := failures + 1; out := out || format(E'FAIL record_first_expense: %s\n', sqlerrm); end;

  -- 9. Quyền: anon không gọi được; hàm mới có search_path cố định.
  if not has_function_privilege('anon', 'public.record_first_expense(uuid, numeric, date, text, text, text)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.record_first_expense(uuid, numeric, date, text, text, text)', 'EXECUTE')
     and not exists (select 1 from pg_proc p where p.proname in ('record_first_expense', 'txn_date_is_future', 'local_day')
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    out := out || E'ok   quyền: anon không, authenticated có; search_path cố định\n';
  else failures := failures + 1; out := out || E'FAIL quyền / search_path\n'; end if;

  raise exception E'%kt08_qa0501_ngay_dia_phuong failures=%', out, failures;
end $test$;
