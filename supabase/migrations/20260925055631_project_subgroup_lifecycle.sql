-- AVORA 25+26 / Nhóm B + C2.
--   B1: mỗi dự án có nhóm con riêng (chat riêng, thành viên riêng). Chỉ Owner/Admin của nhóm mở dự án.
--   B2: đóng đủ tiêu chí (+ 1 lời cảm ơn được ghim) hoặc đóng sớm (lý do bắt buộc, Check-Adjust riêng tư).
--       Đóng rồi thì chat, Bảng, Hạng mục, Task, tiêu chí đều chỉ đọc; người tạo mở lại được.
--   B3: chỉ Owner của nhóm gốc xoá, gõ đúng tên + lý do; một dòng hệ thống vào chat; xoá mềm (tầng Inner,
--       ADR-011) — Outer Trash và xoá vĩnh viễn chờ Key & Trust Architecture (OPEN-001).
--   C2: "Thêm vào Hôm nay" theo từng người, chỉ có hiệu lực đúng ngày đã thêm.

-- ---------------------------------------------------------------- cột mới

ALTER TABLE public.messages
  ADD COLUMN system_kind text
    CHECK (system_kind IS NULL OR system_kind IN ('project_deleted'));
COMMENT ON COLUMN public.messages.system_kind IS
  'Non-null = a system line written by the server (clients have no INSERT grant on it). sender_id is the actor.';

ALTER TABLE public.projects DROP CONSTRAINT projects_status_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'done', 'closed_early', 'archived')),
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN thanks_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN delete_reason text CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 2000);

ALTER TABLE public.task_flags ADD COLUMN my_day_on date;
GRANT INSERT (my_day_on), UPDATE (my_day_on) ON public.task_flags TO authenticated;

