-- AVORA 20 / Phần 2 + 3 + 8 — Think Hub: phạm vi bảng, Sub-table 3 tầng, id cột bất biến, mục đích bảng.
--
-- Một bảng thuộc đúng MỘT phạm vi:
--   * cá nhân (Diary): project_id và conversation_id cùng NULL, chỉ owner_user_id đọc được;
--   * cuộc trò chuyện (1-1 hoặc Nhóm): conversation_id, mọi người trong cuộc đọc được;
--   * dự án: project_id, mọi người trong cuộc trò chuyện của dự án đọc được. Mỗi dự án đúng 1 bảng gốc.
-- Sub-table sinh từ 1 Hạng mục, thừa hưởng nguyên phạm vi của bảng cha, depth = cha + 1, tối đa 3 (ADR-004, ADR-006).

ALTER TABLE public.think_hub_table
  ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  ADD COLUMN parent_record_id uuid REFERENCES public.think_hub_record(id) ON DELETE CASCADE,
  ADD COLUMN depth smallint NOT NULL DEFAULT 1,
  ADD COLUMN purpose text;

ALTER TABLE public.think_hub_table
  ADD CONSTRAINT think_hub_table_depth_range CHECK (depth BETWEEN 1 AND 3),
  ADD CONSTRAINT think_hub_table_single_scope CHECK (num_nonnulls(project_id, conversation_id) <= 1),
  ADD CONSTRAINT think_hub_table_root_depth CHECK ((parent_record_id IS NULL) = (depth = 1)),
  ADD CONSTRAINT think_hub_table_purpose_len CHECK (purpose IS NULL OR char_length(purpose) <= 2000);

CREATE UNIQUE INDEX think_hub_table_one_root_per_project
  ON public.think_hub_table (project_id)
  WHERE parent_record_id IS NULL AND project_id IS NOT NULL;
CREATE INDEX idx_think_hub_table_conversation ON public.think_hub_table (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_think_hub_table_project ON public.think_hub_table (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_think_hub_table_parent ON public.think_hub_table (parent_record_id) WHERE parent_record_id IS NOT NULL;

-- ---------------------------------------------------------------- ai đọc được gì

CREATE OR REPLACE FUNCTION private.think_hub_scope_visible(
  p_owner uuid, p_conversation_id uuid, p_project_id uuid, p_user uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user IS NULL THEN false
    WHEN p_project_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM projects pr
      JOIN conversation_participants cp ON cp.conversation_id = pr.conversation_id
      WHERE pr.id = p_project_id AND cp.user_id = p_user)
    WHEN p_conversation_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id AND cp.user_id = p_user)
    ELSE p_owner = p_user
  END
$$;

CREATE OR REPLACE FUNCTION private.think_hub_table_visible(p_table_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT private.think_hub_scope_visible(t.owner_user_id, t.conversation_id, t.project_id, p_user)
    FROM think_hub_table t WHERE t.id = p_table_id
  ), false)
$$;

