-- ============================================================
-- AVORA — Business HUB v1: business_hub_table + business_hub_record
--
-- Sổ quản trị CÁ NHÂN. Một bảng thuộc về đúng một người: người tạo ra nó.
-- Không chia sẻ, không thành viên, không mời — y hệt Tài chính cá nhân và
-- crm_opportunity. Mọi policy ở đây chỉ có một câu: của ai người đó đọc, người
-- đó sửa.
--
-- Tách biệt hoàn toàn với crm_opportunity: không khoá ngoại, không view chung,
-- không RPC nào đọc chéo. Hai sổ khác nhau cho hai việc khác nhau.
--
-- column_defs là KHUÔN CỘT của riêng một bảng, giá trị thật nằm ở
-- business_hub_record.extension_fields. Khuôn để một chỗ nên đổi nhãn cột không
-- phải đi sửa từng record; giá trị để trên record nên thêm cột không phải viết
-- lại toàn bộ dữ liệu cũ.
--
-- project_id CHƯA gắn khoá ngoại: module Dự án chưa tồn tại, giống hệt
-- crm_opportunity.project_id. Cột giữ chỗ, gắn FK khi Dự án ra mắt thật.
--
-- Không đụng: crm_opportunity, contact, tasks, transactions, conversations.
-- ============================================================

-- ---------------------------------------------------------------- bảng

