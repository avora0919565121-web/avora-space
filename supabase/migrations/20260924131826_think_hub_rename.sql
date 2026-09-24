-- AVORA 20 / Phần 1 — Business HUB → Think Hub (ADR-001, ADR-022).
-- Tên canonical trong code/schema là Think Hub; nhãn hiển thị là "Kế hoạch".
ALTER TABLE public.business_hub_table RENAME TO think_hub_table;
ALTER TABLE public.business_hub_record RENAME TO think_hub_record;

ALTER TABLE public.think_hub_table RENAME CONSTRAINT business_hub_table_pkey TO think_hub_table_pkey;
ALTER TABLE public.think_hub_table RENAME CONSTRAINT business_hub_table_owner_user_id_fkey TO think_hub_table_owner_user_id_fkey;
ALTER TABLE public.think_hub_record RENAME CONSTRAINT business_hub_record_pkey TO think_hub_record_pkey;
ALTER TABLE public.think_hub_record RENAME CONSTRAINT business_hub_record_priority_check TO think_hub_record_priority_check;
ALTER TABLE public.think_hub_record RENAME CONSTRAINT business_hub_record_table_id_fkey TO think_hub_record_table_id_fkey;
ALTER TABLE public.think_hub_record RENAME CONSTRAINT business_hub_record_owner_user_id_fkey TO think_hub_record_owner_user_id_fkey;
ALTER TABLE public.think_hub_record RENAME CONSTRAINT business_hub_record_project_id_fkey TO think_hub_record_project_id_fkey;

ALTER INDEX public.idx_business_hub_table_owner RENAME TO idx_think_hub_table_owner;
ALTER INDEX public.idx_business_hub_record_table RENAME TO idx_think_hub_record_table;
ALTER INDEX public.idx_business_hub_record_owner RENAME TO idx_think_hub_record_owner;
ALTER INDEX public.business_hub_record_remind_idx RENAME TO think_hub_record_remind_idx;

ALTER POLICY business_hub_table_select_own ON public.think_hub_table RENAME TO think_hub_table_select_own;
ALTER POLICY business_hub_table_insert_own ON public.think_hub_table RENAME TO think_hub_table_insert_own;
ALTER POLICY business_hub_table_update_own ON public.think_hub_table RENAME TO think_hub_table_update_own;
ALTER POLICY business_hub_table_delete_own ON public.think_hub_table RENAME TO think_hub_table_delete_own;
ALTER POLICY business_hub_record_select_own ON public.think_hub_record RENAME TO think_hub_record_select_own;
ALTER POLICY business_hub_record_insert_own ON public.think_hub_record RENAME TO think_hub_record_insert_own;
ALTER POLICY business_hub_record_update_own ON public.think_hub_record RENAME TO think_hub_record_update_own;
ALTER POLICY business_hub_record_delete_own ON public.think_hub_record RENAME TO think_hub_record_delete_own;

ALTER TRIGGER trg_business_hub_table_touch_updated_at ON public.think_hub_table RENAME TO trg_think_hub_table_touch_updated_at;
ALTER TRIGGER trg_business_hub_record_touch_updated_at ON public.think_hub_record RENAME TO trg_think_hub_record_touch_updated_at;
DROP TRIGGER trg_business_hub_table_validate ON public.think_hub_table;
DROP TRIGGER trg_business_hub_record_validate ON public.think_hub_record;

DROP FUNCTION public.restore_business_hub_record(uuid);
DROP FUNCTION public.rename_business_hub_table(uuid, text);
DROP FUNCTION public.delete_business_hub_table(uuid);
DROP FUNCTION public.restore_business_hub_table(uuid);
DROP FUNCTION public.delete_business_hub_record(uuid);
DROP FUNCTION public.ensure_default_business_hub_table();
DROP FUNCTION public.create_business_hub_table(text);
DROP FUNCTION public.add_business_hub_column(uuid, text, text, text[]);
DROP FUNCTION public.create_business_hub_record(uuid, text, text, text, text, date, text[], text, jsonb);
DROP FUNCTION public.update_business_hub_record(uuid, jsonb);
DROP FUNCTION private.validate_business_hub_table();
DROP FUNCTION private.validate_business_hub_record();

