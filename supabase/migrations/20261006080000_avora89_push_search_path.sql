-- AVORA-89 · 1.3 — enqueue_message_push with an empty search_path; every name fully qualified.
create or replace function private.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_surface text; v_pending boolean;
begin
  if new.system_kind is not null or new.deleted_at is not null then return null; end if;
  v_surface := private.push_surface(new.conversation_id);
  if v_surface is null then return null; end if;
  select c.verification_status = 'pending' into v_pending from public.conversations c where c.id = new.conversation_id;
  insert into public.push_outbox (user_id, kind, conversation_id, message_id, send_after)
  select cp.user_id, case when coalesce(v_pending, false) then 'friend_request' else 'message' end,
         new.conversation_id, new.id,
         -- Đọc yên tĩnh holds the push (never drops it) until the reader's quiet window ends.
         greatest(pg_catalog.now() + interval '20 seconds',
                  coalesce((select p.quiet_reading_until from public.profiles p
                            where p.id = cp.user_id and p.quiet_reading_until > pg_catalog.now()), pg_catalog.now()))
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id
    and exists (select 1 from public.push_subscriptions s where s.user_id = cp.user_id)
    and not private.is_blocked_between(cp.user_id, new.sender_id)
    and not private.push_mute_blocks(cp.user_id, v_surface, new.conversation_id,
          exists (select 1 from public.family_relations f where f.user_id = cp.user_id and f.related_user_id = new.sender_id),
          cp.user_id = any (coalesce(new.mentioned_user_ids, '{}'::uuid[])),
          new.is_urgent);
  return null;
exception when others then
  raise warning 'avora_push_enqueue_failed';
  return null;
end $function$;

revoke all on function private.enqueue_message_push() from public, anon, authenticated;
