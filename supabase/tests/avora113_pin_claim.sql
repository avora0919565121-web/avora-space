-- AVORA-113 — claim_user_pin does a REAL insert for every PIN the app can produce. Rolled back.
-- The 200 PINs are web/src/test/fixtures/pin-generated-200.json: generatePinBody() with mulberry32(113)
-- (user-pin.test.ts checks the fixture is exactly that draw). Each claim runs in its own
-- sub-transaction that is undone right after, so the same account can claim again.
-- Pass = "failures=0" in the final message.
do $test$
declare
  a uuid := 'be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d';
  generated text[] := array[
    'A-TYRLQERT', 'A-V24TYJTG', 'A-K9KM482V', 'A-YWVL2TSY', 'A-DW9CCL3J', 'A-UT5FURKB', 'A-G252DKQH', 'A-VD7ZCRBM',
    'A-VJDLHLUG', 'A-AHFN357A', 'A-A5LL653H', 'A-KGFG79BW', 'A-S3FW4FPQ', 'A-ENWN4CFW', 'A-PEELR28C', 'A-MTPE8QKQ',
    'A-UMFB3UUT', 'A-R2C7NBQD', 'A-FNJ8HFKU', 'A-ZLSTN7SH', 'A-D4EXY9CC', 'A-E8AENNFT', 'A-UZSZ48BS', 'A-WKCU5VQG',
    'A-SPV38SRF', 'A-JA7L7ZXV', 'A-D3ERFVBS', 'A-RPAT7MZA', 'A-DTJMLPBW', 'A-P77XTHHX', 'A-APVFMJGD', 'A-D9ED9GVQ',
    'A-M42QL64T', 'A-G26N3N7H', 'A-DECQKEZJ', 'A-KC7MDULL', 'A-NJCG5B6Z', 'A-UVEDB8VK', 'A-XKE7DSDH', 'A-DM3MJ8ED',
    'A-NE6SGSWJ', 'A-GJPVZAFT', 'A-SZWJEVNQ', 'A-BLYF9NQF', 'A-ZSM3Y6DR', 'A-VKZX7MZQ', 'A-BDGAM2YM', 'A-R6NGSTXV',
    'A-JYUV2FNV', 'A-XQJLNXYZ', 'A-E2ZGUJQV', 'A-ZGLTSKME', 'A-MX8JKS9X', 'A-AVL8V7MS', 'A-C7948PFM', 'A-QWN4AXDQ',
    'A-ENXAZTYK', 'A-WAB3J5BF', 'A-XG8A93PA', 'A-RS3XQZCZ', 'A-T684RS6L', 'A-GJRE5GXL', 'A-YJYT3VED', 'A-M7NLLEHY',
    'A-FQYVQDBB', 'A-S9V3TTYA', 'A-BQLTRXLE', 'A-JSTKWDKU', 'A-UYH7A5WP', 'A-YR76AUBW', 'A-GXHTQCKF', 'A-QXRAHEBF',
    'A-QLSHZVHK', 'A-FFKYN89M', 'A-M66XF5ZZ', 'A-BR9UHZQU', 'A-FCUFSVAM', 'A-ZY9DDU8Z', 'A-CLXMPQ5L', 'A-HCXPD48D',
    'A-FQV2WD9V', 'A-H3VCGENC', 'A-YMZWJLDF', 'A-B57PMHEF', 'A-ACLC4ADV', 'A-S69RQKQG', 'A-SEPJM5WW', 'A-XJHHN9BQ',
    'A-HMLHBQLV', 'A-SEUM7YDR', 'A-BC92QTBX', 'A-VLREJNTT', 'A-TD2E7NDX', 'A-ZF265XBQ', 'A-N7J2TF7S', 'A-QN8WEKTC',
    'A-SC7VAFXM', 'A-VMRH3HQL', 'A-MS8ZY9NB', 'A-LRTY443L', 'A-Z85WLBNR', 'A-LMNESP7Y', 'A-EWLMWDKG', 'A-LKHNMCXQ',
    'A-XYX2RD9J', 'A-C8LACY2Z', 'A-QHYPQL7X', 'A-BR3G39LZ', 'A-JUQRB4XD', 'A-K6LEC3ZC', 'A-ZJFERJZZ', 'A-VQU7SRWB',
    'A-SCHYN7JG', 'A-UGYLNJ9B', 'A-F8R6M7VW', 'A-MGKDNZTA', 'A-BSN4L4LC', 'A-BDXWVF7C', 'A-YD5Y4X8L', 'A-EHVJAG4Q',
    'A-KFTUAHRT', 'A-LTFTGNXN', 'A-XW5WFYVJ', 'A-MJMA2NDM', 'A-JQYVP5XS', 'A-S9QUHVTQ', 'A-LBVXQ3PV', 'A-LBCAFWTJ',
    'A-JTCVLASN', 'A-LQ4RRJEZ', 'A-DHWFUWDS', 'A-A932ZK2V', 'A-R7WV7QKB', 'A-ZFQ8Z6WW', 'A-JFT6PE7J', 'A-ERMNEDRK',
    'A-GTFB5XEU', 'A-YA97CEBQ', 'A-ZW8E3KUV', 'A-VRPYZ7HL', 'A-U4EL4HKB', 'A-H2XGAWPJ', 'A-G9C3WY5C', 'A-S8NYJ5SZ',
    'A-ULA5UN6U', 'A-L7SGL7HQ', 'A-BN2DS9UR', 'A-HSFB5XUV', 'A-G85F6KBN', 'A-M2PDNXJN', 'A-M66QYTNL', 'A-MU9UXUFZ',
    'A-KQCVY9LQ', 'A-UMX8WL9T', 'A-X3CW226D', 'A-J6LVPF5X', 'A-YG6EF9RS', 'A-TLW8W4DZ', 'A-FAEFEM8B', 'A-VGSYFYRA',
    'A-U7YYKSPG', 'A-BMPXLPXJ', 'A-CV2EPYMP', 'A-N3D5S5EX', 'A-HBJ37VPA', 'A-TLMSFKYZ', 'A-DLM4CJGH', 'A-B95XAMYK',
    'A-TYPYG2BB', 'A-E3GVUYWN', 'A-ZSTRF3XP', 'A-BPM5XH2G', 'A-Z6JLF7RD', 'A-RH72T9FH', 'A-S6MZ4QNK', 'A-JHN5PWAV',
    'A-TXECBYQX', 'A-UPBH4RFW', 'A-ZVQ62B9U', 'A-UEYVBAGH', 'A-QPDEUVRF', 'A-PH94J57R', 'A-FHM6FH7N', 'A-W2NAEMMG',
    'A-U929V9QY', 'A-LVTA6SXQ', 'A-R43U7CUK', 'A-H7YC33SX', 'A-UHGZTZ6D', 'A-NUF7THEX', 'A-SAZR6CZE', 'A-YG8DRHXS',
    'A-Z8S2RYFE', 'A-NPUF9QHZ', 'A-T4WZP3PN', 'A-CZW6BBJK', 'A-CXMUW99T', 'A-DWRPSAXN', 'A-U5EHH6VT', 'A-LHVJBUZU'
  ];
  pin text; got text; st text; msg text; con text;
  failures int := 0; log text := ''; ok_count int := 0; tried int := 0; ok boolean;
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  body text; i int; k int;
begin
  -- A has a PIN already; free the account for the test (rolled back with everything else).
  delete from public.user_pins where user_id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. 200 generated PINs: check says ok, claim inserts.
  foreach pin in array generated loop
    begin
      if public.check_user_pin(pin) <> 'ok' then raise exception 'check_not_ok'; end if;
      got := public.claim_user_pin(pin, 'generated');
      if got = pin and exists (select 1 from public.user_pins where user_id = a and user_pins.pin = got) then ok_count := ok_count + 1; end if;
      raise exception 'undo_claim';
    exception when others then
      get stacked diagnostics st = returned_sqlstate, msg = message_text, con = constraint_name;
      if msg <> 'undo_claim' then log := log || format(E'     %s → %s %s %s\n', pin, st, coalesce(con, ''), msg); end if;
    end;
  end loop;
  ok := ok_count = 200;
  log := log || format(E'%s 1 200 PIN sinh bằng thuật toán của app: %s/200 lưu được\n', case when ok then 'ok  ' else 'FAIL' end, ok_count); failures := failures + (not ok)::int;

  -- 2. L at the start, in the middle, at the end (chosen).
  foreach pin in array array['A-LBCDEFGH', 'A-ABCL2EFG', 'A-ABCDEFGL', 'A-LLMN23PL'] loop
    begin
      got := public.claim_user_pin(pin, 'chosen');
      raise exception 'undo_claim';
    exception when others then
      get stacked diagnostics st = returned_sqlstate, msg = message_text, con = constraint_name;
      ok := msg = 'undo_claim';
      log := log || format(E'%s 2 %s lưu được%s\n', case when ok then 'ok  ' else 'FAIL' end, pin, case when ok then '' else format(' — %s %s %s', st, coalesce(con, ''), msg) end);
      failures := failures + (not ok)::int;
    end;
  end loop;

  -- 3. I, O, 0, 1 refused as confusing, by both check and claim.
  foreach pin in array array['A-ABCIEFGH', 'A-ABCOEFGH', 'A-ABC0EFGH', 'A-ABC1EFGH'] loop
    begin
      ok := public.check_user_pin(pin) = 'avora_pin_confusing';
      got := public.claim_user_pin(pin, 'chosen');
      ok := false;
      raise exception 'undo_claim';
    exception when others then
      get stacked diagnostics msg = message_text;
      ok := coalesce(ok, false) and msg = 'avora_pin_confusing';
    end;
    log := log || format(E'%s 3 %s bị từ chối: avora_pin_confusing\n', case when ok then 'ok  ' else 'FAIL' end, pin); failures := failures + (not ok)::int;
  end loop;

  -- 4. Property: whenever check_user_pin says ok, claim_user_pin succeeds. 1500 bodies drawn from the
  --    full A–Z / 0–9 set (so every rule gets hit), fixed seed.
  perform setseed(0.113);
  ok_count := 0;
  for i in 1 .. 1500 loop
    body := '';
    for k in 1 .. 8 loop body := body || substr(alphabet, 1 + floor(random() * 36)::int, 1); end loop;
    pin := 'A-' || body;
    if public.check_user_pin(pin) <> 'ok' then continue; end if;
    tried := tried + 1;
    begin
      got := public.claim_user_pin(pin, 'chosen');
      ok_count := ok_count + 1;
      raise exception 'undo_claim';
    exception when others then
      get stacked diagnostics st = returned_sqlstate, msg = message_text, con = constraint_name;
      if msg <> 'undo_claim' then ok_count := ok_count - 1; log := log || format(E'     %s → %s %s %s\n', pin, st, coalesce(con, ''), msg); end if;
    end;
  end loop;
  ok := tried > 50 and ok_count = tried;
  log := log || format(E'%s 4 check_user_pin = ok ⇒ claim_user_pin lưu được: %s/%s\n', case when ok then 'ok  ' else 'FAIL' end, ok_count, tried); failures := failures + (not ok)::int;

  reset role;

  -- 5. Every issued PIN still meets the rebuilt constraint.
  ok := (select convalidated from pg_constraint where conrelid = 'public.user_pins'::regclass and conname = 'user_pins_format')
    and not exists (select 1 from public.user_pins up where up.pin !~ '^A-[ABCDEFGHJKLMNPQRSTUVWXYZ][ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKLMNPQRSTUVWXYZ]$');
  log := log || format(E'%s 5 PIN đã cấp vẫn hợp lệ (VALIDATE)\n', case when ok then 'ok  ' else 'FAIL' end); failures := failures + (not ok)::int;

  raise exception E'\n%failures=% (rolled back)', log, failures;
end $test$;
