-- AVORA-38 (gộp) / Phần 2 · Nhóm B2 + C — Khung chat xác minh (ADR-029).
--
-- Read before writing (2026-09-28): no pin_verification_* columns, no
-- conversation_verification_confirms, no user_connections existed — so everything is new and
-- the names are neutral (verification_*), because a verification can come from a PIN or from a
-- shared Nhóm.
--
-- A verification lives on the 1-1 row itself (a 1-1 is reused when the pair already has one):
--   verification_status      null = an ordinary 1-1; 'pending' = waiting for both to agree;
--                            'confirmed' = both agreed; 'closed' = declined, expired or the
--                            bridging Nhóm is gone. 'closed' never says which, on purpose.
--   verification_started_at  the 5-message quota counts from here, not from old history.
--   verification_expires_at  started + 7 days; past it the frame reads as closed (lazy).
--   verification_via_group_id  the Nhóm that bridged the pair; null when opened from a PIN.
--   verification_opened_by   who opened it (the person asked sees "Chờ kết bạn").
--
-- One gate for every write into a 1-1: private.assert_direct_talk(conversation, user, kind).
--   kind 'text'       a new message: blocked → avora_contact_unavailable; pending → at most 5 per
--                     side; otherwise the pair must be bạn → avora_not_connected.
--   kind 'attachment' as 'text', and refused while pending (avora_verification_text_only).
--   kind 'rich'       tasks, suggestions, Bảng, forwards: refused while pending
--                     (avora_verification_text_only), otherwise needs bạn.
--   kind 'reaction'   reactions, recall requests, edits: allowed while pending, otherwise bạn.
-- Groups and the personal journal pass straight through (unchanged behaviour).

alter table public.conversations
  add column verification_status text
    check (verification_status is null or verification_status in ('pending', 'confirmed', 'closed')),
  add column verification_started_at timestamptz,
  add column verification_expires_at timestamptz,
  add column verification_via_group_id uuid references public.conversations (id) on delete set null,
  add column verification_opened_by uuid references auth.users (id) on delete set null,
  add column verification_resolved_at timestamptz;

-- conversations is granted SELECT at table level (relacl authenticated=r), so the new columns
-- are readable by participants under the existing RLS policy. No write grant exists or is added.

create table public.conversation_verification_confirms (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_verification_confirms enable row level security;
revoke all on public.conversation_verification_confirms from public, anon, authenticated;
grant select on public.conversation_verification_confirms to authenticated;
create policy conversation_verification_confirms_select on public.conversation_verification_confirms
  for select to authenticated
  using (private.is_conversation_participant (conversation_id, (select auth.uid ())));

-- 30-day cool-down after a decline on the Nhóm path. Private: no client access.
create table private.verification_declines (
  decliner_id uuid not null references auth.users (id) on delete cascade,
  opener_id uuid not null references auth.users (id) on delete cascade,
  declined_at timestamptz not null default now(),
  primary key (decliner_id, opener_id)
);
revoke all on private.verification_declines from public, anon, authenticated;

-- The person asked decides whether people in a shared Nhóm may open a frame with them.
alter table public.profiles add column allow_group_connection boolean not null default true;
grant update (allow_group_connection) on public.profiles to authenticated;
-- profiles SELECT is column-level: the new column is not inherited, so grant it explicitly.
grant select (allow_group_connection) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------

/** The other person in a 1-1 (null for anything else). */
create or replace function private.direct_peer_of (p_conversation_id uuid, p_user_id uuid)
returns uuid
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select cp.user_id
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id <> p_user_id
  where c.id = p_conversation_id and c.type = 'direct'
  order by cp.joined_at
  limit 1;
$$;

/** True while a frame is really open: pending, not expired, bridge (if any) still standing. */
create or replace function private.verification_is_live (p_conversation_id uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.verification_status = 'pending'
      and c.verification_expires_at > now()
      and (
        c.verification_via_group_id is null
        or exists (
          select 1 from public.conversations g
          where g.id = c.verification_via_group_id and g.deleted_at is null
            and (select count (*) from public.conversation_participants gp
                 where gp.conversation_id = g.id
                   and gp.user_id in (select cp.user_id from public.conversation_participants cp
                                      where cp.conversation_id = c.id)) >= 2
        )
      )
  );
$$;

create or replace function private.assert_direct_talk (p_conversation_id uuid, p_user_id uuid, p_kind text)
returns boolean
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_started timestamptz;
  v_peer uuid;
  v_sent integer;
begin
  if p_conversation_id is null then return true; end if;
  select c.type, c.verification_started_at into v_type, v_started
  from public.conversations c where c.id = p_conversation_id;
  if v_type is distinct from 'direct' then return true; end if;
  -- Membership is checked by the caller; a stranger gets the caller's own refusal, not this one.
  if not private.is_conversation_participant (p_conversation_id, p_user_id) then return true; end if;

  -- AVORA-37 first, exactly as before: a blocked pair reads as "unavailable".
  if private.direct_peer_blocked (p_conversation_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  if private.verification_is_live (p_conversation_id) then
    if p_kind in ('attachment', 'rich') then
      raise exception 'avora_verification_text_only';
    end if;
    if p_kind = 'text' then
      select count (*) into v_sent from public.messages m
      where m.conversation_id = p_conversation_id and m.sender_id = p_user_id
        and m.created_at >= v_started;
      if v_sent >= 5 then raise exception 'avora_verification_quota'; end if;
    end if;
    return true;
  end if;

  v_peer := private.direct_peer_of (p_conversation_id, p_user_id);
  if not private.can_talk_direct (p_user_id, v_peer) then
    raise exception 'avora_not_connected';
  end if;
  return true;
end;
$$;

revoke all on function private.direct_peer_of (uuid, uuid) from public, anon;
revoke all on function private.verification_is_live (uuid) from public, anon;
revoke all on function private.assert_direct_talk (uuid, uuid, text) from public, anon;
grant execute on function private.direct_peer_of (uuid, uuid) to authenticated;
grant execute on function private.verification_is_live (uuid) to authenticated;
grant execute on function private.assert_direct_talk (uuid, uuid, text) to authenticated;

-- Leaving (or being removed from) the bridging Nhóm closes the frame for both, at once.
create or replace function private.close_verifications_on_group_leave ()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations c
  set verification_status = 'closed', verification_resolved_at = now()
  where c.verification_status = 'pending'
    and c.verification_via_group_id = old.conversation_id
    and exists (select 1 from public.conversation_participants cp
                where cp.conversation_id = c.id and cp.user_id = old.user_id);
  return old;
end;
$$;
revoke all on function private.close_verifications_on_group_leave () from public, anon, authenticated;

create trigger conversation_participants_close_verifications
  after delete on public.conversation_participants
  for each row execute function private.close_verifications_on_group_leave ();
