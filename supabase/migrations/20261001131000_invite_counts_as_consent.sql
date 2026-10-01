-- AVORA-56 · A — a request sent with its message is the sender's own "Đồng ý".
--
-- Before, both sides pressed Đồng ý. Now that opening a frame requires a written request, asking
-- again for the sender's agreement is a second click that says nothing new, and the brief's
-- sentence after the person asked agrees is "Hai bạn đã kết nối." — so the opener's confirm row
-- is written together with the first message. Từ chối, the 5-message quota and the 7-day limit
-- are unchanged.

create or replace function private.post_invite_message (p_conv uuid, p_uid uuid, p_message text, p_fresh boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_conv is null then return; end if;
  if not p_fresh and exists (select 1 from public.conversations c
                             where c.id = p_conv and c.verification_opened_by = p_uid
                               and private.verification_is_live (c.id)) then
    return;
  end if;
  perform private.assert_direct_talk (p_conv, p_uid, 'text');
  insert into public.messages (conversation_id, sender_id, content, mentioned_user_ids)
  values (p_conv, p_uid, p_message, '{}');
  if p_fresh then
    insert into public.conversation_verification_confirms (conversation_id, user_id)
    values (p_conv, p_uid) on conflict do nothing;
  end if;
end;
$$;
revoke all on function private.post_invite_message (uuid, uuid, text, boolean) from public, anon, authenticated;
