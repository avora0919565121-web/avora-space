-- AVORA 32 / Nhóm F — User PIN (ADR-019): a permanent identifier, NOT a secret.
--
-- Format: "A-" + 8 characters from A–Z and 2–9 without the easily confused 0/O/1/I/L; at least 4 letters among
-- the 8; the first and last of the 8 are letters. Chosen by the person or generated; set once, never changed.
-- Every account must have one (the app blocks entry until it is set). Checking availability only answers
-- "free / taken / not allowed" — never whose PIN it is.

create table if not exists public.user_pins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin text not null unique,
  source text not null,
  created_at timestamptz not null default now(),
  constraint user_pins_format check (pin ~ '^A-[ABCDEFGHJKMNPQRSTUVWXYZ][ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKMNPQRSTUVWXYZ]$'),
  constraint user_pins_letters check (char_length(regexp_replace(substr(pin, 3), '[^A-Z]', '', 'g')) >= 4),
  constraint user_pins_source check (source in ('chosen', 'generated'))
);

alter table public.user_pins enable row level security;

revoke all on table public.user_pins from public, anon, authenticated;
grant select on table public.user_pins to authenticated;

drop policy if exists user_pins_select_own on public.user_pins;
create policy user_pins_select_own on public.user_pins
  for select to authenticated
  using (user_id = (select auth.uid ()));

-- Permanent: once written, a PIN is never edited (removed only with the account itself).
create or replace function public.enforce_user_pin_permanent ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  raise exception 'avora_pin_permanent';
end;
$$;

revoke execute on function public.enforce_user_pin_permanent () from public, anon, authenticated;

drop trigger if exists user_pins_permanent on public.user_pins;
create trigger user_pins_permanent
  before update on public.user_pins
  for each row execute function public.enforce_user_pin_permanent ();

-- Why a PIN is not allowed, or null. Mirrors the client's rules so the answer is the same on both sides.
create or replace function private.user_pin_problem (p_pin text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
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
$$;

revoke execute on function private.user_pin_problem (text) from public, anon;
grant execute on function private.user_pin_problem (text) to authenticated;

-- Real-time check while typing: 'ok', 'taken', or the rule it breaks. Never who owns it.
create or replace function public.check_user_pin (p_pin text)
  returns text
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
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
$$;

revoke execute on function public.check_user_pin (text) from public, anon;
grant execute on function public.check_user_pin (text) to authenticated;

-- Sets the caller's PIN, once.
create or replace function public.claim_user_pin (p_pin text, p_source text)
  returns text
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
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
$$;

revoke execute on function public.claim_user_pin (text, text) from public, anon;
grant execute on function public.claim_user_pin (text, text) to authenticated;
