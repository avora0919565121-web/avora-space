-- AVORA 20 / Phần 4 + 5 — Gỡ Objective/Deliverable (ADR-005), Task gắn Hạng mục, Project Charter.
--
-- Dữ liệu cũ (1 dự án thử HANA-2607 trong Nhật ký, 5 mục tiêu, 10 kết quả) được xoá theo xác nhận
-- của chủ sản phẩm. Sau bước này không còn dự án nào, nên các trường Charter bắt buộc được khoá
-- NOT NULL thẳng ở database thay vì chỉ ở RPC.

DELETE FROM public.projects;

-- ---------------------------------------------------------------- Phần 4: gỡ hai tầng cũ

DROP TRIGGER IF EXISTS trg_project_tasks_validate ON public.project_tasks;
DROP FUNCTION public.add_objective(uuid, text);
DROP FUNCTION public.add_deliverable(uuid, text);
DROP FUNCTION public.confirm_deliverable(uuid);
DROP FUNCTION public.link_task_to_project(uuid, uuid);
DROP FUNCTION private.validate_project_task();

ALTER TABLE public.tasks DROP COLUMN objective_id, DROP COLUMN deliverable_id;
ALTER TABLE public.project_tasks DROP COLUMN deliverable_id;
DROP TABLE public.objectives, public.deliverables CASCADE;
DROP FUNCTION IF EXISTS private.validate_objective_project();

-- Nullable có chủ đích: NULL = Ad-hoc Task (việc phát sinh trong dự án, không thuộc Hạng mục nào).
ALTER TABLE public.project_tasks
  ADD COLUMN record_id uuid REFERENCES public.think_hub_record(id) ON DELETE SET NULL;
CREATE INDEX idx_project_tasks_record ON public.project_tasks (record_id) WHERE record_id IS NOT NULL;

CREATE FUNCTION private.validate_project_task()
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

  SELECT conversation_id INTO v_task_conversation FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_task_missing';
  END IF;
  IF v_task_conversation IS DISTINCT FROM v_project_conversation THEN
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

CREATE TRIGGER trg_project_tasks_validate
  BEFORE INSERT OR UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_project_task();

-- ---------------------------------------------------------------- Phần 5: Charter

ALTER TABLE public.projects RENAME COLUMN purpose TO objective;
ALTER TABLE public.projects RENAME CONSTRAINT projects_purpose_check TO projects_objective_check;
ALTER TABLE public.projects DROP COLUMN success_criteria;
ALTER TABLE public.projects
  ADD COLUMN value_orientation text NOT NULL,
  ADD COLUMN start_date date NOT NULL,
  ADD COLUMN target_end_date date NOT NULL;
ALTER TABLE public.projects ALTER COLUMN objective SET NOT NULL;
ALTER TABLE public.projects DROP CONSTRAINT projects_objective_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_objective_check CHECK (btrim(objective) <> '' AND char_length(objective) <= 2000),
  ADD CONSTRAINT projects_value_orientation_check CHECK (btrim(value_orientation) <> '' AND char_length(value_orientation) <= 2000),
  ADD CONSTRAINT projects_dates_order CHECK (target_end_date >= start_date);

-- Người mở dự án sửa được câu chữ của Charter; ngày bắt đầu/kết thúc và trạng thái thì không
-- (trạng thái đổi qua close_project, nơi điều kiện đóng được kiểm tra).
REVOKE UPDATE ON public.projects FROM authenticated;
GRANT UPDATE (title, value_orientation, objective, scope, assumptions, updated_at) ON public.projects TO authenticated;

CREATE TABLE public.project_success_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 500),
  measurement_type text NOT NULL CHECK (measurement_type IN ('percentage', 'meeting_confirmation')),
  target_percent numeric(6,2) CHECK (target_percent IS NULL OR (target_percent > 0 AND target_percent <= 1000)),
  actual_percent numeric(6,2) CHECK (actual_percent IS NULL OR (actual_percent >= 0 AND actual_percent <= 1000)),
  meeting_note_id uuid REFERENCES public.group_decisions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- Mỗi loại chỉ mang đúng bằng chứng của nó.
  CONSTRAINT project_success_criteria_shape CHECK (
    (measurement_type = 'percentage' AND meeting_note_id IS NULL)
    OR (measurement_type = 'meeting_confirmation' AND target_percent IS NULL AND actual_percent IS NULL)
  )
);
CREATE INDEX idx_project_success_criteria_project ON public.project_success_criteria (project_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_project_success_criteria_touch_updated_at
  BEFORE UPDATE ON public.project_success_criteria
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.project_success_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_success_criteria_select_participant ON public.project_success_criteria
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_success_criteria.project_id
      AND private.is_conversation_participant(p.conversation_id, (SELECT auth.uid()))
  ));
