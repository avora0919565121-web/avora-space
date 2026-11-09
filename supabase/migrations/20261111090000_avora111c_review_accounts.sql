-- 111-C · Tài khoản demo cho người duyệt (Apple 2.1(a), Google Play). ADR-094.
-- Mọi ngoại lệ đi qua MỘT hàm: private.is_review_account(uid). Tìm tên hàm này để thấy hết.
--   1. Khoá thiết bị không chặn (người duyệt mở trên máy AVORA chưa từng thấy).        → session_device_ok, device_status
--   2. Két sắt mở được trên máy chưa xếp Ưu tiên.                                      → vault_device_allowed
--   3. Không bị chặn vì thiếu mã mời (invite_required).                                 → invite_blocks
--   4. Xoá tài khoản thực thi trong ≤ 5 phút: chờ 0, gọi thực thi ngay khi gửi yêu cầu,
--      và một lịch riêng mỗi 5 phút chỉ cho tài khoản demo. Lịch chung '37 * * * *' giữ nguyên. → account_deletion_grace
-- Chưa có trong mã nên chưa cần ngoại lệ: thống kê đăng ký cho chủ, chính sách "nhà hoang".
-- Đăng nhập bằng mật khẩu không có bước OTP/SMS bắt buộc; thư "có máy mới đăng nhập" chỉ là báo tin.

-- ------------------------------------------------------------------ 0. Sửa 111-A: xoá tài khoản kẹt khi người đó là chủ bảng nhóm / dự án
-- account_purge đổi think_hub_table.owner_user_id sang người kế, nhưng trigger validate_think_hub_table cấm
-- mọi lần đổi chủ (avora_think_hub_table_scope_immutable) → yêu cầu xoá đến hạn mà không xoá được, cron thử lại mãi.
-- Cách sửa: account_purge bật cờ phiên `avora.account_purge` (chỉ trong giao dịch xoá); trigger cho phép đổi CHỦ
-- khi cờ bật, mọi thứ khác về nơi chốn của bảng vẫn bất biến.
-- Lỗi thứ hai cùng chỗ: người có giao dịch Tài chính không xoá được auth.users (danh mục xoá dây chuyền bị
-- block_category_hard_delete chặn: avora_category_in_use). account_purge xoá giao dịch riêng trước.
-- Cờ này được 5 trigger tôn trọng (chỉ cho đổi người sở hữu / người viết, không đổi nơi chốn hay nội dung):
-- validate_think_hub_table, validate_think_hub_record, enforce_decision_immutable, validate_project_task, block_archived_record.
-- Khi auth.users bị xoá (giao dịch của GoTrue): phiếu biểu quyết (enforce_decision_vote_rules) và cơ hội gắn danh bạ
-- (contact_removed_opportunities) cho đi theo nếu người đó không còn trong auth.users.
-- Biểu quyết và phiếu bầu cũng đi theo khi nhóm cha bị xoá dây chuyền.
-- Bài kiểm: avora111c_purge_fixes.sql (17 tình huống) và avora111c_review.sql mục 10b.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'account_purge_core') then
    alter function private.account_purge(uuid, text) rename to account_purge_core;
  end if;
end $$;
revoke all on function private.account_purge_core(uuid, text) from public, anon, authenticated;

create or replace function private.account_purge(p_uid uuid, p_reason text default 'self')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform set_config('avora.account_purge', 'on', true);
  v_result := private.account_purge_core(p_uid, p_reason);
  -- Giao dịch riêng phải đi trước: khi auth.users bị xoá, danh mục (categories) xoá dây chuyền bị
  -- trigger block_category_hard_delete chặn nếu còn giao dịch trỏ tới (avora_category_in_use).
  if coalesce((v_result ->> 'ok')::boolean, false) and coalesce((v_result ->> 'already')::boolean, false) = false then
    delete from public.transactions where user_id = p_uid;
  end if;
  perform set_config('avora.account_purge', '', true);
  return v_result;
