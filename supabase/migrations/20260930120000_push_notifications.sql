-- AVORA-46 — Thông báo đẩy khi app đóng: tin nhắn và nhắc việc.
--   · Riêng tư mặc định: chỉ tên người gửi / tên cuộc + "Tin nhắn mới" / "Nhắc việc"; nội dung chỉ khi
--     người dùng tự bật push_show_content. Khung chờ kết bạn qua PIN: luôn "Có người muốn kết bạn".
--   · Một bộ luật Tắt thông báo: private.push_mute_blocks() làm đúng như shouldBlockNotification (lib/mute.ts).
--   · Không có "Đã xem": không gì được gửi ngược về người gửi.
--   · Hàng đợi push_outbox; Edge Function send-push lấy lô qua push_claim_batch() (chỉ service_role).

create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------------ settings on profiles (P5)
alter table public.profiles add column if not exists push_show_content boolean not null default false;
alter table public.profiles add column if not exists push_reminders boolean not null default true;
grant select (push_show_content, push_reminders), update (push_show_content, push_reminders) on public.profiles to authenticated;

-- ------------------------------------------------------------------ subscriptions (A)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text not null default 'Thiết bị',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  constraint push_subscriptions_endpoint_https check (endpoint like 'https://%' and char_length(endpoint) <= 2000),
  constraint push_subscriptions_keys_len check (char_length(p256dh) between 20 and 200 and char_length(auth) between 8 and 100),
  constraint push_subscriptions_label_len check (char_length(device_label) <= 80)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated, public;
grant select, delete on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device_label text)
returns public.push_subscriptions language plpgsql security definer set search_path = public, pg_temp as $$
declare v push_subscriptions%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  -- The same browser under another account moves to this one: one device, one owner.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_uid, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(coalesce(nullif(btrim(p_device_label), ''), 'Thiết bị'), 80))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    device_label = excluded.device_label, created_at = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.created_at else now() end
  returning * into v;
  return v;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  delete from push_subscriptions where endpoint = btrim(p_endpoint) and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ------------------------------------------------------------------ outbox
create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  conversation_id uuid,
  task_id uuid,
  message_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending',
  attempts integer not null default 0,
  constraint push_outbox_kind check (kind in ('message', 'friend_request', 'reminder')),
  constraint push_outbox_status check (status in ('pending', 'sending', 'sent', 'skipped', 'failed'))
);
create unique index if not exists push_outbox_dedupe on public.push_outbox (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists push_outbox_due on public.push_outbox (status, send_after);
create index if not exists push_outbox_conv on public.push_outbox (user_id, conversation_id) where status in ('pending', 'sending');
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated, public;
grant select on public.push_outbox to authenticated;
drop policy if exists push_outbox_select_own on public.push_outbox;
create policy push_outbox_select_own on public.push_outbox for select to authenticated using (user_id = (select auth.uid()));
revoke truncate on public.push_subscriptions, public.push_outbox from authenticated, anon, public;

-- ------------------------------------------------------------------ the one mute rule, server side (P3)
-- Same order and exceptions as shouldBlockNotification: avora (absolute) → messages (family passes)
-- → the tab (family passes; in a group a mention passes too).
create or replace function private.push_mute_blocks(p_user uuid, p_surface text, p_from_family boolean, p_mentions boolean, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from mute_settings where user_id = p_user and scope = 'avora' and muted_until > p_now) then true
    when exists (select 1 from mute_settings where user_id = p_user and scope = 'messages' and muted_until > p_now) then not p_from_family
    when exists (select 1 from mute_settings where user_id = p_user and scope = p_surface and muted_until > p_now) then
      not (p_from_family or (p_surface = 'group' and p_mentions))
    else false
  end
$$;
revoke all on function private.push_mute_blocks(uuid, text, boolean, boolean, timestamptz) from public, anon, authenticated;

create or replace function private.push_surface(p_conversation uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from projects p where p.conversation_id = p_conversation and p.deleted_at is null) then 'project'
    when c.type = 'group' then 'group'
    when c.type = 'direct' then 'direct'
    else null end
  from conversations c where c.id = p_conversation
$$;
revoke all on function private.push_surface(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ B · messages into the outbox
create or replace function private.enqueue_message_push()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_surface text; v_pending boolean;
begin
  if new.system_kind is not null or new.deleted_at is not null then return null; end if;
  v_surface := private.push_surface(new.conversation_id);
  if v_surface is null then return null; end if;
  select verification_status = 'pending' into v_pending from conversations where id = new.conversation_id;
  insert into push_outbox (user_id, kind, conversation_id, message_id, send_after)
  select cp.user_id, case when coalesce(v_pending, false) then 'friend_request' else 'message' end,
         new.conversation_id, new.id, now() + interval '20 seconds'
  from conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id
    and exists (select 1 from push_subscriptions s where s.user_id = cp.user_id)
    and not private.is_blocked_between(cp.user_id, new.sender_id)
    and not private.push_mute_blocks(cp.user_id, v_surface,
          exists (select 1 from family_relations f where f.user_id = cp.user_id and f.related_user_id = new.sender_id),
          cp.user_id = any (coalesce(new.mentioned_user_ids, '{}')));
  return null;
exception when others then
  -- A notification must never stop a message from being sent.
  raise warning 'avora_push_enqueue_failed';
  return null;
end $$;
revoke all on function private.enqueue_message_push() from public, anon, authenticated;
drop trigger if exists messages_enqueue_push on public.messages;
create trigger messages_enqueue_push after insert on public.messages
  for each row execute function private.enqueue_message_push();

-- ------------------------------------------------------------------ C · reminders into the outbox (P4)
create or replace function private.enqueue_due_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0; v_step integer;
begin
  -- 1. task_reminders: is_sent keeps it to one; only the reminder's own person.
  with due as (
    update task_reminders r set is_sent = true
    from tasks t
    where t.id = r.task_id and not r.is_sent and r.reminder_time <= now() and r.reminder_time > now() - interval '1 hour'
      and t.status not in ('done', 'skipped')
    returning r.id, r.user_id, r.task_id, r.reminder_time
  )
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select d.user_id, 'reminder', d.task_id, 'tr:' || d.id, jsonb_build_object('at', d.reminder_time)
  from due d join profiles p on p.id = d.user_id
  where p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = d.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 2. tasks.departure_reminder_at: the person who does the task (never the proposer, D3).
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select coalesce(t.assignee_id, t.creator_id), 'reminder', t.id, 'dep:' || t.id || ':' || t.departure_reminder_at, jsonb_build_object('at', t.departure_reminder_at, 'go', true)
  from tasks t join profiles p on p.id = coalesce(t.assignee_id, t.creator_id)
  where t.departure_reminder_at <= now() and t.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped') and t.pending_decision_id is null
    and (t.type = 'personal' or t.assignee_id is not null)
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 3. task_travel_plans: the assignee's own travel for a task from a suggestion.
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select tp.user_id, 'reminder', tp.task_id, 'tp:' || tp.task_id || ':' || tp.departure_reminder_at, jsonb_build_object('at', tp.departure_reminder_at, 'go', true)
  from task_travel_plans tp join tasks t on t.id = tp.task_id join profiles p on p.id = tp.user_id
  where tp.departure_reminder_at <= now() and tp.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped')
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = tp.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 4. think_hub_record.remind_at: the Hạng mục's owner.
  insert into push_outbox (user_id, kind, dedupe_key, payload)
  select r.owner_user_id, 'reminder', 'rec:' || r.id || ':' || r.remind_at,
         jsonb_build_object('at', r.remind_at, 'record_id', r.id, 'table_id', r.table_id, 'title', r.title)
  from think_hub_record r join profiles p on p.id = r.owner_user_id
  where r.deleted_at is null and r.remind_at <= now() and r.remind_at > now() - interval '1 hour'
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = r.owner_user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  return v_n;
end $$;
revoke all on function private.enqueue_due_reminders() from public, anon, authenticated;

-- ------------------------------------------------------------------ the batch the Edge Function sends
create or replace function private.push_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(display_name), ''), 'Người dùng AVORA') from profiles where id = p_user
$$;
revoke all on function private.push_display_name(uuid) from public, anon, authenticated;

