-- ============================================================
-- AVORA — Dự án v1: projects + project_tasks, trên hai bảng ĐÃ CÓ
--
-- Objective và Deliverable KHÔNG được tạo mới ở đây. Hai bảng `objectives` và
-- `deliverables` đã tồn tại từ baseline, đã gắn `conversation_id`, `created_by`,
-- `status`, `sort_order`, đã có RLS đọc theo thành viên cuộc trò chuyện, và
-- `tasks` đã có sẵn hai cột `objective_id`/`deliverable_id` trỏ vào chúng. Dựng
-- thêm `project_objectives`/`project_deliverables` song song sẽ tạo HAI cây
-- Objective→Deliverable cùng nghĩa, và biến hai cột kia thành cột chết —
-- đúng điều AGENTS.md §1 cấm. Nên Prompt này chỉ thêm phần thật sự còn thiếu:
--
--   projects            — tầng trên cùng, chưa có
--   objectives.project_id — nối cây cũ vào tầng mới
--   deliverables.confirmed_by/at — xác nhận nghiệm thu, chưa có
--   project_tasks       — bảng nối Task ↔ Deliverable
--
-- Vì sao Task nối bằng BẢNG NỐI chứ không ghi vào `tasks.deliverable_id`:
-- policy `tasks_update_own_personal` chỉ cho UPDATE task `type = 'personal'`
-- của chính người tạo. Task 1-1 và Nhóm KHÔNG UPDATE được từ client, nên ghi
-- thẳng vào cột đó sẽ chỉ chạy được cho việc cá nhân — đúng nửa số trường hợp.
-- Bảng nối cũng giữ nguyên yêu cầu "không đụng luồng ghi của tasks".
--
-- Quyền: KHÔNG dựng thang quyền mới. Mọi thứ đọc theo đúng một câu đã có —
-- `private.is_conversation_participant(conversation_id, auth.uid())` — nên một
-- dự án hiện ra với đúng những người đã ở trong cuộc trò chuyện chứa nó.
--
-- Không đụng: tasks (ngoài bảng nối), conversations, conversation_participants,
-- mọi RPC/trigger của tasks, financial_item (chưa tồn tại), project_reviews.
-- ============================================================

-- ---------------------------------------------------------------- projects

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Dự án SỐNG TRONG một cuộc trò chuyện, không phải bên cạnh nó. Đây là cả cơ
  -- chế quyền: personal → dự án riêng, direct → dự án 1-1, group → dự án nhóm.
  -- CASCADE vì một dự án không còn cuộc trò chuyện thì không còn ai đọc được.
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),

  -- Hiến chương dự án. Bốn câu hỏi, cả bốn đều được phép bỏ trống: người ta mở
  -- một dự án khi mới có ý định, chưa có phạm vi. Bắt điền đủ ở bước tạo là
  -- biến một thao tác 10 giây thành một bài tập làm văn.
  purpose text CHECK (purpose IS NULL OR char_length(purpose) <= 2000),
  scope text CHECK (scope IS NULL OR char_length(scope) <= 2000),
  success_criteria text CHECK (success_criteria IS NULL OR char_length(success_criteria) <= 2000),
  assumptions text CHECK (assumptions IS NULL OR char_length(assumptions) <= 2000),

  -- Cùng ba trạng thái với objectives/deliverables đã có, không thêm từ mới.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Danh sách dự án luôn đọc theo cuộc trò chuyện, và tab Dự án đọc theo người tạo.
CREATE INDEX IF NOT EXISTS idx_projects_conversation ON public.projects(conversation_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON public.projects(created_by);

DROP TRIGGER IF EXISTS trg_projects_touch_updated_at ON public.projects;
CREATE TRIGGER trg_projects_touch_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------- nối cây cũ vào tầng mới

-- Nullable, không backfill: hai bảng này đang rỗng, và để ngỏ NULL nghĩa là một
-- Objective vẫn có thể tồn tại ngoài mọi dự án — đúng như baseline đã cho phép.
ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_objectives_project ON public.objectives(project_id);

-- Nghiệm thu: ai xác nhận, lúc nào. SET NULL để người rời hệ thống không kéo
-- theo cả Deliverable đã hoàn thành.
ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Hai cột đi cùng nhau hoặc cùng trống. "Đã xác nhận mà không biết ai" là một
-- trạng thái không đọc được trên màn hình nghiệm thu.
ALTER TABLE public.deliverables DROP CONSTRAINT IF EXISTS deliverables_confirm_pair;
ALTER TABLE public.deliverables
  ADD CONSTRAINT deliverables_confirm_pair
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL));

-- ---------------------------------------------------------------- gắn FK cho hai cột giữ chỗ

