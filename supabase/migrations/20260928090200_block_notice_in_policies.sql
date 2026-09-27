-- AVORA-37 / A — let a refused 1-1 write say why, in the app's own words.
--
-- 20260928090000 appended "not private.direct_peer_blocked(...)" to three INSERT policies.
-- A policy that is simply false returns the generic 42501 RLS error, which the client cannot
-- tell apart from "not a member". The RPC paths already raise avora_contact_unavailable, so
-- the policies now do the same through an assert helper, and the composer can show its one
-- neutral line ("Không gửi được tin trong cuộc trò chuyện này.").
--
-- The helper raises ONLY for a member of that 1-1: someone outside the conversation still
-- gets the ordinary RLS refusal and learns nothing about who blocked whom. Everything else in
-- the three policies is unchanged.
--
-- Before (from 20260928090000):
--   messages."Participants can send messages" WITH CHECK
--     sender_id = auth.uid() AND is_conversation_participant(conversation_id, auth.uid())
--     AND NOT private.direct_peer_blocked(conversation_id, auth.uid())
--   message_reactions.message_reactions_insert_own / message_recall_request.message_recall_request_insert
--     ... EXISTS (... AND NOT private.direct_peer_blocked(m.conversation_id, auth.uid()))

create or replace function private.assert_contact_available (p_conversation_id uuid, p_user_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
begin
  if private.is_conversation_participant (p_conversation_id, p_user_id)
     and private.direct_peer_blocked (p_conversation_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  return true;
end;
$$;

revoke all on function private.assert_contact_available (uuid, uuid) from public, anon;
grant execute on function private.assert_contact_available (uuid, uuid) to authenticated;

alter policy "Participants can send messages" on public.messages
  with check (
    (sender_id = (select auth.uid()))
    and private.is_conversation_participant (conversation_id, (select auth.uid()))
    and private.assert_contact_available (conversation_id, (select auth.uid()))
  );

alter policy message_reactions_insert_own on public.message_reactions
  with check (
    (user_id = (select auth.uid()))
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and private.is_conversation_participant (m.conversation_id, (select auth.uid()))
        and private.assert_contact_available (m.conversation_id, (select auth.uid()))
    )
  );

alter policy message_recall_request_insert on public.message_recall_request
  with check (
    (requested_by = (select auth.uid()))
    and exists (
      select 1 from public.messages m
      where m.id = message_recall_request.message_id
        and m.sender_id <> (select auth.uid())
        and m.deleted_at is null
        and private.is_conversation_participant (m.conversation_id, (select auth.uid()))
        and private.assert_contact_available (m.conversation_id, (select auth.uid()))
    )
  );
