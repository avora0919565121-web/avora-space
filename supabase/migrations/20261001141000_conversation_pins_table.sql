-- AVORA-57 · D — fix found by the two-account probe.
--
-- conversation_participants is granted SELECT at table level (authenticated=r), so a column on
-- it is readable by every participant: the other person could see that they were pinned.
-- Pins move to their own table that only the owner can read. Writes stay behind the RPC.

alter table public.conversation_participants drop column if exists pinned_at;

create table if not exists public.conversation_pins (
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_pins enable row level security;
revoke all on public.conversation_pins from public, anon, authenticated;
grant select on public.conversation_pins to authenticated;
create policy conversation_pins_own_select on public.conversation_pins
  for select to authenticated
  using (user_id = (select auth.uid ()));

create or replace function public.set_conversation_pinned (p_conversation_id uuid, p_pinned boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_at timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if not coalesce (p_pinned, false) then
    delete from public.conversation_pins where user_id = v_uid and conversation_id = p_conversation_id;
    return null;
  end if;
  select pinned_at into v_at from public.conversation_pins
  where user_id = v_uid and conversation_id = p_conversation_id;
  if v_at is not null then return v_at; end if;
  if (select count (*) from public.conversation_pins where user_id = v_uid) >= 5 then
    raise exception 'avora_pin_limit';
  end if;
  insert into public.conversation_pins (user_id, conversation_id) values (v_uid, p_conversation_id)
  returning pinned_at into v_at;
  return v_at;
end;
$$;

create or replace function public.list_my_conversation_pins ()
returns table (conversation_id uuid, pinned_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select p.conversation_id, p.pinned_at
  from public.conversation_pins p
  where auth.uid () is not null and p.user_id = auth.uid ()
    and private.is_conversation_participant (p.conversation_id, auth.uid ())
  order by p.pinned_at;
$$;

revoke all on function public.set_conversation_pinned (uuid, boolean) from public, anon;
revoke all on function public.list_my_conversation_pins () from public, anon;
grant execute on function public.set_conversation_pinned (uuid, boolean) to authenticated;
grant execute on function public.list_my_conversation_pins () to authenticated;