CREATE OR REPLACE FUNCTION public.restore_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_row   think_hub_record%ROWTYPE;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM think_hub_record
  WHERE id = p_record_id AND owner_user_id = v_user AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  SELECT count(*) INTO v_count FROM think_hub_record
  WHERE table_id = v_row.table_id AND deleted_at IS NULL;
  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_think_hub_record_limit';
  END IF;

  UPDATE think_hub_record SET deleted_at = NULL
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.rename_think_hub_table(p_table_id uuid, p_name text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  UPDATE think_hub_table SET name = v_name
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE think_hub_table SET deleted_at = now()
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.restore_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE think_hub_table SET deleted_at = NULL
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NOT NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE think_hub_record SET deleted_at = now()
  WHERE id = p_record_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION private.validate_column_defs(p_defs jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def  jsonb;
  v_type text;
  v_keys text[] := '{}';
  v_key  text;
BEGIN
  IF p_defs IS NULL OR jsonb_typeof(p_defs) <> 'array' THEN
    RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
  END IF;

  FOR v_def IN SELECT * FROM jsonb_array_elements(p_defs) LOOP
    IF jsonb_typeof(v_def) <> 'object' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;

    v_key := v_def->>'key';
    IF v_key IS NULL OR btrim(v_key) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'avora_think_hub_column_key_taken';
    END IF;
    v_keys := v_keys || v_key;

    IF btrim(coalesce(v_def->>'label', '')) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_label_required';
    END IF;

    v_type := v_def->>'type';
    IF v_type IS NULL OR v_type NOT IN ('text', 'number', 'date', 'select') THEN
      RAISE EXCEPTION 'avora_think_hub_column_type_invalid';
    END IF;

    -- 'select' mà không có lựa chọn nào là một ô không bao giờ điền được.
    IF v_type = 'select' THEN
      IF v_def->'options' IS NULL
         OR jsonb_typeof(v_def->'options') <> 'array'
         OR jsonb_array_length(v_def->'options') = 0 THEN
        RAISE EXCEPTION 'avora_think_hub_column_options_required';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_def->'options') AS opt
        WHERE jsonb_typeof(opt) <> 'string' OR btrim(opt #>> '{}') = ''
      ) THEN
        RAISE EXCEPTION 'avora_think_hub_column_options_required';
      END IF;
    END IF;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION private.validate_extension_values(p_defs jsonb, p_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def   jsonb;
  v_value jsonb;
  v_type  text;
BEGIN
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'avora_think_hub_extension_shape';
  END IF;

  FOR v_def IN SELECT * FROM jsonb_array_elements(coalesce(p_defs, '[]'::jsonb)) LOOP
    v_value := p_values -> (v_def->>'key');
    -- Chưa ai điền là trạng thái bình thường của một cột vừa thêm.
    CONTINUE WHEN v_value IS NULL OR jsonb_typeof(v_value) = 'null';
    IF jsonb_typeof(v_value) = 'string' AND btrim(v_value #>> '{}') = '' THEN
      CONTINUE;
    END IF;

    v_type := v_def->>'type';

    IF v_type = 'number' THEN
      IF jsonb_typeof(v_value) <> 'number' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_number';
      END IF;

    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_date';
      END IF;
      BEGIN
        PERFORM (v_value #>> '{}')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_date';
      END;

    ELSIF v_type = 'select' THEN
      IF jsonb_typeof(v_value) <> 'string'
         OR NOT (v_def->'options' @> jsonb_build_array(v_value #>> '{}')) THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_option';
      END IF;

    ELSE
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_text';
      END IF;
    END IF;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION private.validate_think_hub_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  PERFORM private.validate_column_defs(NEW.column_defs);

  IF jsonb_array_length(NEW.column_defs) > 24 THEN
    RAISE EXCEPTION 'avora_think_hub_column_limit';
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION private.validate_think_hub_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table think_hub_table%ROWTYPE;
BEGIN
  IF btrim(coalesce(NEW.title, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;

  IF btrim(coalesce(NEW.status, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_status_required';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = NEW.table_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  IF v_table.owner_user_id <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  IF NEW.tags IS NULL OR array_position(NEW.tags, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_tags_shape';
  END IF;

  PERFORM private.validate_extension_values(v_table.column_defs, NEW.extension_fields);

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.ensure_default_think_hub_table()
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('think_hub_default:' || v_user::text, 0));

  SELECT * INTO v_row FROM think_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL
  ORDER BY position, created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO think_hub_table (owner_user_id, name, position, column_defs)
  VALUES (v_user, 'Bảng tổng hợp', 0, '[]'::jsonb)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.create_think_hub_table(p_name text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  INSERT INTO think_hub_table (owner_user_id, name, position)
  SELECT v_user, v_name,
         coalesce(max(position), -1) + 1
  FROM think_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.add_think_hub_column(p_table_id uuid, p_label text, p_type text, p_options text[] DEFAULT NULL::text[])
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_label   text;
  v_options jsonb;
  v_def     jsonb;
  v_row     think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_label := btrim(coalesce(p_label, ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'avora_think_hub_column_label_required';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('text', 'number', 'date', 'select') THEN
    RAISE EXCEPTION 'avora_think_hub_column_type_invalid';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  v_def := jsonb_build_object(
    'key', 'col_' || replace(gen_random_uuid()::text, '-', ''),
    'label', v_label,
    'type', p_type
  );

  IF p_type = 'select' THEN
    SELECT coalesce(jsonb_agg(DISTINCT btrim(opt)), '[]'::jsonb) INTO v_options
    FROM unnest(coalesce(p_options, '{}')) AS opt
    WHERE btrim(coalesce(opt, '')) <> '';

    IF jsonb_array_length(v_options) = 0 THEN
      RAISE EXCEPTION 'avora_think_hub_column_options_required';
    END IF;
    v_def := v_def || jsonb_build_object('options', v_options);
  END IF;

  UPDATE think_hub_table
  SET column_defs = column_defs || jsonb_build_array(v_def)
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.create_think_hub_record(p_table_id uuid, p_title text, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_next_action_date date DEFAULT NULL::date, p_tags text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text, p_extension_fields jsonb DEFAULT NULL::jsonb)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_title text;
  v_count integer;
  v_row   think_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM think_hub_table
    WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  SELECT count(*) INTO v_count FROM think_hub_record
  WHERE table_id = p_table_id AND deleted_at IS NULL;

  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_think_hub_record_limit';
  END IF;

  INSERT INTO think_hub_record (
    table_id, owner_user_id, title, status, priority,
    category, next_action_date, tags, notes, extension_fields
  ) VALUES (
    p_table_id, v_user, v_title,
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'moi'),
    coalesce(p_priority, 'trung_binh'),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_next_action_date,
    coalesce(p_tags, '{}'),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_extension_fields, '{}'::jsonb)
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_think_hub_record(p_record_id uuid, p_patch jsonb)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
  v_key  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'avora_think_hub_patch_shape';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'title', 'status', 'priority', 'category',
      'next_action_date', 'tags', 'notes', 'extension_fields', 'remind_at'
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_patch_field';
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM think_hub_record
  WHERE id = p_record_id AND owner_user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_deleted';
  END IF;

  IF p_patch ? 'priority'
     AND coalesce(p_patch->>'priority', '') NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  UPDATE think_hub_record SET
    title = CASE WHEN p_patch ? 'title'
      THEN btrim(coalesce(p_patch->>'title', '')) ELSE title END,
    status = CASE WHEN p_patch ? 'status'
      THEN btrim(coalesce(p_patch->>'status', '')) ELSE status END,
    priority = CASE WHEN p_patch ? 'priority'
      THEN p_patch->>'priority' ELSE priority END,
    category = CASE WHEN p_patch ? 'category'
      THEN nullif(btrim(coalesce(p_patch->>'category', '')), '') ELSE category END,
    next_action_date = CASE WHEN p_patch ? 'next_action_date'
      THEN nullif(btrim(coalesce(p_patch->>'next_action_date', '')), '')::date
      ELSE next_action_date END,
    tags = CASE WHEN p_patch ? 'tags'
      THEN coalesce((
        SELECT array_agg(btrim(tag #>> '{}'))
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_patch->'tags') = 'array' THEN p_patch->'tags' ELSE '[]'::jsonb END
        ) AS tag
        WHERE btrim(coalesce(tag #>> '{}', '')) <> ''
      ), '{}')
      ELSE tags END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END,
    extension_fields = CASE WHEN p_patch ? 'extension_fields'
      THEN coalesce(p_patch->'extension_fields', '{}'::jsonb) ELSE extension_fields END,
    remind_at = CASE WHEN p_patch ? 'remind_at'
      THEN nullif(btrim(coalesce(p_patch->>'remind_at', '')), '')::timestamptz
      ELSE remind_at END
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;



CREATE TRIGGER trg_think_hub_table_validate
  BEFORE INSERT OR UPDATE ON public.think_hub_table
  FOR EACH ROW EXECUTE FUNCTION private.validate_think_hub_table();
CREATE TRIGGER trg_think_hub_record_validate
  BEFORE INSERT OR UPDATE ON public.think_hub_record
  FOR EACH ROW EXECUTE FUNCTION private.validate_think_hub_record();

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.restore_think_hub_record(uuid)', 'public.rename_think_hub_table(uuid, text)',
    'public.delete_think_hub_table(uuid)', 'public.restore_think_hub_table(uuid)',
    'public.delete_think_hub_record(uuid)', 'public.ensure_default_think_hub_table()',
    'public.create_think_hub_table(text)', 'public.add_think_hub_column(uuid, text, text, text[])',
    'public.create_think_hub_record(uuid, text, text, text, text, date, text[], text, jsonb)',
    'public.update_think_hub_record(uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION private.validate_think_hub_table() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.validate_think_hub_record() FROM PUBLIC, anon, authenticated;
END $$;
