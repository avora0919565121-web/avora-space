-- ============================================================
-- AVORA — Nền tảng contact_channel: nhiều số điện thoại / email cho một liên hệ
--
-- Mô hình: contact.phone / contact.email vẫn là KÊNH CHÍNH, không đổi.
-- contact_channel giữ các kênh TỪ THỨ HAI TRỞ ĐI. Chọn như vậy để
-- create_contact / update_contact / create_contact_invite không phải sửa một
-- dòng nào — mọi màn hình đang chạy vẫn đọc đúng chỗ cũ, và một liên hệ chỉ
-- có một số thì không sinh thêm hàng nào ở bảng mới.
--
-- Không đụng: contact, contact_invite, create_contact, update_contact,
-- create_contact_invite, accept_invite, preview_contact_invite.
-- ============================================================

-- ============ Chuẩn hoá giá trị kênh ============
-- Bản sao đúng từng bước của normalizePhone/normalizeEmail phía client
-- (web/src/lib/contact-channels.ts). Hai nơi phải cho ra cùng một chuỗi, nếu
-- không thì màn hình nhập báo "trùng" trong khi database lại nhận thành hai
-- kênh khác nhau.
--
-- IMMUTABLE vì chỉ biến đổi chuỗi — nhờ vậy dùng được cho cột GENERATED, và
-- giá trị chuẩn hoá luôn đúng bất kể ai ghi, bằng đường nào.
CREATE FUNCTION private.normalize_channel(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '';
  END IF;

  IF p_kind = 'email' THEN
    RETURN lower(btrim(p_value));
  END IF;

  -- +84 912 345 678 và 0912345678 là cùng một số: người lưu dạng này rồi nhập
  -- dạng kia vẫn phải ra một liên hệ, không phải hai.
  v := regexp_replace(p_value, '[^0-9+]', '', 'g');
  v := regexp_replace(v, '^\+?84', '0');
  RETURN regexp_replace(v, '[^0-9]', '', 'g');
END;
$$;

-- ============ Bảng contact_channel ============
CREATE TABLE contact_channel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  -- Lặp lại chủ sở hữu ở đây để RLS là một phép so sánh, không phải truy vấn
  -- lồng vào contact. Trigger bên dưới giữ cho nó không bao giờ lệch với
  -- contact.owner_user_id, nên đây là bản sao được canh, không phải nguồn thứ hai.
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('phone', 'email')),
  value text NOT NULL,
  value_normalized text NOT NULL
    GENERATED ALWAYS AS (private.normalize_channel(kind, value)) STORED,
  -- Nhãn tự do người dùng đặt: "cơ quan", "số cũ"... Không có danh sách cố định
  -- vì chỉ chính người ghi đọc nó, không có luật nào chạy theo.
  label text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import_csv', 'import_device')),
  -- Máy không đoán được số nào mới là số chính. Cờ này là lời thú nhận đó,
  -- để màn hình "Cần xem lại" hỏi đúng người biết câu trả lời.
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Cùng một liên hệ không giữ hai lần cùng một số. So theo bản chuẩn hoá nên
  -- "0912 345 678" và "+84912345678" đụng nhau đúng như người đọc mong đợi.
  CONSTRAINT contact_channel_unique_per_contact UNIQUE (contact_id, kind, value_normalized)
);

CREATE INDEX idx_contact_channel_contact ON contact_channel(contact_id);
-- Đường đi của việc dò trùng khi nhập hàng loạt: tìm theo chủ sở hữu + giá trị.
CREATE INDEX idx_contact_channel_lookup
  ON contact_channel(owner_user_id, kind, value_normalized);
CREATE INDEX idx_contact_channel_review
  ON contact_channel(owner_user_id) WHERE needs_review;

CREATE TRIGGER trg_contact_channel_touch_updated_at
  BEFORE UPDATE ON contact_channel
  FOR EACH ROW EXECUTE FUNCTION private.touch_contact_updated_at();

