-- Read-only snapshot of live definitions, 2026-09-27, before AVORA-38 (gộp) / AVORA-39 Phần 3.
-- Source: pg_get_functiondef / pg_policy / pg_constraint on the live project. Nothing here was applied.

-- ===== policies =====
-- checklist_items · checklist_items_delete [d]
--   USING: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- checklist_items · checklist_items_insert [a]
--   USING: null
--   CHECK: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
-- checklist_items · checklist_items_select [r]
--   USING: private.can_view_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- checklist_items · checklist_items_update [w]
--   USING: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
-- message_attachments · Attacher can remove attachment [d]
--   USING: (attached_by = ( SELECT auth.uid() AS uid))
--   CHECK: null
-- message_attachments · Participants can attach [a]
--   USING: null
--   CHECK: ((attached_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_attachments.message_id) AND (m.conversation_id = message_attachments.conversation_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))))
-- message_attachments · Participants can read attachments [r]
--   USING: private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- messages · Authors can delete own journal messages [d]
--   USING: ((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type = 'personal'::text)))))
--   CHECK: null
-- messages · Participants can read messages [r]
--   USING: private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- messages · Participants can send messages [a]
--   USING: null
--   CHECK: ((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(conversation_id, ( SELECT auth.uid() AS uid)))
-- task_resources · task_resources_delete [d]
--   USING: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- task_resources · task_resources_insert [a]
--   USING: null
--   CHECK: ((created_by = ( SELECT auth.uid() AS uid)) AND private.can_link_task(task_id, ( SELECT auth.uid() AS uid)))
-- task_resources · task_resources_select [r]
--   USING: private.can_view_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- task_resources · task_resources_update [w]
--   USING: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
--   CHECK: private.can_link_task(task_id, ( SELECT auth.uid() AS uid))
-- task_suggestions · task_suggestions_select_participant [r]
--   USING: private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid))
--   CHECK: null
-- tasks · tasks_delete_own_personal [d]
--   USING: ((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid)))
--   CHECK: null
-- tasks · tasks_insert_creator [a]
--   USING: null
--   CHECK: ((creator_id = ( SELECT auth.uid() AS uid)) AND (((type = 'personal'::text) AND (conversation_id IS NULL) AND (status = 'confirmed'::text)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND (status = 'pending_confirmation'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))) AND (NOT private.direct_peer_blocked(conversation_id, ( SELECT auth.uid() AS uid))))
-- tasks · tasks_select_visible [r]
--   USING: ((pending_decision_id IS NULL) AND (((type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid))) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.conversation_is_live(conversation_id))))
--   CHECK: null
-- tasks · tasks_update_own_personal [w]
--   USING: ((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid)))
--   CHECK: ((pending_decision_id IS NULL) AND (type = 'personal'::text) AND (creator_id = ( SELECT auth.uid() AS uid)))

-- ===== tasks CHECK constraints =====
-- tasks_confirmed_state: CHECK ((((type = 'personal'::text) AND (status <> ALL (ARRAY['pending_confirmation'::text, 'skipped'::text]))) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND ((status = ANY (ARRAY['pending_confirmation'::text, 'skipped'::text])) = (confirmed_at IS NULL)))))
-- tasks_coordinates_valid: CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))))
-- tasks_custom_recurrence_has_pattern: CHECK (((recurrence <> 'custom'::text) OR (recurrence_pattern IS NOT NULL)))
-- tasks_departure_before_start: CHECK (((departure_reminder_at IS NULL) OR ((start_at IS NOT NULL) AND (departure_reminder_at <= start_at))))
-- tasks_done_state: CHECK (((done_at IS NOT NULL) = (status = ANY (ARRAY['done_pending_review'::text, 'done'::text]))))
-- tasks_estimated_duration_range: CHECK (((estimated_duration_minutes IS NULL) OR ((estimated_duration_minutes >= 1) AND (estimated_duration_minutes <= 10080))))
-- tasks_event_end_after_start: CHECK (((end_at IS NULL) OR ((start_at IS NOT NULL) AND (end_at >= start_at))))
-- tasks_event_needs_start: CHECK (((NOT requires_presence) OR (start_at IS NOT NULL)))
-- tasks_location_length: CHECK (((location IS NULL) OR (char_length(location) <= 300)))
-- tasks_output_value_max_len: CHECK (((output_value IS NULL) OR (char_length(output_value) <= 2000)))
-- tasks_personal_has_no_conversation: CHECK ((((type = 'personal'::text) AND (conversation_id IS NULL)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND (conversation_id IS NOT NULL))))
-- tasks_personal_no_peer_delete: CHECK (((type <> 'personal'::text) OR (deleted_by_peer = false)))
-- tasks_progress_percent_range: CHECK (((progress_percent IS NULL) OR ((progress_percent >= 0) AND (progress_percent <= 100))))
-- tasks_recurrence_allowed: CHECK ((recurrence = ANY (ARRAY['none'::text, 'daily'::text, 'weekly'::text, 'monthly'::text, 'custom'::text])))
-- tasks_review_state: CHECK ((((type = 'personal'::text) AND (status <> 'done_pending_review'::text) AND (completed_confirmed_at IS NULL)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND ((completed_confirmed_at IS NOT NULL) = (status = 'done'::text)))))
-- tasks_silent_skip_state: CHECK (((skipped_silently = false) OR (status = 'skipped'::text)))
-- tasks_skipped_state: CHECK (((skipped_at IS NOT NULL) = (status = 'skipped'::text)))
-- tasks_status_allowed: CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'done_pending_review'::text, 'done'::text, 'skipped'::text])))
-- tasks_title_len: CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)))
-- tasks_travel_duration_range: CHECK (((travel_duration_minutes IS NULL) OR ((travel_duration_minutes >= 0) AND (travel_duration_minutes <= 1440))))
-- tasks_type_allowed: CHECK ((type = ANY (ARRAY['personal'::text, '1-1-shared'::text, 'group-shared'::text])))