create or replace function public.push_claim_batch()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_out jsonb := '[]'::jsonb; g record; v_title text; v_body text; v_count integer; v_last messages%rowtype;
  v_read timestamptz; v_show boolean; v_tz text; v_task tasks%rowtype; v_subs jsonb; v_url text; v_ids uuid[];
  v_mention boolean;
begin
  perform private.enqueue_due_reminders();
  -- Rows a crashed run left half-sent go back in the queue; old rows are cleared (7 days).
  update push_outbox set status = 'pending' where status = 'sending' and sent_at is null and created_at < now() - interval '5 minutes';
  delete from push_outbox where created_at < now() - interval '7 days';

  -- Messages and friend requests: one notification per (person, conversation), replacing the last (tag).
  for g in
    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest
    from push_outbox o
    where o.status = 'pending' and o.kind in ('message', 'friend_request')
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
    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id) then
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
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'reminder' and o.send_after <= now() order by o.created_at limit 200
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
  return v_out;
end $$;
revoke all on function public.push_claim_batch() from public, anon, authenticated;
grant execute on function public.push_claim_batch() to service_role;

-- What happened: sent (any device took it), failed (retry up to 3), and endpoints that are gone.
create or replace function public.push_report(p_sent uuid[], p_failed uuid[], p_gone text[], p_ok_endpoints text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update push_outbox set status = 'sent', sent_at = now() where id = any (coalesce(p_sent, '{}'));
  update push_outbox set attempts = attempts + 1,
    status = case when attempts + 1 >= 3 then 'failed' else 'pending' end,
    send_after = now() + interval '1 minute'
  where id = any (coalesce(p_failed, '{}')) and not (id = any (coalesce(p_sent, '{}')));
  delete from push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
  update push_subscriptions set last_ok_at = now() where endpoint = any (coalesce(p_ok_endpoints, '{}'));
end $$;
revoke all on function public.push_report(uuid[], uuid[], text[], text[]) from public, anon, authenticated;
grant execute on function public.push_report(uuid[], uuid[], text[], text[]) to service_role;

-- A person reading a conversation clears their queued pushes for it.
create or replace function private.skip_push_on_read()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update push_outbox set status = 'skipped', sent_at = now()
  where user_id = new.user_id and conversation_id = new.conversation_id and status = 'pending';
  return null;
end $$;
revoke all on function private.skip_push_on_read() from public, anon, authenticated;
drop trigger if exists read_marks_skip_push on public.conversation_read_marks;
create trigger read_marks_skip_push after insert or update of last_read_at on public.conversation_read_marks
  for each row execute function private.skip_push_on_read();