REVOKE ALL ON FUNCTION private.think_hub_scope_visible(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.think_hub_table_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.think_hub_scope_visible(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.think_hub_table_visible(uuid, uuid) TO authenticated;

-- Ghi chỉ qua RPC: authenticated chỉ có SELECT, nên các policy ghi cũ không còn vế GRANT nào khớp.
DROP POLICY think_hub_table_select_own ON public.think_hub_table;
DROP POLICY think_hub_table_insert_own ON public.think_hub_table;
DROP POLICY think_hub_table_update_own ON public.think_hub_table;
DROP POLICY think_hub_table_delete_own ON public.think_hub_table;
DROP POLICY think_hub_record_select_own ON public.think_hub_record;
DROP POLICY think_hub_record_insert_own ON public.think_hub_record;
DROP POLICY think_hub_record_update_own ON public.think_hub_record;
DROP POLICY think_hub_record_delete_own ON public.think_hub_record;

CREATE POLICY think_hub_table_select_scope ON public.think_hub_table
  FOR SELECT TO authenticated
  USING (private.think_hub_scope_visible(owner_user_id, conversation_id, project_id, (SELECT auth.uid())));
CREATE POLICY think_hub_record_select_scope ON public.think_hub_record
  FOR SELECT TO authenticated
  USING (private.think_hub_table_visible(table_id, (SELECT auth.uid())));

REVOKE ALL ON public.think_hub_table, public.think_hub_record FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.think_hub_table, public.think_hub_record FROM authenticated;
GRANT SELECT ON public.think_hub_table, public.think_hub_record TO authenticated;

-- ---------------------------------------------------------------- cột: id bất biến

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

    -- id: sinh một lần lúc tạo cột, không bao giờ đổi. Dữ liệu và mọi tham chiếu bám vào id,
    -- nên đổi tên cột chỉ là đổi nhãn.
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
    IF v_type IS NULL OR v_type NOT IN ('text', 'number', 'date', 'select') THEN
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
  END LOOP;
END;
$function$;

-- Cột cũ: id = key (key vốn đã do máy chủ sinh và không bao giờ đổi).
UPDATE public.think_hub_table t
SET column_defs = (
  SELECT jsonb_agg(CASE WHEN d ? 'id' THEN d ELSE d || jsonb_build_object('id', d->>'key') END ORDER BY ord)
  FROM jsonb_array_elements(t.column_defs) WITH ORDINALITY AS e(d, ord)
)
WHERE jsonb_array_length(t.column_defs) > 0;

-- ---------------------------------------------------------------- triggers kiểm tra

CREATE OR REPLACE FUNCTION private.validate_think_hub_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parent_table think_hub_table%ROWTYPE;
  v_conv_type text;
  v_project_conversation uuid;
BEGIN
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  PERFORM private.validate_column_defs(NEW.column_defs);

  IF jsonb_array_length(NEW.column_defs) > 24 THEN
    RAISE EXCEPTION 'avora_think_hub_column_limit';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_user_id <> OLD.owner_user_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       OR NEW.parent_record_id IS DISTINCT FROM OLD.parent_record_id
       OR NEW.depth <> OLD.depth THEN
      RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
    END IF;
    -- Không cột nào được mất id, đổi key hay đổi kiểu: đó là thứ dữ liệu đang bám vào.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.column_defs) o
      WHERE o ? 'id' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.column_defs) n
        WHERE n->>'id' = o->>'id' AND n->>'key' = o->>'key' AND n->>'type' = o->>'type'
      )
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_column_id_immutable';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.parent_record_id IS NOT NULL THEN
    SELECT t.* INTO v_parent_table
    FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
    WHERE r.id = NEW.parent_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'avora_think_hub_record_not_yours';
    END IF;
    IF v_parent_table.depth >= 3 THEN
      RAISE EXCEPTION 'avora_think_hub_depth_limit';
    END IF;
    -- Sub-table thừa hưởng phạm vi của bảng cha — không bao giờ tự chọn phạm vi khác.
    NEW.depth := v_parent_table.depth + 1;
    NEW.project_id := v_parent_table.project_id;
    NEW.conversation_id := v_parent_table.conversation_id;
    IF NEW.project_id IS NULL AND NEW.conversation_id IS NULL
       AND NEW.owner_user_id <> v_parent_table.owner_user_id THEN
      RAISE EXCEPTION 'avora_think_hub_table_not_yours';
    END IF;
  ELSE
    NEW.depth := 1;
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = NEW.conversation_id;
    -- Diary dùng bảng cá nhân (hai cột phạm vi cùng NULL), không gắn conversation_id.
    IF v_conv_type IS NULL OR v_conv_type NOT IN ('direct', 'group') THEN
      RAISE EXCEPTION 'avora_think_hub_scope_invalid';
    END IF;
  END IF;

  IF NOT private.think_hub_scope_visible(NEW.owner_user_id, NEW.conversation_id, NEW.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.validate_think_hub_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF TG_OP = 'UPDATE' AND (NEW.table_id <> OLD.table_id OR NEW.owner_user_id <> OLD.owner_user_id) THEN
    RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = NEW.table_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  IF TG_OP = 'INSERT'
     AND NOT private.think_hub_scope_visible(v_table.owner_user_id, v_table.conversation_id, v_table.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  IF NEW.tags IS NULL OR array_position(NEW.tags, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_tags_shape';
  END IF;

  PERFORM private.validate_extension_values(v_table.column_defs, NEW.extension_fields);

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------- bảng

CREATE OR REPLACE FUNCTION public.ensure_default_think_hub_table()
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('think_hub_default:' || v_user::text, 0));

  -- Chỉ bảng gốc cá nhân: bảng của một cuộc trò chuyện hay dự án không phải "bảng của tôi".
  SELECT * INTO v_row FROM think_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL
    AND project_id IS NULL AND conversation_id IS NULL AND parent_record_id IS NULL
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

DROP FUNCTION public.create_think_hub_table(text);
CREATE FUNCTION public.create_think_hub_table(
  p_name text,
  p_purpose text DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL
)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF p_conversation_id IS NOT NULL
     AND NOT private.is_conversation_participant(p_conversation_id, v_user) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;

  -- Bảng gốc của dự án chỉ sinh cùng dự án; ở đây là bảng độc lập (Diary, 1-1, Nhóm).
  INSERT INTO think_hub_table (owner_user_id, name, purpose, conversation_id, position)
  SELECT v_user, v_name, nullif(btrim(coalesce(p_purpose, '')), ''), p_conversation_id,
         coalesce(max(position), -1) + 1
  FROM think_hub_table
  WHERE deleted_at IS NULL AND parent_record_id IS NULL AND project_id IS NULL
    AND conversation_id IS NOT DISTINCT FROM p_conversation_id
    AND (p_conversation_id IS NOT NULL OR owner_user_id = v_user)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE FUNCTION public.create_think_hub_sub_table(
  p_record_id uuid,
  p_name text DEFAULT NULL,
  p_purpose text DEFAULT NULL
)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_record think_hub_record%ROWTYPE;
  v_parent think_hub_table%ROWTYPE;
  v_name   text;
  v_row    think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_record FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_record.table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  SELECT * INTO v_parent FROM think_hub_table WHERE id = v_record.table_id;
  IF v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  IF v_parent.depth >= 3 THEN
    RAISE EXCEPTION 'avora_think_hub_depth_limit';
  END IF;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_record.title);

  INSERT INTO think_hub_table (owner_user_id, name, purpose, parent_record_id, position)
  SELECT v_user, v_name,
         -- Gợi ý có sẵn, người tạo sửa tự do; gửi chuỗi rỗng là chủ động để trống.
         CASE WHEN p_purpose IS NULL THEN 'Theo dõi cho: ' || v_record.title
              ELSE nullif(btrim(p_purpose), '') END,
         p_record_id,
         coalesce(max(position), -1) + 1
  FROM think_hub_table
  WHERE parent_record_id = p_record_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rename_think_hub_table(p_table_id uuid, p_name text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    AND private.think_hub_table_visible(id, v_user)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE FUNCTION public.set_think_hub_table_purpose(p_table_id uuid, p_purpose text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  -- Bảng gốc của dự án đọc lại Kim chỉ nam / Mục tiêu của dự án, không có mục đích riêng.
  IF v_row.project_id IS NOT NULL AND v_row.parent_record_id IS NULL THEN
    RAISE EXCEPTION 'avora_think_hub_purpose_inherited';
  END IF;

  UPDATE think_hub_table SET purpose = nullif(btrim(coalesce(p_purpose, '')), '')
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF v_row.project_id IS NOT NULL AND v_row.parent_record_id IS NULL THEN
    RAISE EXCEPTION 'avora_think_hub_project_root_locked';
  END IF;

  UPDATE think_hub_table SET deleted_at = now()
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    AND private.think_hub_table_visible(id, v_user)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------- cột

CREATE OR REPLACE FUNCTION public.add_think_hub_column(p_table_id uuid, p_label text, p_type text, p_options text[] DEFAULT NULL::text[])
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_label   text;
  v_options jsonb;
  v_id      text;
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
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  -- id và key cùng một giá trị, sinh một lần: key là nơi giá trị của từng Hạng mục được cất.
  v_id := 'col_' || replace(gen_random_uuid()::text, '-', '');
  v_def := jsonb_build_object('id', v_id, 'key', v_id, 'label', v_label, 'type', p_type);

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

CREATE FUNCTION public.rename_think_hub_column(p_table_id uuid, p_column_id text, p_label text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_row   think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF v_label = '' THEN
    RAISE EXCEPTION 'avora_think_hub_column_label_required';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.column_defs) d WHERE d->>'id' = p_column_id) THEN
    RAISE EXCEPTION 'avora_think_hub_column_missing';
  END IF;

  -- Chỉ nhãn đổi; id, key, kiểu và lựa chọn giữ nguyên nên không giá trị nào bị mất.
  UPDATE think_hub_table
  SET column_defs = (
    SELECT jsonb_agg(
      CASE WHEN d->>'id' = p_column_id THEN d || jsonb_build_object('label', v_label) ELSE d END
      ORDER BY ord)
    FROM jsonb_array_elements(v_row.column_defs) WITH ORDINALITY AS e(d, ord)
  )
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------- Hạng mục

DROP FUNCTION public.create_think_hub_record(uuid, text, text, text, text, date, text[], text, jsonb);
CREATE FUNCTION public.create_think_hub_record(
  p_table_id uuid,
  p_title text,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_next_action_date date DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_extension_fields jsonb DEFAULT NULL,
  -- Ngữ cảnh đang tạo: cả hai NULL = Diary/cá nhân; một cuộc trò chuyện (1-1/Nhóm); hoặc một dự án.
  p_scope_conversation_id uuid DEFAULT NULL,
  p_scope_project_id uuid DEFAULT NULL
)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_title text;
  v_count integer;
  v_table think_hub_table%ROWTYPE;
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

  SELECT * INTO v_table FROM think_hub_table WHERE id = p_table_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  -- Bảng phải thuộc đúng ngữ cảnh đang tạo, kể cả khi người gọi có quyền đọc bảng đó.
  IF v_table.conversation_id IS DISTINCT FROM p_scope_conversation_id
     OR v_table.project_id IS DISTINCT FROM p_scope_project_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_out_of_scope';
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

  SELECT * INTO v_row FROM think_hub_record WHERE id = p_record_id;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_row.table_id, v_user) THEN
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

-- Cất đi / lấy lại: người ghi Hạng mục đó hoặc chủ bảng.
CREATE OR REPLACE FUNCTION public.delete_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE think_hub_record r SET deleted_at = now()
  WHERE r.id = p_record_id AND r.deleted_at IS NULL
    AND private.think_hub_table_visible(r.table_id, v_user)
    AND (r.owner_user_id = v_user
         OR EXISTS (SELECT 1 FROM think_hub_table t WHERE t.id = r.table_id AND t.owner_user_id = v_user))
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_row   think_hub_record%ROWTYPE;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT r.* INTO v_row FROM think_hub_record r
  WHERE r.id = p_record_id AND r.deleted_at IS NOT NULL
    AND private.think_hub_table_visible(r.table_id, v_user)
    AND (r.owner_user_id = v_user
         OR EXISTS (SELECT 1 FROM think_hub_table t WHERE t.id = r.table_id AND t.owner_user_id = v_user));
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

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ensure_default_think_hub_table()',
    'public.create_think_hub_table(text, text, uuid)',
    'public.create_think_hub_sub_table(uuid, text, text)',
    'public.rename_think_hub_table(uuid, text)',
    'public.set_think_hub_table_purpose(uuid, text)',
    'public.delete_think_hub_table(uuid)',
    'public.restore_think_hub_table(uuid)',
    'public.add_think_hub_column(uuid, text, text, text[])',
    'public.rename_think_hub_column(uuid, text, text)',
    'public.create_think_hub_record(uuid, text, text, text, text, date, text[], text, jsonb, uuid, uuid)',
    'public.update_think_hub_record(uuid, jsonb)',
    'public.delete_think_hub_record(uuid)',
    'public.restore_think_hub_record(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION private.validate_think_hub_table() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.validate_think_hub_record() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.validate_column_defs(jsonb) FROM PUBLIC, anon, authenticated;
END $$;
