-- ============================================================
-- AVORA — Contact Model v2.0 (Prompt B2): RPC preview_contact_invite
-- Bổ sung cho 20260915230601 + 20260916045628.
-- KHÔNG sửa bảng, KHÔNG sửa RLS, KHÔNG sửa accept_invite.
-- ============================================================

-- Xem trước một lời mời liên hệ trước khi quyết định chấp nhận.
--
-- Vì sao cần hàm này: người NHẬN lời mời không đọc được gì về lời mời đó.
-- RLS của contact_invite là `invited_by = auth.uid()` — tức chỉ người GỬI thấy hàng
-- của mình; profiles cũng chỉ cho đọc hàng của chính mình. Nên nếu không có hàm
-- SECURITY DEFINER này, màn hình nhận lời mời không trả lời được cả câu hỏi đơn
-- giản nhất: "ai mời tôi?" — thậm chí "token này có tồn tại không?".
-- Đây đúng là cách preview_group_invite đã giải cho liên kết nhóm.
--
-- Trả 0 hàng khi token không tồn tại (hoặc liên hệ gốc đã bị xoá): "không tìm thấy"
-- là một trạng thái bình thường của một liên kết được gửi qua tin nhắn, không phải
-- lỗi hệ thống — RAISE ở đây sẽ buộc client phải đọc chuỗi lỗi để phân biệt.
--
-- Chỉ trả về tên người mời, KHÔNG trả về tên liên hệ mà người mời đã ghi. Ai giữ
-- token cũng gọi được hàm này, nên mỗi trường trả thêm là một trường bị lộ; màn
-- hình chỉ cần biết ai đang mời.
CREATE OR REPLACE FUNCTION preview_contact_invite(p_token text)
RETURNS TABLE (
  inviter_name   text,
  status         text,
  is_own_invite  boolean,
  already_linked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invite  contact_invite%ROWTYPE;
  v_contact contact%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_invite FROM contact_invite
  WHERE invite_token = nullif(btrim(p_token), '');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_contact FROM contact WHERE id = v_invite.contact_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    coalesce(
      (SELECT p.display_name FROM profiles p WHERE p.id = v_contact.owner_user_id),
      'Một người dùng AVORA'
    ),
    v_invite.status,
    v_invite.invited_by = auth.uid(),
    v_contact.linked_user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION preview_contact_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_contact_invite(text) TO authenticated;
