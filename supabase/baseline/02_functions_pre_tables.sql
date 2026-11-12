set check_function_bodies = off;
CREATE OR REPLACE FUNCTION private.normalize_channel(p_kind text, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '';
  END IF;

  IF p_kind = 'email' THEN
    RETURN lower(btrim(p_value));
  END IF;

  -- +84 912 345 678 và 0912345678 là cùng một số: người lưu dạng này rồi nhập
  -- dạng kia vẫn phải ra một liên hệ, không phải hai.
  v := regexp_replace(p_value, '[^0-9+]', '', 'g');
  v := regexp_replace(v, '^\+?84', '0');
  RETURN regexp_replace(v, '[^0-9]', '', 'g');
END;
$function$;
