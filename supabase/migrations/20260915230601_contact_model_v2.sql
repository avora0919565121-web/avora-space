-- ============================================================
-- AVORA — Contact Model v2.0 (Prompt A): contact + contact_invite
-- Tạo mới hoàn toàn. Không đụng Finance (transactions/accounts/categories).
-- Model auth: native Supabase (auth.uid()), khớp toàn bộ schema hiện có.
-- ============================================================

-- ============ Bảng contact ============
CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('individual', 'business')),
  name text NOT NULL,
  phone text,
  email text,
  note text,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  employer_contact_id uuid REFERENCES contact(id) ON DELETE SET NULL,
  date_of_birth date,
  relationship_tag text,
  tax_code text,
  business_address text,
  representative_name text,
  representative_phone text,
  representative_email text,
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_owner ON contact(owner_user_id);

CREATE FUNCTION private.touch_contact_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_touch_updated_at
  BEFORE UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION private.touch_contact_updated_at();

-- ============ Trigger ràng buộc dữ liệu trên contact ============
-- CHECK không query được bảng khác nên validation chạy qua trigger.
-- SECURITY DEFINER: cần đọc được contact của người khác (employer có thể là
-- contact doanh nghiệp của người khác) — bypass RLS chỉ để ĐỌC + chặn, không ghi.
CREATE FUNCTION private.validate_contact() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_type text;
BEGIN
  IF NEW.employer_contact_id IS NOT NULL THEN
    IF NEW.contact_type <> 'individual' THEN
      RAISE EXCEPTION 'employer_contact_id chỉ được đặt trên contact cá nhân (individual)';
    END IF;
    SELECT contact_type INTO v_target_type FROM contact WHERE id = NEW.employer_contact_id;
    IF v_target_type IS NULL THEN
      RAISE EXCEPTION 'employer_contact_id trỏ tới contact không tồn tại';
    END IF;
    IF v_target_type <> 'business' THEN
      RAISE EXCEPTION 'employer_contact_id chỉ được trỏ tới contact doanh nghiệp (business)';
    END IF;
  END IF;

  IF NEW.linked_user_id IS NOT NULL AND NEW.contact_type <> 'individual' THEN
    RAISE EXCEPTION 'linked_user_id chỉ được đặt trên contact cá nhân (individual)';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_validate
  BEFORE INSERT OR UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION private.validate_contact();

-- ============ Bảng contact_invite ============
CREATE TABLE contact_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('sms', 'email', 'link', 'qr')),
  invite_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE INDEX idx_contact_invite_contact ON contact_invite(contact_id);

-- Lời mời chỉ tồn tại cho contact cá nhân, do đúng chủ contact tạo.
-- (CREATE thông qua bảng trực tiếp cũng bị chặn, không chỉ qua RPC.)
CREATE FUNCTION private.validate_contact_invite() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_type text;
BEGIN
  SELECT owner_user_id, contact_type INTO v_owner, v_type FROM contact WHERE id = NEW.contact_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'contact không tồn tại';
  END IF;
  IF v_type <> 'individual' THEN
    RAISE EXCEPTION 'Chỉ contact cá nhân (individual) mới nhận được lời mời liên kết';
  END IF;
  IF v_owner <> NEW.invited_by THEN
    RAISE EXCEPTION 'Chỉ chủ contact mới được tạo lời mời cho contact đó';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_invite_validate
  BEFORE INSERT ON contact_invite
  FOR EACH ROW EXECUTE FUNCTION private.validate_contact_invite();

-- ============ RLS ============
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_select_own ON contact
  FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY contact_insert_own ON contact
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY contact_update_own ON contact
  FOR UPDATE USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY contact_delete_own ON contact
  FOR DELETE USING (owner_user_id = auth.uid());

ALTER TABLE contact_invite ENABLE ROW LEVEL SECURITY;

-- Chỉ SELECT/INSERT của chính người mời. KHÔNG có policy UPDATE/DELETE:
-- chấp nhận lời mời đi duy nhất qua RPC accept_invite, bảng không cho sửa tay.
CREATE POLICY contact_invite_select_own ON contact_invite
  FOR SELECT USING (invited_by = auth.uid());
CREATE POLICY contact_invite_insert_own ON contact_invite
  FOR INSERT WITH CHECK (invited_by = auth.uid());

-- ============ GRANT khớp đúng RLS, không thừa vế ============
REVOKE ALL ON contact FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact TO authenticated;

REVOKE ALL ON contact_invite FROM anon, authenticated;
-- Không GRANT UPDATE/DELETE: status chỉ đổi qua RPC, người khác không sửa tay được.
GRANT SELECT, INSERT ON contact_invite TO authenticated;

-- ============ RPC create_contact ============
-- Nơi validate DUY NHẤT có hiệu lực. owner lấy từ auth.uid(), không nhận từ client.
CREATE FUNCTION create_contact(
  p_contact_type text,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_relationship_tag text DEFAULT NULL,
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
  v_contact_row contact%ROWTYPE;
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

  IF p_contact_type NOT IN ('individual', 'business') THEN
    RAISE EXCEPTION 'Loại liên hệ phải là individual hoặc business';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Tên liên hệ không được để trống';
  END IF;

  IF p_contact_type = 'individual' THEN
    IF v_phone IS NULL AND v_email IS NULL THEN
      RAISE EXCEPTION 'Liên hệ cá nhân cần ít nhất số điện thoại hoặc email';
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

  INSERT INTO contact (
    owner_user_id, contact_type, name, phone, email, note,
    date_of_birth, relationship_tag,
    tax_code, business_address, representative_name,
    representative_phone, representative_email, industry
  ) VALUES (
    auth.uid(), p_contact_type, v_name, v_phone, v_email, p_note,
    p_date_of_birth, p_relationship_tag,
    v_tax, p_business_address, v_rep,
    v_rep_ph, v_rep_em, p_industry
  )
  RETURNING * INTO v_contact_row;

  RETURN v_contact_row;
END;
$$;

-- ============ RPC create_contact_invite ============
CREATE FUNCTION create_contact_invite(
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
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_method NOT IN ('sms', 'email', 'link', 'qr') THEN
    RAISE EXCEPTION 'Cách mời phải là sms, email, link hoặc qr';
  END IF;

  SELECT owner_user_id, contact_type INTO v_owner, v_type
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

  v_token := gen_random_uuid()::text;

  INSERT INTO contact_invite (contact_id, invited_by, method, invite_token)
  VALUES (p_contact_id, auth.uid(), p_method, v_token);

  RETURN v_token;
END;
$$;

-- ============ RPC accept_invite ============
-- Người chấp nhận KHÔNG sở hữu invite nên phải SECURITY DEFINER. Làm 3 việc:
-- 1) invite.status = 'accepted'; 2) contact gốc.linked_user_id = người accept;
-- 3) tạo contact ngược phía người accept, trỏ lại người mời (reciprocal, docs/17).
CREATE FUNCTION accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- ============ EXECUTE: chỉ authenticated, không PUBLIC, không anon ============
REVOKE ALL ON FUNCTION private.touch_contact_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.validate_contact() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.validate_contact_invite() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION create_contact(text, text, text, text, text, date, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_contact_invite(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_contact(text, text, text, text, text, date, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_contact_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;
