-- PIN alphabet (VMT 12/10): keep the upper-case L. A PIN is always shown upper-case, so the
-- lower-case l that reads like 1 never appears. Still refused: 0, 1, O, I.
-- Mirrors web/src/lib/user-pin.ts (PIN_LETTERS = 24 letters, PIN_DIGITS = 2–9).
-- PINs already issued are untouched: nothing here rewrites user_pins.
create or replace function private.user_pin_problem (p_pin text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case
    when p_pin is null or p_pin !~ '^A-.{8}$' then 'avora_pin_format'
    when substr(p_pin, 3) ~ '[01OI]' then 'avora_pin_confusing'
    when substr(p_pin, 3) !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$' then 'avora_pin_format'
    when substr(p_pin, 3, 1) !~ '[A-Z]' or substr(p_pin, 10, 1) !~ '[A-Z]' then 'avora_pin_edges'
    when char_length(regexp_replace(substr(p_pin, 3), '[^A-Z]', '', 'g')) < 4 then 'avora_pin_letters'
    when substr(p_pin, 3) ~ '(FUCK|FUK|CUNT|SEX|XXX|CAC|DCM|DKM|DMM|DJT|DM2|CUT|DEM|BUCU|META|VISA|GRAB|SAMSUNG|SHOPEE|VNPAY|MBBANK|VCB|TPBANK|ACB|MASTERCARD|AMEX|NVIDIA|TESLA|UBER|ADMN|ROOT)'
      then 'avora_pin_blocked'
    else null
  end
$$;

revoke execute on function private.user_pin_problem (text) from public, anon;
grant execute on function private.user_pin_problem (text) to authenticated;
