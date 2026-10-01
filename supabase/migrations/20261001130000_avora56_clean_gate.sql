-- AVORA-56 — Cổng vào sạch & Hiệu ứng hoàn thành.
--
-- A. A friend request carries a message (10–200 characters) that becomes the first message of
--    the existing pending frame — no new table. Links are refused in every message of a live
--    pending frame, by a trigger, so a direct insert that skips the app is refused too
--    (avora_verification_no_links). The person asked sees their requests through
--    list_my_connection_requests(): name / PIN under the same visibility rules as
--    list_my_conversations, the message, and nothing about mutual friends.
-- E. profiles.celebration_style — the completion effect each person picked (ADR-036).

-- ---------------------------------------------------------------------------------------
-- E. Completion effect
-- ---------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists celebration_style text not null default 'inspiring';
alter table public.profiles drop constraint if exists profiles_celebration_style_check;
alter table public.profiles
  add constraint profiles_celebration_style_check
  check (celebration_style in ('subtle', 'inspiring', 'vivid', 'fireworks'));
-- profiles SELECT/UPDATE are column-level: new columns are not inherited.
grant select (celebration_style), update (celebration_style) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------------
-- A. Links
-- ---------------------------------------------------------------------------------------

/** http(s)://, www., or a word followed by a common top-level domain. Mirrored in lib/invite-message.ts. */
create or replace function private.text_has_link (p_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce (p_text, '') ~* (
    '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(com|net|org|vn|io|co|info|biz|me|app|dev|xyz|top|site|online|link|ly|gl|shop|store|us|uk|tv|cc|ai|gg|to|in|ru|cn|edu|gov|asia|club|live|page|tk|ml)\M)'
  );
$$;
revoke all on function private.text_has_link (text) from public, anon;
grant execute on function private.text_has_link (text) to authenticated;

create or replace function private.refuse_links_while_pending ()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.content is null or not private.text_has_link (new.content) then return new; end if;
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;
  if exists (select 1 from public.conversations c
             where c.id = new.conversation_id and c.type = 'direct' and c.verification_status = 'pending')
     and private.verification_is_live (new.conversation_id) then
    raise exception 'avora_verification_no_links';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_links_while_pending () from public, anon, authenticated;

drop trigger if exists messages_refuse_links_while_pending on public.messages;
create trigger messages_refuse_links_while_pending
  before insert or update of content on public.messages
  for each row execute function private.refuse_links_while_pending ();

/** The request message, trimmed, or a refusal. */
create or replace function private.invite_message_or_raise (p_message text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v text := regexp_replace (btrim (coalesce (p_message, '')), '\s+', ' ', 'g');
begin
  if char_length (v) < 10 or char_length (v) > 200 then raise exception 'avora_invite_message_length'; end if;
  if private.text_has_link (v) then raise exception 'avora_verification_no_links'; end if;
  return v;
end;
$$;
revoke all on function private.invite_message_or_raise (text) from public, anon, authenticated;

/**
 * Sends the request message into a conversation the caller just reached. Goes through the same
 * gate as any message (quota, block, connection) because SECURITY DEFINER skips the RLS check.
 * Skipped when the caller already opened this live frame: their message is already in it.
 */
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
end;
$$;
revoke all on function private.post_invite_message (uuid, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- A. Opening a frame now needs the message. Old one-argument forms are dropped so no client
--    can open a request without it.
-- ---------------------------------------------------------------------------------------
drop function if exists public.start_pin_connection (text);
drop function if exists public.start_group_connection (uuid, uuid);

create or replace function public.start_pin_connection (p_pin text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_pin text := upper (regexp_replace (btrim (coalesce (p_pin, '')), '\s', '', 'g'));
  v_message text;
  v_other uuid;
  v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  -- Checked before anything is looked up or counted: says nothing about the PIN.
  v_message := private.invite_message_or_raise (p_message);
  if not exists (select 1 from public.user_pins where user_id = v_uid and pin is not null) then
    raise exception 'avora_pin_required';
  end if;
  -- Counted before the lookup, so a miss costs the same as a hit.
  perform private.note_connection_attempt (v_uid, 'pin');

  if v_pin not like 'A-%' then v_pin := 'A-' || v_pin; end if;
  select up.user_id into v_other from public.user_pins up where up.pin = v_pin;

  if v_other = v_uid then raise exception 'avora_pin_self'; end if;
  -- Not found / no PIN / blocked all return NULL — never an exception — so the attempt row
  -- above survives (20260928100500).
  if v_other is null or private.is_blocked_between (v_uid, v_other) then
    return null;
  end if;

  if private.are_connected (v_uid, v_other) then
    v_conv := private.direct_for_connected (v_uid, v_other);
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.live_verification_between (v_uid, v_other);
  if v_conv is not null then
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.open_verification (v_uid, v_other, null);
  perform private.post_invite_message (v_conv, v_uid, v_message, true);
  return v_conv;
end;
$$;

create or replace function public.start_group_connection (p_group_id uuid, p_user_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_message text;
  v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_message := private.invite_message_or_raise (p_message);
  if p_user_id is null or p_user_id = v_uid then raise exception 'avora_invalid_partner'; end if;
  if not exists (select 1 from public.conversations c where c.id = p_group_id and c.type = 'group' and c.deleted_at is null)
     or not private.is_conversation_participant (p_group_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if not private.is_conversation_participant (p_group_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  if private.is_blocked_between (v_uid, p_user_id) then raise exception 'avora_contact_unavailable'; end if;

  if private.are_connected (v_uid, p_user_id) then
    v_conv := private.direct_for_connected (v_uid, p_user_id);
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.live_verification_between (v_uid, p_user_id);
  if v_conv is not null then
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  if not coalesce ((select allow_group_connection from public.profiles where id = p_user_id), true) then
    raise exception 'avora_group_connection_off';
  end if;
  if exists (select 1 from private.verification_declines d
             where d.decliner_id = p_user_id and d.opener_id = v_uid
               and d.declined_at > now() - interval '30 days') then
    raise exception 'avora_contact_unavailable';
  end if;
  if (select count (*) from private.connection_attempts
      where user_id = v_uid and kind = 'group' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'avora_group_connection_daily_limit';
  end if;
  perform private.note_connection_attempt (v_uid, 'group');

  v_conv := private.open_verification (v_uid, p_user_id, p_group_id);
  perform private.post_invite_message (v_conv, v_uid, v_message, true);
  return v_conv;
end;
$$;

revoke all on function public.start_pin_connection (text, text) from public, anon;
revoke all on function public.start_group_connection (uuid, uuid, text) from public, anon;
grant execute on function public.start_pin_connection (text, text) to authenticated;
grant execute on function public.start_group_connection (uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- A. "Lời mời kết bạn · N" — requests waiting on the caller. No mutual friends, on purpose.
-- ---------------------------------------------------------------------------------------
create or replace function public.list_my_connection_requests ()
returns table (
  conversation_id uuid,
  display_name text,
  pin text,
  via_group_name text,
  message text,
  started_at timestamptz,
  expires_at timestamptz
)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    -- Same rule as list_my_conversations: the PIN path shows the PIN, the Nhóm path the name.
    case when c.verification_via_group_id is null then null else p.display_name end,
    case when c.verification_via_group_id is null then up.pin end,
    g.name,
    fm.content,
    c.verification_started_at,
    c.verification_expires_at
  from public.conversations c
  join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid ()
  left join public.profiles p on p.id = c.verification_opened_by
  left join public.user_pins up on up.user_id = c.verification_opened_by
  left join public.conversation_groups g on g.conversation_id = c.verification_via_group_id
  left join lateral (
    select m.content from public.messages m
    where m.conversation_id = c.id and m.sender_id = c.verification_opened_by
      and m.created_at >= c.verification_started_at and m.deleted_at is null
    order by m.created_at, m.id
    limit 1
  ) fm on true
  where auth.uid () is not null
    and c.type = 'direct'
    and c.deleted_at is null
    and c.verification_status = 'pending'
    and c.verification_opened_by is distinct from auth.uid ()
    and private.verification_is_live (c.id)
    and not private.is_blocked_between (auth.uid (), c.verification_opened_by)
    and not exists (select 1 from public.conversation_verification_confirms vc
                    where vc.conversation_id = c.id and vc.user_id = auth.uid ())
  order by c.verification_started_at desc;
$$;
revoke all on function public.list_my_connection_requests () from public, anon;
grant execute on function public.list_my_connection_requests () to authenticated;
