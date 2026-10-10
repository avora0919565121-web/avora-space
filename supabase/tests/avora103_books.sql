-- AVORA-103 · KHỐI 3A — Nguồn sách chính trực · Open Library · Bìa · Bìa của tôi. Chạy trong một khối, tự huỷ (raise ở cuối).
-- A, B, C = ba tài khoản thử; O = người ngoài; anon. Tên miền cấm ghép từ chuỗi đảo ngược (không có tên thật trong tệp).
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := '151a54b2-2ae1-4b0d-906c-08a1965461bd';
  o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  rec_a uuid := '0fc02d25-5d93-4ca4-b445-3d643d28d7f2';
  path_a text;
  banned text[];
  failures int := 0; log text := ''; ok boolean; n bigint; w1 int; w2 int;
begin
  select array_agg(reverse(x)) into banned from unnest(array[
    'gro.evihcra-sanna', 'il.evihcra-sanna', 'es.evihcra-sanna', 'sr.cbil', 'gro.negbil', 'si.negbil', 'ts.negbil',
    'gro.yrarbil-z', 'fe.yrarbil-z', 'ks.yrarbil-z', 'ts.bilew', 'gro.bilew', 'su.eekoob'
  ]) x;

  -- 103.1 không tên miền cấm nào trong dữ liệu sách
  select count(*) into n from public.book_catalog c, unnest(banned) d
  where coalesce(c.epub_url, '') ilike '%' || d || '%' or c.title ilike '%' || d || '%' or coalesce(c.authors, '') ilike '%' || d || '%' or coalesce(c.ia_id, '') ilike '%' || d || '%';
  ok := n = 0;
  log := log || format(E'%s 103.1 danh mục không có tên miền cấm (%s)\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  -- 103.2 tác giả mất < 70 năm (Bertrand Russell 1970, Upton Sinclair 1968) không còn trong kết quả tìm
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.search_book_catalog('Bertrand Russell', null, 'gutenberg', 60);
  ok := n = 0;
  select count(*) into n from public.search_book_catalog('The Jungle', null, 'gutenberg', 60) s where s.source_id = '140';
  ok := ok and n = 0;
  select count(*) into n from public.search_book_catalog('Pride and Prejudice', null, 'gutenberg', 60) s where s.source_id = '1342';
  ok := ok and n = 1;
  select count(*) into n from public.search_book_catalog('King James', null, 'gutenberg', 60) s where s.source_id = '10';
  ok := ok and n = 1;
  reset role;
  select count(*) into n from public.book_catalog where pd_status = 'ok' and author_died > extract(year from now())::int - 71;
  ok := ok and n = 0;
  log := log || format(E'%s 103.2 sách còn bản quyền (mất < 70 năm) bị loại; Austen, King James vẫn còn\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- 103.3/103.4 Open Library: sách công cộng đọc được; sách còn bản quyền chỉ là link (borrow)
  set local role authenticated;
  select count(*) into n from public.search_book_catalog('', null, 'openlibrary', 60) s where s.access = 'read' and s.pd_status = 'ok' and s.ia_id is not null;
  ok := n >= 25;
  select count(*) into n from public.search_book_catalog('Mere Christianity', null, 'openlibrary', 60) s where s.access = 'borrow';
  ok := ok and n = 1;
  select count(*) into n from public.book_catalog_covers(array['openlibrary:OL7173379M', 'gutenberg:1342', 'gutenberg:5827']);
  ok := ok and n = 3;
  reset role;
  log := log || format(E'%s 103.3/4 Open Library: sách công cộng có mã IA; sách còn bản quyền chỉ có link\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- bìa: chỉ máy chủ ghi; người dùng không gọi được set_book_cover / book_fetch_slot
  set local role authenticated;
  begin
    perform public.set_book_cover('gutenberg', '1342', 'gutenberg/1342.webp');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  begin
    perform public.book_fetch_slot();
    ok := false;
  exception when insufficient_privilege then ok := ok;
  end;
  reset role;
  set local role service_role;
  w1 := public.book_fetch_slot();
  w2 := public.book_fetch_slot();
  reset role;
  ok := ok and w2 >= 900 and w2 - w1 >= 900;
  log := log || format(E'%s 103.5 bìa chỉ Edge ghi; mỗi lần gọi nguồn ngoài cách nhau ≥ 1 giây (%s ms, %s ms)\n', case when ok then 'ok  ' else 'FAIL' end, w1, w2); failures := failures + (not ok)::int;

  -- 103.10 Bìa của tôi: A đặt ảnh của A cho cuốn của A; B, C, người ngoài không thấy; không ai đặt vào cuốn của A
  path_a := a || '/' || rec_a || '-1.webp';
  insert into storage.objects (bucket_id, name, owner_id) values ('my-book-covers', path_a, a::text);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_my_book_cover(rec_a, path_a);
  select count(*) into n from public.book_my_covers;
  ok := n = 1;
  select count(*) into n from storage.objects where bucket_id = 'my-book-covers' and name = path_a;
  ok := ok and n = 1;
  reset role;
  foreach o in array array[b, c, '92ace0b9-5de9-4568-8321-84169d3b5ca3'::uuid] loop
    perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.book_my_covers where record_id = rec_a;
    ok := ok and n = 0;
    select count(*) into n from storage.objects where bucket_id = 'my-book-covers' and name = path_a;
    ok := ok and n = 0;
    begin
      perform public.set_my_book_cover(rec_a, o || '/' || rec_a || '-2.webp');
      ok := false;
    exception when others then null;
    end;
    reset role;
  end loop;
  -- A không đặt được đường dẫn ở thư mục người khác
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_my_book_cover(rec_a, b || '/' || rec_a || '-3.webp');
    ok := false;
  exception when others then null;
  end;
  ok := ok and public.clear_my_book_cover(rec_a) = path_a;
  select count(*) into n from public.book_my_covers;
  ok := ok and n = 0;
  reset role;
  log := log || format(E'%s 103.10 Bìa của tôi: chỉ chủ thấy (B, C, người ngoài: 0); không đặt vào thư mục / cuốn của người khác\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- anon: không tìm, không xem bìa, không đặt bìa
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := true;
  begin
    perform public.book_catalog_covers(array['gutenberg:1342']);
    ok := false;
  exception when others then null;
  end;
  begin
    perform public.set_my_book_cover(rec_a, path_a);
    ok := false;
  exception when others then null;
  end;
  begin
    perform 1 from public.book_my_covers;
    ok := false;
  exception when others then null;
  end;
  reset role;
  log := log || format(E'%s 103.A anon không gọi được gì\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA103 failures=% %', failures, E'\n' || log;
end $test$;
