-- AVORA-38 (gộp) / Phần 2 · Nhóm B, F + VMT item 7 — người lạ chỉ tìm được bằng PIN; giới hạn Nhóm.
--
--   find_user_by_email            only returns bạn; anyone else reads exactly as "no account".
--   create_direct_conversation    an existing 1-1 is still returned (history stays readable,
--                                 sending is gated); a new one needs bạn → avora_not_connected.
--   get_or_create_direct_conversation_for_group   bạn → as before; otherwise start_group_connection.
--   private.contact_link_match    (preview/confirm_contact_link) only matches bạn.
--   accept_invite                 both agreed → user_connections 'contact_invite'.
--   create_group_conversation     members among bạn only; ≥ 3 people with the creator
--                                 (avora_group_min_three), ≤ 300 (avora_group_full).
--   get_conversation_peer, list_my_conversations   identity hidden inside a PIN frame.
--   capacity trigger              ≤ 300 on every add path (sub-groups/Dự án: max only, no min).
-- Live definitions read on 2026-09-28; previous versions kept verbatim at the end.

CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
 RETURNS TABLE(user_id uuid, display_name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id, p.display_name, u.email::text
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE auth.uid() IS NOT NULL
    AND btrim(p_email) <> ''
    AND lower(u.email) = lower(btrim(p_email))
    AND u.id <> auth.uid()
    -- AVORA-37 / A: a blocked pair looks exactly like an address with no account.
    AND NOT private.is_blocked_between (u.id, auth.uid())
    -- AVORA-38 / ADR-029: strangers are found by PIN only; a non-bạn reads as no account.
    AND private.are_connected (u.id, auth.uid())
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.create_direct_conversation(other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := auth.uid();
  pair_key text;
  conv uuid;
begin
  if me is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'AVORA_INVALID_PARTNER' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = other_user_id) then
    raise exception 'AVORA_USER_NOT_FOUND' using errcode = '22023';
  end if;

  pair_key := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);

  select c.id into conv
    from public.conversations c
   where c.direct_key = pair_key and c.deleted_at is null;
  if conv is not null then
    return conv;
  end if;

  -- AVORA-37 / A: an existing 1-1 is left alone (history stays); a new one is not opened
  -- between two people when either has blocked the other.
  if private.is_blocked_between (me, other_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  -- AVORA-38 / ADR-029: an existing 1-1 above stays readable (sending goes through
  -- assert_direct_talk); a NEW one is only opened between bạn. Strangers go through a PIN.
  if not private.are_connected (me, other_user_id) then
    raise exception 'avora_not_connected';
  end if;

  insert into public.conversations (type, direct_key)
  values ('direct', pair_key)
  on conflict (direct_key) where direct_key is not null do nothing
  returning id into conv;

  if conv is null then
    select c.id into conv from public.conversations c where c.direct_key = pair_key;
    return conv;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv, me), (conv, other_user_id)
  on conflict do nothing;

  return conv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation_for_group(target_user_id uuid, group_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if group_id is null then
    raise exception 'AVORA_GROUP_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from public.conversations c where c.id = group_id and c.type = 'group') then
    raise exception 'AVORA_GROUP_NOT_FOUND' using errcode = '22023';
  end if;

  -- You can only start a side conversation inside a room you are both actually in.
  if not exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = group_id and cp.user_id = v_uid
  ) then
    raise exception 'AVORA_NOT_GROUP_PARTICIPANT' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = group_id and cp.user_id = target_user_id
  ) then
    raise exception 'AVORA_TARGET_NOT_GROUP_PARTICIPANT' using errcode = '22023';
  end if;

  -- AVORA-38 / B2: bạn → the ordinary 1-1; otherwise the verification frame bridged by this Nhóm.
  if private.are_connected (v_uid, target_user_id) then
    return public.create_direct_conversation(target_user_id);
  end if;
  return public.start_group_connection(group_id, target_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.contact_link_match(p_contact_id uuid, p_owner uuid)
 RETURNS TABLE(user_id uuid, matched_by text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with target as (
    select c.* from public.contact c
    where c.id = p_contact_id and c.owner_user_id = p_owner
      and c.contact_type = 'individual' and c.linked_user_id is null
  ),
  emails as (
    select nullif(lower(btrim(t.email)), '') v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'email'
  ),
  phones as (
    select private.normalize_phone (t.phone) v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'phone'
  ),
  hits as (
    select u.id uid, 'email'::text how from auth.users u
    where u.deleted_at is null and lower(u.email) in (select v from emails where v is not null)
    union all
    select u.id, 'phone' from auth.users u
    where u.deleted_at is null and coalesce(u.phone, '') <> ''
      and private.normalize_phone (u.phone) in (select v from phones where v is not null)
  ),
  eligible as (
    select h.* from hits h
    where h.uid <> p_owner
      -- AVORA-37 / A: a blocked pair is treated as no account at all, so the link
      -- suggestion cannot be used to find someone who blocked you (or whom you blocked).
      and not private.is_blocked_between (h.uid, p_owner)
      -- AVORA-38 / ADR-029: suggesting a stranger would be a way to find them by email/phone.
      and private.are_connected (h.uid, p_owner)
      and not exists (
        select 1 from public.contact c
        where c.owner_user_id = p_owner and c.linked_user_id = h.uid and c.id <> p_contact_id
      )
  )
  select e.uid,
    case when count(distinct e.how) > 1 then 'email_phone' else min(e.how) end
  from eligible e
  where (select count(distinct uid) from eligible) = 1
  group by e.uid
$function$;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite  contact_invite%ROWTYPE;
  v_contact contact%ROWTYPE;
  v_inviter_name text;
  v_reciprocal_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_invite FROM contact_invite
  WHERE invite_token = nullif(btrim(p_token), '');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
  END IF;
  -- AVORA-37 / A: between a blocked pair the invite reads exactly as if it did not exist.
  IF private.is_blocked_between(v_invite.invited_by, auth.uid()) THEN
    RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
  END IF;
  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'Lời mời này đã được chấp nhận';
  END IF;
  IF v_invite.status = 'expired' THEN
    RAISE EXCEPTION 'Lời mời đã hết hạn';
  END IF;
  IF contact_invite_timed_out(v_invite.status, v_invite.invited_at) THEN
    RAISE EXCEPTION 'Lời mời đã hết hạn';
  END IF;
  IF v_invite.invited_by = auth.uid() THEN
    RAISE EXCEPTION 'Không thể tự chấp nhận lời mời của chính mình';
  END IF;

  SELECT * INTO v_contact FROM contact WHERE id = v_invite.contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liên hệ gốc không còn tồn tại';
  END IF;
  IF v_contact.linked_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Hai tài khoản đã liên kết với nhau từ trước';
  END IF;
  IF v_contact.linked_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Người này đã liên kết với một tài khoản khác';
  END IF;

  SELECT display_name INTO v_inviter_name FROM profiles WHERE id = v_contact.owner_user_id;

  UPDATE contact_invite
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invite.id;

  UPDATE contact
  SET linked_user_id = auth.uid(), updated_at = now()
  WHERE id = v_contact.id;

  INSERT INTO contact (
    owner_user_id, contact_type, name, phone, email, note, linked_user_id
  ) VALUES (
    auth.uid(), 'individual',
    coalesce(v_inviter_name, v_contact.name),
    v_contact.phone, v_contact.email, v_contact.note,
    v_contact.owner_user_id
  )
  RETURNING id INTO v_reciprocal_id;

  -- AVORA-38 / ADR-029: both sides agreed through the invite, so they are now bạn.
  PERFORM private.connect_users(v_invite.invited_by, auth.uid(), 'contact_invite');

  RETURN v_reciprocal_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_name text, p_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  m uuid;
  v_members uuid[];
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_group_name_required'; end if;
  if char_length(v_name) > 120 then raise exception 'avora_group_name_max_len'; end if;

  -- AVORA-38 / F + item 7: members are chosen among bạn; anyone else (unknown, blocked, not bạn)
  -- is skipped like an unknown id. A Nhóm needs 3 people counting the creator, at most 300.
  select coalesce(array_agg(distinct x), '{}') into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) x
  where x <> v_uid and exists (select 1 from public.profiles p where p.id = x)
    and not private.is_blocked_between (x, v_uid)
    and private.are_connected (x, v_uid);
  if coalesce(array_length(v_members, 1), 0) < 2 then raise exception 'avora_group_min_three'; end if;
  if array_length(v_members, 1) + 1 > 300 then raise exception 'avora_group_full'; end if;

  insert into public.conversations (type) values ('group') returning id into v_id;
  insert into public.conversation_groups (conversation_id, name, owner_id) values (v_id, v_name, v_uid);
  insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, v_uid, 'owner')
    on conflict do nothing;

  foreach m in array v_members loop
    -- AVORA-37 / A: a blocked pair is skipped exactly like an unknown id, so a new "group"
    -- of two cannot stand in for the 1-1 that is refused.
    if m <> v_uid and exists (select 1 from public.profiles p where p.id = m)
       and not private.is_blocked_between (m, v_uid) then
      insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, m, 'member')
        on conflict do nothing;
    end if;
  end loop;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_conversation_peer(p_conversation_id uuid)
 RETURNS TABLE(peer_id uuid, peer_display_name text, peer_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- AVORA-38 / C: inside a live verification frame opened from a PIN the name and email stay
  -- hidden; one opened from a Nhóm shows the name the Nhóm already shows, never the email.
  SELECT cp.user_id,
    CASE WHEN private.verification_is_live (p_conversation_id) AND c.verification_via_group_id IS NULL
      THEN NULL ELSE pp.display_name END,
    CASE WHEN private.verification_is_live (p_conversation_id) THEN NULL ELSE pu.email::text END
  FROM public.conversation_participants cp
  JOIN public.conversations c ON c.id = cp.conversation_id
  LEFT JOIN public.profiles pp ON pp.id = cp.user_id
  LEFT JOIN auth.users pu ON pu.id = cp.user_id
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id <> auth.uid()
    AND private.is_conversation_participant(p_conversation_id, auth.uid())
  ORDER BY cp.joined_at
  LIMIT 1;
$function$;

-- list_my_conversations gains the verification fields; its return type changes → DROP + CREATE.
-- A frame that was declined, expired or lost its bridging Nhóm disappears for both. A live frame
-- opened from a PIN returns no name/email, only peer_pin; one opened from a Nhóm returns the name
-- and the Nhóm's name. peer_pin is otherwise returned only between bạn (ADR-029 rule 6).
drop function public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text,
  last_message_content text, last_message_at timestamptz, last_message_sender_id uuid,
  unread_count integer, sort_at timestamptz, conversation_type text, group_name text,
  member_count integer,
  is_connected boolean, verification_status text, verification_expires_at timestamptz,
  verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid,
  verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text
)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    peer.user_id,
    case when live.v and c.verification_via_group_id is null then null else pp.display_name end,
    case when live.v then null else pu.email::text end,
    lm.content,
    lm.created_at,
    lm.sender_id,
    coalesce(un.unread_count, 0)::integer,
    coalesce(lm.created_at, c.created_at),
    c.type,
    cg.name,
    coalesce(mc.member_count, 1)::integer,
    case when c.type = 'direct' then private.are_connected (auth.uid(), peer.user_id) end,
    case when live.v then 'pending' end,
    case when live.v then c.verification_expires_at end,
    case when live.v then c.verification_via_group_id end,
    case when live.v then bg.name end,
    case when live.v then c.verification_opened_by end,
    case when live.v then greatest(0, 5 - (
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.sender_id = auth.uid() and m2.created_at >= c.verification_started_at
    ))::integer end,
    case when live.v then exists (
      select 1 from public.conversation_verification_confirms vc
      where vc.conversation_id = c.id and vc.user_id = auth.uid()
    ) end,
    case
      when c.type <> 'direct' then null
      when live.v and c.verification_via_group_id is null then pin.pin
      when not live.v and private.are_connected (auth.uid(), peer.user_id) then pin.pin
    end
  from public.conversations c
  join public.conversation_participants me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_groups cg on cg.conversation_id = c.id
  left join lateral (
    select cp.user_id
    from public.conversation_participants cp
    where cp.conversation_id = c.id
      and cp.user_id <> auth.uid()
      and c.type = 'direct'
    order by cp.joined_at
    limit 1
  ) peer on true
  left join public.profiles pp on pp.id = peer.user_id
  left join auth.users pu on pu.id = peer.user_id
  left join public.user_pins pin on pin.user_id = peer.user_id
  left join public.conversation_groups bg on bg.conversation_id = c.verification_via_group_id
  cross join lateral (select (c.verification_status = 'pending' and private.verification_is_live (c.id)) as v) live
  left join lateral (
    select m.content, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as unread_count
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_id <> auth.uid()
      and (me.last_read_at is null or m.created_at > me.last_read_at)
  ) un on true
  left join lateral (
    select count(*) as member_count
    from public.conversation_participants cp2
    where cp2.conversation_id = c.id
  ) mc on true
  where auth.uid() is not null
    and c.deleted_at is null
    -- A frame that ended (declined, expired, bridge gone) is hidden unless the pair are bạn.
    and not (
      c.type = 'direct'
      and c.verification_status in ('pending', 'closed')
      and not live.v
      and not private.are_connected (auth.uid(), peer.user_id)
    )
  order by coalesce(lm.created_at, c.created_at) desc;