-- ===== task_suggestions privileges =====
-- relacl: {postgres=arwdDxtm/postgres,service_role=Dxtm/postgres,authenticated=r/postgres} — table-level SELECT, no column ACLs

-- ===== find_user_by_email =====
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
  LIMIT 1;
$function$

;

-- ===== create_direct_conversation =====
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
$function$

;

-- ===== get_or_create_direct_conversation_for_group =====
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

  return public.create_direct_conversation(target_user_id);
end;
$function$

;

-- ===== accept_invite =====
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

  RETURN v_reciprocal_id;
END;
$function$

;

-- ===== preview_contact_link =====
CREATE OR REPLACE FUNCTION public.preview_contact_link(p_contact_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_dismissed text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then return null; end if;

  select link_suggestion_dismissed into v_dismissed from public.contact where id = p_contact_id;
  if v_dismissed = private.contact_link_fingerprint (p_contact_id, v_match.user_id) then
    return null;
  end if;

  return v_match.matched_by;
end;
$function$

;

-- ===== confirm_contact_link =====
CREATE OR REPLACE FUNCTION public.confirm_contact_link(p_contact_id uuid)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_row public.contact%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then raise exception 'avora_contact_link_no_match'; end if;

  update public.contact
    set linked_user_id = v_match.user_id, link_suggestion_dismissed = null, updated_at = now()
    where id = p_contact_id and owner_user_id = v_uid and linked_user_id is null
    returning * into v_row;
  if not found then raise exception 'avora_contact_link_no_match'; end if;

  return v_row;
end;
$function$

;

-- ===== contact_link_match =====
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
$function$

;

-- ===== list_my_conversations =====
CREATE OR REPLACE FUNCTION public.list_my_conversations()
 RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    c.id,
    peer.user_id,
    pp.display_name,
    pu.email::text,
    lm.content,
    lm.created_at,
    lm.sender_id,
    coalesce(un.unread_count, 0)::integer,
    coalesce(lm.created_at, c.created_at),
    c.type,
    cg.name,
    coalesce(mc.member_count, 1)::integer
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
  order by coalesce(lm.created_at, c.created_at) desc;
$function$

;

-- ===== get_conversation_peer =====
CREATE OR REPLACE FUNCTION public.get_conversation_peer(p_conversation_id uuid)
 RETURNS TABLE(peer_id uuid, peer_display_name text, peer_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT cp.user_id, pp.display_name, pu.email::text
  FROM public.conversation_participants cp
  LEFT JOIN public.profiles pp ON pp.id = cp.user_id
  LEFT JOIN auth.users pu ON pu.id = cp.user_id
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id <> auth.uid()
    AND private.is_conversation_participant(p_conversation_id, auth.uid())
  ORDER BY cp.joined_at
  LIMIT 1;
$function$

;

-- ===== list_group_members =====
CREATE OR REPLACE FUNCTION public.list_group_members(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, email text, role text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'avora_not_signed_in';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = auth.uid()
  ) then
    raise exception 'You are not a participant of this group';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.type = 'group'
  ) then
    raise exception 'Not a group conversation';
  end if;

  return query
  select
    cp.user_id,
    pp.display_name,
    au.email::text,
    cp.role,
    cp.joined_at
  from public.conversation_participants cp
  left join public.profiles pp on pp.id = cp.user_id
  left join auth.users au on au.id = cp.user_id
  where cp.conversation_id = p_conversation_id
  order by cp.joined_at asc;
end;
$function$

;

-- ===== create_group_conversation =====
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
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_group_name_required'; end if;
  if char_length(v_name) > 120 then raise exception 'avora_group_name_max_len'; end if;

  insert into public.conversations (type) values ('group') returning id into v_id;
  insert into public.conversation_groups (conversation_id, name, owner_id) values (v_id, v_name, v_uid);
  insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, v_uid, 'owner')
    on conflict do nothing;

  foreach m in array coalesce(p_member_ids, '{}'::uuid[]) loop
    -- AVORA-37 / A: a blocked pair is skipped exactly like an unknown id, so a new "group"
    -- of two cannot stand in for the 1-1 that is refused.
    if m <> v_uid and exists (select 1 from public.profiles p where p.id = m)
       and not private.is_blocked_between (m, v_uid) then
      insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, m, 'member')
        on conflict do nothing;
    end if;
  end loop;

  return v_id;
