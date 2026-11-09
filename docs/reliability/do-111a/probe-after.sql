-- 111-A · Probe sau khi xoá thử (A.5): quét MỌI cột kiểu uuid trong schema public, private, storage
-- (không chỉ cột tên user_id / owner_id / created_by) tìm uid của tài khoản vừa xoá. Mong đợi: 0 dòng có số > 0.
-- Chạy: thay :uid bằng uid đã xoá. Chỉ đọc.
do $$
declare
  v_uid uuid := '0b6271bc-7c4e-43ca-a87d-57fa10d059ec';  -- user tạm e2e111a, đã xoá 09/11/2026
  r record; n bigint; checked int := 0; hits text := '';
begin
  for r in
    select c.table_schema, c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema in ('public', 'private', 'storage')
       and c.data_type = 'uuid' and t.table_type = 'BASE TABLE'
     order by 1, 2, 3
  loop
    execute format('select count(*) from %I.%I where %I = $1', r.table_schema, r.table_name, r.column_name) into n using v_uid;
    checked := checked + 1;
    if n > 0 then hits := hits || format('%s.%s.%s=%s; ', r.table_schema, r.table_name, r.column_name, n); end if;
  end loop;
  -- storage.objects: đường dẫn bắt đầu bằng uid (thư mục riêng của người dùng).
  select count(*) into n from storage.objects o where o.name like v_uid::text || '/%' or o.owner = v_uid;
  if n > 0 then hits := hits || format('storage.objects(path/owner)=%s; ', n); end if;
  select count(*) into n from auth.users u where u.id = v_uid;
  if n > 0 then hits := hits || format('auth.users=%s; ', n); end if;
  select count(*) into n from auth.identities i where i.user_id = v_uid;
  if n > 0 then hits := hits || format('auth.identities=%s; ', n); end if;
  raise exception 'PROBE 111A checked_columns=% hits=[%]', checked, hits;
end $$;