$$;
revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;

-- ---------------------------------------------------------------------------------------
-- Nhóm tối đa 300 người — on EVERY path that adds a member (create_group_conversation,
-- create_sub_group, create_project, join_group_with_invite, and any future one), enforced by
-- one trigger so no path can forget it. Existing groups above the limit keep everyone; the
-- trigger only refuses the next addition. accept_invite links contacts and adds nobody to a Nhóm.
-- ---------------------------------------------------------------------------------------
create or replace function private.enforce_group_capacity ()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select type from public.conversations where id = new.conversation_id) is distinct from 'group' then
    return new;
  end if;
  perform pg_advisory_xact_lock (hashtext ('avora_group_capacity:' || new.conversation_id::text));
  if exists (select 1 from public.conversation_participants
             where conversation_id = new.conversation_id and user_id = new.user_id) then
    return new;
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = new.conversation_id) >= 300 then
    raise exception 'avora_group_full';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_group_capacity () from public, anon, authenticated;
create trigger conversation_participants_group_capacity
  before insert on public.conversation_participants
  for each row execute function private.enforce_group_capacity ();

-- ===================== Previous definitions (verbatim) =====================
-- CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
--  RETURNS TABLE(user_id uuid, display_name text, email text)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
--   SELECT u.id, p.display_name, u.email::text
--   FROM auth.users u
--   LEFT JOIN public.profiles p ON p.id = u.id
--   WHERE auth.uid() IS NOT NULL
--     AND btrim(p_email) <> ''
--     AND lower(u.email) = lower(btrim(p_email))
--     AND u.id <> auth.uid()
--     -- AVORA-37 / A: a blocked pair looks exactly like an address with no account.
--     AND NOT private.is_blocked_between (u.id, auth.uid())
--   LIMIT 1;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_direct_conversation(other_user_id uuid)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   me uuid := auth.uid();
--   pair_key text;
--   conv uuid;
-- begin
--   if me is null then
--     raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
--   end if;
--   if other_user_id is null or other_user_id = me then
--     raise exception 'AVORA_INVALID_PARTNER' using errcode = '22023';
--   end if;
--   if not exists (select 1 from public.profiles p where p.id = other_user_id) then
--     raise exception 'AVORA_USER_NOT_FOUND' using errcode = '22023';
--   end if;
-- 
--   pair_key := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);
-- 
--   select c.id into conv
--     from public.conversations c
--    where c.direct_key = pair_key and c.deleted_at is null;
--   if conv is not null then
--     return conv;
--   end if;
-- 
--   -- AVORA-37 / A: an existing 1-1 is left alone (history stays); a new one is not opened
--   -- between two people when either has blocked the other.
--   if private.is_blocked_between (me, other_user_id) then
--     raise exception 'avora_contact_unavailable';
--   end if;
-- 
--   insert into public.conversations (type, direct_key)
--   values ('direct', pair_key)
--   on conflict (direct_key) where direct_key is not null do nothing
--   returning id into conv;
-- 
--   if conv is null then
--     select c.id into conv from public.conversations c where c.direct_key = pair_key;
--     return conv;
--   end if;
-- 
--   insert into public.conversation_participants (conversation_id, user_id)
--   values (conv, me), (conv, other_user_id)
--   on conflict do nothing;
-- 
--   return conv;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation_for_group(target_user_id uuid, group_id uuid)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
-- begin
--   if v_uid is null then
--     raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
--   end if;
--   if group_id is null then
--     raise exception 'AVORA_GROUP_REQUIRED' using errcode = '22023';
--   end if;
-- 
--   if not exists (select 1 from public.conversations c where c.id = group_id and c.type = 'group') then
--     raise exception 'AVORA_GROUP_NOT_FOUND' using errcode = '22023';
--   end if;
-- 
--   -- You can only start a side conversation inside a room you are both actually in.
--   if not exists (
--     select 1 from public.conversation_participants cp
--      where cp.conversation_id = group_id and cp.user_id = v_uid
--   ) then
--     raise exception 'AVORA_NOT_GROUP_PARTICIPANT' using errcode = '42501';
--   end if;
-- 
--   if not exists (
--     select 1 from public.conversation_participants cp
--      where cp.conversation_id = group_id and cp.user_id = target_user_id
--   ) then
--     raise exception 'AVORA_TARGET_NOT_GROUP_PARTICIPANT' using errcode = '22023';
--   end if;
-- 
--   return public.create_direct_conversation(target_user_id);
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION private.contact_link_match(p_contact_id uuid, p_owner uuid)
--  RETURNS TABLE(user_id uuid, matched_by text)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
--   with target as (
--     select c.* from public.contact c
--     where c.id = p_contact_id and c.owner_user_id = p_owner
--       and c.contact_type = 'individual' and c.linked_user_id is null
--   ),
--   emails as (
--     select nullif(lower(btrim(t.email)), '') v from target t
--     union
--     select ch.value_normalized from public.contact_channel ch, target t
--     where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'email'
--   ),
--   phones as (
--     select private.normalize_phone (t.phone) v from target t
--     union
--     select ch.value_normalized from public.contact_channel ch, target t
--     where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'phone'
--   ),
--   hits as (
--     select u.id uid, 'email'::text how from auth.users u
--     where u.deleted_at is null and lower(u.email) in (select v from emails where v is not null)
--     union all
--     select u.id, 'phone' from auth.users u
--     where u.deleted_at is null and coalesce(u.phone, '') <> ''
--       and private.normalize_phone (u.phone) in (select v from phones where v is not null)
--   ),
--   eligible as (
--     select h.* from hits h
--     where h.uid <> p_owner
--       -- AVORA-37 / A: a blocked pair is treated as no account at all, so the link
--       -- suggestion cannot be used to find someone who blocked you (or whom you blocked).
--       and not private.is_blocked_between (h.uid, p_owner)
--       and not exists (
--         select 1 from public.contact c
--         where c.owner_user_id = p_owner and c.linked_user_id = h.uid and c.id <> p_contact_id
--       )
--   )
--   select e.uid,
--     case when count(distinct e.how) > 1 then 'email_phone' else min(e.how) end
--   from eligible e
--   where (select count(distinct uid) from eligible) = 1
--   group by e.uid
-- $function$

-- CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_invite  contact_invite%ROWTYPE;
--   v_contact contact%ROWTYPE;
--   v_inviter_name text;
--   v_reciprocal_id uuid;
-- BEGIN
--   IF auth.uid() IS NULL THEN
--     RAISE EXCEPTION 'Chưa đăng nhập';
--   END IF;
-- 
--   SELECT * INTO v_invite FROM contact_invite
--   WHERE invite_token = nullif(btrim(p_token), '');
-- 
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
--   END IF;
--   -- AVORA-37 / A: between a blocked pair the invite reads exactly as if it did not exist.
--   IF private.is_blocked_between(v_invite.invited_by, auth.uid()) THEN
--     RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
--   END IF;
--   IF v_invite.status = 'accepted' THEN
--     RAISE EXCEPTION 'Lời mời này đã được chấp nhận';
--   END IF;
--   IF v_invite.status = 'expired' THEN
--     RAISE EXCEPTION 'Lời mời đã hết hạn';
--   END IF;
--   IF contact_invite_timed_out(v_invite.status, v_invite.invited_at) THEN
--     RAISE EXCEPTION 'Lời mời đã hết hạn';
--   END IF;
--   IF v_invite.invited_by = auth.uid() THEN
--     RAISE EXCEPTION 'Không thể tự chấp nhận lời mời của chính mình';
--   END IF;
-- 
--   SELECT * INTO v_contact FROM contact WHERE id = v_invite.contact_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Liên hệ gốc không còn tồn tại';
--   END IF;
--   IF v_contact.linked_user_id = auth.uid() THEN
--     RAISE EXCEPTION 'Hai tài khoản đã liên kết với nhau từ trước';
--   END IF;
--   IF v_contact.linked_user_id IS NOT NULL THEN
--     RAISE EXCEPTION 'Người này đã liên kết với một tài khoản khác';
--   END IF;
-- 
--   SELECT display_name INTO v_inviter_name FROM profiles WHERE id = v_contact.owner_user_id;
-- 
--   UPDATE contact_invite
--   SET status = 'accepted', accepted_at = now()
--   WHERE id = v_invite.id;
-- 
--   UPDATE contact
--   SET linked_user_id = auth.uid(), updated_at = now()
--   WHERE id = v_contact.id;
-- 
--   INSERT INTO contact (
--     owner_user_id, contact_type, name, phone, email, note, linked_user_id
--   ) VALUES (
--     auth.uid(), 'individual',
--     coalesce(v_inviter_name, v_contact.name),
--     v_contact.phone, v_contact.email, v_contact.note,
--     v_contact.owner_user_id
--   )
--   RETURNING id INTO v_reciprocal_id;
-- 
--   RETURN v_reciprocal_id;
-- END;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_group_conversation(p_name text, p_member_ids uuid[] DEFAULT '{}'::uuid[])
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_name text := nullif(btrim(coalesce(p_name, '')), '');
--   v_id uuid;
--   m uuid;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_name is null then raise exception 'avora_group_name_required'; end if;
--   if char_length(v_name) > 120 then raise exception 'avora_group_name_max_len'; end if;
-- 
--   insert into public.conversations (type) values ('group') returning id into v_id;
--   insert into public.conversation_groups (conversation_id, name, owner_id) values (v_id, v_name, v_uid);
--   insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, v_uid, 'owner')
--     on conflict do nothing;
-- 
--   foreach m in array coalesce(p_member_ids, '{}'::uuid[]) loop
--     -- AVORA-37 / A: a blocked pair is skipped exactly like an unknown id, so a new "group"
--     -- of two cannot stand in for the 1-1 that is refused.
--     if m <> v_uid and exists (select 1 from public.profiles p where p.id = m)
--        and not private.is_blocked_between (m, v_uid) then
--       insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, m, 'member')
--         on conflict do nothing;
--     end if;
--   end loop;
-- 
--   return v_id;
-- end $function$

