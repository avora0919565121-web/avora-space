-- ============================================================
-- AVORA — Contact Model v2.0: hạn 14 ngày cho lời mời liên hệ
-- Bổ sung cho 20260915230601 + 20260916045628 + 20260916061500.
-- ============================================================

-- Một lời mời còn 'pending' nhưng đã quá 14 ngày thì coi như hết hạn.
--
-- Cả accept_invite và preview_contact_invite đều đã có nhánh cho status='expired'
-- từ trước, nhưng chưa có gì đặt giá trị đó — nên trên thực tế không lời mời nào
-- tự hết hạn. Hàm này là chỗ duy nhất định nghĩa "quá hạn", để hai hàm kia không
-- thể trôi lệch nhau: một liên kết mà màn hình nhận nói đã hết hạn thì accept_invite
-- cũng phải từ chối, và ngược lại.
--
-- Tính lúc đọc thay vì UPDATE: hết hạn là một suy ra từ invited_at, không phải một
-- sự kiện có người gây ra. Nếu ghi, thì mỗi lần MỞ một liên kết cũ sẽ là một lần
-- ghi vào bảng — và nếu không ai mở, hàng đó vẫn mãi là 'pending' dù đã quá hạn,
-- tức là cùng một hàng có hai nghĩa tuỳ vào việc đã có ai ghé qua hay chưa.
-- Không cần pg_cron: không có gì phải chạy định kỳ khi câu trả lời luôn tính được.
CREATE OR REPLACE FUNCTION contact_invite_timed_out(p_status text, p_invited_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p_status = 'pending' AND now() - p_invited_at > interval '14 days';
$$;

REVOKE ALL ON FUNCTION contact_invite_timed_out(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION contact_invite_timed_out(text, timestamptz) TO authenticated;

-- Xem trước lời mời — nay báo 'expired' cho cả lời mời quá 14 ngày, để màn hình nhận
-- nói "đã hết hạn" chứ không lẫn sang "không tồn tại" (hai việc khác nhau: một cái
-- từng có thật và người mời gửi lại được, một cái thì chưa bao giờ có).
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
  v_status  text;
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

  v_status := CASE
    WHEN contact_invite_timed_out(v_invite.status, v_invite.invited_at) THEN 'expired'
    ELSE v_invite.status
  END;

  RETURN QUERY
  SELECT
    coalesce(
      (SELECT p.display_name FROM profiles p WHERE p.id = v_contact.owner_user_id),
      'Một người dùng AVORA'
    ),
    v_status,
    v_invite.invited_by = auth.uid(),
    v_contact.linked_user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION preview_contact_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_contact_invite(text) TO authenticated;

-- Chấp nhận lời mời — thêm đúng một nhánh: quá 14 ngày thì từ chối bằng cùng câu
-- 'Lời mời đã hết hạn' mà nhánh status='expired' vẫn dùng, nên client không phải
-- phân biệt "hết hạn vì quá ngày" với "hết hạn vì bị đánh dấu". Mọi luật khác giữ
-- nguyên y như trước.
CREATE OR REPLACE FUNCTION accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invite  contact_invite%ROWTYPE;
  v_contact contact%ROWTYPE;
  v_inviter_name text;
  v_reciprocal_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_invite FROM contact_invite
  WHERE invite_token = nullif(btrim(p_token), '');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
  END IF;
  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'Lời mời này đã được chấp nhận';
  END IF;
  IF v_invite.status = 'expired' THEN
    RAISE EXCEPTION 'Lời mời đã hết hạn';
  END IF;
  IF contact_invite_timed_out(v_invite.status, v_invite.invited_at) THEN
    RAISE EXCEPTION 'Lời mời đã hết hạn';
  END IF;
  IF v_invite.invited_by = auth.uid() THEN
    RAISE EXCEPTION 'Không thể tự chấp nhận lời mời của chính mình';
  END IF;

  SELECT * INTO v_contact FROM contact WHERE id = v_invite.contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liên hệ gốc không còn tồn tại';
  END IF;
  IF v_contact.linked_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Hai tài khoản đã liên kết với nhau từ trước';
  END IF;
  IF v_contact.linked_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Người này đã liên kết với một tài khoản khác';
  END IF;

  SELECT display_name INTO v_inviter_name FROM profiles WHERE id = v_contact.owner_user_id;

  UPDATE contact_invite
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invite.id;

  UPDATE contact
  SET linked_user_id = auth.uid(), updated_at = now()
  WHERE id = v_contact.id;

  INSERT INTO contact (
    owner_user_id, contact_type, name, phone, email, note, linked_user_id
  ) VALUES (
    auth.uid(), 'individual',
    coalesce(v_inviter_name, v_contact.name),
    v_contact.phone, v_contact.email, v_contact.note,
    v_contact.owner_user_id
  )
  RETURNING id INTO v_reciprocal_id;

  RETURN v_reciprocal_id;
END;
$$;

REVOKE ALL ON FUNCTION accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;
