-- AVORA-106 · K2 — Chính xác (server half). Client half: outbox, cursors, merge (web/src/lib/outbox.ts, chat.ts).
-- C6  page by (created_at, id)          → public.messages_page()
-- C7  read up to the last message SHOWN → mark_conversation_read(p_conversation_id, p_up_to)
-- C8  "Đã nhận" in batches on open      → mark_conversation_delivered()
-- C10 one unread number                 → list_my_conversations stays the only source (unchanged)
-- C11 removal is heard                  → realtime.send to user-<id> on participant delete
-- C12 no double push, mute at send time → push_claim_batch: FOR UPDATE SKIP LOCKED + mute re-check

-- ------------------------------------------------------------ C6
create index if not exists messages_conversation_created_id_idx
  on public.messages (conversation_id, created_at desc, id desc);

/** One page older than (before_at, before_id), newest first. Members only (can_act_in 'read'). */
create or replace function public.messages_page(
  p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 30
) returns setof public.messages
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  if not private.can_act_in(p_conversation, auth.uid(), 'read') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  return query
    select m.* from public.messages m
    where m.conversation_id = p_conversation and m.trashed_at is null
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;
revoke execute on function public.messages_page(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.messages_page(uuid, timestamptz, uuid, int) to authenticated;

-- ------------------------------------------------------------ C7
create or replace function public.mark_conversation_read(p_conversation_id uuid, p_up_to uuid default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_latest timestamptz; v_result timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000'; end if;
  if not private.can_act_in(p_conversation_id, v_user, 'mark') then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  if p_up_to is not null then
    -- Only as far as the device actually showed — a message that arrived after stays unread.
    select m.created_at into v_latest from public.messages m where m.id = p_up_to and m.conversation_id = p_conversation_id;
  else
    select max(m.created_at) into v_latest from public.messages m where m.conversation_id = p_conversation_id;
  end if;
  if v_latest is not null then
    insert into public.conversation_read_marks as r (conversation_id, user_id, last_read_at)
    values (p_conversation_id, v_user, v_latest)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at
      where r.last_read_at < excluded.last_read_at;
  end if;
  select last_read_at into v_result from public.conversation_read_marks where conversation_id = p_conversation_id and user_id = v_user;
  return v_result;
end $$;
drop function if exists public.mark_conversation_read(uuid);
revoke execute on function public.mark_conversation_read(uuid, uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ C8
/** On opening a 1-1: everything from the peer not yet marked delivered, in one call (ADR-028: no "Đã xem"). */
create or replace function public.mark_conversation_delivered(p_conversation uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation, v_uid, 'mark') then return 0; end if;
  insert into public.message_deliveries (message_id, user_id)
  select m.id, v_uid from public.messages m
  join public.conversations c on c.id = m.conversation_id and c.type = 'direct'
  where m.conversation_id = p_conversation and m.sender_id <> v_uid and m.system_kind is null
    and m.created_at > now() - interval '30 days'
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.mark_conversation_delivered(uuid) from public, anon;
grant execute on function public.mark_conversation_delivered(uuid) to authenticated;

-- ------------------------------------------------------------ C11
/** Tells the removed person's own topic, so every device drops the room at once. */
create or replace function private.notify_participant_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', old.conversation_id,
                       'name', (select g.name from public.conversation_groups g where g.conversation_id = old.conversation_id)),
    'removed', 'user-' || old.user_id::text, true);
  return old;
exception when others then
  return old; -- a failed notice never blocks leaving
end $$;
revoke execute on function private.notify_participant_removed() from public, anon, authenticated;
drop trigger if exists conversation_participants_removed_notice on public.conversation_participants;
create trigger conversation_participants_removed_notice after delete on public.conversation_participants
for each row execute function private.notify_participant_removed();

-- ------------------------------------------------------------ C12
do $do$
declare v_name text;
begin
  select conname into v_name from pg_constraint where conrelid = 'public.push_outbox'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
  if v_name is not null then execute format('alter table public.push_outbox drop constraint %I', v_name); end if;
end $do$;
alter table public.push_outbox add constraint push_outbox_status_check
  check (status = any (array['pending', 'claimed', 'sending', 'sent', 'skipped', 'failed']));
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.push_claim_batch()'::regprocedure);
  -- (1) Two runs never take the same rows: claim them under SKIP LOCKED first.
  v_def := replace(v_def,
    E'  for g in\n    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest\n    from push_outbox o\n    where o.status = ''pending'' and o.kind in (''message'', ''friend_request'')',
    E'  -- K2 · C12: rows are locked (SKIP LOCKED) and marked before grouping, so a parallel run cannot take them.\n  update push_outbox set status = ''claimed'' where id in (\n    select o.id from push_outbox o where o.status = ''pending'' and o.kind in (''message'', ''friend_request'')\n      and o.send_after <= now() order by o.id limit 2000 for update skip locked);\n  for g in\n    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest\n    from push_outbox o\n    where o.status = ''claimed'' and o.kind in (''message'', ''friend_request'')');
  -- (2) Mute is read again now, not only when queued 20 s ago.
  v_def := replace(v_def,
    E'    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id) then',
    E'    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id)\n       or private.push_mute_blocks(g.user_id, coalesce(private.push_surface(g.conversation_id), ''direct''), g.conversation_id,\n            false, exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, ''{}''))),\n            exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and m.is_urgent)) then');
  if position('skip locked' in v_def) = 0 or position('push_mute_blocks' in v_def) = 0 then
    raise exception 'K2: push_claim_batch body changed, C12 not placed';
  end if;
  -- the other three loops (reminder, board, security) take their rows under SKIP LOCKED too
  v_def := replace(v_def, E'and o.kind = ''reminder'' and o.send_after <= now() order by o.created_at limit 200', E'and o.kind = ''reminder'' and o.send_after <= now() order by o.created_at limit 200 for update skip locked');
  v_def := replace(v_def, E'and o.kind = ''board'' and o.send_after <= now() order by o.created_at limit 200', E'and o.kind = ''board'' and o.send_after <= now() order by o.created_at limit 200 for update skip locked');
  v_def := replace(v_def, E'and o.kind = ''security'' and o.send_after <= now() order by o.created_at limit 200', E'and o.kind = ''security'' and o.send_after <= now() order by o.created_at limit 200 for update skip locked');
  -- a crashed run's claimed rows go back too
  v_def := replace(v_def, E'update push_outbox set status = ''pending'' where status = ''sending''', E'update push_outbox set status = ''pending'' where status in (''sending'', ''claimed'')');
  execute v_def;
end $do$;