-- Check-Adjust: riêng người mở dự án, không ai khác đọc được.
CREATE TABLE public.project_check_adjust (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  close_reason text NOT NULL CHECK (btrim(close_reason) <> '' AND char_length(close_reason) <= 2000),
  note text CHECK (note IS NULL OR char_length(note) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_project_check_adjust_touch_updated_at
  BEFORE UPDATE ON public.project_check_adjust
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.project_check_adjust ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_check_adjust_select_owner ON public.project_check_adjust
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
REVOKE ALL ON public.project_check_adjust FROM anon, authenticated;
GRANT SELECT ON public.project_check_adjust TO authenticated;

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION private.group_root(p_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current uuid := p_conversation_id;
  v_parent uuid;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT parent_group_id INTO v_parent FROM conversations WHERE id = v_current;
    EXIT WHEN v_parent IS NULL;
    v_current := v_parent;
  END LOOP;
  RETURN v_current;
END;
$$;

CREATE FUNCTION private.is_group_root_owner(p_conversation_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = private.group_root(p_conversation_id)
      AND cp.user_id = p_user AND cp.role = 'owner'
  )
$$;

-- Dự án còn nhận thay đổi: đang mở và chưa bị xoá.
CREATE FUNCTION private.project_is_open(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND status = 'active' AND deleted_at IS NULL)
$$;

-- Cuộc trò chuyện là nhóm con của một dự án đã đóng.
CREATE FUNCTION private.conversation_project_closed(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE conversation_id = p_conversation_id AND status <> 'active' AND deleted_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION private.group_root(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_group_root_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.project_is_open(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.conversation_project_closed(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- khoá chỉ đọc khi đóng

-- Chat của dự án đã đóng nhận đúng những dòng máy chủ tự viết (lời cảm ơn, dòng hệ thống).
CREATE FUNCTION private.enforce_project_chat_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(current_setting('avora.project_system', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF private.conversation_project_closed(NEW.conversation_id) THEN
    RAISE EXCEPTION 'avora_project_chat_closed';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enforce_project_chat_open() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER messages_enforce_project_open
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.enforce_project_chat_open();
CREATE TRIGGER tasks_enforce_project_open
  BEFORE INSERT ON public.tasks
  FOR EACH ROW WHEN (NEW.conversation_id IS NOT NULL)
  EXECUTE FUNCTION private.enforce_project_chat_open();

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
      WHERE pr.id = p_project_id AND pr.deleted_at IS NULL AND cp.user_id = p_user)
    WHEN p_conversation_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id AND cp.user_id = p_user)
    ELSE p_owner = p_user
  END
$$;

CREATE OR REPLACE FUNCTION private.validate_think_hub_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parent_table think_hub_table%ROWTYPE;
  v_conv_type text;
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
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.column_defs) o
      WHERE o ? 'id' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.column_defs) n
        WHERE n->>'id' = o->>'id' AND n->>'key' = o->>'key' AND n->>'type' = o->>'type'
      )
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_column_id_immutable';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
      RAISE EXCEPTION 'avora_project_closed';
    END IF;
    RETURN NEW;
  END IF;

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

  IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = NEW.conversation_id;
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
  IF v_table.project_id IS NOT NULL AND NOT private.project_is_open(v_table.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
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

-- Dự án đã xoá biến mất khỏi mọi danh sách; dự án đã đóng không sửa câu chữ được nữa.
DROP POLICY projects_select_participant ON public.projects;
CREATE POLICY projects_select_participant ON public.projects
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND private.is_conversation_participant(conversation_id, (SELECT auth.uid())));
DROP POLICY projects_update_owner ON public.projects;
CREATE POLICY projects_update_owner ON public.projects
  FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND status = 'active' AND deleted_at IS NULL)
  WITH CHECK (created_by = (SELECT auth.uid()) AND status = 'active' AND deleted_at IS NULL);
DROP POLICY IF EXISTS projects_insert_participant ON public.projects;

-- ---------------------------------------------------------------- B1: mở dự án = mở nhóm con

CREATE OR REPLACE FUNCTION public.create_project(
  p_conversation_id uuid,
  p_title text,
  p_value_orientation text,
  p_objective text,
  p_start_date date,
  p_target_end_date date,
  p_scope text DEFAULT NULL,
  p_assumptions text DEFAULT NULL
) RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_parent conversations%ROWTYPE;
  v_role text;
  v_sub uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_value text := btrim(coalesce(p_value_orientation, ''));
  v_objective text := btrim(coalesce(p_objective, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF v_title = '' THEN RAISE EXCEPTION 'avora_project_title_required'; END IF;
  IF v_value = '' THEN RAISE EXCEPTION 'avora_project_value_required'; END IF;
  IF v_objective = '' THEN RAISE EXCEPTION 'avora_project_objective_required'; END IF;
  IF p_start_date IS NULL OR p_target_end_date IS NULL THEN RAISE EXCEPTION 'avora_project_dates_required'; END IF;
  IF p_target_end_date < p_start_date THEN RAISE EXCEPTION 'avora_project_dates_order'; END IF;

  SELECT * INTO v_parent FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_parent.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_not_a_participant'; END IF;
  IF v_parent.type <> 'group' THEN RAISE EXCEPTION 'avora_project_group_only'; END IF;

  SELECT role INTO v_role FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'avora_not_a_participant'; END IF;
  IF v_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'avora_group_sub_not_allowed'; END IF;
  IF v_parent.group_depth >= 3 THEN RAISE EXCEPTION 'avora_group_depth_limit'; END IF;

  -- Nhóm con riêng của dự án: người mở là Owner, mọi thành viên hiện tại của nhóm cha vào theo.
  INSERT INTO conversations (type, parent_group_id) VALUES ('group', p_conversation_id) RETURNING id INTO v_sub;
  INSERT INTO conversation_groups (conversation_id, name, owner_id) VALUES (v_sub, left(v_title, 120), v_uid);
  INSERT INTO conversation_participants (conversation_id, user_id, role)
  SELECT v_sub, cp.user_id, CASE WHEN cp.user_id = v_uid THEN 'owner' ELSE 'member' END
  FROM conversation_participants cp WHERE cp.conversation_id = p_conversation_id
  ON CONFLICT DO NOTHING;

  INSERT INTO projects (
    conversation_id, created_by, title, value_orientation, objective,
    start_date, target_end_date, scope, assumptions
  ) VALUES (
    v_sub, v_uid, v_title, v_value, v_objective, p_start_date, p_target_end_date,
    nullif(btrim(coalesce(p_scope, '')), ''), nullif(btrim(coalesce(p_assumptions, '')), '')
  )
  RETURNING * INTO v_project;

  INSERT INTO think_hub_table (owner_user_id, name, project_id, position)
  VALUES (v_uid, v_title, v_project.id, 0);

  RETURN v_project;
END;
$function$;

-- Dự án cũ đang gắn thẳng vào Nhóm: tạo nhóm con cho nó rồi chuyển sang. Tin nhắn cũ ở lại Nhóm cha.
DO $$
DECLARE
  p record;
  v_sub uuid;
BEGIN
  FOR p IN
    SELECT pr.* FROM projects pr JOIN conversations c ON c.id = pr.conversation_id
    WHERE c.type = 'group' AND c.group_depth < 3
      AND c.parent_group_id IS NULL
  LOOP
    INSERT INTO conversations (type, parent_group_id) VALUES ('group', p.conversation_id) RETURNING id INTO v_sub;
    INSERT INTO conversation_groups (conversation_id, name, owner_id) VALUES (v_sub, left(p.title, 120), p.created_by);
    INSERT INTO conversation_participants (conversation_id, user_id, role)
    SELECT v_sub, cp.user_id, CASE WHEN cp.user_id = p.created_by THEN 'owner' ELSE 'member' END
    FROM conversation_participants cp WHERE cp.conversation_id = p.conversation_id
    ON CONFLICT DO NOTHING;
    -- Người mở dự án có thể đã rời nhóm cha; nhóm con vẫn cần một Owner.
    INSERT INTO conversation_participants (conversation_id, user_id, role)
    VALUES (v_sub, p.created_by, 'owner') ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = 'owner';
    UPDATE projects SET conversation_id = v_sub WHERE id = p.id;
  END LOOP;
END $$;

-- Việc đã nối trước khi chuyển vẫn thuộc Nhóm cha; việc mới phải cùng chat với dự án.
CREATE OR REPLACE FUNCTION private.validate_project_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_conversation uuid;
  v_task_conversation uuid;
  v_record_project uuid;
BEGIN
  SELECT conversation_id INTO v_project_conversation FROM projects WHERE id = NEW.project_id;
  IF v_project_conversation IS NULL THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;
  IF NOT private.project_is_open(NEW.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  SELECT conversation_id INTO v_task_conversation FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_task_missing';
  END IF;
  IF v_task_conversation IS DISTINCT FROM v_project_conversation
     AND v_task_conversation IS DISTINCT FROM (SELECT parent_group_id FROM conversations WHERE id = v_project_conversation) THEN
    RAISE EXCEPTION 'avora_project_task_foreign_conversation';
  END IF;

  IF NEW.record_id IS NOT NULL THEN
    SELECT t.project_id INTO v_record_project
    FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
    WHERE r.id = NEW.record_id AND r.deleted_at IS NULL;
    IF v_record_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'avora_project_record_foreign';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------- B2: đóng, đóng sớm, mở lại

CREATE OR REPLACE FUNCTION public.close_project(p_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'done' THEN RETURN v_project; END IF;
  IF v_project.status <> 'active' THEN RAISE EXCEPTION 'avora_project_closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM project_success_criteria c
    WHERE c.project_id = p_project_id AND c.deleted_at IS NULL
      AND ((c.measurement_type = 'percentage' AND c.actual_percent IS NULL)
        OR (c.measurement_type = 'meeting_confirmation' AND c.meeting_note_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'avora_project_criteria_open';
  END IF;

  IF EXISTS (
    SELECT 1 FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id
    WHERE pt.project_id = p_project_id AND t.status <> 'skipped'
      AND t.deadline_date IS NOT NULL AND t.deadline_date > v_project.target_end_date
  ) THEN
    RAISE EXCEPTION 'avora_project_task_past_end';
  END IF;

  UPDATE projects SET status = 'done', closed_at = now() WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

-- Lời cảm ơn: người lãnh đạo tự viết (không có bản nháp nào soạn sẵn), đăng vào chat dự án, tự ghim.
-- Đúng một lần.
CREATE FUNCTION public.post_project_thanks(p_project_id uuid, p_body text)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_message uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.status <> 'done' OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_thanks_not_closed'; END IF;
  IF v_project.thanks_message_id IS NOT NULL THEN RAISE EXCEPTION 'avora_project_thanks_already'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'avora_project_thanks_empty'; END IF;
  IF char_length(v_body) > 4000 THEN RAISE EXCEPTION 'avora_project_thanks_too_long'; END IF;

  PERFORM set_config('avora.project_system', 'on', true);
  INSERT INTO messages (conversation_id, sender_id, content)
  VALUES (v_project.conversation_id, v_uid, v_body)
  RETURNING id INTO v_message;
  PERFORM set_config('avora.project_system', 'off', true);

  INSERT INTO message_pins (message_id, conversation_id, pinned_by, scope)
  VALUES (v_message, v_project.conversation_id, v_uid, 'group');

  UPDATE projects SET thanks_message_id = v_message WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE FUNCTION public.close_project_early(p_project_id uuid, p_reason text)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'avora_project_close_reason_required'; END IF;
  IF char_length(v_reason) > 2000 THEN RAISE EXCEPTION 'avora_project_close_reason_too_long'; END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'closed_early' THEN RETURN v_project; END IF;
  IF v_project.status <> 'active' THEN RAISE EXCEPTION 'avora_project_closed'; END IF;

  INSERT INTO project_check_adjust (project_id, owner_id, close_reason)
  VALUES (p_project_id, v_uid, v_reason)
  ON CONFLICT (project_id) DO UPDATE SET close_reason = EXCLUDED.close_reason, owner_id = EXCLUDED.owner_id;

  -- Không đăng gì vào chat: đóng sớm là chuyện người lãnh đạo tự nhìn lại.
  UPDATE projects SET status = 'closed_early', closed_at = now() WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE FUNCTION public.save_project_check_adjust_note(p_project_id uuid, p_note text)
RETURNS public.project_check_adjust
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_check_adjust%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  UPDATE project_check_adjust
  SET note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE project_id = p_project_id AND owner_id = v_uid
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  RETURN v_row;
END;
$function$;

CREATE FUNCTION public.reopen_project(p_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'active' THEN RETURN v_project; END IF;

  UPDATE projects SET status = 'active', closed_at = NULL WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

-- Dự án mở lại hay chưa đóng thì mới nhận Task và câu chữ mới.
CREATE OR REPLACE FUNCTION public.link_task_to_project(p_task_id uuid, p_project_id uuid, p_record_id uuid DEFAULT NULL)
 RETURNS public.project_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_row project_tasks%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT conversation_id INTO v_conversation FROM projects WHERE id = p_project_id AND deleted_at IS NULL;
  IF v_conversation IS NULL OR NOT private.is_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;

  INSERT INTO project_tasks (task_id, project_id, record_id, linked_by)
  VALUES (p_task_id, p_project_id, p_record_id, v_uid)
  ON CONFLICT (task_id) DO UPDATE
    SET project_id = EXCLUDED.project_id, record_id = EXCLUDED.record_id, linked_by = EXCLUDED.linked_by
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------- B3: xoá (tầng Inner) và khôi phục

CREATE FUNCTION public.delete_project(p_project_id uuid, p_confirm_title text, p_reason text)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF NOT private.is_group_root_owner(v_project.conversation_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_delete_root_owner_only';
  END IF;
  IF btrim(coalesce(p_confirm_title, '')) <> v_project.title THEN
    RAISE EXCEPTION 'avora_project_delete_title_mismatch';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'avora_project_delete_reason_required'; END IF;
  IF char_length(v_reason) > 2000 THEN RAISE EXCEPTION 'avora_project_close_reason_too_long'; END IF;

  SELECT coalesce(nullif(btrim(p.display_name), ''), u.email, 'Chủ nhóm') INTO v_name
  FROM auth.users u LEFT JOIN profiles p ON p.id = u.id WHERE u.id = v_uid;

  -- Dòng hệ thống viết trước khi nhóm con biến mất, để ai khôi phục lại cũng thấy vì sao.
  PERFORM set_config('avora.project_system', 'on', true);
  INSERT INTO messages (conversation_id, sender_id, content, system_kind)
  VALUES (
    v_project.conversation_id, v_uid,
    format('Dự án %s đã bị xoá bởi %s — Lý do: %s', v_project.title, v_name, v_reason),
    'project_deleted'
  );
  PERFORM set_config('avora.project_system', 'off', true);

  UPDATE projects SET deleted_at = now(), deleted_by = v_uid, delete_reason = v_reason
  WHERE id = p_project_id RETURNING * INTO v_project;
  UPDATE conversations SET deleted_at = now() WHERE id = v_project.conversation_id AND deleted_at IS NULL;

  RETURN v_project;
END;
$function$;

CREATE FUNCTION public.restore_project(p_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF NOT private.is_group_root_owner(v_project.conversation_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_delete_root_owner_only';
  END IF;

  UPDATE conversations SET deleted_at = NULL WHERE id = v_project.conversation_id;
  UPDATE projects SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
  WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

-- Thùng rác dự án của Owner nhóm gốc.
CREATE FUNCTION public.list_deleted_projects()
RETURNS SETOF public.projects
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.* FROM projects p
  WHERE p.deleted_at IS NOT NULL
    AND private.is_group_root_owner(p.conversation_id, auth.uid())
  ORDER BY p.deleted_at DESC
$function$;

-- Ai là Owner nhóm gốc của dự án này — để màn dự án biết có hiện nút "Xoá dự án" không.
CREATE FUNCTION public.is_project_root_owner(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND private.is_group_root_owner(p.conversation_id, auth.uid())
  )
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_project(uuid, text, text, text, date, date, text, text)',
    'public.close_project(uuid)',
    'public.post_project_thanks(uuid, text)',
    'public.close_project_early(uuid, text)',
    'public.save_project_check_adjust_note(uuid, text)',
    'public.reopen_project(uuid)',
    'public.link_task_to_project(uuid, uuid, uuid)',
    'public.delete_project(uuid, text, text)',
    'public.restore_project(uuid)',
    'public.list_deleted_projects()',
    'public.is_project_root_owner(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION private.validate_think_hub_table() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.validate_think_hub_record() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.validate_project_task() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION private.think_hub_scope_visible(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION private.think_hub_scope_visible(uuid, uuid, uuid, uuid) TO authenticated;
END $$;
