-- AVORA 20 / Phần 6 — Sub-group tối đa 3 tầng (ADR-007, mô hình AF0-AF1-AF2).
--
-- `related_group_id` giữ nguyên nghĩa cũ: trên cuộc 1-1, nó ghi nhóm mà tin nhắn riêng được mở từ đó.
-- Quan hệ cha-con của Nhóm dùng cột riêng `parent_group_id`, chỉ có trên Nhóm.
-- Quyền không lan theo cây (ADR-014): Owner nhóm cha không tự có quyền gì ở nhóm con.

ALTER TABLE public.conversations
  ADD COLUMN parent_group_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN group_depth smallint NOT NULL DEFAULT 1;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_group_depth_range CHECK (group_depth BETWEEN 1 AND 3),
  ADD CONSTRAINT conversations_parent_group_only CHECK (parent_group_id IS NULL OR type = 'group'),
  ADD CONSTRAINT conversations_parent_not_self CHECK (parent_group_id IS DISTINCT FROM id);

CREATE INDEX idx_conversations_parent_group ON public.conversations (parent_group_id) WHERE parent_group_id IS NOT NULL;

CREATE FUNCTION private.enforce_group_depth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parent conversations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Nhóm cha bị xoá (ON DELETE SET NULL) thì nhóm con đứng riêng nhưng giữ nguyên tầng: không đổi
    -- tầng ngầm, và không gắn lại vào cây khác.
    IF NEW.parent_group_id IS NOT NULL AND NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id THEN
      RAISE EXCEPTION 'avora_group_parent_immutable';
    END IF;
    IF NEW.group_depth <> OLD.group_depth THEN
      RAISE EXCEPTION 'avora_group_parent_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_group_id IS NULL THEN
    NEW.group_depth := 1;
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent FROM conversations WHERE id = NEW.parent_group_id;
  IF NOT FOUND OR v_parent.type <> 'group' OR v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_group_parent_invalid';
  END IF;
  IF v_parent.group_depth >= 3 THEN
    RAISE EXCEPTION 'avora_group_depth_limit';
  END IF;
  NEW.group_depth := v_parent.group_depth + 1;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enforce_group_depth() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversations_enforce_group_depth
  BEFORE INSERT OR UPDATE OF parent_group_id, group_depth ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_group_depth();

-- Owner hoặc Admin của nhóm cha mở nhóm con; người mở tự là Owner nhóm con.
-- Thành viên được mời phải đang ở trong nhóm cha — nhóm con là một phần của đội, không phải cửa sau
-- để kéo người lạ vào.
CREATE FUNCTION public.create_sub_group(
  p_parent_group_id uuid,
  p_name text,
  p_member_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_parent conversations%ROWTYPE;
  v_role text;
  v_id uuid;
  m uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'avora_group_name_required'; END IF;
  IF char_length(v_name) > 120 THEN RAISE EXCEPTION 'avora_group_name_max_len'; END IF;

  SELECT * INTO v_parent FROM conversations WHERE id = p_parent_group_id;
  IF NOT FOUND OR v_parent.type <> 'group' OR v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_group_parent_invalid';
  END IF;

  SELECT role INTO v_role FROM conversation_participants
  WHERE conversation_id = p_parent_group_id AND user_id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'avora_not_a_participant'; END IF;
  IF v_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'avora_group_sub_not_allowed'; END IF;

  IF v_parent.group_depth >= 3 THEN
    RAISE EXCEPTION 'avora_group_depth_limit';
  END IF;

  INSERT INTO conversations (type, parent_group_id) VALUES ('group', p_parent_group_id) RETURNING id INTO v_id;
  INSERT INTO conversation_groups (conversation_id, name, owner_id) VALUES (v_id, v_name, v_uid);
  INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (v_id, v_uid, 'owner')
    ON CONFLICT DO NOTHING;

  FOREACH m IN ARRAY coalesce(p_member_ids, '{}'::uuid[]) LOOP
    IF m <> v_uid THEN
      IF NOT private.is_conversation_participant(p_parent_group_id, m) THEN
        RAISE EXCEPTION 'avora_group_sub_member_outside';
      END IF;
      INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (v_id, m, 'member')
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_sub_group(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sub_group(uuid, text, uuid[]) TO authenticated;
