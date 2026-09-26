-- AVORA 33 / Nhóm F — PIN is introduced when needed, not forced at the door.
--
-- profiles.pin_required_at: the moment an account without a PIN starts being blocked by the PIN screen.
--   * New accounts: created_at + 30 days, set on insert.
--   * Existing accounts without a PIN: now() + 30 days (nobody is suddenly blocked by the switch).
--   * Accounts with a PIN: NULL — no longer used.
-- Clients may read it but never write it (column grants), so nobody can push their own deadline.

alter table public.profiles add column if not exists pin_required_at timestamptz;

create or replace function public.set_profile_pin_required_at ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.user_pins where user_id = new.id) then
    new.pin_required_at := null;
  else
    new.pin_required_at := coalesce(new.created_at, now()) + interval '30 days';
  end if;
  return new;
end;
$$;

revoke execute on function public.set_profile_pin_required_at () from public, anon, authenticated;

drop trigger if exists profiles_pin_required_at on public.profiles;
create trigger profiles_pin_required_at
  before insert on public.profiles
  for each row execute function public.set_profile_pin_required_at ();

-- Backfill once.
update public.profiles p
set pin_required_at = case
  when exists (select 1 from public.user_pins u where u.user_id = p.id) then null
  else now() + interval '30 days'
end;

-- Column-level write access: everything the client already wrote, minus the deadline.
revoke insert, update on table public.profiles from authenticated;
grant insert (id, display_name, avatar_url, created_at, base_currency, timezone, daily_thought_category, hide_typing_signal, last_opened_date)
  on table public.profiles to authenticated;
grant update (id, display_name, avatar_url, created_at, base_currency, timezone, daily_thought_category, hide_typing_signal, last_opened_date)
  on table public.profiles to authenticated;

-- Claiming a PIN clears the deadline.
create or replace function public.clear_pin_required_at_on_claim ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  update public.profiles set pin_required_at = null where id = new.user_id;
  return new;
end;
$$;

revoke execute on function public.clear_pin_required_at_on_claim () from public, anon, authenticated;

drop trigger if exists user_pins_clear_deadline on public.user_pins;
create trigger user_pins_clear_deadline
  after insert on public.user_pins
  for each row execute function public.clear_pin_required_at_on_claim ();
