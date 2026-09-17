-- ============================================================
-- AVORA — Dự án v1: năm RPC ghi
--
-- Objective và Deliverable KHÔNG được GRANT INSERT ở migration trước. Đó là cố
-- ý: mọi hàng mới đi qua đúng năm hàm dưới đây, nơi quyền được kiểm một lần và
-- `sort_order` được tính từ hàng cuối cùng thay vì do client tự đoán.
--
-- Cả năm đều SECURITY DEFINER, `search_path` pin, REVOKE khỏi PUBLIC/anon, và
-- không hàm nào nhận `user_id` từ client — người ghi luôn là `auth.uid()`.
-- ============================================================

-- ---------------------------------------------------------------- create_project

/**
 * Mở một dự án, cùng với Mục tiêu đầu tiên của nó.
 *
 * Hai tham số bắt buộc đi cùng nhau vì một dự án không có mục tiêu nào là một
 * cái tên rỗng: màn chi tiết sẽ mở ra ba tầng trống và không gợi được bước kế
 * tiếp. Bốn ô hiến chương thì để trống được — người ta mở dự án khi mới có ý
 * định, chưa có phạm vi.
 *
 * Cuộc trò chuyện quyết định dự án thuộc loại nào: personal → dự án riêng,
 * direct → 1-1, group → nhóm. Không có cột "loại dự án" nào cả.
 */
