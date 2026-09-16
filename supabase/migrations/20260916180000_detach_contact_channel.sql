-- ============================================================
-- AVORA — Bỏ một số/email khỏi MỘT liên hệ (Trường hợp 2: kênh dùng chung)
--
-- Trường hợp 1 (một liên hệ nhiều số) đã xử lý xong bằng contact_channel +
-- màn "Cần xem lại". Còn thiếu chiều ngược lại: CÙNG một số được lưu ở NHIỀU
-- liên hệ khác nhau của cùng một người dùng. Việc phát hiện đọc dữ liệu đã có
-- (không cron, không bảng cache, không hàm chuẩn hoá thứ hai). Việc GHI thì cần
-- hàm này.
--
-- Không đụng: contact_channel, add_contact_channel, create_contact,
-- update_contact, create_contact_invite, accept_invite, preview_contact_invite.
-- ============================================================

-- Bỏ một giá trị kênh khỏi đúng một liên hệ, dù nó đang nằm ở đâu.
--
-- Một số có thể được giữ ở kênh chính (contact.phone/email) hoặc ở kênh phụ
-- (contact_channel), và người dùng không nhìn thấy khác biệt đó — họ chỉ thấy
-- "số này đang gắn với ba người". Nên hàm nhận GIÁ TRỊ chứ không nhận id hàng:
-- màn hình nói "bỏ số này khỏi liên hệ kia", không phải "xoá hàng số 7".
--
-- Làm trong MỘT lần gọi vì bỏ kênh chính thường kéo theo việc đưa một kênh phụ
-- lên làm kênh chính. Tách thành hai lời gọi phía client sẽ có một khoảng thời
-- gian liên hệ đó không còn kênh chính nào — lúc đó danh bạ hiển thị "chưa có
-- số điện thoại" và lời mời qua SMS bị từ chối, trong khi số vẫn nằm trong
-- bảng kênh phụ.
CREATE OR REPLACE FUNCTION detach_contact_channel(
  p_contact_id uuid,
  p_kind text,
  p_value text
) RETURNS contact
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact  contact%ROWTYPE;
  v_result   contact%ROWTYPE;
  v_norm     text;
  v_primary  text;
  v_holds    boolean;
  v_other    text;
  v_promoted contact_channel%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'Loại kênh phải là phone hoặc email';
  END IF;

  v_norm := private.normalize_channel(p_kind, p_value);
  IF btrim(coalesce(v_norm, '')) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  -- SECURITY DEFINER bỏ qua RLS, nên quyền sở hữu phải tự kiểm: p_contact_id
  -- đến từ client và không được tin. Không có dòng này, một người dọn kênh
  -- dùng chung của mình sẽ xoá được số trong danh bạ của người khác.
  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được sửa kênh liên hệ của liên hệ này';
  END IF;

  v_primary := private.normalize_channel(
    p_kind,
    CASE WHEN p_kind = 'phone' THEN v_contact.phone ELSE v_contact.email END
  );

  v_holds := (v_primary = v_norm) OR EXISTS (
    SELECT 1 FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_norm
  );

  -- Liên hệ này không giữ giá trị đó thì coi như xong, không phải lỗi: dọn một
  -- kênh dùng chung là nhiều lần bỏ liên tiếp, và bấm lại một bước đã xong
  -- không có gì sai để báo.
  IF NOT v_holds THEN
    RETURN v_contact;
  END IF;

  DELETE FROM contact_channel
  WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_norm;

  -- Ô kênh chính vừa trống mà liên hệ còn số khác cùng loại thì số đó lên thay,
  -- theo đúng luật "kênh đầu tiên mỗi loại là kênh chính" mà nhập hàng loạt
  -- đang dùng.
  IF v_primary = v_norm THEN
    SELECT * INTO v_promoted FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind
    ORDER BY created_at, id
    LIMIT 1;

    IF FOUND THEN
      DELETE FROM contact_channel WHERE id = v_promoted.id;
    END IF;

    IF p_kind = 'phone' THEN
      UPDATE contact SET phone = v_promoted.value WHERE id = p_contact_id
      RETURNING * INTO v_contact;
    ELSE
      UPDATE contact SET email = v_promoted.value WHERE id = p_contact_id
      RETURNING * INTO v_contact;
    END IF;
  END IF;

  -- Nếu đến đây mà CẢ HAI ô kênh chính đều trống trong khi liên hệ vẫn còn một
  -- kênh phụ loại khác, thì kênh đó lên thay. Không làm bước này sẽ sinh ra một
  -- liên hệ mà create_contact / update_contact đều coi là không hợp lệ: mọi lần
  -- sửa về sau bị chính chúng từ chối, dù trên màn hình vẫn thấy một email nằm
  -- đó. Chỉ chạm tới ô của loại khác khi nó đang trống, nên không ghi đè gì.
  IF btrim(coalesce(v_contact.phone, '')) = '' AND btrim(coalesce(v_contact.email, '')) = '' THEN
    SELECT * INTO v_promoted FROM contact_channel
    WHERE contact_id = p_contact_id
    ORDER BY created_at, id
    LIMIT 1;

    IF FOUND THEN
      DELETE FROM contact_channel WHERE id = v_promoted.id;

      IF v_promoted.kind = 'phone' THEN
        UPDATE contact SET phone = v_promoted.value WHERE id = p_contact_id
        RETURNING * INTO v_contact;
      ELSE
        UPDATE contact SET email = v_promoted.value WHERE id = p_contact_id
        RETURNING * INTO v_contact;
      END IF;
    END IF;
  END IF;

  -- Đo bằng đúng thước của create_contact / update_contact, không phải bằng
  -- "còn hàng nào trong bảng kênh không". RAISE ở đây cuộn lại toàn bộ những
  -- gì phía trên vừa làm, nên liên hệ không bao giờ ở lại trạng thái nửa vời.
  IF v_contact.contact_type = 'individual' THEN
    IF btrim(coalesce(v_contact.phone, '')) = '' AND btrim(coalesce(v_contact.email, '')) = '' THEN
      RAISE EXCEPTION 'Đây là cách liên lạc duy nhất của liên hệ này, không bỏ được';
    END IF;
  ELSE
    IF btrim(coalesce(v_contact.phone, '')) = ''
       AND btrim(coalesce(v_contact.email, '')) = ''
       AND btrim(coalesce(v_contact.representative_phone, '')) = ''
       AND btrim(coalesce(v_contact.representative_email, '')) = '' THEN
      RAISE EXCEPTION 'Đây là cách liên lạc duy nhất của liên hệ này, không bỏ được';
    END IF;
  END IF;

  SELECT * INTO v_result FROM contact WHERE id = p_contact_id;
  RETURN v_result;
END;
$$;

-- ============ EXECUTE: chỉ authenticated ============
REVOKE ALL ON FUNCTION detach_contact_channel(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION detach_contact_channel(uuid, text, text) TO authenticated;
