-- AVORA 25+26 / Nhóm A — Think Hub dùng được thật.
--   A1/A3: mỗi cột có thể mang `width` (px) và `hidden`; chỉ chủ bảng đổi, áp dụng cho mọi người xem.
--   A4: mỗi Hạng mục có đúng 1 bảng con.
--   A5: Task gắn Hạng mục ở mọi nơi. Bảng dự án dùng `project_tasks.record_id` sẵn có; bảng
--       Nhật ký / 1-1 / Nhóm dùng `think_hub_record_tasks` (cùng một ý nghĩa, không chép Task).

-- ---------------------------------------------------------------- A1 + A3: cột

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
REVOKE ALL ON FUNCTION private.validate_column_defs(jsonb) FROM PUBLIC, anon, authenticated;

-- Đổi một thuộc tính trình bày của một cột (độ rộng / ẩn). Không đụng id, key, kiểu hay dữ liệu.
CREATE FUNCTION private.patch_think_hub_column(p_table_id uuid, p_column_id text, p_patch jsonb)
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
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.column_defs) d WHERE d->>'id' = p_column_id) THEN
    RAISE EXCEPTION 'avora_think_hub_column_missing';
  END IF;

  UPDATE think_hub_table
  SET column_defs = (
    SELECT jsonb_agg(
      CASE WHEN d->>'id' = p_column_id THEN jsonb_strip_nulls(d || p_patch) ELSE d END
      ORDER BY ord)
    FROM jsonb_array_elements(v_row.column_defs) WITH ORDINALITY AS e(d, ord)
  )
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION private.patch_think_hub_column(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_think_hub_column_width(p_table_id uuid, p_column_id text, p_width integer)
 RETURNS think_hub_table
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- NULL trả cột về độ rộng mặc định.
  SELECT private.patch_think_hub_column(
    p_table_id, p_column_id,
    jsonb_build_object('width', CASE WHEN p_width IS NULL THEN NULL ELSE greatest(60, least(800, p_width)) END)
  );
$function$;

CREATE FUNCTION public.set_think_hub_column_hidden(p_table_id uuid, p_column_id text, p_hidden boolean)
 RETURNS think_hub_table
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT private.patch_think_hub_column(
    p_table_id, p_column_id,
    jsonb_build_object('hidden', CASE WHEN coalesce(p_hidden, false) THEN true ELSE NULL END)
  );
$function$;

-- ---------------------------------------------------------------- A4: 1 bảng con / Hạng mục

CREATE UNIQUE INDEX think_hub_table_one_sub_per_record
  ON public.think_hub_table (parent_record_id)
  WHERE parent_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_think_hub_sub_table(
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
  v_user     uuid := auth.uid();
  v_record   think_hub_record%ROWTYPE;
  v_parent   think_hub_table%ROWTYPE;
  v_existing think_hub_table%ROWTYPE;
  v_name     text;
  v_row      think_hub_table%ROWTYPE;
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

  -- Đúng 1 bảng con. Bảng con đã cất đi thì lấy lại thay vì tạo cái thứ hai.
  SELECT * INTO v_existing FROM think_hub_table WHERE parent_record_id = p_record_id;
  IF FOUND THEN
    IF v_existing.deleted_at IS NULL THEN
      RAISE EXCEPTION 'avora_think_hub_sub_table_exists';
    END IF;
    UPDATE think_hub_table SET deleted_at = NULL WHERE id = v_existing.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_record.title);

  INSERT INTO think_hub_table (owner_user_id, name, purpose, parent_record_id, position)
  VALUES (
    v_user, v_name,
    CASE WHEN p_purpose IS NULL THEN 'Theo dõi cho: ' || v_record.title
         ELSE nullif(btrim(p_purpose), '') END,
    p_record_id, 0
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------- A5: Task ↔ Hạng mục (ngoài dự án)

CREATE TABLE public.think_hub_record_tasks (
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  record_id uuid NOT NULL REFERENCES public.think_hub_record(id) ON DELETE CASCADE,
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_think_hub_record_tasks_record ON public.think_hub_record_tasks (record_id);

CREATE FUNCTION private.validate_think_hub_record_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table think_hub_table%ROWTYPE;
  v_task  tasks%ROWTYPE;
BEGIN
  SELECT t.* INTO v_table
  FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
  WHERE r.id = NEW.record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  -- Hạng mục của dự án đi qua project_tasks, không qua đây.
  IF v_table.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_is_project';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_task_missing';
  END IF;

  -- Task và Hạng mục phải cùng một nơi: bảng riêng ↔ việc riêng của chính chủ bảng;
  -- bảng của cuộc trò chuyện ↔ việc chung của đúng cuộc đó.
  IF v_table.conversation_id IS NULL THEN
    IF v_task.type <> 'personal' OR v_task.creator_id <> v_table.owner_user_id THEN
      RAISE EXCEPTION 'avora_think_hub_task_out_of_scope';
    END IF;
  ELSIF v_task.conversation_id IS DISTINCT FROM v_table.conversation_id THEN
    RAISE EXCEPTION 'avora_think_hub_task_out_of_scope';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_think_hub_record_task() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_think_hub_record_tasks_validate
  BEFORE INSERT OR UPDATE ON public.think_hub_record_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_think_hub_record_task();

ALTER TABLE public.think_hub_record_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY think_hub_record_tasks_select ON public.think_hub_record_tasks
  FOR SELECT TO authenticated
  USING (
    private.can_view_task(task_id, (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.think_hub_record r
      WHERE r.id = think_hub_record_tasks.record_id
        AND private.think_hub_table_visible(r.table_id, (SELECT auth.uid()))
    )
  );
REVOKE ALL ON public.think_hub_record_tasks FROM anon, authenticated;
GRANT SELECT ON public.think_hub_record_tasks TO authenticated;

-- Tạo một Task từ một Hạng mục ngoài dự án. Luôn do người dùng bấm; Task đi đúng đường sẵn có:
-- Nhật ký → việc riêng (đã xác nhận); 1-1 / Nhóm → việc chung chờ người nhận xác nhận.
CREATE FUNCTION public.create_record_task(
  p_record_id uuid,
  p_task_id uuid,
  p_title text,
  p_description text,
  p_deadline date,
  p_assignee_id uuid DEFAULT NULL,
  p_deadline_time time DEFAULT NULL,
  p_deadline_tz text DEFAULT NULL
) RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_rec   think_hub_record%ROWTYPE;
  v_table think_hub_table%ROWTYPE;
  v_conv_type text;
  v_task  tasks%ROWTYPE;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc  text := btrim(coalesce(p_description, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_rec FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_rec.table_id, v_uid) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  SELECT * INTO v_table FROM think_hub_table WHERE id = v_rec.table_id;
  IF v_table.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_is_project';
  END IF;

  IF v_table.conversation_id IS NULL THEN
    IF v_title = '' THEN RAISE EXCEPTION 'avora_task_title_blank'; END IF;
    IF char_length(v_title) > 200 THEN RAISE EXCEPTION 'avora_task_title_max_len'; END IF;
    INSERT INTO tasks (
      id, type, creator_id, title, description, status, deadline_date, deadline_time, deadline_tz,
      is_important, recurrence
    ) VALUES (
      p_task_id, 'personal', v_uid, v_title, v_desc, 'confirmed', p_deadline, p_deadline_time,
      coalesce(nullif(btrim(coalesce(p_deadline_tz, '')), ''), 'Asia/Ho_Chi_Minh'), false, 'none'
    )
    RETURNING * INTO v_task;
  ELSE
    SELECT type INTO v_conv_type FROM conversations WHERE id = v_table.conversation_id;
    v_task := public.create_shared_task(
      v_table.conversation_id,
      CASE WHEN v_conv_type = 'group' THEN 'group-shared' ELSE '1-1-shared' END,
      p_title, p_description, p_deadline, p_task_id, p_assignee_id, p_deadline_time, p_deadline_tz,
      NULL, false, 'none', NULL,
      jsonb_build_object(
        'conversation_type', v_conv_type,
        'conversation_id', v_table.conversation_id,
        'conversation_name', v_table.name,
        'original_message_id', NULL,
        'original_message_text', '',
        'original_message_sender_id', NULL,
        'original_message_sender_name', '',
        'original_message_created_at', NULL,
        'user_response', 'Từ Hạng mục: ' || v_rec.title,
        'snapshot_created_at', now()
      )
    );
  END IF;

  INSERT INTO think_hub_record_tasks (task_id, record_id, linked_by)
  VALUES (v_task.id, p_record_id, v_uid);

  RETURN v_task;
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_think_hub_column_width(uuid, text, integer)',
    'public.set_think_hub_column_hidden(uuid, text, boolean)',
    'public.create_think_hub_sub_table(uuid, text, text)',
    'public.create_record_task(uuid, uuid, text, text, date, uuid, time, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