-- crm_opportunity.project_id và business_hub_record.project_id được tạo ra từ
-- trước với ghi chú "CHƯA gắn FK — Dự án chưa tồn tại". Dự án tồn tại rồi.
-- SET NULL: dọn một dự án không được phép xoá mất cơ hội bán hàng hay bản ghi
-- kinh doanh — chúng chỉ thôi trỏ vào đâu nữa.
ALTER TABLE public.crm_opportunity DROP CONSTRAINT IF EXISTS crm_opportunity_project_id_fkey;
ALTER TABLE public.crm_opportunity
  ADD CONSTRAINT crm_opportunity_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.business_hub_record DROP CONSTRAINT IF EXISTS business_hub_record_project_id_fkey;
ALTER TABLE public.business_hub_record
  ADD CONSTRAINT business_hub_record_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- project_tasks

CREATE TABLE IF NOT EXISTS public.project_tasks (
  -- Khoá chính là task_id: một việc thuộc về đúng một Deliverable. Cho một việc
  -- nằm ở hai nơi là mở đường cho hai phần trăm hoàn thành cùng đếm nó.
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Ghi lại cả project_id dù suy ra được qua deliverable → objective → project:
  -- màn danh sách đọc "việc của dự án này" mỗi lần mở, và bắt nó đi hai lần nối
  -- bảng cho mỗi dòng là trả giá mãi mãi cho một cột 16 byte.
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  deliverable_id uuid NOT NULL REFERENCES public.deliverables(id) ON DELETE CASCADE,
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON public.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_deliverable ON public.project_tasks(deliverable_id);

-- ---------------------------------------------------------------- trigger ràng buộc

/**
 * Một Objective phải nằm cùng cuộc trò chuyện với dự án của nó.
 *
 * RLS đọc Objective theo `objectives.conversation_id`, còn màn Dự án đọc theo
 * `project_id`. Nếu hai cột lệch nhau, một Objective sẽ hiện trong dự án của
 * một nhóm mà lại được cấp quyền đọc theo một cuộc trò chuyện khác — đúng nghĩa
 * là rò rỉ. Kiểm ở trigger nên đúng với mọi đường ghi, kể cả đường mở sau này.
 */
CREATE OR REPLACE FUNCTION private.validate_objective_project() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_conversation uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conversation_id INTO v_project_conversation
  FROM projects WHERE id = NEW.project_id;

  IF v_project_conversation IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy dự án này';
  END IF;
  IF v_project_conversation <> NEW.conversation_id THEN
    RAISE EXCEPTION 'Mục tiêu phải thuộc cùng cuộc trò chuyện với dự án';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_objectives_validate_project ON public.objectives;
CREATE TRIGGER trg_objectives_validate_project
  BEFORE INSERT OR UPDATE ON public.objectives
  FOR EACH ROW EXECUTE FUNCTION private.validate_objective_project();

/**
 * Bảng nối phải tự nhất quán, và việc được nối phải cùng chỗ với dự án.
 *
 * Hai luật khác nhau cho hai loại việc, vì `tasks` lưu chúng khác nhau:
 *   - việc cá nhân: `conversation_id` là NULL, nên không so được cuộc trò
 *     chuyện. So chủ sở hữu: người tạo việc phải là người tạo dự án, và dự án
 *     phải là dự án riêng (`conversations.type = 'personal'`).
 *   - việc 1-1 / Nhóm: so thẳng `conversation_id` với dự án.
 */
CREATE OR REPLACE FUNCTION private.validate_project_task() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deliverable_project uuid;
  v_project_conversation uuid;
  v_project_owner uuid;
  v_conversation_type text;
  v_task_type text;
  v_task_conversation uuid;
  v_task_creator uuid;
BEGIN
  SELECT o.project_id INTO v_deliverable_project
  FROM deliverables d JOIN objectives o ON o.id = d.objective_id
  WHERE d.id = NEW.deliverable_id;

  IF v_deliverable_project IS NULL THEN
    RAISE EXCEPTION 'Kết quả này không thuộc dự án nào';
  END IF;
  IF v_deliverable_project <> NEW.project_id THEN
    RAISE EXCEPTION 'Việc phải được nối vào kết quả của chính dự án này';
  END IF;

  SELECT p.conversation_id, p.created_by, c.type
    INTO v_project_conversation, v_project_owner, v_conversation_type
  FROM projects p JOIN conversations c ON c.id = p.conversation_id
  WHERE p.id = NEW.project_id;

  SELECT type, conversation_id, creator_id
    INTO v_task_type, v_task_conversation, v_task_creator
  FROM tasks WHERE id = NEW.task_id;

  IF v_task_type IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy việc này';
  END IF;

  IF v_task_type = 'personal' THEN
    IF v_conversation_type <> 'personal' OR v_task_creator <> v_project_owner THEN
      RAISE EXCEPTION 'Việc riêng chỉ nối được vào dự án riêng của chính bạn';
    END IF;
  ELSIF v_task_conversation IS DISTINCT FROM v_project_conversation THEN
    RAISE EXCEPTION 'Việc phải cùng cuộc trò chuyện với dự án';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_tasks_validate ON public.project_tasks;
CREATE TRIGGER trg_project_tasks_validate
  BEFORE INSERT OR UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_project_task();

-- ---------------------------------------------------------------- RLS

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

-- Đọc: y hệt câu mà objectives/deliverables đã dùng từ baseline.
DROP POLICY IF EXISTS projects_select_participant ON public.projects;
CREATE POLICY projects_select_participant ON public.projects
  FOR SELECT USING (private.is_conversation_participant(conversation_id, (SELECT auth.uid())));

-- Trần của mọi đường ghi. Không GRANT INSERT (xem phần GRANT), nhưng policy
-- vẫn phải đúng: nếu sau này có ai mở INSERT trực tiếp, luật đã nằm sẵn ở đây.
DROP POLICY IF EXISTS projects_insert_participant ON public.projects;
CREATE POLICY projects_insert_participant ON public.projects
  FOR INSERT WITH CHECK (
    created_by = (SELECT auth.uid())
    AND private.is_conversation_participant(conversation_id, (SELECT auth.uid()))
  );

-- Sửa hiến chương: chỉ người mở dự án. Thành viên khác bàn việc trong chat, chứ
-- không viết lại mục đích của dự án do người khác dựng.
DROP POLICY IF EXISTS projects_update_owner ON public.projects;
CREATE POLICY projects_update_owner ON public.projects
  FOR UPDATE USING (created_by = (SELECT auth.uid()))
  WITH CHECK (created_by = (SELECT auth.uid()));

-- Không có policy DELETE, và không GRANT DELETE: v1 không cho xoá dự án.

DROP POLICY IF EXISTS project_tasks_select_participant ON public.project_tasks;
CREATE POLICY project_tasks_select_participant ON public.project_tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_tasks.project_id
        AND private.is_conversation_participant(p.conversation_id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS project_tasks_insert_participant ON public.project_tasks;
CREATE POLICY project_tasks_insert_participant ON public.project_tasks
  FOR INSERT WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_tasks.project_id
        AND private.is_conversation_participant(p.conversation_id, (SELECT auth.uid()))
    )
  );