CREATE TABLE public.business_hub_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: sổ riêng của một người, không có ai kế thừa.
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  -- [{key, label, type, options?}] — type: 'text' | 'number' | 'date' | 'select'.
  column_defs jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.business_hub_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE vì table_id là NOT NULL: một record không thuộc bảng nào thì không
  -- còn là record. Xoá cứng một bảng (nếu sau này có) phải dọn được record của
  -- nó, không để lại hàng mồ côi không màn hình nào đọc tới.
  table_id uuid NOT NULL REFERENCES public.business_hub_table(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  -- Không CHECK: Trạng thái là từ ngữ của người dùng, không phải của hệ thống.
  -- Client gợi ý một bộ quen thuộc; Kanban dựng cột từ chính dữ liệu nên một
  -- trạng thái lạ vẫn hiện ra chứ không biến mất.
  status text NOT NULL DEFAULT 'moi',
  priority text NOT NULL DEFAULT 'trung_binh'
    CHECK (priority IN ('thap', 'trung_binh', 'cao')),
  category text,
  next_action_date date,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  extension_fields jsonb NOT NULL DEFAULT '{}',
  project_id uuid, -- CHƯA gắn FK — Dự án chưa tồn tại
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_business_hub_table_owner
  ON public.business_hub_table(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_business_hub_record_table
  ON public.business_hub_record(table_id) WHERE deleted_at IS NULL;
-- Thêm ngoài đề bài: màn tổng quan đếm record theo hạn trên TẤT CẢ các bảng,
-- và RLS lọc theo owner ở mọi câu đọc — không có index này thì mỗi lần mở
-- Business Space là một lần quét toàn bảng.
CREATE INDEX idx_business_hub_record_owner
  ON public.business_hub_record(owner_user_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_business_hub_table_touch_updated_at
  BEFORE UPDATE ON public.business_hub_table
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_business_hub_record_touch_updated_at
  BEFORE UPDATE ON public.business_hub_record
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------- khuôn cột

/**
 * Kiểm một mảng định nghĩa cột.
 *
 * Đặt ở schema private vì đây là hàm kiểm nội bộ, không phải API: để ở public
 * thì PostgREST biến nó thành endpoint gọi được.
 *
 * Kiểm cả mảng chứ không chỉ cột vừa thêm — column_defs là một giá trị jsonb
 * duy nhất, mọi đường ghi đều ghi lại cả mảng, nên chỗ duy nhất đúng để kiểm là
 * toàn bộ mảng sau khi ghi.
 */
CREATE FUNCTION private.validate_column_defs(p_defs jsonb) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_def  jsonb;
  v_type text;
  v_keys text[] := '{}';
  v_key  text;
BEGIN
  IF p_defs IS NULL OR jsonb_typeof(p_defs) <> 'array' THEN
    RAISE EXCEPTION 'avora_business_hub_column_defs_shape';
  END IF;

  FOR v_def IN SELECT * FROM jsonb_array_elements(p_defs) LOOP
    IF jsonb_typeof(v_def) <> 'object' THEN
      RAISE EXCEPTION 'avora_business_hub_column_defs_shape';
    END IF;

    v_key := v_def->>'key';
    IF v_key IS NULL OR btrim(v_key) = '' THEN
      RAISE EXCEPTION 'avora_business_hub_column_defs_shape';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'avora_business_hub_column_key_taken';
    END IF;
    v_keys := v_keys || v_key;

    IF btrim(coalesce(v_def->>'label', '')) = '' THEN
      RAISE EXCEPTION 'avora_business_hub_column_label_required';
    END IF;

    v_type := v_def->>'type';
    IF v_type IS NULL OR v_type NOT IN ('text', 'number', 'date', 'select') THEN
      RAISE EXCEPTION 'avora_business_hub_column_type_invalid';
    END IF;

    -- 'select' mà không có lựa chọn nào là một ô không bao giờ điền được.
    IF v_type = 'select' THEN
      IF v_def->'options' IS NULL
         OR jsonb_typeof(v_def->'options') <> 'array'
         OR jsonb_array_length(v_def->'options') = 0 THEN
        RAISE EXCEPTION 'avora_business_hub_column_options_required';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_def->'options') AS opt
        WHERE jsonb_typeof(opt) <> 'string' OR btrim(opt #>> '{}') = ''
      ) THEN
        RAISE EXCEPTION 'avora_business_hub_column_options_required';
      END IF;
    END IF;
  END LOOP;
END;
$$;

/**
 * Kiểm giá trị cột mở rộng của một record so với khuôn cột của bảng nó.
 *
 * Khoá lạ (cột đã bị bỏ khỏi khuôn, hoặc client tự bịa) được BỎ QUA chứ không
 * làm hỏng cả lần ghi: khuôn cột đổi được, còn dữ liệu cũ thì không nên biến
 * một lần sửa ghi chú thành một lỗi người dùng không hiểu.
 *
 * Nhưng giá trị SAI KIỂU thì từ chối: một cột Số nhận "abc" là một cột không
 * còn cộng được, và người nhập đáng được biết ngay lúc nhập.
 */
-- STABLE, không IMMUTABLE: ép chuỗi sang date phụ thuộc DateStyle của phiên.
CREATE FUNCTION private.validate_extension_values(p_defs jsonb, p_values jsonb) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_def   jsonb;
  v_value jsonb;
  v_type  text;
BEGIN
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'avora_business_hub_extension_shape';
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
        RAISE EXCEPTION 'avora_business_hub_value_not_number';
      END IF;

    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_business_hub_value_not_date';
      END IF;
      BEGIN
        PERFORM (v_value #>> '{}')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'avora_business_hub_value_not_date';
      END;

    ELSIF v_type = 'select' THEN
      IF jsonb_typeof(v_value) <> 'string'
         OR NOT (v_def->'options' @> jsonb_build_array(v_value #>> '{}')) THEN
        RAISE EXCEPTION 'avora_business_hub_value_not_option';
      END IF;

    ELSE
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_business_hub_value_not_text';
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------- trigger ràng buộc

CREATE FUNCTION private.validate_business_hub_table() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'avora_business_hub_table_name_required';
  END IF;

  PERFORM private.validate_column_defs(NEW.column_defs);

  IF jsonb_array_length(NEW.column_defs) > 24 THEN
    RAISE EXCEPTION 'avora_business_hub_column_limit';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_hub_table_validate
  BEFORE INSERT OR UPDATE ON public.business_hub_table
  FOR EACH ROW EXECUTE FUNCTION private.validate_business_hub_table();

/**
 * Record và bảng chứa nó phải cùng một chủ.
 *
 * RLS chỉ so được owner_user_id = auth.uid(). Nếu dừng ở đó, một người có thể
 * tạo record của MÌNH trỏ vào bảng của NGƯỜI KHÁC — owner_user_id là của mình
 * nên policy cho qua, table_id là của họ. Đây là cùng một lỗ hổng mà
 * crm_opportunity chặn bằng trigger, nên chặn bằng đúng cách đó: RPC cũng kiểm,
 * nhưng trigger đúng với MỌI đường ghi, kể cả đường sau này ai đó mở ra.
 */
CREATE FUNCTION private.validate_business_hub_record() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table business_hub_table%ROWTYPE;
BEGIN
  IF btrim(coalesce(NEW.title, '')) = '' THEN
    RAISE EXCEPTION 'avora_business_hub_record_title_required';
  END IF;

  IF btrim(coalesce(NEW.status, '')) = '' THEN
    RAISE EXCEPTION 'avora_business_hub_record_status_required';
  END IF;

  SELECT * INTO v_table FROM business_hub_table WHERE id = NEW.table_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_table_missing';
  END IF;
  IF v_table.owner_user_id <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
  END IF;

  IF NEW.tags IS NULL OR array_position(NEW.tags, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'avora_business_hub_tags_shape';
  END IF;

  PERFORM private.validate_extension_values(v_table.column_defs, NEW.extension_fields);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_hub_record_validate
  BEFORE INSERT OR UPDATE ON public.business_hub_record
  FOR EACH ROW EXECUTE FUNCTION private.validate_business_hub_record();

-- ---------------------------------------------------------------- RLS

ALTER TABLE public.business_hub_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hub_record ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_hub_table_select_own ON public.business_hub_table
  FOR SELECT USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_table_insert_own ON public.business_hub_table
  FOR INSERT WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_table_update_own ON public.business_hub_table
  FOR UPDATE USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_table_delete_own ON public.business_hub_table
  FOR DELETE USING (owner_user_id = (SELECT auth.uid()));

CREATE POLICY business_hub_record_select_own ON public.business_hub_record
  FOR SELECT USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_record_insert_own ON public.business_hub_record
  FOR INSERT WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_record_update_own ON public.business_hub_record
  FOR UPDATE USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY business_hub_record_delete_own ON public.business_hub_record
  FOR DELETE USING (owner_user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------- GRANT khớp RLS

REVOKE ALL ON public.business_hub_table FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.business_hub_record FROM PUBLIC, anon, authenticated;

-- Chỉ đọc. Mọi đường ghi đi qua RPC, nơi quyền sở hữu bảng được kiểm và giới
-- hạn 1.000 record được đếm — GRANT INSERT thẳng là mở một cửa sau vòng qua cả
-- hai. Policy INSERT/UPDATE/DELETE ở trên vẫn là trần của mọi đường ghi, kể cả
-- đường của SECURITY DEFINER sau này bị sửa sai.
GRANT SELECT ON public.business_hub_table TO authenticated;
GRANT SELECT ON public.business_hub_record TO authenticated;

-- ---------------------------------------------------------------- RPC: bảng

/**
 * Bảng mặc định cho người chưa có bảng nào.
 *
 * Gọi bao nhiêu lần cũng ra đúng một bảng. Khoá theo người dùng (không phải
 * theo bảng, vì bảng chưa tồn tại để mà khoá): mở hai tab cùng lúc là chuyện
 * thường, và không có khoá thì cả hai cùng thấy "chưa có bảng nào" rồi cùng
 * tạo, để lại hai "Bảng tổng hợp" trống mà người dùng không hiểu từ đâu ra.
 */
CREATE FUNCTION public.ensure_default_business_hub_table() RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_hub_default:' || v_user::text, 0));

  SELECT * INTO v_row FROM business_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL
  ORDER BY position, created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO business_hub_table (owner_user_id, name, position, column_defs)
  VALUES (v_user, 'Bảng tổng hợp', 0, '[]'::jsonb)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/** Một bảng mới, xếp sau tất cả những bảng đang có. */
CREATE FUNCTION public.create_business_hub_table(p_name text) RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_row  business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_business_hub_table_name_required';
  END IF;

  INSERT INTO business_hub_table (owner_user_id, name, position)
  SELECT v_user, v_name,
         coalesce(max(position), -1) + 1
  FROM business_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/** Đổi tên một bảng. Tên là nhãn, không phải khoá — sửa được bất cứ lúc nào. */
CREATE FUNCTION public.rename_business_hub_table(
  p_table_id uuid,
  p_name text
) RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_row  business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_business_hub_table_name_required';
  END IF;

  UPDATE business_hub_table SET name = v_name
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$$;

/**
 * Cất một bảng đi.
 *
 * Xoá mềm, như mọi thứ khác trong AVORA: record bên trong giữ nguyên, không
 * đụng tới cột deleted_at của chúng. Bảng quay lại thì nội dung quay lại cùng —
 * đánh dấu cả nghìn record rồi phải gỡ đúng đúng từng cái là cách chắc chắn
 * đánh mất thứ gì đó.
 */
CREATE FUNCTION public.delete_business_hub_table(p_table_id uuid) RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE business_hub_table SET deleted_at = now()
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$$;

/** Lấy lại một bảng vừa cất đi. */
CREATE FUNCTION public.restore_business_hub_table(p_table_id uuid) RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE business_hub_table SET deleted_at = NULL
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NOT NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$$;

/**
 * Thêm một cột mở rộng vào khuôn cột của MỘT bảng.
 *
 * Khoá cột do máy chủ sinh, không lấy từ nhãn: nhãn đổi được và nhãn trùng
 * nhau được ("Ghi chú" hai lần là chuyện thường), còn khoá thì phải đứng yên
 * vĩnh viễn vì nó là thứ đang trỏ tới giá trị đã nhập trong từng record. Sinh
 * khoá từ nhãn là hẹn trước ngày đổi tên cột làm mất sạch dữ liệu cột đó.
 *
 * Cột mới luôn vào CUỐI mảng và không đụng tới record nào: giá trị của các
 * record cũ ở cột này đơn giản là chưa có, và hiện ra dưới dạng ô trống.
 */
CREATE FUNCTION public.add_business_hub_column(
  p_table_id uuid,
  p_label text,
  p_type text,
  p_options text[] DEFAULT NULL
) RETURNS public.business_hub_table
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_label   text;
  v_options jsonb;
  v_def     jsonb;
  v_row     business_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_label := btrim(coalesce(p_label, ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'avora_business_hub_column_label_required';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('text', 'number', 'date', 'select') THEN
    RAISE EXCEPTION 'avora_business_hub_column_type_invalid';
  END IF;

  SELECT * INTO v_row FROM business_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
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
      RAISE EXCEPTION 'avora_business_hub_column_options_required';
    END IF;
    v_def := v_def || jsonb_build_object('options', v_options);
  END IF;

  UPDATE business_hub_table
  SET column_defs = column_defs || jsonb_build_array(v_def)
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- RPC: record

/**
 * Một mục mới trong một bảng.
 *
 * Trần 1.000 record/bảng được đếm Ở ĐÂY chứ không ở giao diện: giao diện là
 * nơi báo tin, không phải nơi giữ luật. Đếm bỏ qua record đã xoá mềm — dọn bớt
 * phải thật sự mở ra chỗ trống, nếu không thì lời khuyên "hãy dọn bớt" là lời
 * khuyên sai.
 */
CREATE FUNCTION public.create_business_hub_record(
  p_table_id uuid,
  p_title text,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_next_action_date date DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_extension_fields jsonb DEFAULT NULL
) RETURNS public.business_hub_record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_title text;
  v_count integer;
  v_row   business_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'avora_business_hub_record_title_required';
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_business_hub_priority_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM business_hub_table
    WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'avora_business_hub_table_not_yours';
  END IF;

  SELECT count(*) INTO v_count FROM business_hub_record
  WHERE table_id = p_table_id AND deleted_at IS NULL;

  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_business_hub_record_limit';
  END IF;

  INSERT INTO business_hub_record (
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
$$;

/**
 * Sửa một record.
 *
 * Nhận một jsonb vá thay vì tám tham số, vì tám tham số không phân biệt được
 * "để nguyên" với "xoá trống": cả hai đều gửi lên NULL. Ở đây khoá CÓ MẶT
 * nghĩa là ghi (kể cả ghi null để xoá trống), khoá VẮNG MẶT nghĩa là không
 * đụng tới. Khoá lạ bị từ chối thẳng — im lặng bỏ qua một khoá gõ sai là để
 * người dùng tưởng đã lưu.
 */
CREATE FUNCTION public.update_business_hub_record(
  p_record_id uuid,
  p_patch jsonb
) RETURNS public.business_hub_record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  business_hub_record%ROWTYPE;
  v_key  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'avora_business_hub_patch_shape';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'title', 'status', 'priority', 'category',
      'next_action_date', 'tags', 'notes', 'extension_fields'
    ) THEN
      RAISE EXCEPTION 'avora_business_hub_patch_field';
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM business_hub_record
  WHERE id = p_record_id AND owner_user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_record_not_yours';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_business_hub_record_deleted';
  END IF;

  IF p_patch ? 'priority'
     AND coalesce(p_patch->>'priority', '') NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_business_hub_priority_invalid';
  END IF;

  UPDATE business_hub_record SET
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
      THEN coalesce(p_patch->'extension_fields', '{}'::jsonb) ELSE extension_fields END
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

/** Cất một record đi. Xoá mềm — bảng vẫn đếm được, chỗ trống vẫn mở ra. */
CREATE FUNCTION public.delete_business_hub_record(p_record_id uuid)
RETURNS public.business_hub_record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  business_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE business_hub_record SET deleted_at = now()
  WHERE id = p_record_id AND owner_user_id = v_user AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_record_not_yours';
  END IF;

  RETURN v_row;
END;
$$;

/**
 * Lấy lại một record vừa cất đi.
 *
 * Trần 1.000 được kiểm lại ở đây: khôi phục cũng là thêm một mục vào bảng, và
 * không kiểm thì đây là đường vòng đưa bảng vượt trần.
 */
CREATE FUNCTION public.restore_business_hub_record(p_record_id uuid)
RETURNS public.business_hub_record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_row   business_hub_record%ROWTYPE;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM business_hub_record
  WHERE id = p_record_id AND owner_user_id = v_user AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_business_hub_record_not_yours';
  END IF;

  SELECT count(*) INTO v_count FROM business_hub_record
  WHERE table_id = v_row.table_id AND deleted_at IS NULL;
  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_business_hub_record_limit';
  END IF;

  UPDATE business_hub_record SET deleted_at = NULL
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------- EXECUTE

REVOKE ALL ON FUNCTION private.validate_column_defs(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_extension_values(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_business_hub_table() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_business_hub_record() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ensure_default_business_hub_table() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_business_hub_table() TO authenticated;

REVOKE ALL ON FUNCTION public.create_business_hub_table(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_hub_table(text) TO authenticated;

REVOKE ALL ON FUNCTION public.rename_business_hub_table(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_business_hub_table(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_business_hub_table(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_business_hub_table(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.restore_business_hub_table(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_business_hub_table(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_business_hub_column(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_business_hub_column(uuid, text, text, text[]) TO authenticated;

REVOKE ALL ON FUNCTION public.create_business_hub_record(
  uuid, text, text, text, text, date, text[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_hub_record(
  uuid, text, text, text, text, date, text[], text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.update_business_hub_record(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_hub_record(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_business_hub_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_business_hub_record(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.restore_business_hub_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_business_hub_record(uuid) TO authenticated;
