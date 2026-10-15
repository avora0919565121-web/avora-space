-- AVORA-112-B — công tắc tính năng. Ghi thật trong một giao dịch, luôn rollback. A testera (được thêm
-- tạm vào ops_user_ids trong giao dịch) · B testerb (người thường) · anon.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0';
  log text := '';
  failures int := 0;
  ok boolean;
  n int;
  t text;
begin
  update public.app_config set value = jsonb_build_array(a::text) where key = 'ops_user_ids';

  -- ---------------------------------------------------------------- đọc
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.app_features;
  ok := n >= 29 and (select count(*) from public.app_features where status <> 'stable') = 0;
  -- B không ghi thẳng, không gọi được hàm đổi, không đọc lịch sử.
  begin update public.app_features set status = 'hidden' where key = 'habits'; ok := ok and not found; exception when insufficient_privilege then null; end;
  begin perform public.ops_set_feature('habits', 'hidden', null); ok := false; exception when others then ok := ok and sqlerrm = 'avora_not_allowed'; end;
  reset role;
  log := log || format(E'%s người thường đọc %s khoá (đều stable); không ghi, không đổi được\n', case when ok then 'ok  ' else 'FAIL' end, n); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- ops đổi, có lịch sử
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.ops_set_feature('habits', 'soon', 'thử 112-B');
  ok := (select status from public.app_features where key = 'habits') = 'soon'
    and (select count(*) from public.app_feature_changes where key = 'habits' and from_status = 'stable' and to_status = 'soon' and changed_by = a) = 1;
  begin perform public.ops_set_feature('habits', 'gone', null); ok := false; exception when others then ok := ok and sqlerrm = 'avora_feature_status'; end;
  begin perform public.ops_set_feature('khong_co', 'soon', null); ok := false; exception when others then ok := ok and sqlerrm = 'avora_feature_unknown'; end;
  reset role;
  log := log || format(E'%s ops đổi trạng thái; lịch sử ghi lại; trạng thái/khoá lạ bị từ chối\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- RPC bị từ chối ở soon và hidden
  for t in select unnest(array['soon', 'hidden']) loop
    update public.app_features set status = t where key in ('habits', 'avatars', 'books', 'reactions');
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    ok := true;
    begin perform public.create_habit(gen_random_uuid(), 'Thử', 'check', null, array[1,2,3], '[]'::jsonb, false, 'pause'); ok := false;
    exception when others then ok := ok and sqlerrm = 'avora_feature_off'; end;
    begin perform public.set_avatar(b::text || '/x.jpg'); ok := false; exception when others then ok := ok and sqlerrm = 'avora_feature_off'; end;
    begin perform public.search_book_catalog('truyen', null, null, 5); ok := false; exception when others then ok := ok and sqlerrm = 'avora_feature_off'; end;
    begin
      insert into public.message_reactions (message_id, user_id, emoji)
      select m.id, b, '👍' from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id = b limit 1;
      ok := ok and not found;
    exception when others then ok := ok and sqlerrm = 'avora_feature_off'; end;
    reset role;
    log := log || format(E'%s %s: create_habit · set_avatar · search_book_catalog · thả cảm xúc đều trả avora_feature_off\n', case when ok then 'ok  ' else 'FAIL' end, t); failures := failures + (not ok)::int;
  end loop;

  -- ---------------------------------------------------------------- về stable thì chạy lại
  update public.app_features set status = 'stable' where key in ('habits', 'avatars', 'books', 'reactions');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin perform public.create_habit(gen_random_uuid(), 'Thử 112-B', 'check', null, array[1,2,3], '[]'::jsonb, false, 'pause');
  exception when others then ok := sqlerrm <> 'avora_feature_off'; end;
  reset role;
  log := log || format(E'%s stable: create_habit chạy bình thường\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- khoá chưa có dòng = stable
  ok := private.feature_status('khoa_moi_chua_gieo') = 'stable';
  log := log || format(E'%s khoá chưa gieo coi như stable (không tắt nhầm)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  -- ---------------------------------------------------------------- anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  ok := false;
  begin perform count(*) from public.app_features; exception when insufficient_privilege then ok := true; end;
  begin perform public.ops_set_feature('habits', 'hidden', null); ok := false; exception when insufficient_privilege then ok := ok; end;
  reset role;
  log := log || format(E'%s anon không đọc, không đổi\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'AVORA112B failures=%\n%', failures, log;
end $test$;
