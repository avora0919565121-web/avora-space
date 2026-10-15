-- AVORA-115 — ảnh đại diện: ai ghi, ai thấy. INSERT / SELECT / DELETE thật trên storage.objects và
-- profiles, trong một giao dịch, luôn rollback. A chủ ảnh · B bạn của A · C chung nhóm với A, chưa là
-- bạn · O người lạ (rồi thành bạn, rồi bị chặn) · anon.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  c uuid := private.test_ephemeral_user('C');
  o uuid := private.test_ephemeral_user('O');
  g uuid := gen_random_uuid();
  g2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  p1 text := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d/v1.jpg';
  p2 text := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d/v2.jpg';
  log text := '';
  failures int := 0;
  ok boolean;
  n int;
  t text;
  old_path text;

begin
  -- Fixture (system): A–B friends (already, ensured), C shares a group with A and B, O stranger.
  insert into public.user_connections (user_low, user_high, status, source)
  values (least(a, b), greatest(a, b), 'active', 'pin')
  on conflict (user_low, user_high) do update set status = 'active', removed_at = null;
  delete from public.user_connections where (user_low, user_high) in ((least(a, c), greatest(a, c)), (least(a, o), greatest(a, o)));
  delete from public.user_blocks where (blocker_id = a and blocked_id in (b, c, o)) or (blocked_id = a and blocker_id in (b, c, o));
  insert into public.conversations (id, type) values (g, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g, 'Nhóm thử ảnh', a);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g, a, 'owner'), (g, b, 'member'), (g, c, 'member');
  -- A contact card of A, sent by B into a group of B and C (A is not in it, as the card rule requires).
  insert into public.conversations (id, type) values (g2, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (g2, 'Nhóm thẻ', b);
  insert into public.conversation_participants (conversation_id, user_id, role) values (g2, b, 'owner'), (g2, c, 'member');
  insert into public.messages (id, conversation_id, sender_id, content, contact_card_user_id) values (m, g2, b, 'thẻ liên hệ', a);
  update public.profiles set avatar_url = null where id = a;

  -- ---------------------------------------------------------------- A writes
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('avatars', p1, a::text);
  ok := true;
  begin insert into storage.objects (bucket_id, name, owner_id) values ('avatars', b::text || '/x.jpg', a::text); ok := false;
  exception when others then null; end;
  log := log || format(E'%s A tải lên thư mục của mình; không ghi được vào thư mục B\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  old_path := public.set_avatar(p1);
  ok := old_path is null and (select avatar_url from public.profiles where id = a) = p1;
  begin perform public.set_avatar(b::text || '/x.jpg'); ok := false; exception when others then ok := ok and sqlerrm = 'avora_avatar_invalid'; end;
  begin perform public.set_avatar(a::text || '/missing.jpg'); ok := false; exception when others then ok := ok and sqlerrm = 'avora_attachment_missing'; end;
  begin update public.profiles set avatar_url = b::text || '/x.jpg' where id = a; ok := false; exception when insufficient_privilege then null; end;
  log := log || format(E'%s set_avatar chỉ nhận ảnh của chính mình; avatar_url không sửa thẳng được\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  reset role;

  -- ---------------------------------------------------------------- who reads
  for t, n in select * from (values ('B', 1), ('C', 0), ('O', 0)) v(who, want) loop
    perform set_config('request.jwt.claims', json_build_object('sub', case t when 'B' then b when 'C' then c else o end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    ok := (select count(*) from public.avatar_paths(array[a])) = n
      and (select count(*) from storage.objects where bucket_id = 'avatars' and name = p1) = n;
    if t in ('B', 'C') then
      ok := ok and ((select v.avatar_url from public.contact_card_view(m) v) is not null) = (n = 1);
    end if;
    reset role;
    log := log || format(E'%s %s %s ảnh (avatar_paths · storage · contact_card_view)\n', case when ok then 'ok  ' else 'FAIL' end, t,
      case when n = 1 then 'thấy' else 'không thấy' end);
    failures := failures + (not ok)::int;
  end loop;

  -- O becomes a friend → sees; then A blocks O → nothing, at once.
  insert into public.user_connections (user_low, user_high, status, source) values (least(a, o), greatest(a, o), 'active', 'pin');
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.avatar_paths(array[a])) = 1;
  reset role;
  insert into public.user_blocks (blocker_id, blocked_id) values (a, o);
  set local role authenticated;
  ok := ok and (select count(*) from public.avatar_paths(array[a])) = 0
    and (select count(*) from storage.objects where bucket_id = 'avatars' and name = p1) = 0;
  reset role;
  log := log || format(E'%s O thành bạn → thấy; A chặn O → mất ngay\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- B unfriends → nothing, at once, everywhere (contact card included).
  update public.user_connections set status = 'removed', removed_at = now(), removed_by = b where user_low = least(a, b) and user_high = greatest(a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.avatar_paths(array[a])) = 0
    and (select count(*) from storage.objects where bucket_id = 'avatars' and name = p1) = 0
    and (select v.avatar_url from public.contact_card_view(m) v) is null;
  reset role;
  log := log || format(E'%s B huỷ kết bạn → mất ngay (kể cả thẻ liên hệ trong lịch sử chat)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;
  update public.user_connections set status = 'active', removed_at = null, removed_by = null where user_low = least(a, b) and user_high = greatest(a, b);

  -- ---------------------------------------------------------------- nobody else deletes; owner replaces and clears
  perform set_config('storage.allow_delete_query', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'avatars' and name = p1;
  get diagnostics n = row_count;
  ok := n = 0;
  begin perform public.clear_avatar(); exception when others then null; end;
  reset role;
  ok := ok and (select avatar_url from public.profiles where id = a) = p1;
  log := log || format(E'%s B không xoá được ảnh A, clear_avatar của B không chạm hồ sơ A\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('avatars', p2, a::text);
  old_path := public.set_avatar(p2);
  ok := old_path = p1;
  delete from storage.objects where bucket_id = 'avatars' and name = old_path;
  get diagnostics n = row_count;
  ok := ok and n = 1 and (select count(*) from storage.objects where bucket_id = 'avatars' and name like a::text || '/%') = 1;
  old_path := public.clear_avatar();
  ok := ok and old_path = p2 and (select avatar_url from public.profiles where id = a) is null
    and (select avatar_updated_at from public.profiles where id = a) is not null;
  delete from storage.objects where bucket_id = 'avatars' and name = old_path;
  get diagnostics n = row_count;
  ok := ok and n = 1 and (select count(*) from storage.objects where bucket_id = 'avatars' and name like a::text || '/%') = 0;
  reset role;
  log := log || format(E'%s đổi ảnh trả đường dẫn cũ, chủ xoá được bản cũ; xoá ảnh → chữ cái đầu, thư mục trống\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- B (friend) asks after A cleared: nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := (select count(*) from public.avatar_paths(array[a])) = 0;
  reset role;
  log := log || format(E'%s sau khi xoá ảnh, bạn bè cũng chỉ thấy chữ cái đầu\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- anon, size
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false;
  begin perform public.avatar_paths(array[a]); exception when insufficient_privilege then ok := true; end;
  begin perform public.set_avatar(p1); ok := false; exception when insufficient_privilege then ok := ok; end;
  reset role;
  log := log || format(E'%s anon: không đọc, không ghi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  ok := (select public = false and file_size_limit = 262144 and allowed_mime_types = array['image/jpeg'] from storage.buckets where id = 'avatars');
  log := log || format(E'%s bucket avatars riêng tư, JPEG ≤ 256 KB\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA115 failures=%\n%', failures, log;
end $test$;
