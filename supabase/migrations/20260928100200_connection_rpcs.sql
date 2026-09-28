-- AVORA-38 (gộp) / Phần 2 · Nhóm A/B/B2/C/D — RPC kết bạn (ADR-029).
--
--   start_pin_connection(pin)            strangers only find each other by PIN.
--   start_group_connection(group, user)  "Chat riêng" with someone in a shared Nhóm, no PIN needed.
--   confirm_verification(conversation)   one side's "Đồng ý"; both → bạn, in the same transaction.
--   decline_verification(conversation)   closes the frame for both; on the Nhóm path, a 30-day cool-down.
--   list_my_connections()                bạn bè with their PIN — never who removed whom.
--   remove_connection(user)              either side, idempotent.
-- Every refusal that could tell a stranger something ("no such PIN", "no PIN yet", "blocked")
-- is the same code: avora_pin_not_found on the PIN path, avora_contact_unavailable on the Nhóm path.

/** Opens (or reuses) the 1-1 of a pair in verification mode and returns it. */
create or replace function private.open_verification (p_me uuid, p_other uuid, p_via_group uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := least (p_me::text, p_other::text) || ':' || greatest (p_me::text, p_other::text);
  v_conv uuid;
begin
  select c.id into v_conv from public.conversations c where c.direct_key = v_key and c.deleted_at is null;
  if v_conv is null then
    insert into public.conversations (type, direct_key) values ('direct', v_key)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.direct_key = v_key;
      -- A soft-deleted 1-1 comes back to life rather than colliding on the unique key.
      update public.conversations set deleted_at = null where id = v_conv;
    end if;
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv, p_me), (v_conv, p_other) on conflict do nothing;
  end if;

  delete from public.conversation_verification_confirms where conversation_id = v_conv;
  update public.conversations
  set verification_status = 'pending',
      verification_started_at = now(),
      verification_expires_at = now() + interval '7 days',
      verification_via_group_id = p_via_group,
      verification_opened_by = p_me,
      verification_resolved_at = null
  where id = v_conv;
  return v_conv;
end;
$$;
revoke all on function private.open_verification (uuid, uuid, uuid) from public, anon, authenticated;

/** A live frame between two people, if any (either path). */
create or replace function private.live_verification_between (p_a uuid, p_b uuid)
returns uuid
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select c.id from public.conversations c
  where c.direct_key = least (p_a::text, p_b::text) || ':' || greatest (p_a::text, p_b::text)
    and c.deleted_at is null and private.verification_is_live (c.id)
  limit 1;
$$;
revoke all on function private.live_verification_between (uuid, uuid) from public, anon, authenticated;

/** The ordinary 1-1 of two bạn (created when missing). Clears any leftover verification state. */
create or replace function private.direct_for_connected (p_me uuid, p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := least (p_me::text, p_other::text) || ':' || greatest (p_me::text, p_other::text);
  v_conv uuid;
begin
  select c.id into v_conv from public.conversations c where c.direct_key = v_key and c.deleted_at is null;
  if v_conv is null then
    insert into public.conversations (type, direct_key) values ('direct', v_key)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.direct_key = v_key;
      update public.conversations set deleted_at = null where id = v_conv;
    end if;
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv, p_me), (v_conv, p_other) on conflict do nothing;
  end if;
  update public.conversations
  set verification_status = case when verification_status = 'pending' then 'confirmed' else verification_status end
  where id = v_conv;
  return v_conv;
end;
$$;
revoke all on function private.direct_for_connected (uuid, uuid) from public, anon, authenticated;