REVOKE ALL ON public.project_success_criteria FROM anon, authenticated;
GRANT SELECT ON public.project_success_criteria TO authenticated;

-- ---------------------------------------------------------------- RPC: mở dự án

DROP FUNCTION public.create_project(uuid, text, text, text, text, text, text);
CREATE FUNCTION public.create_project(
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
  v_title text := btrim(coalesce(p_title, ''));
  v_value text := btrim(coalesce(p_value_orientation, ''));
  v_objective text := btrim(coalesce(p_objective, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'avora_project_title_required';
  END IF;
  IF v_value = '' THEN
    RAISE EXCEPTION 'avora_project_value_required';
  END IF;
  IF v_objective = '' THEN
    RAISE EXCEPTION 'avora_project_objective_required';
  END IF;
  -- Không có ngày mặc định: người mở dự án phải tự chọn cả hai.
  IF p_start_date IS NULL OR p_target_end_date IS NULL THEN
    RAISE EXCEPTION 'avora_project_dates_required';
  END IF;
  IF p_target_end_date < p_start_date THEN
    RAISE EXCEPTION 'avora_project_dates_order';
  END IF;
  IF NOT private.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;
  -- ADR-002: dự án chỉ mở trong Nhóm.
  IF NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = p_conversation_id AND c.type = 'group') THEN
    RAISE EXCEPTION 'avora_project_group_only';
  END IF;

  INSERT INTO projects (
    conversation_id, created_by, title, value_orientation, objective,
    start_date, target_end_date, scope, assumptions
  ) VALUES (
    p_conversation_id, v_uid, v_title, v_value, v_objective,
    p_start_date, p_target_end_date,
    nullif(btrim(coalesce(p_scope, '')), ''),
    nullif(btrim(coalesce(p_assumptions, '')), '')
  )
  RETURNING * INTO v_project;

  -- Đúng 1 bảng gốc cho mỗi dự án (ADR-006); mục đích của bảng là Charter của dự án, nên để trống.
  INSERT INTO think_hub_table (owner_user_id, name, project_id, position)
  VALUES (v_uid, v_title, v_project.id, 0);

  RETURN v_project;
END;
$function$;

-- ---------------------------------------------------------------- RPC: Task trong dự án

CREATE FUNCTION public.create_project_task(
  p_project_id uuid,
  p_record_id uuid,
  p_task_id uuid,
  p_title text,
  p_description text,
  p_deadline date,
  p_assignee_id uuid,
  p_deadline_time time DEFAULT NULL,
  p_deadline_tz text DEFAULT NULL,
  p_context_snapshot jsonb DEFAULT NULL
) RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_task tasks%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT conversation_id INTO v_conversation FROM projects WHERE id = p_project_id;
  IF v_conversation IS NULL OR NOT private.is_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;

  -- Cùng đường tạo Task nhóm như trong chat: xác nhận hai bước, ngữ cảnh bất biến, mọi kiểm tra cũ.
  v_task := public.create_shared_task(
    v_conversation, 'group-shared', p_title, p_description, p_deadline, p_task_id,
    p_assignee_id, p_deadline_time, p_deadline_tz, NULL, false, 'none', NULL, p_context_snapshot
  );

  INSERT INTO project_tasks (task_id, project_id, record_id, linked_by)
  VALUES (v_task.id, p_project_id, p_record_id, v_uid)
  ON CONFLICT (task_id) DO UPDATE
    SET project_id = EXCLUDED.project_id, record_id = EXCLUDED.record_id, linked_by = EXCLUDED.linked_by;

  RETURN v_task;
END;
$function$;

CREATE FUNCTION public.link_task_to_project(p_task_id uuid, p_project_id uuid, p_record_id uuid DEFAULT NULL)
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT conversation_id INTO v_conversation FROM projects WHERE id = p_project_id;
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

-- ---------------------------------------------------------------- RPC: tiêu chí thành công

CREATE FUNCTION private.project_owned_by(p_project_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.created_by = p_user
      AND private.is_conversation_participant(p.conversation_id, p_user)
  )
$$;
REVOKE ALL ON FUNCTION private.project_owned_by(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.add_project_success_criterion(
  p_project_id uuid,
  p_description text,
  p_measurement_type text,
  p_target_percent numeric DEFAULT NULL
) RETURNS public.project_success_criteria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;
  IF btrim(coalesce(p_description, '')) = '' THEN
    RAISE EXCEPTION 'avora_criterion_description_required';
  END IF;
  IF p_measurement_type IS NULL OR p_measurement_type NOT IN ('percentage', 'meeting_confirmation') THEN
    RAISE EXCEPTION 'avora_criterion_type_invalid';
  END IF;

  INSERT INTO project_success_criteria (project_id, description, measurement_type, target_percent, created_by)
  VALUES (
    p_project_id, btrim(p_description), p_measurement_type,
    CASE WHEN p_measurement_type = 'percentage' THEN p_target_percent END,
    v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- Ghi kết quả thật: con số đạt được (loại %), hoặc biên bản họp đã chốt (loại xác nhận qua họp).
-- Luôn do người mở dự án bấm — không trợ lý nào ghi thay.
CREATE FUNCTION public.record_project_success_criterion(
  p_criterion_id uuid,
  p_actual_percent numeric DEFAULT NULL,
  p_meeting_note_id uuid DEFAULT NULL
) RETURNS public.project_success_criteria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
  v_conversation uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM project_success_criteria WHERE id = p_criterion_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.project_owned_by(v_row.project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = v_row.project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  IF v_row.measurement_type = 'percentage' THEN
    IF p_meeting_note_id IS NOT NULL THEN
      RAISE EXCEPTION 'avora_criterion_evidence_mismatch';
    END IF;
    UPDATE project_success_criteria SET actual_percent = p_actual_percent
    WHERE id = p_criterion_id RETURNING * INTO v_row;
  ELSE
    IF p_actual_percent IS NOT NULL THEN
      RAISE EXCEPTION 'avora_criterion_evidence_mismatch';
    END IF;
    IF p_meeting_note_id IS NOT NULL THEN
      SELECT conversation_id INTO v_conversation FROM projects WHERE id = v_row.project_id;
      IF NOT EXISTS (
        SELECT 1 FROM group_decisions d
        WHERE d.id = p_meeting_note_id AND d.kind = 'meeting_note'
          AND d.status = 'finalized' AND d.conversation_id = v_conversation
      ) THEN
        RAISE EXCEPTION 'avora_criterion_meeting_note_invalid';
      END IF;
    END IF;
    UPDATE project_success_criteria SET meeting_note_id = p_meeting_note_id
    WHERE id = p_criterion_id RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE FUNCTION public.delete_project_success_criterion(p_criterion_id uuid)
RETURNS public.project_success_criteria
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM project_success_criteria WHERE id = p_criterion_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.project_owned_by(v_row.project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = v_row.project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  -- Xoá mềm: lịch sử những gì từng được hứa vẫn còn đó.
  UPDATE project_success_criteria SET deleted_at = now()
  WHERE id = p_criterion_id RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------- RPC: đóng dự án

CREATE FUNCTION public.close_project(p_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.status = 'done' THEN
    RETURN v_project;
  END IF;
  IF v_project.status <> 'active' THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

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

  UPDATE projects SET status = 'done' WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_project(uuid, text, text, text, date, date, text, text)',
    'public.create_project_task(uuid, uuid, uuid, text, text, date, uuid, time, text, jsonb)',
    'public.link_task_to_project(uuid, uuid, uuid)',
    'public.add_project_success_criterion(uuid, text, text, numeric)',
    'public.record_project_success_criterion(uuid, numeric, uuid)',
    'public.delete_project_success_criterion(uuid)',
    'public.close_project(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION private.validate_project_task() FROM PUBLIC, anon, authenticated;
END $$;