CREATE OR REPLACE FUNCTION public.create_project(
  p_conversation_id uuid,
  p_title text,
  p_first_objective_title text,
  p_purpose text DEFAULT NULL,
  p_scope text DEFAULT NULL,
  p_success_criteria text DEFAULT NULL,
  p_assumptions text DEFAULT NULL
) RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_title text := btrim(coalesce(p_title, ''));
  v_objective_title text := btrim(coalesce(p_first_objective_title, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'Dự án cần một tiêu đề';
  END IF;
  IF v_objective_title = '' THEN
    RAISE EXCEPTION 'Dự án cần mục tiêu đầu tiên';
  END IF;
  IF NOT private.is_conversation_participant(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Chỉ mở được dự án trong cuộc trò chuyện mà bạn là thành viên';
  END IF;

  INSERT INTO projects (
    conversation_id, created_by, title, purpose, scope, success_criteria, assumptions
  ) VALUES (
    p_conversation_id, auth.uid(), v_title,
    nullif(btrim(coalesce(p_purpose, '')), ''),
    nullif(btrim(coalesce(p_scope, '')), ''),
    nullif(btrim(coalesce(p_success_criteria, '')), ''),
    nullif(btrim(coalesce(p_assumptions, '')), '')
  )
  RETURNING * INTO v_project;

  INSERT INTO objectives (conversation_id, project_id, created_by, title, sort_order)
  VALUES (p_conversation_id, v_project.id, auth.uid(), v_objective_title, 0);

  RETURN v_project;
END;
$$;

-- ---------------------------------------------------------------- add_objective

/**
 * Thêm một Mục tiêu vào dự án.
 *
 * Ai trong cuộc trò chuyện cũng thêm được, không riêng người mở dự án: mục tiêu
 * là thứ cả nhóm cùng nhìn ra khi đang bàn việc. `sort_order` tính từ hàng cuối
 * để thứ tự là thứ tự người ta nghĩ ra, không phải thứ tự chữ cái.
 */
CREATE OR REPLACE FUNCTION public.add_objective(
  p_project_id uuid,
  p_title text
) RETURNS public.objectives
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row objectives%ROWTYPE;
  v_conversation_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'Mục tiêu cần một tiêu đề';
  END IF;

  SELECT conversation_id INTO v_conversation_id FROM projects WHERE id = p_project_id;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy dự án này';
  END IF;
  IF NOT private.is_conversation_participant(v_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Bạn không còn trong cuộc trò chuyện của dự án này';
  END IF;

  INSERT INTO objectives (conversation_id, project_id, created_by, title, sort_order)
  VALUES (
    v_conversation_id, p_project_id, auth.uid(), v_title,
    coalesce((SELECT max(sort_order) + 1 FROM objectives WHERE project_id = p_project_id), 0)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- add_deliverable

/**
 * Thêm một Kết quả cần giao vào một Mục tiêu.
 *
 * Quyền đọc theo cuộc trò chuyện của Mục tiêu, không theo dự án — hai thứ này
 * được trigger `validate_objective_project` giữ cho luôn bằng nhau, nên đọc từ
 * Mục tiêu là đường ngắn hơn và không cần tin vào `project_id` client gửi lên.
 */
CREATE OR REPLACE FUNCTION public.add_deliverable(
  p_objective_id uuid,
  p_title text
) RETURNS public.deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row deliverables%ROWTYPE;
  v_conversation_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'Kết quả cần một tiêu đề';
  END IF;

  SELECT conversation_id INTO v_conversation_id FROM objectives WHERE id = p_objective_id;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy mục tiêu này';
  END IF;
  IF NOT private.is_conversation_participant(v_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Bạn không còn trong cuộc trò chuyện của dự án này';
  END IF;

  INSERT INTO deliverables (objective_id, title, sort_order)
  VALUES (
    p_objective_id, v_title,
    coalesce((SELECT max(sort_order) + 1 FROM deliverables WHERE objective_id = p_objective_id), 0)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- link_task_to_project

/**
 * Nối một việc đã có vào một Kết quả.
 *
 * Không tạo việc mới: việc sinh ra ở Nhật ký hoặc trong chat, với đầy đủ ngữ
 * cảnh và luồng xác nhận của nó. Ở đây chỉ nói "việc này thuộc kết quả kia".
 *
 * ON CONFLICT để nối lại là dời chỗ, không phải lỗi — kéo một việc từ Kết quả
 * này sang Kết quả khác là thao tác thường khi kế hoạch đổi. Hai luật "cùng
 * cuộc trò chuyện" và "cùng dự án" do trigger `validate_project_task` canh, nên
 * đúng với cả đường INSERT lẫn đường UPDATE này.
 */
CREATE OR REPLACE FUNCTION public.link_task_to_project(
  p_task_id uuid,
  p_deliverable_id uuid
) RETURNS public.project_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row project_tasks%ROWTYPE;
  v_project_id uuid;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT o.project_id, o.conversation_id INTO v_project_id, v_conversation_id
  FROM deliverables d JOIN objectives o ON o.id = d.objective_id
  WHERE d.id = p_deliverable_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy kết quả này';
  END IF;
  IF NOT private.is_conversation_participant(v_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Bạn không còn trong cuộc trò chuyện của dự án này';
  END IF;

  INSERT INTO project_tasks (task_id, project_id, deliverable_id, linked_by)
  VALUES (p_task_id, v_project_id, p_deliverable_id, auth.uid())
  ON CONFLICT (task_id) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        deliverable_id = EXCLUDED.deliverable_id,
        linked_by = EXCLUDED.linked_by
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- confirm_deliverable

/**
 * Nghiệm thu một Kết quả: chỉ người mở dự án.
 *
 * Đây là điểm ma sát có chủ đích duy nhất của module. Thêm Mục tiêu, thêm Kết
 * quả, nối việc — cả nhóm cùng làm được. Nhưng "kết quả này đã đạt" là một lời
 * tuyên bố về dự án, và nó thuộc về người chịu trách nhiệm cho dự án đó.
 *
 * Lỗi trả về là mã `avora_project_not_owner` chứ không phải câu tiếng Việt, vì
 * client cần phân biệt "không phải chủ dự án" (ẩn nút, giải thích ai mới làm
 * được) với mọi lỗi khác (hiện lại cùng một toast).
 *
 * Đã xác nhận rồi thì trả về nguyên trạng thay vì báo lỗi: hai người cùng bấm
 * trên hai máy không phải là sự cố đáng dựng một hộp thoại.
 */
CREATE OR REPLACE FUNCTION public.confirm_deliverable(
  p_deliverable_id uuid
) RETURNS public.deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row deliverables%ROWTYPE;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT d.* INTO v_row FROM deliverables d WHERE d.id = p_deliverable_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy kết quả này';
  END IF;

  SELECT p.created_by INTO v_owner
  FROM deliverables d
  JOIN objectives o ON o.id = d.objective_id
  JOIN projects p ON p.id = o.project_id
  WHERE d.id = p_deliverable_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Kết quả này không thuộc dự án nào';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;

  IF v_row.confirmed_at IS NOT NULL THEN
    RETURN v_row;
  END IF;

  UPDATE deliverables
  SET status = 'done', confirmed_by = auth.uid(), confirmed_at = now()
  WHERE id = p_deliverable_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- EXECUTE

REVOKE ALL ON FUNCTION public.create_project(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project(uuid, text, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.add_objective(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_objective(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.add_deliverable(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_deliverable(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.link_task_to_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_task_to_project(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_deliverable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_deliverable(uuid) TO authenticated;
