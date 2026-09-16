-- ============================================================
-- AVORA — CRM Giai đoạn 1: crm_opportunity + tasks.opportunity_id
--
-- Sổ cơ hội CÁ NHÂN. Một cơ hội thuộc về đúng một người: người đang theo dõi
-- nó. Kể cả khi cơ hội được gắn vào một cuộc trò chuyện nhóm, những thành viên
-- khác trong nhóm cũng không đọc được — họ đang bàn công việc, không cùng theo
-- dõi phễu bán hàng của người khác.
--
-- project_id CHƯA gắn khoá ngoại: module Dự án chưa tồn tại (chỉ là nhãn
-- "Sắp ra mắt" trên nav). Cột để trống chỗ, gắn FK khi Dự án ra mắt thật.
--
-- Không đụng: contact, tasks (ngoài đúng một cột mới), conversations,
-- conversation_participants, mọi RPC/trigger của tasks.
-- ============================================================

-- ---------------------------------------------------------------- bảng

CREATE TABLE public.crm_opportunity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: sổ theo dõi riêng của một người, không có ai kế thừa.
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- CASCADE vì contact_id là NOT NULL: một cơ hội không gắn với ai thì không
  -- còn là cơ hội. Không CASCADE thì xoá một liên hệ sẽ thất bại với thông báo
  -- khoá ngoại mà người dùng không hiểu, ở một màn hình không nhắc gì tới CRM.
  contact_id uuid NOT NULL REFERENCES public.contact(id) ON DELETE CASCADE,
  title text NOT NULL,
  stage text NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'tiem_nang', 'dang_cham_soc', 'doi_tac', 'khong_thanh')),
  -- Không âm: một cơ hội trị giá âm không có nghĩa gì. NULL thì khác — chưa
  -- định giá được là chuyện thường ở giai đoạn 'lead'.
  estimated_value numeric CHECK (estimated_value IS NULL OR estimated_value >= 0),
  -- SET NULL: cuộc trò chuyện tan đi thì cơ hội vẫn còn. Ngược lại là xoá mất
  -- việc theo dõi một khách hàng chỉ vì một nhóm chat bị dọn.
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  project_id uuid, -- CHƯA gắn FK — Dự án chưa tồn tại
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Không phải khoá tự nhiên, chỉ để tasks tham chiếu được theo CẶP
  -- (id, owner_user_id) — xem khoá ngoại ghép ở dưới.
  CONSTRAINT crm_opportunity_id_owner_key UNIQUE (id, owner_user_id)
);

CREATE INDEX idx_crm_opportunity_owner ON public.crm_opportunity(owner_user_id);
CREATE INDEX idx_crm_opportunity_contact ON public.crm_opportunity(contact_id);

CREATE TRIGGER trg_crm_opportunity_touch_updated_at
  BEFORE UPDATE ON public.crm_opportunity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------- trigger ràng buộc

/**
 * Cơ hội và liên hệ phải cùng một chủ.
 *
 * RLS chỉ so được owner_user_id = auth.uid(). Nếu dừng ở đó, một người có thể
 * tạo cơ hội của MÌNH trỏ vào liên hệ của NGƯỜI KHÁC (owner_user_id là của
 * mình nên policy cho qua, contact_id là của họ). RPC create_opportunity cũng
 * kiểm điều này, nhưng kiểm ở đây thì đúng với MỌI đường ghi, kể cả đường sau
 * này ai đó mở ra mà quên mất luật.
 */
CREATE FUNCTION private.validate_crm_opportunity() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_user_id INTO v_owner FROM contact WHERE id = NEW.contact_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'Cơ hội phải gắn với liên hệ của chính bạn';
  END IF;

  IF btrim(coalesce(NEW.title, '')) = '' THEN
    RAISE EXCEPTION 'Cơ hội cần một tiêu đề';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crm_opportunity_validate
  BEFORE INSERT OR UPDATE ON public.crm_opportunity
  FOR EACH ROW EXECUTE FUNCTION private.validate_crm_opportunity();