end $function$

;

-- ===== assert_contact_available =====
CREATE OR REPLACE FUNCTION private.assert_contact_available(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if private.is_conversation_participant (p_conversation_id, p_user_id)
     and private.direct_peer_blocked (p_conversation_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  return true;
end;
$function$

;

-- ===== direct_peer_blocked =====
CREATE OR REPLACE FUNCTION private.direct_peer_blocked(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_participants cp
      on cp.conversation_id = c.id and cp.user_id <> p_user_id
    where c.id = p_conversation_id
      and c.type = 'direct'
      and private.is_blocked_between (cp.user_id, p_user_id)
  );
$function$

;

-- ===== is_blocked_between =====
CREATE OR REPLACE FUNCTION private.is_blocked_between(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$function$

;

-- ===== send_message_with_attachments =====
CREATE OR REPLACE FUNCTION public.send_message_with_attachments(p_conversation_id uuid, p_content text, p_reply_to_message_id uuid DEFAULT NULL::uuid, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_origin_group_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_message_id uuid := gen_random_uuid ();
  v_count integer := coalesce(jsonb_array_length(p_attachments), 0);
  v_content text := coalesce(btrim(p_content), '');
  v_row public.messages%rowtype;
  v_item jsonb;
  v_path text;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  -- The caller's claim about who they are is never read; membership is checked for the
  -- session's own identity.
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
  if private.direct_peer_blocked (p_conversation_id, v_uid) then
    raise exception 'avora_contact_unavailable';
  end if;

  if v_count > 10 then
    raise exception 'avora_attachment_too_many';
  end if;

  if v_content = '' and v_count = 0 then
    raise exception 'messages_content_not_blank';
  end if;

  -- Each file must already sit in this conversation's own folder. Storage write access is
  -- folder-scoped, so this is what stops a row pointing at a file from a thread the sender
  -- is not in. Forwarding an existing file is a different operation with its own rules.
  for v_item in select * from jsonb_array_elements(p_attachments)
  loop
    v_path := v_item ->> 'storage_path';

    if v_path is null or v_path not like (p_conversation_id::text || '/%') then
      raise exception 'avora_attachment_path_invalid';
    end if;

    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'chat-attachments' and o.name = v_path
    ) then
      raise exception 'avora_attachment_missing';
    end if;
  end loop;

  -- Written with the real count so the not-blank rule passes for a wordless message; the
  -- trigger on the inserts below recomputes it from the rows that actually landed, so a
  -- wrong number here cannot survive the statement.
  insert into public.messages (
    id, conversation_id, sender_id, content, reply_to_message_id,
    mentioned_user_ids, origin_group_id, attachment_count
  )
  values (
    v_message_id, p_conversation_id, v_uid, v_content, p_reply_to_message_id,
    coalesce(p_mentioned_user_ids, '{}'), p_origin_group_id, v_count
  );

  insert into public.message_attachments (
    message_id, conversation_id, attached_by, kind, storage_path,
    file_name, mime_type, byte_size, width, height, duration_seconds, permission
  )
  select
    v_message_id,
    p_conversation_id,
    v_uid,
    item ->> 'kind',
    item ->> 'storage_path',
    item ->> 'file_name',
    item ->> 'mime_type',
    (item ->> 'byte_size')::bigint,
    nullif(item ->> 'width', '')::integer,
    nullif(item ->> 'height', '')::integer,
    nullif(item ->> 'duration_seconds', '')::numeric,
    coalesce(nullif(item ->> 'permission', ''), 'export')
  from jsonb_array_elements(p_attachments) as item;

  select * into v_row from public.messages where id = v_message_id;
  return v_row;
end;
$function$

;

-- ===== forward_messages =====
CREATE OR REPLACE FUNCTION public.forward_messages(p_message_ids uuid[], p_target_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_source public.messages%rowtype;
  v_new_id uuid;
  v_forwarded integer := 0;
  v_carried integer := 0;
  v_blocked integer := 0;
  v_allowed integer;
  v_denied integer;
  v_content text;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  if not private.is_conversation_participant (p_target_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
  if private.direct_peer_blocked (p_target_conversation_id, v_uid) then
    raise exception 'avora_contact_unavailable';
  end if;

  if coalesce(array_length(p_message_ids, 1), 0) = 0 then
    return jsonb_build_object('forwarded', 0, 'files_carried', 0, 'files_blocked', 0);
  end if;

  if array_length(p_message_ids, 1) > 50 then
    raise exception 'avora_forward_too_many';
  end if;

  -- Oldest first, so a forwarded run of messages reads in the order it was said.
  for v_source in
    select * from public.messages
    where id = any (p_message_ids)
    order by created_at, id
  loop
    -- Readable by the forwarder, or it cannot be carried anywhere. Checked per message
    -- rather than once, because the list can span several conversations.
    if not private.is_conversation_participant (v_source.conversation_id, v_uid) then
      raise exception 'avora_not_a_participant';
    end if;

    -- Withdrawn words are gone; there is nothing left to forward.
    if v_source.deleted_at is not null then
      continue;
    end if;

    -- The permission ladder decides what travels. 'view' means the file stops here: the
    -- reader may look at it where it was sent, and carrying it onward is exactly the thing
    -- that rung refuses.
    select
      count(*) filter (where permission in ('forward', 'export')),
      count(*) filter (where permission = 'view')
    into v_allowed, v_denied
    from public.message_attachments
    where message_id = v_source.id;

    v_content := v_source.content;

    -- Said plainly rather than by omission: a file quietly missing from a forward is worse
    -- than a forward that admits what it could not bring.
    if v_denied > 0 then
      v_content := case when btrim(v_content) = '' then
        public.forward_blocked_note ()
      else
        v_content || E'\n' || public.forward_blocked_note ()
      end;
    end if;

    v_new_id := gen_random_uuid ();

    insert into public.messages (
      id, conversation_id, sender_id, content,
      mentioned_user_ids, attachment_count, origin_content_id, origin_sender_id
    )
    values (
      v_new_id,
      p_target_conversation_id,
      v_uid,
      v_content,
      -- Mentions are not carried: naming someone in a room they are not in would notify
      -- nobody and read as a summons from a conversation they cannot see.
      '{}',
      v_allowed,
      v_source.id,
      v_source.sender_id
    );

    -- The file itself is not copied. Both rows point at the same object, and the storage
    -- policy grants access to whoever is in a conversation that points at it — so the
    -- forward costs no bytes and revoking it is a matter of the message going away.
    insert into public.message_attachments (
      message_id, conversation_id, attached_by, kind, storage_path, file_name,
      mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id
    )
    select
      v_new_id,
      p_target_conversation_id,
      v_uid,
      a.kind,
      a.storage_path,
      a.file_name,
      a.mime_type,
      a.byte_size,
      a.width,
      a.height,
      a.duration_seconds,
      -- Never widened on the way through. Nobody can hand on more than they were given,
      -- so the copy carries the same rung it arrived at.
      a.permission,
      a.message_id
    from public.message_attachments a
    where a.message_id = v_source.id
      and a.permission in ('forward', 'export');

    v_forwarded := v_forwarded + 1;
    v_carried := v_carried + v_allowed;
    v_blocked := v_blocked + v_denied;
  end loop;

  return jsonb_build_object(
    'forwarded', v_forwarded,
    'files_carried', v_carried,
    'files_blocked', v_blocked
  );
end;
$function$

;

-- ===== create_1_1_shared_task =====
CREATE OR REPLACE FUNCTION public.create_1_1_shared_task(p_conversation_id uuid, p_title text, p_description text, p_deadline date, p_task_id uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT 'Asia/Ho_Chi_Minh'::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid := coalesce(p_task_id, gen_random_uuid());
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- Asking someone for work without saying what you need, or by when, is not a task.
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;

  if not exists (
    select 1
    from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id
    where c.id = p_conversation_id and c.type = 'direct' and cp.user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: no shared task into a blocked 1-1.
  if private.direct_peer_blocked (p_conversation_id, v_uid) then
    raise exception 'avora_contact_unavailable';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.tasks (
    id, type, creator_id, conversation_id, title, description, status, deadline_date,
    deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern
  )
  values (
    v_id, '1-1-shared', v_uid, p_conversation_id, v_title, v_description, 'pending_confirmation', p_deadline,
    p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'), p_category_id,
    coalesce(p_is_important, false), coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern
  )
  on conflict (id) do nothing;

  -- The creator's half of the two-party confirmation, recorded at creation.
  insert into public.task_confirmations (task_id, user_id)
  values (v_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  select * into v_row from public.tasks where id = v_id;
  return v_row;
end;
$function$

;

-- ===== create_shared_task =====
CREATE OR REPLACE FUNCTION public.create_shared_task(p_conversation_id uuid, p_type text, p_title text, p_description text, p_deadline date, p_task_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb, p_context_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid := coalesce(p_task_id, gen_random_uuid());
  v_type text := btrim(coalesce(p_type, ''));
  v_conv_type text;
  v_assignee uuid := p_assignee_id;
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- Asking someone for work without saying what you need, or by when, is not a task.
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;

  -- A suggestion with no trace of the exchange that produced it is exactly the thing this
  -- feature exists to prevent: the person receiving it cannot tell what it refers to.
  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;

  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 / A: no shared task into a blocked 1-1. Groups are untouched.
  if private.direct_peer_blocked (p_conversation_id, v_uid) then raise exception 'avora_contact_unavailable'; end if;

  -- The kind of task and the kind of room have to agree, or a group task could be filed
  -- against a 1-1 thread and inherit the wrong idea of who the assignee is.
  if v_type = '1-1-shared' and v_conv_type <> 'direct' then raise exception 'avora_task_wrong_conversation'; end if;
  if v_type = 'group-shared' and v_conv_type <> 'group' then raise exception 'avora_task_wrong_conversation'; end if;

  if v_type = '1-1-shared' then
    -- Exactly one other person is in the room; naming them is a convenience, not a choice.
    select cp.user_id into v_assignee
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id <> v_uid
    limit 1;
  end if;

  if v_assignee is null then raise exception 'avora_task_assignee_required'; end if;

  -- Work you give yourself is a personal task; the two-party flow needs two parties.
  if v_assignee = v_uid then raise exception 'avora_task_self_assign'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_assignee
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date,
    deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern,
    context_snapshot
  )
  values (
    v_id, v_type, v_uid, v_assignee, p_conversation_id, v_title, v_description, 'pending_confirmation',
    p_deadline, p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'),
    p_category_id, coalesce(p_is_important, false),
    coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern, p_context_snapshot
  )
  on conflict (id) do nothing;

  -- The creator's half of the two-party confirmation, recorded at creation.
  insert into public.task_confirmations (task_id, user_id)
  values (v_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  select * into v_row from public.tasks where id = v_id;
  return v_row;
end;
$function$

;

-- ===== confirm_shared_task =====
CREATE OR REPLACE FUNCTION public.confirm_shared_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Two-party confirmation: the creator cannot confirm their own task.
  if v_uid = v_row.creator_id then
    raise exception 'avora_task_self_confirm';
  end if;

  -- In a group, everyone else can see the task but only one person was asked to do it.
  if not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_assignee';
  end if;

  if v_row.status = 'pending_confirmation' then
    insert into public.task_confirmations (task_id, user_id)
    values (p_task_id, v_uid)
    on conflict (task_id, user_id) do nothing;

    update public.tasks
    set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
    where id = p_task_id and status = 'pending_confirmation';
  end if;
  -- already confirmed or done: retry is a no-op success

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$

;

-- ===== create_task_suggestion =====
CREATE OR REPLACE FUNCTION public.create_task_suggestion(p_conversation_id uuid, p_assignee_id uuid, p_title text, p_description text, p_deadline date, p_context_snapshot jsonb, p_suggestion_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_conv_type text;
  v_snapshot_conv uuid;
  v_row public.task_suggestions%rowtype;
  v_self boolean;
  k text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  -- Same bar a shared task has to clear: a suggestion with no trace of the exchange behind it
  -- leaves the person receiving it unable to tell what it refers to.
  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
  if jsonb_typeof(p_context_snapshot) <> 'object' then
    raise exception 'avora_context_snapshot_not_object';
  end if;
  foreach k in array array[
    'conversation_type', 'conversation_id', 'conversation_name',
    'original_message_id', 'original_message_text', 'original_message_sender_id',
    'original_message_sender_name', 'original_message_created_at',
    'user_response', 'snapshot_created_at'
  ] loop
    if not (p_context_snapshot ? k) then
      raise exception 'avora_context_snapshot_missing_key_%', k;
    end if;
  end loop;

  v_snapshot_conv := nullif(p_context_snapshot->>'conversation_id', '')::uuid;
  if v_snapshot_conv is null then raise exception 'avora_context_snapshot_conversation_required'; end if;
  -- The snapshot must describe the room this is actually being raised in, or it becomes a way
  -- to write a fabricated quote into someone else's context.
  if v_snapshot_conv <> p_conversation_id then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;
  if nullif(p_context_snapshot->>'snapshot_created_at', '') is null then
    raise exception 'avora_context_snapshot_time_required';
  end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;
  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 / A: no suggestion into a blocked 1-1. Groups are untouched.
  if private.direct_peer_blocked (p_conversation_id, v_uid) then raise exception 'avora_contact_unavailable'; end if;

  if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
    raise exception 'avora_context_snapshot_type_mismatch';
  end if;

  if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
  v_self := (p_assignee_id = v_uid);
  -- Asking yourself is only meaningful in a group. In a 1-1 the other person is the only one
  -- there is to ask, so naming yourself is a mistake rather than a choice.
  if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_assignee_id
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;

  -- A quoted message has to belong to this conversation.
  if p_message_id is not null and not exists (
    select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.task_suggestions (
    id, conversation_id, message_id, proposer_id, assignee_id,
    proposed_title, proposed_description, proposed_deadline,
    proposed_deadline_time, proposed_deadline_tz, context_snapshot, status
  )
  values (
    v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
    v_title, v_description, p_deadline,
    p_deadline_time, v_tz, p_context_snapshot, 'pending'
  )
  on conflict (id) do nothing;

  -- Work taken on by the person raising it needs no answer, so it is answered here and now,
  -- through the ordinary acceptance path. Re-running this for an already-accepted row is a
  -- no-op inside that function, which keeps the whole call idempotent.
  if v_self then
    perform public.accept_task_suggestion(v_id, gen_random_uuid());
  end if;

  select * into v_row from public.task_suggestions where id = v_id;
  return v_row;
end;
$function$

;

-- ===== edit_task_suggestion =====
CREATE OR REPLACE FUNCTION public.edit_task_suggestion(p_suggestion_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;

  -- Editing the ask belongs to the person who asked. The assignee cannot rewrite somebody
  -- else's request into one they prefer, and neither can a bystander.
  if v_s.proposer_id <> v_uid then raise exception 'avora_task_not_proposer'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Only a question can be reworded. Once answered — accepted, skipped or withdrawn — the
  -- record stands as what it was when it was answered; a retractable edit would let a
  -- proposer rewrite an offer after the other person had already relied on it.
  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  update public.task_suggestions
  set proposed_title = v_title,
      proposed_description = v_description,
      proposed_deadline = p_deadline,
      proposed_deadline_time = p_deadline_time,
      proposed_deadline_tz = v_tz
  where id = p_suggestion_id
  returning * into v_s;

  return v_s;
end;
$function$

;

-- ===== accept_task_suggestion =====
CREATE OR REPLACE FUNCTION public.accept_task_suggestion(p_suggestion_id uuid, p_task_id uuid DEFAULT NULL::uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_task_id uuid;
  v_type text;
  v_conv_type text;
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  -- Lock the suggestion: two taps on a slow connection must not create two tasks.
  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;

  -- Only the person asked may answer. The proposer accepting on their behalf would be
  -- assigning work while calling it agreement.
  if v_s.assignee_id <> v_uid then raise exception 'avora_task_not_assignee'; end if;

  -- Retrying returns the task already created rather than failing or making a second one.
  if v_s.status = 'accepted' then
    if v_s.accepted_task_id is null then raise exception 'avora_task_not_found'; end if;
    select * into v_row from public.tasks where id = v_s.accepted_task_id;
    if not found then raise exception 'avora_task_not_found'; end if;
    return v_row;
  end if;

  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  select type into v_conv_type from public.conversations where id = v_s.conversation_id;
  v_type := case when v_conv_type = 'group' then 'group-shared' else '1-1-shared' end;
  v_task_id := coalesce(p_task_id, gen_random_uuid());

  -- See enforce_task_essentials: an aged suggestion stays answerable, as it always was.
  perform set_config('avora.accepting_suggestion', 'on', true);

  -- Accepted on the spot: the assignee has just agreed, so there is nothing left to confirm.
  -- Going in at 'pending_confirmation' would ask them to accept the thing they just accepted.
  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status,
    confirmed_by, confirmed_at, deadline_date, deadline_time, deadline_tz, context_snapshot
  )
  values (
    v_task_id, v_type, v_s.proposer_id, v_s.assignee_id, v_s.conversation_id,
    v_s.proposed_title, v_s.proposed_description, 'confirmed',
    v_uid, now(), v_s.proposed_deadline, v_s.proposed_deadline_time,
    v_s.proposed_deadline_tz, v_s.context_snapshot
  );

  perform set_config('avora.accepting_suggestion', 'off', true);

  -- Both halves of the two-party record, in one step, because both happened.
  insert into public.task_confirmations (task_id, user_id)
  values (v_task_id, v_s.proposer_id), (v_task_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  update public.task_suggestions
  set status = 'accepted', resolved_at = now(), accepted_task_id = v_task_id
  where id = p_suggestion_id;

  select * into v_row from public.tasks where id = v_task_id;
  return v_row;
end;
$function$

;

-- ===== update_shared_task_schedule =====
CREATE OR REPLACE FUNCTION public.update_shared_task_schedule(p_task_id uuid, p_estimated_duration_minutes integer, p_requires_presence boolean, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_location text, p_travel_duration_minutes integer)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Same party rule as rewording and replanning: the person who asked and the person carrying it.
  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if v_presence and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;

  -- Not an Event means no when/where: the fields are cleared rather than left dangling.
  update public.tasks
  set
    estimated_duration_minutes = p_estimated_duration_minutes,
    requires_presence = v_presence,
    start_at = case when v_presence then p_start_at end,
    end_at = case when v_presence then p_end_at end,
    location = case when v_presence then v_location end,
    travel_duration_minutes = case when v_presence then p_travel_duration_minutes end,
    departure_reminder_at = case
      when v_presence and p_start_at is not null and p_travel_duration_minutes is not null
        then p_start_at - make_interval(mins => p_travel_duration_minutes)
    end,
    updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$

;

-- ===== update_shared_task_details =====
CREATE OR REPLACE FUNCTION public.update_shared_task_details(p_task_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.tasks%rowtype;
  v_title text := btrim(p_title);
  v_description text := btrim(p_description);
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id
    and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant (v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- A bystander in a group can read the task but was never party to it, so it is not theirs
  -- to reword. Only the person who asked and the person carrying it may edit.
  if v_uid <> v_row.creator_id
    and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if v_title = '' then
    raise exception 'avora_task_title_blank';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'avora_task_title_max_len';
  end if;
  if v_description = '' then
    raise exception 'avora_task_description_required';
  end if;
  if char_length(v_description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if p_deadline is null then
    raise exception 'avora_task_deadline_required';
  end if;

  update
    public.tasks
  set
    title = v_title,
    description = v_description,
    deadline_date = p_deadline,
    deadline_time = p_deadline_time,
    deadline_tz = coalesce(p_deadline_tz, deadline_tz),
    updated_at = now()
  where
    id = p_task_id;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id;
  return v_row;
end;
$function$

;

-- ===== enforce_task_schedule =====
CREATE OR REPLACE FUNCTION public.enforce_task_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.deadline_tz := btrim(coalesce(nullif(new.deadline_tz, ''), 'Asia/Ho_Chi_Minh'));
  if not exists (select 1 from pg_timezone_names where name = new.deadline_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  new.recurrence := coalesce(nullif(btrim(new.recurrence), ''), 'none');
  if new.recurrence = 'none' then
    new.recurrence_pattern := null;
  end if;

  if new.task_category_id is not null and not exists (
    select 1 from public.task_categories c
    where c.id = new.task_category_id
      and c.user_id = new.creator_id
      and c.deleted_at is null
  ) then
    raise exception 'avora_task_category_foreign';
  end if;

  return new;
end $function$

;

-- ===== enforce_task_essentials =====
CREATE OR REPLACE FUNCTION public.enforce_task_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.description := btrim(coalesce(new.description, ''));

  if new.deadline_date is null then
    raise exception 'avora_task_deadline_required';
  end if;
  if new.description = '' then
    raise exception 'avora_task_description_required';
  end if;
  if char_length(new.description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if new.deadline_date < current_date
     and coalesce(current_setting('avora.accepting_suggestion', true), '') <> 'on' then
    raise exception 'avora_task_deadline_past';
  end if;

  return new;
end;
$function$

;

-- ===== can_view_task =====
CREATE OR REPLACE FUNCTION private.can_view_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and private.conversation_is_live (t.conversation_id))
      )
  );
$function$

;

-- ===== can_link_task =====
CREATE OR REPLACE FUNCTION private.can_link_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and (t.creator_id = p_user or public.is_task_assignee (t, p_user)))
      )
  );
$function$

;

-- ===== validate_suggestion_self_assign =====
CREATE OR REPLACE FUNCTION private.validate_suggestion_self_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_type text;
begin
  if new.assignee_id is distinct from new.proposer_id then
    return new;
  end if;

  select type into v_type from public.conversations where id = new.conversation_id;
  -- A 1-1 has exactly one other person in it, so naming yourself is a slip, not a decision.
  if v_type is distinct from 'group' then
    raise exception 'avora_task_self_assign';
  end if;

  return new;
end;
$function$

;

-- ===== check_user_pin =====
CREATE OR REPLACE FUNCTION public.check_user_pin(p_pin text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pin text := upper(btrim(coalesce(p_pin, '')));
  v_problem text;
begin
  if auth.uid () is null then raise exception 'avora_not_signed_in'; end if;
  v_problem := private.user_pin_problem (v_pin);
  if v_problem is not null then return v_problem; end if;
  if exists (select 1 from public.user_pins where pin = v_pin) then return 'taken'; end if;
  return 'ok';
end;
$function$

;

-- ===== user_pin_problem =====
CREATE OR REPLACE FUNCTION private.user_pin_problem(p_pin text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_pin is null or p_pin !~ '^A-.{8}$' then 'avora_pin_format'
    when substr(p_pin, 3) ~ '[01OIL]' then 'avora_pin_confusing'
    when substr(p_pin, 3) !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$' then 'avora_pin_format'
    when substr(p_pin, 3, 1) !~ '[A-Z]' or substr(p_pin, 10, 1) !~ '[A-Z]' then 'avora_pin_edges'
    when char_length(regexp_replace(substr(p_pin, 3), '[^A-Z]', '', 'g')) < 4 then 'avora_pin_letters'
    when substr(p_pin, 3) ~ '(FUCK|FUK|CUNT|SEX|XXX|CAC|DCM|DKM|DMM|DJT|DM2|CUT|DEM|BUCU|META|VISA|GRAB|SAMSUNG|SHOPEE|VNPAY|MBBANK|VCB|TPBANK|ACB|MASTERCARD|AMEX|NVIDIA|TESLA|UBER|ADMN|ROOT)'
      then 'avora_pin_blocked'
    else null
  end
$function$

;

-- ===== claim_user_pin =====
CREATE OR REPLACE FUNCTION public.claim_user_pin(p_pin text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_pin text := upper(btrim(coalesce(p_pin, '')));
  v_problem text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_source not in ('chosen', 'generated') then raise exception 'avora_pin_format'; end if;
  if exists (select 1 from public.user_pins where user_id = v_uid) then
    raise exception 'avora_pin_permanent';
  end if;

  v_problem := private.user_pin_problem (v_pin);
  if v_problem is not null then raise exception '%', v_problem; end if;

  begin
    insert into public.user_pins (user_id, pin, source) values (v_uid, v_pin, p_source);
  exception when unique_violation then
    if exists (select 1 from public.user_pins where user_id = v_uid) then
      raise exception 'avora_pin_permanent';
    end if;
    raise exception 'avora_pin_taken';
  end;

  return v_pin;
end;
$function$

;
