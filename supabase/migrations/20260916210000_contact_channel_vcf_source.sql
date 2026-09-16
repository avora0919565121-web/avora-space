-- ============================================================
-- AVORA — Nhận thêm nguồn kênh 'import_vcf' (file danh bạ .vcf)
--
-- Chỉ nới đúng danh sách giá trị được phép của cột source, ở CẢ HAI nơi đang
-- canh nó: CHECK constraint trên bảng, và câu kiểm trong add_contact_channel.
-- Sửa một nơi thôi thì nơi còn lại chặn — và lỗi hiện ra sẽ nói sai chỗ.
--
-- Kèm một sửa lỗi có sẵn, phát hiện khi probe nguồn mới: xem phần cuối file.
--
-- Không đụng: contact_channel (cấu trúc còn lại), add_contact_channel (phần
-- thân hàm), create_contact, update_contact, create_contact_invite.
-- ============================================================

-- ============ CHECK constraint ============
-- Nguồn là lời khai "con số này từ đâu tới", nên mỗi đường nhập mới phải có tên
-- riêng: gộp .vcf vào chung 'import_csv' sẽ khiến màn hình kênh liên hệ nói với
-- người dùng rằng số lấy từ danh bạ iPhone là "nhập từ tệp bảng tính".
ALTER TABLE contact_channel DROP CONSTRAINT contact_channel_source_check;
ALTER TABLE contact_channel ADD CONSTRAINT contact_channel_source_check
  CHECK (source IN ('manual', 'import_csv', 'import_device', 'import_vcf'));

-- ============ add_contact_channel ============
-- CREATE OR REPLACE giữ nguyên chữ ký, nên mọi GRANT/REVOKE đã cấp ở migration
-- nền tảng còn nguyên — không cần cấp lại, và cũng không có khoảng hở nào giữa
-- lúc xoá và lúc cấp lại.
CREATE OR REPLACE FUNCTION add_contact_channel(
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

  IF p_source NOT IN ('manual', 'import_csv', 'import_device', 'import_vcf') THEN
    RAISE EXCEPTION 'Nguồn kênh phải là manual, import_csv, import_device hoặc import_vcf';
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

-- ============ Sửa lỗi có sẵn: xác nhận / đặt tên kênh đang hỏng ============
-- Phát hiện khi probe nguồn mới dưới role authenticated: hai câu UPDATE mà màn
-- hình "Cần xem lại" chạy hằng ngày đều đổ với
--   permission denied for function normalize_channel
--
-- Nguyên do: value_normalized là cột GENERATED gọi private.normalize_channel,
-- và Postgres tính lại cột sinh ở MỌI câu UPDATE trên hàng đó — kể cả khi chỉ
-- sửa needs_review hay label. Hàm này bị REVOKE khỏi PUBLIC ở migration nền
-- tảng, nên mọi đường ghi thẳng vào bảng đều bị chặn, dù RLS và GRANT cột đều
-- đã đúng. Các RPC không lộ ra lỗi này vì SECURITY DEFINER chạy dưới quyền chủ
-- hàm, nên bug nằm im cho tới khi có người bấm "Đây là số chính".
--
-- Chỉ cấp EXECUTE, KHÔNG cấp USAGE trên schema private: đã đo lại bằng probe —
-- cột sinh tính được, còn gọi thẳng private.normalize_channel vẫn bị chặn ở
-- tầng schema. Nhờ vậy hàm vẫn không thành API công khai qua PostgREST, đúng
-- điều khoản "predicate helper không đặt ở public" trong AGENTS.md.
GRANT EXECUTE ON FUNCTION private.normalize_channel(text, text) TO authenticated;
