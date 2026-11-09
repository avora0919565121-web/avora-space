-- 112-H · LOI-15: hàm phiên bản Điều khoản không mở cho anon/public; authenticated và service_role vẫn gọi được.
do $test$
declare
  failures int := 0; log text := '';
begin
  if has_function_privilege('anon', 'private.terms_version()', 'execute') then
    failures := failures + 1; log := log || E'\n  anon còn gọi được private.terms_version()';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'terms_version'
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  ) then
    failures := failures + 1; log := log || E'\n  PUBLIC còn quyền EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'private.terms_version()', 'execute') then
    failures := failures + 1; log := log || E'\n  authenticated mất quyền gọi';
  end if;
  if not has_function_privilege('service_role', 'private.terms_version()', 'execute') then
    failures := failures + 1; log := log || E'\n  service_role mất quyền gọi';
  end if;
  raise exception E'AVORA112H_GRANTS failures=%\n%', failures, log;
end $test$;