-- CREATE OR REPLACE FUNCTION public.get_conversation_peer(p_conversation_id uuid)
--  RETURNS TABLE(peer_id uuid, peer_display_name text, peer_email text)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
--   SELECT cp.user_id, pp.display_name, pu.email::text
--   FROM public.conversation_participants cp
--   LEFT JOIN public.profiles pp ON pp.id = cp.user_id
--   LEFT JOIN auth.users pu ON pu.id = cp.user_id
--   WHERE cp.conversation_id = p_conversation_id
--     AND cp.user_id <> auth.uid()
--     AND private.is_conversation_participant(p_conversation_id, auth.uid())
--   ORDER BY cp.joined_at
--   LIMIT 1;
-- $function$

-- CREATE OR REPLACE FUNCTION public.list_my_conversations()
--  RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
--   select
--     c.id,
--     peer.user_id,
--     pp.display_name,
--     pu.email::text,
--     lm.content,
--     lm.created_at,
--     lm.sender_id,
--     coalesce(un.unread_count, 0)::integer,
--     coalesce(lm.created_at, c.created_at),
--     c.type,
--     cg.name,
--     coalesce(mc.member_count, 1)::integer
--   from public.conversations c
--   join public.conversation_participants me
--     on me.conversation_id = c.id and me.user_id = auth.uid()
--   left join public.conversation_groups cg on cg.conversation_id = c.id
--   left join lateral (
--     select cp.user_id
--     from public.conversation_participants cp
--     where cp.conversation_id = c.id
--       and cp.user_id <> auth.uid()
--       and c.type = 'direct'
--     order by cp.joined_at
--     limit 1
--   ) peer on true
--   left join public.profiles pp on pp.id = peer.user_id
--   left join auth.users pu on pu.id = peer.user_id
--   left join lateral (
--     select m.content, m.created_at, m.sender_id
--     from public.messages m
--     where m.conversation_id = c.id
--     order by m.created_at desc, m.id desc
--     limit 1
--   ) lm on true
--   left join lateral (
--     select count(*) as unread_count
--     from public.messages m
--     where m.conversation_id = c.id
--       and m.sender_id <> auth.uid()
--       and (me.last_read_at is null or m.created_at > me.last_read_at)
--   ) un on true
--   left join lateral (
--     select count(*) as member_count
--     from public.conversation_participants cp2
--     where cp2.conversation_id = c.id
--   ) mc on true
--   where auth.uid() is not null
--     and c.deleted_at is null
--   order by coalesce(lm.created_at, c.created_at) desc;
-- $function$
