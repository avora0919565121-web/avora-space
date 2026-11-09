-- 111-A · push_claim_batch: thêm loại `account` (định nghĩa live 09/11 + một vòng cuối). Không đổi các loại khác.

CREATE OR REPLACE FUNCTION public.push_claim_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_out jsonb := '[]'::jsonb; g record; v_title text; v_body text; v_count integer; v_last messages%rowtype;
  v_read timestamptz; v_show boolean; v_tz text; v_task tasks%rowtype; v_subs jsonb; v_url text; v_ids uuid[];
  v_mention boolean;
begin
  perform private.assert_session_allowed();
  perform private.enqueue_due_reminders();
  perform private.enqueue_due_habits();
  -- Rows a crashed run left half-sent go back in the queue; old rows are cleared (7 days).
  update push_outbox set status = 'pending' where status in ('sending', 'claimed') and sent_at is null and created_at < now() - interval '5 minutes';
  delete from push_outbox where created_at < now() - interval '7 days';

  -- Messages and friend requests: one notification per (person, conversation), replacing the last (tag).
  -- K2 · C12: rows are locked (SKIP LOCKED) and marked before grouping, so a parallel run cannot take them.
  update push_outbox set status = 'claimed' where id in (
    select o.id from push_outbox o where o.status = 'pending' and o.kind in ('message', 'friend_request')
      and o.send_after <= now() order by o.id limit 2000 for update skip locked);
  for g in
    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest
    from push_outbox o
    where o.status = 'claimed' and o.kind in ('message', 'friend_request')
    group by o.user_id, o.conversation_id, o.kind
    having min(o.send_after) <= now()
    limit 200
  loop
    update push_outbox set status = 'sending' where id = any (g.ids);
    select last_read_at into v_read from conversation_read_marks where conversation_id = g.conversation_id and user_id = g.user_id;
    select count(*) into v_count from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
        and m.created_at > coalesce(v_read, '-infinity'::timestamptz);
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id)
       or private.push_mute_blocks(g.user_id, coalesce(private.push_surface(g.conversation_id), 'direct'), g.conversation_id,
            false, exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}'))),
            exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and m.is_urgent)) then
      -- Already read in the app (or nothing left to say): no push.
      update push_outbox set status = 'skipped', sent_at = now() where id = any (g.ids);
      continue;
    end if;
    select m.* into v_last from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
      order by m.created_at desc limit 1;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_mention := g.user_id = any (coalesce(v_last.mentioned_user_ids, '{}'));
    if g.kind = 'friend_request' then
      v_title := 'AVORA';
      v_body := 'Có người muốn kết bạn';
    else
      v_title := coalesce((select name from conversation_groups where conversation_id = g.conversation_id), private.push_display_name(v_last.sender_id));
      if coalesce(v_show, false) then
        v_body := case
          when btrim(v_last.content) <> '' then left(btrim(v_last.content), 80)
          when exists (select 1 from message_attachments a where a.message_id = v_last.id and a.kind = 'image') then '[Ảnh]'
          else '[Tệp]' end;
        if v_count > 1 then v_body := format('(%s) %s', v_count, v_body); end if;
      elsif exists (select 1 from push_outbox o join messages m on m.id = o.message_id
                    where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')))
            and exists (select 1 from conversations where id = g.conversation_id and type = 'group') then
        -- Being named is what matters most: said first, the count after.
        v_body := format('%s nhắc đến bạn', private.push_display_name(
          (select m.sender_id from push_outbox o join messages m on m.id = o.message_id
           where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')) order by m.created_at desc limit 1)))
          || case when v_count > 1 then format(' · %s tin nhắn mới', v_count) else '' end;
      elsif v_count > 1 then
        v_body := format('%s tin nhắn mới', v_count);
      else
        v_body := 'Tin nhắn mới';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', to_jsonb(g.ids), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', v_title, 'body', v_body, 'tag', g.conversation_id::text,
        'url', '/tin-nhan/' || g.conversation_id)));
  end loop;

  -- Reminders: one each.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'reminder' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    select push_show_content, coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_show, v_tz from profiles where id = g.user_id;
    v_task := null;
    if g.task_id is not null then select * into v_task from tasks where id = g.task_id; end if;
    if v_subs is null or (g.task_id is not null and (v_task.id is null or v_task.status in ('done', 'skipped'))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_body := case when (g.payload->>'go') = 'true' then 'Đến giờ đi: ' else 'Đến giờ: ' end
      || to_char(((g.payload->>'at')::timestamptz) at time zone v_tz, 'HH24:MI');
    if coalesce(v_show, false) then
      v_body := v_body || ' · ' || left(coalesce(v_task.title, g.payload->>'title', ''), 80);
    end if;
    v_url := case when g.task_id is not null then '/nhiem-vu?muc=viec&mo=' || g.task_id
                  else '/ke-hoach?bang=' || (g.payload->>'table_id') || '&hang-muc=' || (g.payload->>'record_id') end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'Nhắc việc', 'body', v_body, 'tag', 'nhac:' || coalesce(g.task_id::text, g.payload->>'record_id'), 'url', v_url)));
  end loop;
  -- AVORA-62 · board updates: only to the people a change concerns; mute was checked when queued.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'board' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', coalesce(g.payload->>'title', 'Kế hoạch'),
        'body', case when coalesce(v_show, false) then coalesce(g.payload->>'body', 'Bảng chung có thay đổi') else 'Bảng chung có thay đổi liên quan đến bạn' end,
        'tag', 'bang:' || coalesce(g.payload->>'table_id', g.id::text), 'url', coalesce(g.payload->>'url', '/ke-hoach'))));
  end loop;
  -- AVORA-51 · security alarms (Két sắt code reset / changed): always sent, no mute applies.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'security' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'AVORA · Két sắt', 'body', coalesce(g.payload->>'text', 'Mã Két sắt vừa thay đổi.'), 'tag', 'ket-sat:' || g.id, 'url', '/ket-sat')));
  end loop;
  -- AVORA-107 · Thói quen: nhẹ hơn nhắc việc; chỉ tên thói quen, theo luật ẩn nội dung. Khung đã làm thì bỏ.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'habit' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null or not exists (select 1 from habits h where h.id = (g.payload->>'habit_id')::uuid and h.paused_at is null and h.archived_at is null)
       or exists (select 1 from habit_logs l where l.habit_id = (g.payload->>'habit_id')::uuid and l.status = 'done'
                  and l.local_date = split_part(g.dedupe_key, ':', 3)::date and l.window_index = split_part(g.dedupe_key, ':', 4)::integer) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    -- VMT 10/10 21:11 · báo đồng hồ đủ giờ khi app đóng (`ht:`): xét chế độ yên lặng lúc gửi, không lúc xếp hàng.
    if g.dedupe_key like 'ht:%' and exists (
      select 1 from profiles pr where pr.id = g.user_id and (
        not coalesce(pr.push_reminders, true)
        or (pr.focus_mode is not null and (pr.focus_until is null or pr.focus_until > now()))
        or extract(dow from (now() at time zone coalesce(pr.timezone, 'Asia/Ho_Chi_Minh')))::integer = coalesce(pr.rest_weekday, -1)
        or exists (select 1 from mute_settings m where m.user_id = pr.id and m.scope = 'avora' and m.muted_until > now()))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', case when g.dedupe_key like 'ht:%' then jsonb_build_object('title', 'Thói quen',
        'body', case when coalesce(v_show, false) then 'Đủ giờ: ' || left(coalesce(g.payload->>'title', ''), 80) else 'Đồng hồ thói quen đã đủ giờ' end,
        'tag', 'thoi-quen-dong-ho:' || (g.payload->>'habit_id'), 'url', '/nhiem-vu?muc=thoi-quen')
      else jsonb_build_object('title', 'Thói quen',
        'body', case when coalesce(v_show, false) then left(coalesce(g.payload->>'title', ''), 80) else 'Đến giờ thói quen của bạn' end,
        'tag', 'thoi-quen:' || (g.payload->>'habit_id'), 'url', '/nhiem-vu?muc=thoi-quen') end));
  end loop;
  -- 111-A · tài khoản (yêu cầu xoá): luôn gửi, không theo chế độ yên lặng; bỏ máy vừa bấm xoá (except_endpoint).
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'account' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s
      where s.user_id = g.user_id and s.endpoint is distinct from (g.payload->>'except_endpoint')) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'AVORA · Tài khoản', 'body', coalesce(g.payload->>'text', 'Tài khoản của bạn có thay đổi.'), 'tag', 'tai-khoan:' || g.id, 'url', '/cai-dat?muc=tai-khoan')));
  end loop;
  return v_out;
end $function$;
