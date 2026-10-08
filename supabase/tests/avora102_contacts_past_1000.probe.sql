do $$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d'; b uuid := 'ce09d234-af48-49a5-96f2-b2456ae4e5b0'; o uuid := '92ace0b9-5de9-4568-8321-84169d3b5ca3';
  log text := ''; r jsonb; n int; ids uuid[]; total int := 0; mid uuid; keep uuid; dropc uuid; opp uuid; rows jsonb; t0 timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  -- 102.10: 1 000 contacts (6 batches of 500) + 1 500 extra channels; names end with Ý…
  t0 := clock_timestamp();
  for batch in 0..5 loop
    select jsonb_agg(jsonb_build_object('type','individual','name', case when g >= 2990 then 'Ý ' || g else 'Người ' || lpad(g::text, 4, '0') end,
      'phone', '09' || lpad(g::text, 8, '0'), 'source', 'import_csv',
      'channels', case when g % 2 = 0 then jsonb_build_array(jsonb_build_object('kind','phone','value','08' || lpad(g::text, 8, '0'))) else '[]'::jsonb end))
      into rows from generate_series(batch * 500, batch * 500 + 499) g;
    r := public.create_contacts_bulk(rows);
    total := total + (select count(*) from jsonb_array_elements(r) x where x ->> 'status' = 'created');
  end loop;
  log := log || format(E'102.10 created=%s in %s ms; db contacts=%s channels=%s; Ý-contacts with channel=%s\n', total,
    round(extract(epoch from clock_timestamp() - t0) * 1000), (select count(*) from public.contact where owner_user_id = a),
    (select count(*) from public.contact_channel where owner_user_id = a),
    (select count(*) from public.contact c join public.contact_channel ch on ch.contact_id = c.id where c.owner_user_id = a and c.name like 'Ý %'));
  -- 102.11: same file again → 0 new
  total := 0; n := 0;
  for batch in 0..5 loop
    select jsonb_agg(jsonb_build_object('type','individual','name', 'Người ' || g, 'phone', '+84 9' || lpad(g::text, 8, '0'), 'source', 'import_csv')) into rows from generate_series(batch * 500, batch * 500 + 499) g;
    r := public.create_contacts_bulk(rows);
    total := total + (select count(*) from jsonb_array_elements(r) x where x ->> 'status' = 'created');
    n := n + (select count(*) from jsonb_array_elements(r) x where x ->> 'status' = 'exists');
  end loop;
  log := log || format(E'102.11 re-import: created=%s exists=%s\n', total, n);
  -- match on server sees the whole book
  log := log || format(E'102.11 match last 500 phones: %s hits\n', (select count(*) from public.contact_match_channels(array(select '09' || lpad(g::text, 8, '0') from generate_series(2500, 2999) g), '{}')));
  -- 102.12: 50 duplicate pairs (written directly, as old imports did)
  insert into public.contact (owner_user_id, contact_type, name, phone, created_at)
  select a, 'individual', 'Trùng ' || g, '09' || lpad(g::text, 8, '0'), now() + interval '1 minute' from generate_series(0, 49) g;
  log := log || format(E'102.12 pairs=%s\n', (select count(*) from public.contact_duplicate_pairs()));
  select keep_id, drop_id into keep, dropc from public.contact_duplicate_pairs() where drop_name = 'Trùng 0';
  reset role;
  insert into public.crm_opportunity (owner_user_id, contact_id, title) values (a, dropc, 'Cơ hội thử') returning id into opp;
  insert into public.contact_channel (contact_id, owner_user_id, kind, value, source) values (dropc, a, 'email', 'trung0@example.vn', 'manual');
  set local role authenticated;
  mid := public.merge_contacts(keep, dropc);
  log := log || format(E'102.12 merged: drop gone=%s opp on keep=%s email on keep=%s pairs now=%s\n',
    not exists (select 1 from public.contact where id = dropc), (select contact_id = keep from public.crm_opportunity where id = opp),
    exists (select 1 from public.contact_channel where contact_id = keep and value = 'trung0@example.vn'), (select count(*) from public.contact_duplicate_pairs()));
  perform public.undo_contact_merge(mid);
  log := log || format(E'102.12 undo: drop back=%s opp back=%s email back=%s pairs=%s\n',
    exists (select 1 from public.contact where id = dropc), (select contact_id = dropc from public.crm_opportunity where id = opp),
    exists (select 1 from public.contact_channel where contact_id = dropc and value = 'trung0@example.vn'), (select count(*) from public.contact_duplicate_pairs()));
  perform public.dismiss_contact_duplicate(keep, dropc);
  log := log || format(E'102.12 after "Không phải trùng": pairs=%s\n', (select count(*) from public.contact_duplicate_pairs()));
  -- 102.13: 1 800 flags
  reset role;
  update public.contact_channel set needs_review = true where owner_user_id = a and id in (select id from public.contact_channel where owner_user_id = a limit 1800);
  set local role authenticated;
  total := 0;
  loop ids := public.clear_channel_review_batch(500); exit when coalesce(array_length(ids, 1), 0) = 0; total := total + array_length(ids, 1); end loop;
  log := log || format(E'102.13 cleared=%s still flagged=%s\n', total, (select count(*) from public.contact_channel where owner_user_id = a and needs_review));
  -- isolation: B and outsider
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  log := log || format(E'B: pairs=%s match A phones=%s\n', (select count(*) from public.contact_duplicate_pairs()), (select count(*) from public.contact_match_channels(array['0900000001'], '{}')));
  begin perform public.merge_contacts(keep, dropc); log := log || E'B merge A FAIL\n'; exception when others then log := log || format(E'B merge A -> %s\n', sqlerrm); end;
  begin perform public.undo_contact_merge(mid); log := log || E'B undo A FAIL\n'; exception when others then log := log || format(E'B undo A -> %s\n', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  log := log || format(E'outsider: pairs=%s\n', (select count(*) from public.contact_duplicate_pairs()));
  reset role; set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.contact_duplicate_pairs(); log := log || E'anon FAIL\n'; exception when others then log := log || format(E'anon -> %s\n', sqlerrm); end;
  raise exception 'PROBE%', E'\n' || log;
end $$;