end $$;
revoke all on function private.account_purge(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validate_think_hub_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_parent_table think_hub_table%ROWTYPE;
  v_conv_type text;
BEGIN
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  PERFORM private.validate_column_defs(NEW.column_defs);

  IF jsonb_array_length(NEW.column_defs) > 24 THEN
    RAISE EXCEPTION 'avora_think_hub_column_limit';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- 111-C (sửa 111-A): khi xoá tài khoản, account_purge chuyển chủ bảng nhóm / dự án cho người kế.
    -- Chỉ đổi chủ; nơi bảng thuộc về (dự án, cuộc, bản ghi cha, độ sâu) phải giữ nguyên.
    IF coalesce(current_setting('avora.account_purge', true), '') = 'on'
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
       AND NEW.parent_record_id IS NOT DISTINCT FROM OLD.parent_record_id
       AND NEW.depth = OLD.depth THEN
      RETURN NEW;
    END IF;
    -- AVORA-69: only move_board_tree changes where a board lives (it checks the destination itself).
    IF coalesce(current_setting('avora.board_move', true), '') = 'on' THEN
      IF NEW.owner_user_id <> OLD.owner_user_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.parent_record_id IS DISTINCT FROM OLD.parent_record_id OR NEW.depth <> OLD.depth THEN
        RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.owner_user_id <> OLD.owner_user_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       OR NEW.parent_record_id IS DISTINCT FROM OLD.parent_record_id
       OR NEW.depth <> OLD.depth THEN
      RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
    END IF;
    -- AVORA-61 · E: only delete_think_hub_column / change_think_hub_column_type may drop a
    -- column or change its kind (they keep the values in the board's bin / convert them safely).
    IF coalesce(current_setting('avora.column_reshape', true), '') <> 'on' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.column_defs) o
      WHERE o ? 'id' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.column_defs) n
        WHERE n->>'id' = o->>'id' AND n->>'key' = o->>'key' AND n->>'type' = o->>'type'
      )
    ) THEN
      RAISE EXCEPTION 'avora_think_hub_column_id_immutable';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
      RAISE EXCEPTION 'avora_project_closed';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_record_id IS NOT NULL THEN
    SELECT t.* INTO v_parent_table
    FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
    WHERE r.id = NEW.parent_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'avora_think_hub_record_not_yours';
    END IF;
    IF v_parent_table.depth >= 3 THEN
      RAISE EXCEPTION 'avora_think_hub_depth_limit';
    END IF;
    NEW.depth := v_parent_table.depth + 1;
    NEW.project_id := v_parent_table.project_id;
    NEW.conversation_id := v_parent_table.conversation_id;
    NEW.share_mode := v_parent_table.share_mode;
    IF NEW.project_id IS NULL AND NEW.conversation_id IS NULL
       AND NEW.owner_user_id <> v_parent_table.owner_user_id THEN
      RAISE EXCEPTION 'avora_think_hub_table_not_yours';
    END IF;
  ELSE
    NEW.depth := 1;
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT private.project_is_open(NEW.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = NEW.conversation_id;
    IF v_conv_type IS NULL OR v_conv_type NOT IN ('direct', 'group') THEN
      RAISE EXCEPTION 'avora_think_hub_scope_invalid';
    END IF;
  END IF;

  IF NOT private.think_hub_scope_visible(NEW.owner_user_id, NEW.conversation_id, NEW.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;

  RETURN NEW;
END;
$function$;

-- Cùng cờ cho bản ghi bảng, biên bản họp / biểu quyết (kể cả đã chốt) và liên kết việc–dự án:
CREATE OR REPLACE FUNCTION private.validate_think_hub_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table think_hub_table%ROWTYPE;
BEGIN
  IF btrim(coalesce(NEW.title, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;
  IF btrim(coalesce(NEW.status, '')) = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_status_required';
  END IF;
  -- 111-C (sửa 111-A): account_purge chuyển chủ bản ghi cho người kế; chỉ đổi chủ, bản ghi vẫn ở bảng cũ.
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('avora.account_purge', true), '') = 'on'
     AND NEW.table_id = OLD.table_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_id <> OLD.table_id
     AND coalesce(current_setting('avora.record_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_think_hub_table_scope_immutable';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = NEW.table_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  -- AVORA-69: a board shared `Chỉ xem` is changed by its owner only (server-side, whatever the client shows).
  IF auth.uid() IS NOT NULL AND v_table.share_mode = 'view' AND auth.uid() <> v_table.owner_user_id
     AND coalesce(current_setting('avora.board_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_think_hub_view_only';
  END IF;
  IF v_table.project_id IS NOT NULL AND NOT private.project_is_open(v_table.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.table_id <> OLD.table_id)
     AND NOT private.think_hub_scope_visible(v_table.owner_user_id, v_table.conversation_id, v_table.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF NEW.tags IS NULL OR array_position(NEW.tags, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_tags_shape';
  END IF;
  PERFORM private.validate_extension_values(v_table.column_defs, NEW.extension_fields);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_decision_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Settling is the one transition allowed into the frozen state; everything after it is refused.
  if tg_op = 'DELETE' then
    -- 111-C (sửa 111-A): nhóm bị xoá khi xoá tài khoản (chuỗi CASCADE, nhóm đã đi trước) → biểu quyết đi theo.
    if old.status in ('finalized', 'closed')
       and coalesce(current_setting('avora.account_purge', true), '') <> 'on'
       and exists (select 1 from public.conversations c where c.id = old.conversation_id) then
      raise exception 'avora_decision_settled_immutable';
    end if;
    return old;
  end if;

  -- 111-C (sửa 111-A): khi xoá tài khoản, account_purge chỉ đổi người viết sang người kế; nội dung đã chốt giữ nguyên.
  if tg_op = 'UPDATE' and coalesce(current_setting('avora.account_purge', true), '') = 'on'
     and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at') then
    return new;
  end if;

  if old.status = 'finalized' then
    raise exception 'avora_decision_settled_immutable';
  end if;

  if old.status = 'closed' then
    raise exception 'avora_decision_settled_immutable';
  end if;

  -- A row may not change what kind of thing it is, nor who wrote it, nor when.
  if new.kind <> old.kind or new.conversation_id <> old.conversation_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'avora_decision_identity_immutable';
  end if;

  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.validate_project_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_conversation uuid;
  v_task_conversation uuid;
  v_record_project uuid;
BEGIN
  -- 111-C (sửa 111-A): account_purge chỉ đổi người liên kết (linked_by), kể cả ở dự án đã đóng.
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('avora.account_purge', true), '') = 'on'
     AND NEW.project_id = OLD.project_id AND NEW.task_id = OLD.task_id AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id THEN
    RETURN NEW;
  END IF;
  SELECT conversation_id INTO v_project_conversation FROM projects WHERE id = NEW.project_id;
  IF v_project_conversation IS NULL THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;
  IF NOT private.project_is_open(NEW.project_id) THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  SELECT conversation_id INTO v_task_conversation FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_task_missing';
  END IF;
  IF v_task_conversation IS DISTINCT FROM v_project_conversation
     AND v_task_conversation IS DISTINCT FROM (SELECT parent_group_id FROM conversations WHERE id = v_project_conversation) THEN
    RAISE EXCEPTION 'avora_project_task_foreign_conversation';
  END IF;

  IF NEW.record_id IS NOT NULL THEN
    SELECT t.project_id INTO v_record_project
    FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
    WHERE r.id = NEW.record_id AND r.deleted_at IS NULL;
    IF v_record_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'avora_project_record_foreign';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.block_archived_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- 111-C (sửa 111-A): bảng đã lưu trữ vẫn cho account_purge đổi người viết (cùng bảng).
  if tg_op = 'UPDATE' and coalesce(current_setting('avora.account_purge', true), '') = 'on'
     and new.table_id = old.table_id then
    return new;
  end if;
  if private.think_hub_table_archived(new.table_id) then raise exception 'avora_table_archived'; end if;
  return new;
end $function$;

-- Hai trigger chặn chuỗi CASCADE khi Edge Function xoá auth.users (giao dịch riêng của GoTrue, không có cờ):
CREATE OR REPLACE FUNCTION public.enforce_decision_vote_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if private.decision_is_settled(new.decision_id) then
      raise exception 'avora_decision_poll_closed';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Closed is closed: the tally is public by then, so a late change would rewrite a
    -- published result.
    if private.decision_is_settled(new.decision_id) then
      raise exception 'avora_decision_poll_closed';
    end if;
    -- Only the choice may move. Whose ballot it is and which poll it belongs to are not
    -- editable facts, and neither is when they first answered.
    if new.decision_id <> old.decision_id
       or new.voter_id <> old.voter_id
       or new.created_at <> old.created_at then
      raise exception 'avora_decision_vote_immutable';
    end if;
    return new;
  end if;

  -- DELETE
  -- 111-C (sửa 111-A): người bỏ phiếu xoá tài khoản → phiếu của họ đi theo (khoá ngoại CASCADE từ auth.users).
  -- Biểu quyết cha bị xoá theo nhóm (chuỗi CASCADE) → phiếu đi theo.
  if not exists (select 1 from auth.users u where u.id = old.voter_id)
     or not exists (select 1 from public.group_decisions d where d.id = old.decision_id) then
    return old;
  end if;
  raise exception 'avora_decision_vote_immutable';
end
$function$;

CREATE OR REPLACE FUNCTION private.contact_removed_opportunities()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 111-C (sửa 111-A): chủ danh bạ đang bị xoá (auth.users đã đi trước trong chuỗi CASCADE) → cơ hội cũng sắp
  -- bị xoá theo; cập nhật lúc này vi phạm khoá ngoại owner_user_id.
  if not exists (select 1 from auth.users u where u.id = old.owner_user_id) then
    return old;
  end if;
  update public.crm_opportunity set removed_at = coalesce(removed_at, now()),
    contact_snapshot = jsonb_build_object('name', old.name)
  where contact_id = old.id;
  return old;
end $function$;

-- ------------------------------------------------------------------ 1. Bảng + hàm duy nhất
create table if not exists private.review_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now()
);
revoke all on private.review_accounts from public, anon, authenticated;

-- Dữ liệu mẫu đã gieo (để gieo lại thì xoá đúng phần đã gieo, không đụng dữ liệu khác).
create table if not exists private.review_seed_rows (
  reviewer uuid not null,
  kind text not null,
  id uuid not null,
  created_at timestamptz not null default now(),
  primary key (reviewer, kind, id)
);
revoke all on private.review_seed_rows from public, anon, authenticated;

create or replace function private.is_review_account(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (select 1 from private.review_accounts r where r.user_id = p_uid)
$$;
revoke all on function private.is_review_account(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. Ngoại lệ (bản sao hàm hiện có + một dòng)
CREATE OR REPLACE FUNCTION private.session_device_ok()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_sid uuid;
  v_dev public.account_devices%rowtype;
  v_lock public.account_device_lock%rowtype;
begin
  if v_uid is null then
    -- No user: only the system itself (cron, service_role, migrations) — never anon (S12).
    return v_role = 'service_role' or (v_role = '' and session_user not in ('authenticator', 'anon', 'authenticated'));
  end if;
  -- AVORA-100 · G.3: an account made after the code became required, without one, sees nothing.
  if private.invite_blocks(v_uid) then
    return false;
  end if;
  v_sid := private.current_session_id();
  if v_sid is not null and exists (select 1 from private.blocked_sessions where session_id = v_sid) then
    return false;
  end if;
  if v_sid is not null then
    select * into v_dev from public.account_devices where user_id = v_uid and session_id = v_sid limit 1;
  end if;
  if v_dev.id is not null and (v_dev.revoked_at is not null or v_dev.lost_status in ('pending', 'confirmed')) then
    return false;
  end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_lock.user_id is null then
    return true; -- Not locked: an unbound session still works (nobody breaks on rollout day).
  end if;
  -- 111-C: a review (demo) account is opened by the store reviewer on a device AVORA has never seen.
  if private.is_review_account(v_uid) then return true; end if;
  if v_dev.id is null then return false; end if;
  if v_lock.locked_rank = 1 then return v_dev.rank = 1; end if;
  return v_dev.rank in (1, 2);
end $function$;

CREATE OR REPLACE FUNCTION private.invite_blocks(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 111-C: the review check runs only when the account would otherwise be blocked (hot path: session_device_ok).
  select case
    when coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'invite_required'), false)
     and exists (
       select 1 from public.profiles p
        where p.id = p_uid and p.invite_code is null
          and p.created_at >= coalesce(
            (select (c.value #>> '{}')::timestamptz from public.app_config c where c.key = 'invite_required_since'),
            'infinity'::timestamptz))
    then not private.is_review_account(p_uid)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION private.vault_device_allowed(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_review_account(p_uid) or not (
    exists (select 1 from public.account_devices d where d.user_id = p_uid and d.rank in (1, 2) and d.revoked_at is null)
    and not coalesce((select p.vault_other_devices_allowed from public.profiles p where p.id = p_uid), false)
    and not exists (
      select 1 from public.account_devices me
      where me.user_id = p_uid and me.session_id = private.current_session_id()
        and private.current_session_id() is not null and me.rank in (1, 2) and me.revoked_at is null
    )
  )
$function$;

-- Màn chặn khoá thiết bị phía app đọc device_status: cùng ngoại lệ với session_device_ok.
CREATE OR REPLACE FUNCTION public.device_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_sid uuid := private.current_session_id();
  v_dev public.account_devices%rowtype; v_lock public.account_device_lock%rowtype;
  v_reason text; v_by text; v_lock_dev public.account_devices%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_sid is not null then
    select * into v_dev from public.account_devices where user_id = v_uid and session_id = v_sid limit 1;
  end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_dev.lost_status = 'pending' then
    v_reason := 'lost';
    select label into v_by from public.account_devices where id = v_dev.lost_reported_by_device;
  elsif v_dev.revoked_at is not null or v_dev.lost_status = 'confirmed'
        or (v_sid is not null and exists (select 1 from private.blocked_sessions where session_id = v_sid)) then
    v_reason := 'revoked';
  elsif v_lock.user_id is not null and not private.is_review_account(v_uid) and (v_dev.id is null or (v_lock.locked_rank = 1 and v_dev.rank <> 1) or (v_lock.locked_rank = 2 and v_dev.rank = 3)) then
    v_reason := 'locked';
    -- `lock_attempt`: the locking device hears about it, at most once every 10 minutes.
    if not exists (select 1 from private.device_alarm_log where user_id = v_uid and kind = 'lock_attempt' and sent_at > now() - interval '10 minutes') then
      insert into private.device_alarm_log (user_id, kind) values (v_uid, 'lock_attempt');
      perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_attempt', 'label', coalesce(v_dev.label, 'Một máy chưa xác nhận')),
        'Có người vừa thử vào tài khoản đang khoá thiết bị (' || coalesce(v_dev.label, 'máy chưa xác nhận') || ').');
    end if;
  end if;
  if v_reason is null and v_dev.id is not null then
    update public.account_devices set last_seen_at = now() where id = v_dev.id and last_seen_at < now() - interval '5 minutes';
  end if;
  if v_lock.user_id is not null then select * into v_lock_dev from public.account_devices where id = v_lock.locked_by_device; end if;
  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'device', v_dev.id,
    'my_rank', v_dev.rank,
    'guest', coalesce(v_dev.guest, false),
    'lost_by', v_by,
    'lost_at', v_dev.lost_reported_at,
    'lock', case when v_lock.user_id is null then null else jsonb_build_object(
      'rank', v_lock.locked_rank, 'at', v_lock.locked_at, 'mine', v_lock.locked_by_device = v_dev.id,
      'by_label', v_lock_dev.label, 'escape_at', v_lock.unlock_requested_at) end,
    'rank_taken', jsonb_build_object(
      '1', exists (select 1 from public.account_devices where user_id = v_uid and rank = 1 and revoked_at is null),
      '2', exists (select 1 from public.account_devices where user_id = v_uid and rank = 2 and revoked_at is null)),
    'vault_other_allowed', coalesce((select vault_other_devices_allowed from public.profiles where id = v_uid), false)
  );
end $function$;

create or replace function private.account_deletion_grace(p_uid uuid)
returns interval language sql stable set search_path = '' as $$
  select case when private.is_review_account(p_uid) then interval '0'
              else make_interval(days => private.account_deletion_grace_days()) end
$$;
revoke all on function private.account_deletion_grace(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. Xoá nhanh cho tài khoản demo
-- Lịch riêng mỗi 5 phút, chỉ gọi Edge Function khi có tài khoản demo đến hạn (lịch chung không đổi).
create or replace function private.call_delete_review_accounts()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.account_deletion_requests r
                  join private.review_accounts ra on ra.user_id = r.user_id
                  where r.status = 'pending' and r.execute_after <= now()) then return; end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/delete-account',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.call_delete_review_accounts() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('avora_delete_review_account');
exception when others then null; end $$;
select cron.schedule('avora_delete_review_account', '*/5 * * * *', 'select private.call_delete_review_accounts()');

-- Gọi thực thi ngay khi tài khoản demo gửi yêu cầu (pg_net gửi sau khi giao dịch xong, nên hàng yêu cầu đã có).
create or replace function private.review_delete_now()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and private.is_review_account(new.user_id) then
    perform private.call_delete_review_accounts();
  end if;
  return new;
end $$;
revoke all on function private.review_delete_now() from public, anon, authenticated;
drop trigger if exists account_deletion_review_now on public.account_deletion_requests;
create trigger account_deletion_review_now after insert or update of status on public.account_deletion_requests
  for each row execute function private.review_delete_now();

-- ------------------------------------------------------------------ 4. RPC cho ops
create or replace function private.ops_mark_review_account(p_email text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_uid uuid;
begin
  if v_actor is null or not private.is_ops(v_actor) then raise exception 'avora_not_allowed'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_uid is null then raise exception 'avora_user_not_found'; end if;
  insert into private.review_accounts (user_id, note, created_by) values (v_uid, nullif(btrim(p_note), ''), v_actor)
  on conflict (user_id) do update set note = excluded.note, created_by = excluded.created_by;
  return jsonb_build_object('user_id', v_uid, 'review', true);
end $$;

create or replace function private.ops_unmark_review_account(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_uid uuid;
begin
  if v_actor is null or not private.is_ops(v_actor) then raise exception 'avora_not_allowed'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_uid is null then raise exception 'avora_user_not_found'; end if;
  delete from private.review_accounts where user_id = v_uid;
  return jsonb_build_object('user_id', v_uid, 'review', false);
end $$;
revoke all on function private.ops_mark_review_account(text, text) from public, anon;
revoke all on function private.ops_unmark_review_account(text) from public, anon;
grant execute on function private.ops_mark_review_account(text, text) to authenticated;
grant execute on function private.ops_unmark_review_account(text) to authenticated;

create or replace function public.ops_mark_review_account(p_email text, p_note text default null)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ops_mark_review_account(p_email, p_note) $$;
create or replace function public.ops_unmark_review_account(p_email text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ops_unmark_review_account(p_email) $$;
revoke all on function public.ops_mark_review_account(text, text) from public, anon;
revoke all on function public.ops_unmark_review_account(text) from public, anon;
grant execute on function public.ops_mark_review_account(text, text) to authenticated;
grant execute on function public.ops_unmark_review_account(text) to authenticated;

-- ------------------------------------------------------------------ 5. Gieo dữ liệu mẫu (chạy lại được)
-- Người duyệt (đã đánh dấu demo) + một tài khoản phụ do VMT tự đăng ký. Nội dung trung tính, Việt + Anh.
-- Gieo lại: xoá đúng những dòng đã gieo lần trước (private.review_seed_rows), rồi gieo mới.
create or replace function private.review_as(p_uid uuid)
returns void language plpgsql set search_path = '' as $$
begin
  -- auth.uid() đọc request.jwt.claim.sub (kiểu cũ) trước request.jwt.claims: đặt cả hai.
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;
revoke all on function private.review_as(uuid) from public, anon, authenticated;

create or replace function private.ops_seed_review_data(p_reviewer uuid, p_helper uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_claims text := current_setting('request.jwt.claims', true);
  v_claim_sub text := current_setting('request.jwt.claim.sub', true);
  v_direct uuid; v_group uuid := gen_random_uuid(); v_journal uuid; v_project uuid; v_shelf uuid;
  v_account uuid := gen_random_uuid(); v_income uuid; v_expense uuid; v_msg uuid; v_book text;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_n int := 0;
  r record;
begin
  if v_actor is null or not private.is_ops(v_actor) then raise exception 'avora_not_allowed'; end if;
  if not private.is_review_account(p_reviewer) then raise exception 'avora_not_review_account'; end if;
  if p_helper is null or p_helper = p_reviewer or not exists (select 1 from public.profiles p where p.id = p_helper) then
    raise exception 'avora_review_helper_invalid';
  end if;

  -- 0. Gỡ phần đã gieo lần trước (con trước cha).
  -- Gồm cả phần gieo cho người duyệt cũ đã xoá tài khoản (nhóm mẫu của họ đã chuyển cho tài khoản phụ).
  for r in select kind, id from private.review_seed_rows
           where reviewer = p_reviewer or not exists (select 1 from auth.users u where u.id = reviewer)
           order by case kind when 'report' then 1 when 'message' then 2 when 'task' then 3 when 'habit' then 4
                              when 'transaction' then 5 when 'account' then 6 when 'record' then 7 when 'project' then 8
                              when 'conversation' then 9 when 'connection' then 10 else 11 end loop
    case r.kind
      when 'report' then delete from public.user_reports where id = r.id;
      when 'message' then delete from public.messages where id = r.id;
      when 'task' then delete from public.project_tasks where task_id = r.id; delete from public.tasks where id = r.id;
      when 'habit' then delete from public.habit_logs where habit_id = r.id; delete from public.habits where id = r.id;
      when 'transaction' then delete from public.transactions where id = r.id;
      when 'account' then delete from public.transactions where account_id = r.id; delete from public.accounts where id = r.id;
      when 'record' then delete from public.think_hub_record where id = r.id;
      when 'project' then delete from public.projects where id = r.id;
      when 'conversation' then delete from public.conversations where id = r.id;
      else null;
    end case;
  end loop;
  delete from private.review_seed_rows where reviewer = p_reviewer or not exists (select 1 from auth.users u where u.id = reviewer);

  -- 1. Hai người là bạn (nếu chưa).
  if not private.are_connected(p_reviewer, p_helper) then
    insert into public.user_connections (user_low, user_high, status, source)
    values (least(p_reviewer, p_helper), greatest(p_reviewer, p_helper), 'active', 'legacy')
    on conflict (user_low, user_high) do update set status = 'active', removed_at = null, removed_by = null;
  end if;

  -- 2. Chat 1-1 (dùng lại cuộc đã có nếu có) + vài tin.
  perform private.review_as(p_reviewer);
  v_direct := public.create_direct_conversation(p_helper);
  v_msg := gen_random_uuid();
  with m as (
    insert into public.messages (id, conversation_id, sender_id, content, created_at) values
      (v_msg, v_direct, p_helper, 'Chào bạn! Tuần này mình đi dạo công viên nhé? · Hi! A walk in the park this week?', now() - interval '50 minutes'),
      (gen_random_uuid(), v_direct, p_reviewer, 'Được, Thứ Bảy 7 giờ sáng nhé. · Sure, Saturday 7 am.', now() - interval '45 minutes'),
      (gen_random_uuid(), v_direct, p_helper, 'Mình gửi danh sách đồ cần mang trước Thứ Sáu. · I''ll send the packing list by Friday.', now() - interval '40 minutes')
    returning id)
  insert into private.review_seed_rows (reviewer, kind, id) select p_reviewer, 'message', id from m;

  -- 3. Nhóm (seed trực tiếp: nhóm thật cần 3 người, ở đây chỉ để xem) + tin.
  insert into public.conversations (id, type) values (v_group, 'group');
  insert into public.conversation_groups (conversation_id, name, owner_id) values (v_group, 'Gia đình · Family (demo)', p_reviewer);
  insert into public.conversation_participants (conversation_id, user_id, role) values (v_group, p_reviewer, 'owner'), (v_group, p_helper, 'member');
  insert into private.review_seed_rows (reviewer, kind, id) values (p_reviewer, 'conversation', v_group);
  insert into public.messages (id, conversation_id, sender_id, content, created_at) values
    (gen_random_uuid(), v_group, p_reviewer, 'Cuối tuần này cả nhà ăn tối cùng nhau nhé. · Family dinner this weekend.', now() - interval '30 minutes'),
    (gen_random_uuid(), v_group, p_helper, 'Mình phụ trách món tráng miệng. · I''ll bring dessert.', now() - interval '25 minutes');

  -- 4. Báo cáo mẫu (để xem luồng ở màn quản trị): người duyệt báo một tin của tài khoản phụ.
  insert into public.user_reports (id, reporter_id, reported_user_id, conversation_id, message_id, reason, note, reported_content, target_kind)
  values (gen_random_uuid(), p_reviewer, p_helper, v_direct, v_msg, 'other', 'Báo cáo mẫu để xem luồng · Sample report (demo)',
          'Chào bạn! Tuần này mình đi dạo công viên nhé?', 'message')
  returning id into v_msg;
  insert into private.review_seed_rows (reviewer, kind, id) values (p_reviewer, 'report', v_msg);

  -- 5. Nhiệm vụ: ba việc riêng + một việc giao cho người kia trong 1-1.
  with t as (
    insert into public.tasks (type, creator_id, title, deadline_date, status, deadline_tz)
    values ('personal', p_reviewer, 'Đọc 20 trang sách · Read 20 pages', v_today, 'confirmed', 'Asia/Ho_Chi_Minh'),
           ('personal', p_reviewer, 'Gọi điện cho bà · Call grandma', v_today + 1, 'confirmed', 'Asia/Ho_Chi_Minh'),
           ('personal', p_reviewer, 'Lên kế hoạch tuần · Plan the week', v_today + 2, 'confirmed', 'Asia/Ho_Chi_Minh')
    returning id)
  insert into private.review_seed_rows (reviewer, kind, id) select p_reviewer, 'task', id from t;
  insert into private.review_seed_rows (reviewer, kind, id)
  select p_reviewer, 'task', (public.create_1_1_shared_task(v_direct, 'Gửi danh sách đồ đi dạo · Send the packing list', 'Nước, mũ, giày đi bộ · Water, hat, walking shoes', v_today + 3, gen_random_uuid())).id;

  -- 6. Dự án trong nhóm, có một Hạng mục việc.
  v_project := (public.create_project(v_group, 'Chuyến đi cuối năm · Year-end trip', 'Cả nhà có thời gian bên nhau · Time together',
                 'Chọn nơi đi và đặt chỗ trước 15/12 · Choose and book by 15 Dec', v_today, v_today + 30)).id;
  insert into private.review_seed_rows (reviewer, kind, id) values (p_reviewer, 'project', v_project);
  insert into private.review_seed_rows (reviewer, kind, id)
  select p_reviewer, 'conversation', p.conversation_id from public.projects p where p.id = v_project;
  insert into private.review_seed_rows (reviewer, kind, id)
  select p_reviewer, 'task', (public.create_project_task(v_project, null, gen_random_uuid(), 'So sánh ba nơi nghỉ · Compare three places', 'Giá, đường đi, chỗ cho trẻ em · Price, travel, room for kids', v_today + 7, p_helper, null, 'Asia/Ho_Chi_Minh',
    jsonb_build_object('conversation_type', 'group',
      'conversation_id', (select p.conversation_id from public.projects p where p.id = v_project),
      'conversation_name', 'Chuyến đi cuối năm · Year-end trip',
      'original_message_id', null, 'original_message_text', 'Dữ liệu mẫu cho người duyệt · Sample data for review',
      'original_message_sender_id', p_reviewer, 'original_message_sender_name', null,
      'original_message_created_at', now(), 'user_response', null, 'snapshot_created_at', now()))).id;

  -- 7. Ba thói quen, một thói quen có đồng hồ.
  insert into private.review_seed_rows (reviewer, kind, id) values
    (p_reviewer, 'habit', public.create_habit(gen_random_uuid(), 'Đọc sách · Reading', 'timed', 20, '{1,2,3,4,5,6,7}', '[{"time":"21:00","remind":false}]'::jsonb, false, 'keep')),
    (p_reviewer, 'habit', public.create_habit(gen_random_uuid(), 'Uống đủ nước · Drink water', 'check', null, '{1,2,3,4,5,6,7}', '[{"time":"09:00","remind":false}]'::jsonb, false, 'keep')),
    (p_reviewer, 'habit', public.create_habit(gen_random_uuid(), 'Đi bộ · Walk', 'check', null, '{1,3,5}', '[{"time":"06:30","remind":false}]'::jsonb, false, 'keep'));

  -- 8. Vài dòng Nhật ký.
  v_journal := public.ensure_personal_journal(p_reviewer);
  with m as (
    insert into public.messages (id, conversation_id, sender_id, content, created_at) values
      (gen_random_uuid(), v_journal, p_reviewer, 'Hôm nay biết ơn vì một buổi sáng yên tĩnh. · Grateful for a quiet morning.', now() - interval '3 hours'),
      (gen_random_uuid(), v_journal, p_reviewer, 'Ý tưởng: tuần sau thử dậy sớm hơn 15 phút. · Idea: wake up 15 minutes earlier next week.', now() - interval '2 hours')
    returning id)
  insert into private.review_seed_rows (reviewer, kind, id) select p_reviewer, 'message', id from m;

  -- 9. Tài chính: một tài khoản tiền mặt + hai giao dịch.
  perform public.seed_finance_categories(p_reviewer);  -- không qua khoá Két sắt (người duyệt tự đặt mật khẩu Két sắt khi vào lần đầu)
  select c.id into v_income from public.categories c where c.user_id = p_reviewer and c.applies_to = 'income' and c.deleted_at is null order by c.sort_order nulls last limit 1;
  select c.id into v_expense from public.categories c where c.user_id = p_reviewer and c.applies_to = 'expense' and c.deleted_at is null order by c.sort_order nulls last limit 1;
  insert into public.accounts (id, user_id, name, type, opening_balance, currency) values (v_account, p_reviewer, 'Tiền mặt · Cash', 'cash', 2000000, 'VND');
  insert into private.review_seed_rows (reviewer, kind, id) values (p_reviewer, 'account', v_account);
  if v_income is not null and v_expense is not null then
    with t as (
      insert into public.transactions (user_id, account_id, category_id, type, amount, description, transaction_date, currency)
      values (p_reviewer, v_account, v_income, 'income', 500000, 'Quà sinh nhật · Birthday gift', v_today - 2, 'VND'),
             (p_reviewer, v_account, v_expense, 'expense', 120000, 'Sách mới · New book', v_today - 1, 'VND')
      returning id)
    insert into private.review_seed_rows (reviewer, kind, id) select p_reviewer, 'transaction', id from t;
  end if;

  -- 10. Một cuốn sách trên kệ (lấy từ danh mục sách công cộng đã có).
  v_shelf := (public.ensure_bookshelf()).id;
  select coalesce(b.title_vi, b.title) into v_book from public.book_catalog b where b.access is distinct from 'none' order by b.title limit 1;
  if v_shelf is not null then
    insert into private.review_seed_rows (reviewer, kind, id)
    select p_reviewer, 'record', (public.create_think_hub_record(v_shelf, coalesce(v_book, 'Sách mẫu · Sample book'))).id;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  select count(*) into v_n from private.review_seed_rows where reviewer = p_reviewer;
  return jsonb_build_object('reviewer', p_reviewer, 'helper', p_helper, 'rows', v_n, 'direct', v_direct, 'group', v_group);
end $$;
revoke all on function private.ops_seed_review_data(uuid, uuid) from public, anon;
grant execute on function private.ops_seed_review_data(uuid, uuid) to authenticated;

create or replace function public.ops_seed_review_data(p_reviewer uuid, p_helper uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ops_seed_review_data(p_reviewer, p_helper) $$;
revoke all on function public.ops_seed_review_data(uuid, uuid) from public, anon;
grant execute on function public.ops_seed_review_data(uuid, uuid) to authenticated;
