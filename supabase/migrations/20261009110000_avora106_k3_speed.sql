-- AVORA-106 · K3 — Nhanh.
-- N1  each message / reaction / pin / delivery change is broadcast to the conversation's private
--     topic `conv-<id>` (members only via realtime_topic_ok → can_act_in 'read').
-- N2  open_thread(): one call returns the page + its files / reactions / pins + the room summary.
-- N10 indexes checked on the live DB.

-- ------------------------------------------------------------ N10
create index if not exists messages_conversation_created_id_idx on public.messages (conversation_id, created_at desc, id desc);
create index if not exists message_attachments_message_idx on public.message_attachments (message_id);
create index if not exists message_pins_conversation_idx on public.message_pins (conversation_id);
create index if not exists message_deliveries_message_idx on public.message_deliveries (message_id);

-- ------------------------------------------------------------ N1
/** Small payload: ids and the change kind. The client reads the row through RLS (or open_thread). */
create or replace function private.broadcast_chat_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_msg uuid; v_kind text;
begin
  if tg_table_name = 'messages' then
    v_conv := coalesce(new.conversation_id, old.conversation_id);
    v_msg := coalesce(new.id, old.id);
    v_kind := case tg_op when 'INSERT' then 'message' else 'message_update' end;
  elsif tg_table_name = 'message_reactions' then
    v_msg := coalesce(new.message_id, old.message_id);
    select m.conversation_id into v_conv from public.messages m where m.id = v_msg;
    v_kind := 'reaction';
  elsif tg_table_name = 'message_pins' then
    v_conv := coalesce(new.conversation_id, old.conversation_id);
    v_msg := coalesce(new.message_id, old.message_id);
    v_kind := 'pin';
  elsif tg_table_name = 'message_deliveries' then
    v_msg := coalesce(new.message_id, old.message_id);
    select m.conversation_id into v_conv from public.messages m where m.id = v_msg;
    v_kind := 'delivered';
  end if;
  if v_conv is null then return null; end if;
  perform realtime.send(jsonb_build_object('conversation_id', v_conv, 'message_id', v_msg, 'op', lower(tg_op)),
                        v_kind, 'conv-' || v_conv::text, true);
  return null;
exception when others then
  return null; -- a lost broadcast is healed by the next read; it must never fail a write
end $$;
revoke execute on function private.broadcast_chat_change() from public, anon, authenticated;

drop trigger if exists messages_broadcast on public.messages;
create trigger messages_broadcast after insert or update on public.messages
for each row execute function private.broadcast_chat_change();
drop trigger if exists message_reactions_broadcast on public.message_reactions;
create trigger message_reactions_broadcast after insert or delete on public.message_reactions
for each row execute function private.broadcast_chat_change();
drop trigger if exists message_pins_broadcast on public.message_pins;
create trigger message_pins_broadcast after insert or delete on public.message_pins
for each row execute function private.broadcast_chat_change();
drop trigger if exists message_deliveries_broadcast on public.message_deliveries;
create trigger message_deliveries_broadcast after insert on public.message_deliveries
for each row execute function private.broadcast_chat_change();

-- ------------------------------------------------------------ N2
/**
 * Opening a conversation in one round trip: up to p_limit messages before the cursor, and only
 * THEIR files, reactions and pins, plus who is here and what the viewer may do.
 */
create or replace function public.open_thread(
  p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 30
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_out jsonb;
begin
  perform private.assert_session_allowed();
  if not private.can_act_in(p_conversation, v_uid, 'read') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select m.id from public.messages m
    where m.conversation_id = p_conversation and m.trashed_at is null
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)) x;
  select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'key_version' - 'algorithm_version' order by m.created_at, m.id)
                          from public.messages m where m.id = any (v_ids)), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) - 'key_version' - 'algorithm_version')
                             from public.message_attachments a where a.message_id = any (v_ids)), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('message_id', r.message_id, 'user_id', r.user_id, 'emoji', r.emoji))
                           from public.message_reactions r where r.message_id = any (v_ids)), '[]'::jsonb),
    'pins', coalesce((select jsonb_agg(to_jsonb(p)) from public.message_pins p
                      where p.conversation_id = p_conversation and (p.scope = 'group' or p.pinned_by = v_uid)), '[]'::jsonb),
    'summary', jsonb_build_object(
      'type', (select c.type from public.conversations c where c.id = p_conversation),
      'name', (select g.name from public.conversation_groups g where g.conversation_id = p_conversation),
      'member_count', (select count(*) from public.conversation_participants cp where cp.conversation_id = p_conversation),
      'can_send', private.can_act_in(p_conversation, v_uid, 'send')),
    'has_more', coalesce(array_length(v_ids, 1), 0) >= least(greatest(coalesce(p_limit, 30), 1), 100)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.open_thread(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.open_thread(uuid, timestamptz, uuid, int) to authenticated;

-- N1 (people): a new message also tells each member's own topic, so the Kết nối list updates
-- without listening to every conversation. Members only; the payload is ids.
create or replace function private.broadcast_message_to_members()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_row jsonb;
begin
  v_row := to_jsonb(new) - 'key_version' - 'algorithm_version';
  for v_member in select cp.user_id from public.conversation_participants cp where cp.conversation_id = new.conversation_id loop
    perform realtime.send(jsonb_build_object('message', v_row, 'op', lower(tg_op)),
                          case tg_op when 'INSERT' then 'message' else 'message_update' end,
                          'user-' || v_member::text, true);
  end loop;
  return null;
exception when others then
  return null;
end $$;
revoke execute on function private.broadcast_message_to_members() from public, anon, authenticated;
drop trigger if exists messages_broadcast_members on public.messages;
create trigger messages_broadcast_members after insert or update on public.messages
for each row execute function private.broadcast_message_to_members();
