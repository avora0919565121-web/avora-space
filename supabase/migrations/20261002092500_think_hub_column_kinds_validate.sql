-- AVORA-61 · D: the table and value validators learn the four new column kinds.
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
  v_ids  text[] := '{}';
  v_key  text;
  v_id   text;
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

    v_id := v_def->>'id';
    IF v_id IS NULL OR btrim(v_id) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'avora_think_hub_column_key_taken';
    END IF;
    v_ids := v_ids || v_id;

    IF btrim(coalesce(v_def->>'label', '')) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_label_required';
    END IF;

    v_type := v_def->>'type';
    IF v_type IS NULL OR v_type NOT IN ('text', 'number', 'date', 'select', 'link', 'contact', 'checkbox', 'file') THEN
      RAISE EXCEPTION 'avora_think_hub_column_type_invalid';
    END IF;

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

    IF v_def ? 'width' AND jsonb_typeof(v_def->'width') <> 'null' THEN
      IF jsonb_typeof(v_def->'width') <> 'number'
         OR (v_def->>'width')::numeric < 60 OR (v_def->>'width')::numeric > 800 THEN
        RAISE EXCEPTION 'avora_think_hub_column_width_invalid';
      END IF;
    END IF;

    IF v_def ? 'hidden' AND jsonb_typeof(v_def->'hidden') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
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

    ELSIF v_type = 'link' THEN
      -- AVORA-61 · D: an http(s) link and nothing else.
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* '^https?://[^\s]+$' OR char_length(v_value #>> '{}') > 2000 THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_link';
      END IF;

    ELSIF v_type = 'contact' THEN
      -- The id of a contact in the writer's own book; others see only that it is set.
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_contact';
      END IF;

    ELSIF v_type = 'checkbox' THEN
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') <> '1' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_checkbox';
      END IF;

    ELSIF v_type = 'file' THEN
      -- Files live in think_hub_cell_files; the cell itself holds nothing.
      RAISE EXCEPTION 'avora_think_hub_value_not_text';

    ELSE
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_text';
      END IF;
    END IF;
  END LOOP;
END;
$function$;
