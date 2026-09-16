-- ============================================================
-- AVORA — Contact Model v2.0 (Prompt B1): RPC update_contact
-- Bổ sung cho migration 20260915230601. Không sửa bảng, không sửa RLS,
-- không đụng create_contact / create_contact_invite / accept_invite.
-- ============================================================

-- Sửa một liên hệ đã có.
--
-- Validate GIỐNG HỆT create_contact, nhưng theo contact_type ĐANG CÓ của hàng đó:
-- loại không đổi được sau khi tạo. Một hàng sinh ra là 'individual' thì mọi lần
-- sửa về sau vẫn đo bằng luật của cá nhân — nếu cần đổi loại, xoá và tạo lại.
--
-- SECURITY DEFINER nên phải tự kiểm tra quyền sở hữu: p_contact_id đến từ client
-- và không được tin. Đọc owner_user_id từ bảng rồi đối chiếu auth.uid(), không
-- dựa vào RLS (definer bỏ qua RLS).
CREATE OR REPLACE FUNCTION update_contact(
  p_contact_id uuid,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_relationship_tag text DEFAULT NULL,
  p_employer_contact_id uuid DEFAULT NULL,
  p_tax_code text DEFAULT NULL,
  p_business_address text DEFAULT NULL,
  p_representative_name text DEFAULT NULL,
  p_representative_phone text DEFAULT NULL,
  p_representative_email text DEFAULT NULL,
  p_industry text DEFAULT NULL
) RETURNS contact
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    contact%ROWTYPE;
  v_result      contact%ROWTYPE;
  v_employer    contact%ROWTYPE;
  v_name   text := nullif(btrim(p_name), '');
  v_phone  text := nullif(btrim(p_phone), '');
  v_email  text := nullif(btrim(p_email), '');
  v_tax    text := nullif(btrim(p_tax_code), '');
  v_rep    text := nullif(btrim(p_representative_name), '');
  v_rep_ph text := nullif(btrim(p_representative_phone), '');
  v_rep_em text := nullif(btrim(p_representative_email), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_existing FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_existing.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được sửa liên hệ này';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Tên liên hệ không được để trống';
  END IF;

  IF v_existing.contact_type = 'individual' THEN
    IF v_phone IS NULL AND v_email IS NULL THEN
      RAISE EXCEPTION 'Liên hệ cá nhân cần ít nhất số điện thoại hoặc email';
    END IF;

    -- Nơi làm việc phải là doanh nghiệp của CHÍNH người này. Trigger đã chặn
    -- việc trỏ sang contact không phải business, nhưng không chặn trỏ sang
    -- doanh nghiệp của người khác — id đoán được thì phải chặn ở đây.
    IF p_employer_contact_id IS NOT NULL THEN
      SELECT * INTO v_employer FROM contact WHERE id = p_employer_contact_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy doanh nghiệp này';
      END IF;
      IF v_employer.owner_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Chỉ chọn được doanh nghiệp trong danh bạ của bạn';
      END IF;
      IF v_employer.contact_type <> 'business' THEN
        RAISE EXCEPTION 'Nơi làm việc phải là một liên hệ doanh nghiệp';
      END IF;
      IF v_employer.id = v_existing.id THEN
        RAISE EXCEPTION 'Một liên hệ không thể làm việc cho chính nó';
      END IF;
    END IF;
  ELSE
    IF v_tax IS NULL THEN
      RAISE EXCEPTION 'Liên hệ doanh nghiệp cần mã số thuế';
    END IF;
    IF v_rep IS NULL THEN
      RAISE EXCEPTION 'Liên hệ doanh nghiệp cần tên người đại diện';
    END IF;
    IF v_phone IS NULL AND v_email IS NULL AND v_rep_ph IS NULL AND v_rep_em IS NULL THEN
      RAISE EXCEPTION 'Liên hệ doanh nghiệp cần ít nhất một kênh liên hệ (điện thoại hoặc email)';
    END IF;
  END IF;

  -- contact_type, owner_user_id, linked_user_id KHÔNG nằm trong SET: loại không
  -- đổi được, chủ sở hữu không chuyển được, và liên kết tài khoản chỉ do
  -- accept_invite đặt — không phải thứ một form sửa tay được.
  UPDATE contact SET
    name                 = v_name,
    phone                = v_phone,
    email                = v_email,
    note                 = p_note,
    date_of_birth        = CASE WHEN v_existing.contact_type = 'individual' THEN p_date_of_birth ELSE date_of_birth END,
    relationship_tag     = CASE WHEN v_existing.contact_type = 'individual' THEN p_relationship_tag ELSE relationship_tag END,
    employer_contact_id  = CASE WHEN v_existing.contact_type = 'individual' THEN p_employer_contact_id ELSE employer_contact_id END,
    tax_code             = CASE WHEN v_existing.contact_type = 'business' THEN v_tax ELSE tax_code END,
    business_address     = CASE WHEN v_existing.contact_type = 'business' THEN p_business_address ELSE business_address END,
    representative_name  = CASE WHEN v_existing.contact_type = 'business' THEN v_rep ELSE representative_name END,
    representative_phone = CASE WHEN v_existing.contact_type = 'business' THEN v_rep_ph ELSE representative_phone END,
    representative_email = CASE WHEN v_existing.contact_type = 'business' THEN v_rep_em ELSE representative_email END,
    industry             = CASE WHEN v_existing.contact_type = 'business' THEN p_industry ELSE industry END
  WHERE id = p_contact_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION update_contact(uuid, text, text, text, text, date, text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_contact(uuid, text, text, text, text, date, text, uuid, text, text, text, text, text, text) TO authenticated;
