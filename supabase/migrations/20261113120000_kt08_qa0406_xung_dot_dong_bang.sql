-- KT-08 · QA04-06 (Nặng, AICOS quyết làm trước Gate 2): hai người cùng sửa một dòng bảng thì người lưu sau
-- ghi đè lặng lẽ. Nay: kiểm phiên bản lạc quan theo updated_at.
--
-- update_think_hub_record nhận thêm p_expected_updated_at (mặc định NULL = như cũ, app cũ vẫn chạy).
-- Dòng đã đổi kể từ lúc người dùng mở → lỗi avora_think_hub_record_conflict, DETAIL là JSON
-- {updated_at, by_id, by_name, by_me}; app hỏi "Dòng này vừa được [tên] cập nhật. Xem bản mới / Vẫn lưu của
-- tôi". "Vẫn lưu của tôi" gửi lại với updated_at mới (người dùng đã thấy và chọn ghi đè).
-- Bỏ bản 2 tham số để PostgREST không gặp hai hàm trùng tên (gọi 2 tham số vẫn khớp nhờ DEFAULT).
-- Áp lại được (idempotent).

drop function if exists public.update_think_hub_record(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.update_think_hub_record(p_record_id uuid, p_patch jsonb, p_expected_updated_at timestamptz DEFAULT NULL)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
  v_key  text;
  v_by   uuid;
  v_name text;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'avora_think_hub_patch_shape';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'title', 'status', 'priority', 'category',
      'next_action_date', 'tags', 'notes', 'extension_fields', 'remind_at'
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_patch_field';
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM think_hub_record WHERE id = p_record_id;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_row.table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_deleted';
  END IF;

  IF p_patch ? 'priority'
     AND coalesce(p_patch->>'priority', '') NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  -- AVORA-69: `Nhắc tôi xem lại` is the caller's own, never the row's (and never blocked by Chỉ xem).
  IF p_patch ? 'remind_at' THEN
    IF nullif(btrim(coalesce(p_patch->>'remind_at', '')), '') IS NULL THEN
      DELETE FROM think_hub_record_reminders WHERE record_id = p_record_id AND user_id = v_user;
    ELSE
      INSERT INTO think_hub_record_reminders (record_id, user_id, remind_at)
      VALUES (p_record_id, v_user, (p_patch->>'remind_at')::timestamptz)
      ON CONFLICT (record_id, user_id) DO UPDATE SET remind_at = excluded.remind_at, updated_at = now();
    END IF;
    p_patch := p_patch - 'remind_at';
    IF p_patch = '{}'::jsonb THEN
      RETURN v_row;
    END IF;
  END IF;

  -- KT-08 · QA04-06: optimistic check. The caller sends the updated_at it started editing from; a row
  -- that changed since is not overwritten silently — the caller gets who changed it and when, and decides.
  -- NULL (older clients, personal quick edits) keeps the previous behaviour.
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    SELECT l.actor_id INTO v_by FROM think_hub_change_log l
     WHERE l.record_id = p_record_id AND l.kind IN ('record_edit', 'record_add')
     ORDER BY l.created_at DESC LIMIT 1;
    IF v_by IS NULL AND array_length(v_row.editor_ids, 1) > 0 THEN
      v_by := v_row.editor_ids[array_length(v_row.editor_ids, 1)];
    END IF;
    SELECT nullif(btrim(p.display_name), '') INTO v_name FROM profiles p WHERE p.id = v_by;
    RAISE EXCEPTION 'avora_think_hub_record_conflict' USING DETAIL = jsonb_build_object(
      'updated_at', v_row.updated_at,
      'by_id', v_by,
      'by_name', v_name,
      'by_me', v_by IS NOT DISTINCT FROM v_user
    )::text;
  END IF;

  UPDATE think_hub_record SET
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
      THEN coalesce(p_patch->'extension_fields', '{}'::jsonb) ELSE extension_fields END,
    remind_at = NULL
  WHERE id = p_record_id
    -- Two saves at the same instant: the second waits for the first's row lock, then sees a new
    -- updated_at and matches nothing (READ COMMITTED re-check) — it becomes a conflict, not an overwrite.
    AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM think_hub_record WHERE id = p_record_id;
    RAISE EXCEPTION 'avora_think_hub_record_conflict' USING DETAIL = jsonb_build_object(
      'updated_at', v_row.updated_at, 'by_id', null, 'by_name', null, 'by_me', false)::text;
  END IF;

  RETURN v_row;
END;
$function$;

revoke all on function public.update_think_hub_record(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.update_think_hub_record(uuid, jsonb, timestamptz) to authenticated;
