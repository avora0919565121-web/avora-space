-- ============================================================================
-- AVORA 08 — Lời mời phải có kênh để đi
--
-- create_contact_invite kiểm tra người gửi, loại liên hệ và cách mời, nhưng không
-- kiểm tra cách mời đó có địa chỉ để gửi hay không. Liên hệ chỉ có email vẫn mời
-- được "qua SMS": token được cấp, hàng được ghi, và không có số nào để gửi tới.
--
-- 'link' và 'qr' không cần kênh nào: liên kết tự nó là lời mời, người gửi tự chọn
-- đường chuyển tiếp. Chỉ 'sms' và 'email' cần một địa chỉ có thật.
--
-- Thiếu sót từ đặc tả gốc (Prompt A), không phải lỗi cài đặt.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_contact_invite(
  p_contact_id uuid,
  p_method text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_type  text;
  v_phone text;
  v_email text;
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_method NOT IN ('sms', 'email', 'link', 'qr') THEN
    RAISE EXCEPTION 'Cách mời phải là sms, email, link hoặc qr';
  END IF;

  SELECT owner_user_id, contact_type, phone, email
    INTO v_owner, v_type, v_phone, v_email
  FROM contact WHERE id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được gửi lời mời';
  END IF;
  IF v_type <> 'individual' THEN
    RAISE EXCEPTION 'Chỉ liên hệ cá nhân mới có thể mời liên kết tài khoản';
  END IF;

  -- Kênh phải có địa chỉ thật. Chuỗi rỗng cũng là chưa có: create_contact/update_contact
  -- đã nullif(btrim(...)) khi ghi, nhưng hàng cũ hoặc đường ghi khác có thể còn ''.
  IF p_method = 'sms' AND nullif(btrim(coalesce(v_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Liên hệ này chưa có số điện thoại, không thể mời qua SMS';
  END IF;
  IF p_method = 'email' AND nullif(btrim(coalesce(v_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Liên hệ này chưa có email, không thể mời qua email';
  END IF;

  v_token := gen_random_uuid()::text;

  INSERT INTO contact_invite (contact_id, invited_by, method, invite_token)
  VALUES (p_contact_id, auth.uid(), p_method, v_token);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION create_contact_invite(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_contact_invite(uuid, text) TO authenticated;
