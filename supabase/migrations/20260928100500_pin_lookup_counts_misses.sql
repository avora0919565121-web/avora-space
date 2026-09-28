-- AVORA-38 (gộp) / Phần 2 · Nhóm B — fix found by probe 2.4 on the live database.
--
-- start_pin_connection counted an attempt and then raised avora_pin_not_found. The exception rolls
-- back the whole call, including the attempt row, so failed lookups — exactly what PIN scanning is
-- made of — never counted toward the 20/hour limit. A miss now returns NULL instead: every miss
-- (unknown PIN, owner without PIN, blocked pair) still looks identical, the client shows the same
-- "không tìm thấy" sentence, and the attempt is kept. Same signature → CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.start_pin_connection(p_pin text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Not found / no PIN / blocked all return NULL — never an exception — so the attempt row above
  -- survives (an exception would roll it back and misses would never count toward the limit).
  if v_other is null or private.is_blocked_between (v_uid, v_other) then
    return null;
  end if;

  if private.are_connected (v_uid, v_other) then
    return private.direct_for_connected (v_uid, v_other);
  end if;

  v_conv := private.live_verification_between (v_uid, v_other);
  if v_conv is not null then return v_conv; end if;

  return private.open_verification (v_uid, v_other, null);
end;
$function$;

-- ===================== Previous definition (verbatim) =====================
-- CREATE OR REPLACE FUNCTION public.start_pin_connection(p_pin text)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid ();
--   v_pin text := upper (regexp_replace (btrim (coalesce (p_pin, '')), '\s', '', 'g'));
--   v_other uuid;
--   v_conv uuid;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if not exists (select 1 from public.user_pins where user_id = v_uid and pin is not null) then
--     raise exception 'avora_pin_required';
--   end if;
--   -- Counted before the lookup, so a miss costs the same as a hit.
--   perform private.note_connection_attempt (v_uid, 'pin');
-- 
--   if v_pin not like 'A-%' then v_pin := 'A-' || v_pin; end if;
--   select up.user_id into v_other from public.user_pins up where up.pin = v_pin;
-- 
--   if v_other = v_uid then raise exception 'avora_pin_self'; end if;
--   if v_other is null or private.is_blocked_between (v_uid, v_other) then
--     raise exception 'avora_pin_not_found';
--   end if;
-- 
--   if private.are_connected (v_uid, v_other) then
--     return private.direct_for_connected (v_uid, v_other);
--   end if;
-- 
--   v_conv := private.live_verification_between (v_uid, v_other);
--   if v_conv is not null then return v_conv; end if;
-- 
--   return private.open_verification (v_uid, v_other, null);
-- end;
-- $function$
