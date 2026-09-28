-- AVORA-38 (gộp) / Phần 2 · Nhóm A — Quan hệ "bạn" (ADR-029).
--
-- Two accounts are "bạn" when a row here is 'active'. Stored once per pair, lowest id first.
-- Nobody writes this table directly: every change goes through an RPC (Phần 2 · Nhóm B/C/D).
-- `removed_by` is never readable by the client — column-level SELECT leaves it out — so the
-- other side cannot tell who ended the connection.
--
-- Backfill: every pair that already has a live 1-1 (type 'direct', deleted_at null) becomes a
-- 'legacy' connection, so nobody loses the person they are talking to when the rules change.
-- Read before writing (2026-09-28): 12 live 1-1s, each with exactly 2 participants, 0 blocked
-- pairs. The 3 deleted 1-1s are not counted.

create table public.user_connections (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'removed')),
  source text not null check (source in ('pin', 'group', 'contact_invite', 'legacy')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  primary key (user_low, user_high),
  constraint user_connections_ordered check (user_low < user_high)
);

create index user_connections_high_idx on public.user_connections (user_high) where status = 'active';

alter table public.user_connections enable row level security;

revoke all on public.user_connections from public, anon, authenticated;
grant select (user_low, user_high, status, source, created_at, removed_at)
  on public.user_connections to authenticated;

create policy user_connections_select_own on public.user_connections
  for select to authenticated
  using ((select auth.uid ()) in (user_low, user_high));

-- Rate-limit ledger for the two ways to open a verification (PIN, Nhóm). Private: no client access.
create table private.connection_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pin', 'group')),
  created_at timestamptz not null default now()
);
create index connection_attempts_user_time_idx on private.connection_attempts (user_id, created_at desc);
revoke all on private.connection_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Helpers (private, SECURITY DEFINER, pinned search_path)
-- ---------------------------------------------------------------------------------------

create or replace function private.are_connected (p_a uuid, p_b uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.user_connections uc
    where uc.user_low = least (p_a, p_b) and uc.user_high = greatest (p_a, p_b)
      and uc.status = 'active'
  );
$$;

-- No "same group" branch on purpose: sharing a Nhóm is not enough to talk privately.
create or replace function private.can_talk_direct (p_a uuid, p_b uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select private.are_connected (p_a, p_b) and not private.is_blocked_between (p_a, p_b);
$$;

-- Makes (or re-activates) the connection. Callers have already checked consent.
create or replace function private.connect_users (p_a uuid, p_b uuid, p_source text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then return; end if;
  insert into public.user_connections (user_low, user_high, status, source)
  values (least (p_a, p_b), greatest (p_a, p_b), 'active', p_source)
  on conflict (user_low, user_high) do update
    set status = 'active',
        source = case when public.user_connections.status = 'active' then public.user_connections.source else excluded.source end,
        created_at = case when public.user_connections.status = 'active' then public.user_connections.created_at else now() end,
        removed_at = null,
        removed_by = null;
end;
$$;

revoke all on function private.are_connected (uuid, uuid) from public, anon;
revoke all on function private.can_talk_direct (uuid, uuid) from public, anon;
revoke all on function private.connect_users (uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.are_connected (uuid, uuid) to authenticated;
grant execute on function private.can_talk_direct (uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Backfill: every live 1-1 pair → 'legacy'
-- ---------------------------------------------------------------------------------------
insert into public.user_connections (user_low, user_high, status, source)
select least (p.a, p.b), greatest (p.a, p.b), 'active', 'legacy'
from (
  select c.id, min (cp.user_id::text)::uuid a, max (cp.user_id::text)::uuid b, count (*) n
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.type = 'direct' and c.deleted_at is null
  group by c.id
) p
where p.n = 2 and p.a <> p.b and not private.is_blocked_between (p.a, p.b)
on conflict (user_low, user_high) do nothing;