-- ---------------------------------------------------------------- RLS

ALTER TABLE public.crm_opportunity ENABLE ROW LEVEL SECURITY;

-- Bốn vế đều là cùng một câu: cơ hội của ai người đó đọc, người đó sửa. Không
-- có ngoại lệ nào cho thành viên của conversation_id — đây là sổ cá nhân.
CREATE POLICY crm_opportunity_select_own ON public.crm_opportunity
  FOR SELECT USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY crm_opportunity_insert_own ON public.crm_opportunity
  FOR INSERT WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY crm_opportunity_update_own ON public.crm_opportunity
  FOR UPDATE USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY crm_opportunity_delete_own ON public.crm_opportunity
  FOR DELETE USING (owner_user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------- GRANT khớp RLS

REVOKE ALL ON public.crm_opportunity FROM PUBLIC, anon, authenticated;

-- SELECT và DELETE: đọc sổ của mình, và bỏ một cơ hội ghi nhầm.
GRANT SELECT, DELETE ON public.crm_opportunity TO authenticated;

-- UPDATE chỉ đúng ba cột người dùng thật sự sửa tại chỗ.
--
-- stage, contact_id và owner_user_id KHÔNG nằm trong danh sách này: đổi giai
-- đoạn đi qua update_opportunity_stage (nơi giá trị được đối chiếu với danh
-- sách hợp lệ), còn hai cột kia là quyền sở hữu — cho sửa trực tiếp là mở
-- đường chuyển cơ hội sang liên hệ của người khác, thứ RLS không nhìn thấy.
--
-- Không GRANT INSERT: cơ hội chỉ sinh ra qua create_opportunity, nơi quyền sở
-- hữu liên hệ được kiểm. Policy INSERT ở trên vẫn là trần của mọi đường ghi.
GRANT UPDATE (title, estimated_value, updated_at) ON public.crm_opportunity TO authenticated;

-- ---------------------------------------------------------------- tasks.opportunity_id

ALTER TABLE public.tasks ADD COLUMN opportunity_id uuid;

-- Khoá ngoại GHÉP, không phải khoá ngoại thường: một việc chỉ gắn được vào cơ
-- hội của CHÍNH người tạo việc đó. Làm bằng khoá ngoại chứ không bằng trigger
-- vì phạm vi Prompt này không cho đụng vào luồng ghi của tasks — và ràng buộc
-- này chỉ áp cho hàng có opportunity_id, tức là chỉ hàng mới.
--
-- MATCH SIMPLE (mặc định): opportunity_id NULL thì bỏ qua kiểm — mọi việc đang
-- có trong bảng không chịu ảnh hưởng nào.
--
-- SET NULL phải nêu RÕ cột, phát hiện khi dò: một khoá ngoại ghép mặc định xoá
-- trắng CẢ HAI cột, tức là cả creator_id (NOT NULL) — xoá một cơ hội sẽ thất
-- bại với thông báo "creator_id không được rỗng" ở màn hình CRM. Nêu tên cột
-- thì chỉ liên kết bị cắt, việc vẫn thuộc về người tạo nó.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_opportunity_fkey
  FOREIGN KEY (opportunity_id, creator_id)
  REFERENCES public.crm_opportunity(id, owner_user_id)
  ON DELETE SET NULL (opportunity_id);

CREATE INDEX idx_tasks_opportunity
  ON public.tasks(opportunity_id) WHERE opportunity_id IS NOT NULL;

-- Bảng tasks cấp quyền theo TỪNG CỘT, nên cột mới không tự thừa hưởng gì.
GRANT SELECT (opportunity_id), INSERT (opportunity_id), UPDATE (opportunity_id)
  ON public.tasks TO authenticated;

-- ---------------------------------------------------------------- RPC

/**
 * Đánh dấu một liên hệ là cơ hội kinh doanh.
 *
 * owner_user_id lấy từ auth.uid(), không nhận từ client. p_contact_id thì
 * ngược lại — client gửi lên và không được tin, nên quyền sở hữu liên hệ được
 * kiểm ở đây (SECURITY DEFINER bỏ qua RLS).
 */
CREATE FUNCTION public.create_opportunity(
  p_contact_id uuid,
  p_title text,
  p_estimated_value numeric DEFAULT NULL
) RETURNS public.crm_opportunity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact contact%ROWTYPE;
  v_row     crm_opportunity%ROWTYPE;
  v_title   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'Cơ hội cần một tiêu đề';
  END IF;

  IF p_estimated_value IS NOT NULL AND p_estimated_value < 0 THEN
    RAISE EXCEPTION 'Giá trị dự kiến không thể là số âm';
  END IF;

  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ đánh dấu được cơ hội trên liên hệ của chính bạn';
  END IF;

  INSERT INTO crm_opportunity (owner_user_id, contact_id, title, estimated_value)
  VALUES (auth.uid(), p_contact_id, v_title, p_estimated_value)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/**
 * Đổi giai đoạn của một cơ hội.
 *
 * Năm giai đoạn đi tự do, không theo thứ tự cứng: đánh giá lại một khách hàng
 * và lùi từ 'dang_cham_soc' về 'tiem_nang' là việc thường ngày, không phải sai
 * sót cần chặn. Danh sách giá trị hợp lệ vẫn là danh sách duy nhất.
 */
CREATE FUNCTION public.update_opportunity_stage(
  p_opportunity_id uuid,
  p_stage text
) RETURNS public.crm_opportunity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row crm_opportunity%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_stage NOT IN ('lead', 'tiem_nang', 'dang_cham_soc', 'doi_tac', 'khong_thanh') THEN
    RAISE EXCEPTION 'Giai đoạn không hợp lệ';
  END IF;

  SELECT * INTO v_row FROM crm_opportunity WHERE id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy cơ hội này';
  END IF;
  IF v_row.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ cơ hội mới được đổi giai đoạn';
  END IF;

  UPDATE crm_opportunity SET stage = p_stage
  WHERE id = p_opportunity_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/**
 * Gắn một cơ hội với một cuộc trò chuyện đã có.
 *
 * Hai điều kiện, không phải một: người gọi phải là chủ cơ hội VÀ là thành viên
 * của cuộc trò chuyện đó. Chỉ kiểm vế đầu thì id đoán được là đủ để dò xem một
 * cuộc trò chuyện có tồn tại hay không.
 *
 * p_conversation_id NULL là đường tháo gắn: một liên kết chỉ đi được một chiều
 * thì người dùng gắn nhầm sẽ mắc ở đó vĩnh viễn.
 */
CREATE FUNCTION public.link_opportunity_conversation(
  p_opportunity_id uuid,
  p_conversation_id uuid
) RETURNS public.crm_opportunity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row crm_opportunity%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_row FROM crm_opportunity WHERE id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy cơ hội này';
  END IF;
  IF v_row.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ cơ hội mới được gắn cuộc trò chuyện';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = p_conversation_id) THEN
      RAISE EXCEPTION 'Không tìm thấy cuộc trò chuyện này';
    END IF;
    IF NOT private.is_conversation_participant(p_conversation_id, auth.uid()) THEN
      RAISE EXCEPTION 'Chỉ gắn được cuộc trò chuyện mà bạn là thành viên';
    END IF;
  END IF;

  UPDATE crm_opportunity SET conversation_id = p_conversation_id
  WHERE id = p_opportunity_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- EXECUTE

REVOKE ALL ON FUNCTION private.validate_crm_opportunity() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.create_opportunity(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_opportunity(uuid, text, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.update_opportunity_stage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_opportunity_stage(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.link_opportunity_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_opportunity_conversation(uuid, uuid) TO authenticated;
