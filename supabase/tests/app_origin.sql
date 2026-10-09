-- KHỐI 0 — device-email links never point at another site.
do $test$
declare failures int := 0; log text := ''; r record;
begin
  for r in select * from (values
    ('https://evil.rork.app', 'https://avorachat.com'),
    ('https://evil.rork.live', 'https://avorachat.com'),
    ('https://myavora.rork.app', 'https://avorachat.com'),
    ('https://avoraspace.rork.app', 'https://avorachat.com'),
    ('https://www.avorachat.com', 'https://avorachat.com'),
    (null, 'https://avorachat.com'),
    ('https://9gn7yyx8sbtban1pcozwb-web.rork.live', 'https://9gn7yyx8sbtban1pcozwb-web.rork.live')) v(origin, expected) loop
    if private.app_origin(r.origin) is distinct from r.expected then
      failures := failures + 1; log := log || format(E'FAIL %s → %s\n', r.origin, private.app_origin(r.origin));
    else log := log || format(E'ok   %s → %s\n', r.origin, r.expected); end if;
  end loop;
  raise exception 'APP_ORIGIN failures=% %', failures, E'\n' || log;
end $test$;
