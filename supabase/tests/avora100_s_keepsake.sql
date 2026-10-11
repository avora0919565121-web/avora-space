-- AVORA-100 · S.2 §4.3 — Dấu ấn Avora Space (84.12 · 84.14). Always rolled back.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  failures int := 0; log text := ''; ok boolean; old text;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('keepsakes', a || '/k1.webp', a::text, '{"size": 90000, "mimetype": "image/webp"}'),
    ('keepsakes', b || '/kb.webp', b::text, '{"size": 90000, "mimetype": "image/webp"}');

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_space_keepsake('{"kind":"sticker","sticker_id":"cun.om"}');
  ok := (select space_keepsake ->> 'sticker_id' from public.profiles where id = a) = 'cun.om';
  begin perform public.set_space_keepsake('{"kind":"sticker","sticker_id":"abc.xyz"}'); ok := false; exception when others then null; end;
  begin perform public.set_space_keepsake(jsonb_build_object('kind', 'photo', 'path', b || '/kb.webp', 'focus_y', 0.3)); ok := false; exception when others then null; end;
  log := log || format(E'%s 84.12 đặt sticker cun.om; id lạ / ảnh của người khác → từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform public.set_space_keepsake(jsonb_build_object('kind', 'photo', 'path', a || '/k1.webp', 'focus_y', 0.3));
  perform public.set_space_keepsake(jsonb_build_object('kind', 'photo', 'path', a || '/k1.webp', 'focus_y', 1.7));
  ok := (select (space_keepsake ->> 'focus_y')::numeric from public.profiles where id = a) = 1;
  old := public.set_space_keepsake(null);
  ok := ok and old = a || '/k1.webp' and (select space_keepsake from public.profiles where id = a) is null;
  perform public.set_space_keepsake(jsonb_build_object('kind', 'photo', 'path', a || '/k1.webp', 'focus_y', 0.4));
  reset role;
  log := log || format(E'%s 84.13 ảnh + vị trí (giữ trong 0–1); gỡ → trả đường dẫn ảnh cũ để xoá\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from storage.objects where bucket_id = 'keepsakes' and name = a || '/k1.webp') = 0
    and (select count(*) from public.profiles where id = a) = 0;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('keepsakes', a || '/chen.webp', b::text);
    ok := false;
  exception when others then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := ok and (select count(*) from storage.objects where bucket_id = 'keepsakes') = 0;
  reset role;
  log := log || format(E'%s 84.14 B / anon không đọc ảnh dấu ấn hay cột của A; không ghi vào thư mục của A\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception 'AVORA100_KEEPSAKE failures=% %', failures, E'\n' || log;
end $test$;