-- ============ Trigger ràng buộc ============
-- RLS chỉ kiểm được owner_user_id = auth.uid(). Nếu dừng ở đó, một người có
-- thể gắn kênh của mình vào liên hệ của NGƯỜI KHÁC (owner_user_id là của mình,
-- contact_id là của họ) — id đoán được thì phải chặn ở đây.
CREATE FUNCTION private.validate_contact_channel() RETURNS trigger
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
    RAISE EXCEPTION 'Kênh liên hệ phải thuộc cùng chủ với liên hệ';
  END IF;

  -- Một chuỗi chuẩn hoá xong không còn gì thì không phải kênh liên hệ.
  --
  -- Tự gọi hàm chuẩn hoá chứ không đọc NEW.value_normalized: cột GENERATED chỉ
  -- được tính SAU khi BEFORE-trigger chạy xong, nên ở đây nó luôn rỗng và mọi
  -- kênh hợp lệ đều bị chặn nhầm.
  IF btrim(private.normalize_channel(NEW.kind, NEW.value)) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_channel_validate
  BEFORE INSERT OR UPDATE ON contact_channel
  FOR EACH ROW EXECUTE FUNCTION private.validate_contact_channel();

-- ============ RLS ============
ALTER TABLE contact_channel ENABLE ROW LEVEL SECURITY;

-- Không có policy INSERT, và cũng không GRANT INSERT: kênh chỉ sinh ra qua
-- add_contact_channel, nơi giá trị được đối chiếu với kênh chính và với các
-- kênh đã có. Cho ghi thẳng vào bảng là mở một đường vòng qua chỗ kiểm đó.
CREATE POLICY contact_channel_select_own ON contact_channel
  FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY contact_channel_update_own ON contact_channel
  FOR UPDATE USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY contact_channel_delete_own ON contact_channel
  FOR DELETE USING (owner_user_id = auth.uid());

-- ============ GRANT khớp đúng RLS ============
REVOKE ALL ON contact_channel FROM PUBLIC, anon, authenticated;
-- UPDATE giới hạn ở đúng hai cột người dùng thật sự sửa: đánh dấu đã xem lại,
-- và đặt tên cho kênh. Sửa chính giá trị là xoá rồi thêm lại — như vậy nguồn
-- (source) không bao giờ nói dối về việc con số này từ đâu tới.
GRANT SELECT, DELETE ON contact_channel TO authenticated;
GRANT UPDATE (needs_review, label) ON contact_channel TO authenticated;

-- ============ RPC add_contact_channel ============
-- Thêm một kênh phụ cho liên hệ mình sở hữu.
--
-- Không báo lỗi khi kênh đã có: nhập hàng loạt thường gặp cùng một số viết hai
-- kiểu trong cùng một file, và bắt cả mẻ nhập dừng lại vì chuyện vô hại đó thì
-- tệ hơn là lặng lẽ trả về đúng hàng đang có. Trả về NULL khi giá trị trùng
-- chính kênh chính của liên hệ — không có gì để thêm, cũng không có gì sai.
CREATE FUNCTION add_contact_channel(
  p_contact_id uuid,
  p_kind text,
  p_value text,
  p_source text DEFAULT 'manual',
  p_label text DEFAULT NULL,
  p_needs_review boolean DEFAULT false
) RETURNS contact_channel
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact    contact%ROWTYPE;
  v_row        contact_channel%ROWTYPE;
  v_normalized text;
  v_primary    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'Loại kênh phải là phone hoặc email';
  END IF;

  IF p_source NOT IN ('manual', 'import_csv', 'import_device') THEN
    RAISE EXCEPTION 'Nguồn kênh phải là manual, import_csv hoặc import_device';
  END IF;

  v_normalized := private.normalize_channel(p_kind, p_value);
  IF btrim(coalesce(v_normalized, '')) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  -- SECURITY DEFINER bỏ qua RLS, nên quyền sở hữu phải tự kiểm: p_contact_id
  -- đến từ client và không được tin.
  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được thêm kênh liên hệ';
  END IF;

  v_primary := private.normalize_channel(
    p_kind,
    CASE WHEN p_kind = 'phone' THEN v_contact.phone ELSE v_contact.email END
  );
  IF v_primary = v_normalized THEN
    RETURN NULL;
  END IF;

  INSERT INTO contact_channel (contact_id, owner_user_id, kind, value, label, source, needs_review)
  VALUES (p_contact_id, auth.uid(), p_kind, btrim(p_value), nullif(btrim(p_label), ''),
          p_source, coalesce(p_needs_review, false))
  ON CONFLICT ON CONSTRAINT contact_channel_unique_per_contact DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_normalized;
  END IF;

  RETURN v_row;
END;
$$;

-- ============ EXECUTE: chỉ authenticated ============
REVOKE ALL ON FUNCTION private.normalize_channel(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.validate_contact_channel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION add_contact_channel(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_contact_channel(uuid, text, text, text, text, boolean) TO authenticated;
