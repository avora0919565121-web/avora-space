-- AVORA-110 · 7.1 — rest_saturday / rest_theme_enabled: owner reads & writes; others / anon see nothing. Rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := private.test_ephemeral_user('C');
  o uuid := private.test_ephemeral_user('O');
  n int; failures int := 0; log text := ''; ok boolean;
begin
  -- 1. Defaults for an existing account: Saturday off, colour change on.
  ok := (select rest_saturday = false and rest_theme_enabled = true from public.profiles where id = c);
  log := log || format(E'%s 1 mặc định: rest_saturday=false, rest_theme_enabled=true\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 2. A turns Saturday on and the colour change off; reads it back.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set rest_saturday = true, rest_theme_enabled = false where id = a;
  ok := (select rest_saturday and not rest_theme_enabled from public.profiles where id = a);
  reset role;
  log := log || format(E'%s 2 A tự bật Thứ Bảy, tắt đổi màu, đọc lại được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 3. B cannot read or change A's (0 rows); outsider O neither.
  foreach n in array array[1, 2] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case n when 1 then b else o end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    ok := (select count(*) from public.profiles where id = a) = 0;
    update public.profiles set rest_saturday = false where id = a;
    reset role;
    ok := ok and (select rest_saturday from public.profiles where id = a);
    log := log || format(E'%s 3.%s %s không đọc / không sửa được của A\n', case when ok then 'ok  ' else 'FAIL' end, n, case n when 1 then 'B' else 'O' end); failures := failures + (not ok)::int;
  end loop;

  -- 4. anon: permission denied.
  set local role anon;
  begin
    perform rest_saturday from public.profiles limit 1;
    ok := false;
  exception when others then ok := sqlerrm like '%permission denied%';
  end;
  reset role;
  log := log || format(E'%s 4 anon → permission denied\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA110 failures=% %', failures, E'\n' || log;
end $test$;