-- Bỏ một việc nối nhầm ra khỏi dự án KHÔNG phải xoá việc: hàng ở bảng nối mất
-- đi, `tasks` không đụng tới. Đây là lý do bảng nối tồn tại.
DROP POLICY IF EXISTS project_tasks_delete_participant ON public.project_tasks;
CREATE POLICY project_tasks_delete_participant ON public.project_tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_tasks.project_id
        AND private.is_conversation_participant(p.conversation_id, (SELECT auth.uid()))
    )
  );

-- Sửa tiêu đề Mục tiêu / Kết quả — baseline chỉ có policy SELECT, nên hai vế
-- UPDATE này là mới. Cùng một câu quyền, không nới thêm ai.
DROP POLICY IF EXISTS objectives_update_participant ON public.objectives;
CREATE POLICY objectives_update_participant ON public.objectives
  FOR UPDATE USING (private.is_conversation_participant(conversation_id, (SELECT auth.uid())))
  WITH CHECK (private.is_conversation_participant(conversation_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS deliverables_update_participant ON public.deliverables;
CREATE POLICY deliverables_update_participant ON public.deliverables
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.objectives o
      WHERE o.id = deliverables.objective_id
        AND private.is_conversation_participant(o.conversation_id, (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.objectives o
      WHERE o.id = deliverables.objective_id
        AND private.is_conversation_participant(o.conversation_id, (SELECT auth.uid()))
    )
  );

-- ---------------------------------------------------------------- GRANT khớp RLS

REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.project_tasks FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.projects TO authenticated;
-- Chỉ bốn ô hiến chương và tiêu đề. conversation_id và created_by KHÔNG nằm
-- đây: cho sửa là cho dời một dự án sang cuộc trò chuyện khác, tức đổi luôn tập
-- người đọc được nó — thứ RLS không nhìn thấy vì hàng vẫn "của mình".
-- status đi qua RPC, không sửa tay.
GRANT UPDATE (title, purpose, scope, success_criteria, assumptions, updated_at)
  ON public.projects TO authenticated;

GRANT SELECT, DELETE ON public.project_tasks TO authenticated;

-- Sửa tên Mục tiêu / Kết quả tại chỗ. Không cấp status: hoàn thành đi qua
-- confirm_deliverable, nơi quyền chủ dự án được kiểm.
GRANT UPDATE (title, updated_at) ON public.objectives TO authenticated;
GRANT UPDATE (title, updated_at) ON public.deliverables TO authenticated;

REVOKE ALL ON FUNCTION private.validate_objective_project() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_project_task() FROM PUBLIC, anon, authenticated;
