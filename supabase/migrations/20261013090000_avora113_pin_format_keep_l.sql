-- AVORA-113 — "Không lưu được PIN". The 12/10 alphabet change (20261012090000) let the upper-case L
-- through private.user_pin_problem but left the table constraint user_pins_format on the old
-- 23-letter set, so check_user_pin said "ok" and the INSERT inside claim_user_pin then failed with
-- check_violation 23514 — which claim_user_pin does not catch (it only catches unique_violation).
--
-- Rebuilt with the same shape (letter · 6 of letters/2–9 · letter) and the 24-letter set:
-- A–Z without I and O. user_pins_letters and user_pins_source are untouched. Issued PINs are
-- re-checked by VALIDATE (they all used the narrower set, so they stay valid).
alter table public.user_pins drop constraint if exists user_pins_format;
alter table public.user_pins
  add constraint user_pins_format
  check (pin ~ '^A-[ABCDEFGHJKLMNPQRSTUVWXYZ][ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}[ABCDEFGHJKLMNPQRSTUVWXYZ]$')
  not valid;
alter table public.user_pins validate constraint user_pins_format;