create or replace function private.note_connection_attempt (p_user uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Shared: 20 openings per hour across both paths (anti PIN-scanning).
  if (select count (*) from private.connection_attempts
      where user_id = p_user and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'avora_pin_rate_limited';
  end if;
  insert into private.connection_attempts (user_id, kind) values (p_user, p_kind);
end;
$$;
revoke all on function private.note_connection_attempt (uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------

create or replace function public.start_pin_connection (p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_pin text := upper (regexp_replace (btrim (coalesce (p_pin, '')), '\s', '', 'g'));
  v_other uuid;
  v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from public.user_pins where user_id = v_uid and pin is not null) then
    raise exception 'avora_pin_required';
  end if;
  -- Counted before the lookup, so a miss costs the same as a hit.
  perform private.note_connection_attempt (v_uid, 'pin');

  if v_pin not like 'A-%' then v_pin := 'A-' || v_pin; end if;
  select up.user_id into v_other from public.user_pins up where up.pin = v_pin;

  if v_other = v_uid then raise exception 'avora_pin_self'; end if;
  if v_other is null or private.is_blocked_between (v_uid, v_other) then
    raise exception 'avora_pin_not_found';
  end if;

  if private.are_connected (v_uid, v_other) then
    return private.direct_for_connected (v_uid, v_other);
  end if;

  v_conv := private.live_verification_between (v_uid, v_other);
  if v_conv is not null then return v_conv; end if;

  return private.open_verification (v_uid, v_other, null);
end;
$$;

create or replace function public.start_group_connection (p_group_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_conv uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
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
    return private.direct_for_connected (v_uid, p_user_id);
  end if;

  v_conv := private.live_verification_between (v_uid, p_user_id);
  if v_conv is not null then return v_conv; end if;

  -- The person asked has switched this path off.
  if not coalesce ((select allow_group_connection from public.profiles where id = p_user_id), true) then
    raise exception 'avora_group_connection_off';
  end if;
  -- Declined within 30 days → neutral refusal (the PIN path stays open).
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

  return private.open_verification (v_uid, p_user_id, p_group_id);
end;
$$;

create or replace function public.confirm_verification (p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_peer uuid;
  v_via uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  v_peer := private.direct_peer_of (p_conversation_id, v_uid);
  if private.is_blocked_between (v_uid, v_peer) then raise exception 'avora_contact_unavailable'; end if;
  if not private.verification_is_live (p_conversation_id) then raise exception 'avora_verification_closed'; end if;

  insert into public.conversation_verification_confirms (conversation_id, user_id)
  values (p_conversation_id, v_uid) on conflict do nothing;

  if (select count (*) from public.conversation_verification_confirms where conversation_id = p_conversation_id) >= 2 then
    select verification_via_group_id into v_via from public.conversations where id = p_conversation_id;
    perform private.connect_users (v_uid, v_peer, case when v_via is null then 'pin' else 'group' end);
    update public.conversations
    set verification_status = 'confirmed', verification_resolved_at = now()
    where id = p_conversation_id;
    return 'connected';
  end if;
  return 'waiting';
end;
$$;

create or replace function public.decline_verification (p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_row public.conversations%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  select * into v_row from public.conversations where id = p_conversation_id;
  if v_row.verification_status is distinct from 'pending' then return; end if;

  update public.conversations
  set verification_status = 'closed', verification_resolved_at = now()
  where id = p_conversation_id;

  if v_row.verification_via_group_id is not null and v_row.verification_opened_by is not null
     and v_row.verification_opened_by <> v_uid then
    insert into private.verification_declines (decliner_id, opener_id)
    values (v_uid, v_row.verification_opened_by)
    on conflict (decliner_id, opener_id) do update set declined_at = now();
  end if;
end;
$$;

create or replace function public.list_my_connections ()
returns table (user_id uuid, display_name text, pin text, created_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select other.id, p.display_name, up.pin, uc.created_at
  from public.user_connections uc
  cross join lateral (select case when uc.user_low = auth.uid () then uc.user_high else uc.user_low end as id) other
  left join public.profiles p on p.id = other.id
  left join public.user_pins up on up.user_id = other.id
  where auth.uid () is not null
    and auth.uid () in (uc.user_low, uc.user_high)
    and uc.status = 'active'
  order by lower (coalesce (p.display_name, '')), other.id;
$$;

create or replace function public.remove_connection (p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_user_id is null or p_user_id = v_uid then return; end if;
  update public.user_connections
  set status = 'removed', removed_at = now(), removed_by = v_uid
  where user_low = least (v_uid, p_user_id) and user_high = greatest (v_uid, p_user_id)
    and status = 'active';
end;
$$;

revoke all on function public.start_pin_connection (text) from public, anon;
revoke all on function public.start_group_connection (uuid, uuid) from public, anon;
revoke all on function public.confirm_verification (uuid) from public, anon;
revoke all on function public.decline_verification (uuid) from public, anon;
revoke all on function public.list_my_connections () from public, anon;
revoke all on function public.remove_connection (uuid) from public, anon;
grant execute on function public.start_pin_connection (text) to authenticated;
grant execute on function public.start_group_connection (uuid, uuid) to authenticated;
grant execute on function public.confirm_verification (uuid) to authenticated;
grant execute on function public.decline_verification (uuid) to authenticated;
grant execute on function public.list_my_connections () to authenticated;
grant execute on function public.remove_connection (uuid) to authenticated;
