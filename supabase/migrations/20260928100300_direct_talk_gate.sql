-- AVORA-38 (gộp) / Phần 2 · Nhóm A + C, Ràng buộc chéo #2 — one gate for every write into a 1-1.
--
-- Each AVORA-37 block check below is replaced, at exactly the same spot, by
-- private.assert_direct_talk(conversation, user, kind) — no new positions. It raises the same
-- avora_contact_unavailable for a blocked pair first, then applies the verification frame rules
-- (text only, 5 per side → avora_verification_text_only / avora_verification_quota) and finally
-- requires bạn (avora_not_connected). Groups and the journal pass through unchanged.
--   text        messages INSERT policy, send_message_with_attachments without files
--   attachment  send_message_with_attachments with files, message_attachments INSERT policy
--   rich        forward_messages, create_shared_task, create_task_suggestion, invite_task_participant,
--               create_think_hub_table/_record/_sub_table, tasks & task_lists INSERT policies
--   reaction    assert_contact_available (reactions, recall requests), edit_message
-- confirm_shared_task gains the block check it never had (answering is refused for a blocked pair).
-- create_1_1_shared_task (unused by the client since AVORA-35) loses EXECUTE for everyone.
-- Live definitions were read with pg_get_functiondef / pg_policies on 2026-09-28 and are kept
-- verbatim at the end of this file. CREATE OR REPLACE keeps existing EXECUTE grants.

CREATE OR REPLACE FUNCTION public.send_message_with_attachments(p_conversation_id uuid, p_content text, p_reply_to_message_id uuid DEFAULT NULL::uuid, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_origin_group_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_message_id uuid := gen_random_uuid ();
  v_count integer := coalesce(jsonb_array_length(p_attachments), 0);
  v_content text := coalesce(btrim(p_content), '');
  v_row public.messages%rowtype;
  v_item jsonb;
  v_path text;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  -- The caller's claim about who they are is never read; membership is checked for the
  -- session's own identity.
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
  -- AVORA-38: one gate — blocked, verification (text only, 5 per side), or not bạn.
  perform private.assert_direct_talk (p_conversation_id, v_uid, case when v_count > 0 then 'attachment' else 'text' end);

  if v_count > 10 then
    raise exception 'avora_attachment_too_many';
  end if;

  if v_content = '' and v_count = 0 then
    raise exception 'messages_content_not_blank';
  end if;

  -- Each file must already sit in this conversation's own folder. Storage write access is
  -- folder-scoped, so this is what stops a row pointing at a file from a thread the sender
  -- is not in. Forwarding an existing file is a different operation with its own rules.
  for v_item in select * from jsonb_array_elements(p_attachments)
  loop
    v_path := v_item ->> 'storage_path';

    if v_path is null or v_path not like (p_conversation_id::text || '/%') then
      raise exception 'avora_attachment_path_invalid';
    end if;

    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'chat-attachments' and o.name = v_path
    ) then
      raise exception 'avora_attachment_missing';
    end if;
  end loop;

  -- Written with the real count so the not-blank rule passes for a wordless message; the
  -- trigger on the inserts below recomputes it from the rows that actually landed, so a
  -- wrong number here cannot survive the statement.
  insert into public.messages (
    id, conversation_id, sender_id, content, reply_to_message_id,
    mentioned_user_ids, origin_group_id, attachment_count
  )
  values (
    v_message_id, p_conversation_id, v_uid, v_content, p_reply_to_message_id,
    coalesce(p_mentioned_user_ids, '{}'), p_origin_group_id, v_count
  );

  insert into public.message_attachments (
    message_id, conversation_id, attached_by, kind, storage_path,
    file_name, mime_type, byte_size, width, height, duration_seconds, permission
  )
  select
    v_message_id,
    p_conversation_id,
    v_uid,
    item ->> 'kind',
    item ->> 'storage_path',
    item ->> 'file_name',
    item ->> 'mime_type',
    (item ->> 'byte_size')::bigint,
    nullif(item ->> 'width', '')::integer,
    nullif(item ->> 'height', '')::integer,
    nullif(item ->> 'duration_seconds', '')::numeric,
    coalesce(nullif(item ->> 'permission', ''), 'export')
  from jsonb_array_elements(p_attachments) as item;

  select * into v_row from public.messages where id = v_message_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.forward_messages(p_message_ids uuid[], p_target_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_source public.messages%rowtype;
  v_new_id uuid;
  v_forwarded integer := 0;
  v_carried integer := 0;
  v_blocked integer := 0;
  v_allowed integer;
  v_denied integer;
  v_content text;
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  if not private.is_conversation_participant (p_target_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
  -- AVORA-38: forwarding is not plain text — refused in a verification frame, needs bạn otherwise.
  perform private.assert_direct_talk (p_target_conversation_id, v_uid, 'rich');

  if coalesce(array_length(p_message_ids, 1), 0) = 0 then
    return jsonb_build_object('forwarded', 0, 'files_carried', 0, 'files_blocked', 0);
  end if;

  if array_length(p_message_ids, 1) > 50 then
    raise exception 'avora_forward_too_many';
  end if;

  -- Oldest first, so a forwarded run of messages reads in the order it was said.
  for v_source in
    select * from public.messages
    where id = any (p_message_ids)
    order by created_at, id
  loop
    -- Readable by the forwarder, or it cannot be carried anywhere. Checked per message
    -- rather than once, because the list can span several conversations.
    if not private.is_conversation_participant (v_source.conversation_id, v_uid) then
      raise exception 'avora_not_a_participant';
    end if;

    -- Withdrawn words are gone; there is nothing left to forward.
    if v_source.deleted_at is not null then
      continue;
    end if;

    -- The permission ladder decides what travels. 'view' means the file stops here: the
    -- reader may look at it where it was sent, and carrying it onward is exactly the thing
    -- that rung refuses.
    select
      count(*) filter (where permission in ('forward', 'export')),
      count(*) filter (where permission = 'view')
    into v_allowed, v_denied
    from public.message_attachments
    where message_id = v_source.id;

    v_content := v_source.content;

    -- Said plainly rather than by omission: a file quietly missing from a forward is worse
    -- than a forward that admits what it could not bring.
    if v_denied > 0 then
      v_content := case when btrim(v_content) = '' then
        public.forward_blocked_note ()
      else
        v_content || E'\n' || public.forward_blocked_note ()
      end;
    end if;

    v_new_id := gen_random_uuid ();

    insert into public.messages (
      id, conversation_id, sender_id, content,
      mentioned_user_ids, attachment_count, origin_content_id, origin_sender_id
    )
    values (
      v_new_id,
      p_target_conversation_id,
      v_uid,
      v_content,
      -- Mentions are not carried: naming someone in a room they are not in would notify
      -- nobody and read as a summons from a conversation they cannot see.
      '{}',
      v_allowed,
      v_source.id,
      v_source.sender_id
    );

    -- The file itself is not copied. Both rows point at the same object, and the storage
    -- policy grants access to whoever is in a conversation that points at it — so the
    -- forward costs no bytes and revoking it is a matter of the message going away.
    insert into public.message_attachments (
      message_id, conversation_id, attached_by, kind, storage_path, file_name,
      mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id
    )
    select
      v_new_id,
      p_target_conversation_id,
      v_uid,
      a.kind,
      a.storage_path,
      a.file_name,
      a.mime_type,
      a.byte_size,
      a.width,
      a.height,
      a.duration_seconds,
      -- Never widened on the way through. Nobody can hand on more than they were given,
      -- so the copy carries the same rung it arrived at.
      a.permission,
      a.message_id
    from public.message_attachments a
    where a.message_id = v_source.id
      and a.permission in ('forward', 'export');

    v_forwarded := v_forwarded + 1;
    v_carried := v_carried + v_allowed;
    v_blocked := v_blocked + v_denied;
  end loop;

  return jsonb_build_object(
    'forwarded', v_forwarded,
    'files_carried', v_carried,
    'files_blocked', v_blocked
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_shared_task(p_conversation_id uuid, p_type text, p_title text, p_description text, p_deadline date, p_task_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb, p_context_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid := coalesce(p_task_id, gen_random_uuid());
  v_type text := btrim(coalesce(p_type, ''));
  v_conv_type text;
  v_assignee uuid := p_assignee_id;
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- Asking someone for work without saying what you need, or by when, is not a task.
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;

  -- A suggestion with no trace of the exchange that produced it is exactly the thing this
  -- feature exists to prevent: the person receiving it cannot tell what it refers to.
  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;

  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 / A: no shared task into a blocked 1-1. Groups are untouched.
  perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');

  -- The kind of task and the kind of room have to agree, or a group task could be filed
  -- against a 1-1 thread and inherit the wrong idea of who the assignee is.
  if v_type = '1-1-shared' and v_conv_type <> 'direct' then raise exception 'avora_task_wrong_conversation'; end if;
  if v_type = 'group-shared' and v_conv_type <> 'group' then raise exception 'avora_task_wrong_conversation'; end if;

  if v_type = '1-1-shared' then
    -- Exactly one other person is in the room; naming them is a convenience, not a choice.
    select cp.user_id into v_assignee
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id <> v_uid
    limit 1;
  end if;

  if v_assignee is null then raise exception 'avora_task_assignee_required'; end if;

  -- Work you give yourself is a personal task; the two-party flow needs two parties.
  if v_assignee = v_uid then raise exception 'avora_task_self_assign'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_assignee
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date,
    deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern,
    context_snapshot
  )
  values (
    v_id, v_type, v_uid, v_assignee, p_conversation_id, v_title, v_description, 'pending_confirmation',
    p_deadline, p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'),
    p_category_id, coalesce(p_is_important, false),
    coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern, p_context_snapshot
  )
  on conflict (id) do nothing;

  -- The creator's half of the two-party confirmation, recorded at creation.
  insert into public.task_confirmations (task_id, user_id)
  values (v_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  select * into v_row from public.tasks where id = v_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_task_suggestion(p_conversation_id uuid, p_assignee_id uuid, p_title text, p_description text, p_deadline date, p_context_snapshot jsonb, p_suggestion_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_conv_type text;
  v_snapshot_conv uuid;
  v_row public.task_suggestions%rowtype;
  v_self boolean;
  k text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  -- Same bar a shared task has to clear: a suggestion with no trace of the exchange behind it
  -- leaves the person receiving it unable to tell what it refers to.
  if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
  if jsonb_typeof(p_context_snapshot) <> 'object' then
    raise exception 'avora_context_snapshot_not_object';
  end if;
  foreach k in array array[
    'conversation_type', 'conversation_id', 'conversation_name',
    'original_message_id', 'original_message_text', 'original_message_sender_id',
    'original_message_sender_name', 'original_message_created_at',
    'user_response', 'snapshot_created_at'
  ] loop
    if not (p_context_snapshot ? k) then
      raise exception 'avora_context_snapshot_missing_key_%', k;
    end if;
  end loop;

  v_snapshot_conv := nullif(p_context_snapshot->>'conversation_id', '')::uuid;
  if v_snapshot_conv is null then raise exception 'avora_context_snapshot_conversation_required'; end if;
  -- The snapshot must describe the room this is actually being raised in, or it becomes a way
  -- to write a fabricated quote into someone else's context.
  if v_snapshot_conv <> p_conversation_id then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;
  if nullif(p_context_snapshot->>'snapshot_created_at', '') is null then
    raise exception 'avora_context_snapshot_time_required';
  end if;

  select c.type into v_conv_type
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id
  where c.id = p_conversation_id and cp.user_id = v_uid;
  if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
  -- AVORA-37 / A: no suggestion into a blocked 1-1. Groups are untouched.
  perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');

  if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
    raise exception 'avora_context_snapshot_type_mismatch';
  end if;

  if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
  v_self := (p_assignee_id = v_uid);
  -- Asking yourself is only meaningful in a group. In a 1-1 the other person is the only one
  -- there is to ask, so naming yourself is a mistake rather than a choice.
  if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_assignee_id
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;

  -- A quoted message has to belong to this conversation.
  if p_message_id is not null and not exists (
    select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.task_suggestions (
    id, conversation_id, message_id, proposer_id, assignee_id,
    proposed_title, proposed_description, proposed_deadline,
    proposed_deadline_time, proposed_deadline_tz, context_snapshot, status
  )
  values (
    v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
    v_title, v_description, p_deadline,
    p_deadline_time, v_tz, p_context_snapshot, 'pending'
  )
  on conflict (id) do nothing;

  -- Work taken on by the person raising it needs no answer, so it is answered here and now,
  -- through the ordinary acceptance path. Re-running this for an already-accepted row is a
  -- no-op inside that function, which keeps the whole call idempotent.
  if v_self then
    perform public.accept_task_suggestion(v_id, gen_random_uuid());
  end if;

  select * into v_row from public.task_suggestions where id = v_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_think_hub_table(p_name text, p_purpose text DEFAULT NULL::text, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  IF p_conversation_id IS NOT NULL
     AND NOT private.is_conversation_participant(p_conversation_id, v_user) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;

  -- AVORA-37 / A: no new table in a blocked 1-1.
  PERFORM private.assert_direct_talk(p_conversation_id, v_user, 'rich');

  -- Bảng gốc của dự án chỉ sinh cùng dự án; ở đây là bảng độc lập (Diary, 1-1, Nhóm).
  INSERT INTO think_hub_table (owner_user_id, name, purpose, conversation_id, position)
  SELECT v_user, v_name, nullif(btrim(coalesce(p_purpose, '')), ''), p_conversation_id,
         coalesce(max(position), -1) + 1
  FROM think_hub_table
  WHERE deleted_at IS NULL AND parent_record_id IS NULL AND project_id IS NULL
    AND conversation_id IS NOT DISTINCT FROM p_conversation_id
    AND (p_conversation_id IS NOT NULL OR owner_user_id = v_user)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_think_hub_record(p_table_id uuid, p_title text, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_next_action_date date DEFAULT NULL::date, p_tags text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text, p_extension_fields jsonb DEFAULT NULL::jsonb, p_scope_conversation_id uuid DEFAULT NULL::uuid, p_scope_project_id uuid DEFAULT NULL::uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_title text;
  v_count integer;
  v_table think_hub_table%ROWTYPE;
  v_row   think_hub_record%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'avora_think_hub_record_title_required';
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('thap', 'trung_binh', 'cao') THEN
    RAISE EXCEPTION 'avora_think_hub_priority_invalid';
  END IF;

  SELECT * INTO v_table FROM think_hub_table WHERE id = p_table_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  -- Bảng phải thuộc đúng ngữ cảnh đang tạo, kể cả khi người gọi có quyền đọc bảng đó.
  IF v_table.conversation_id IS DISTINCT FROM p_scope_conversation_id
     OR v_table.project_id IS DISTINCT FROM p_scope_project_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_out_of_scope';
  END IF;

  -- AVORA-37 / A: no new row in a table that belongs to a blocked 1-1.
  PERFORM private.assert_direct_talk(v_table.conversation_id, v_user, 'rich');

  SELECT count(*) INTO v_count FROM think_hub_record
  WHERE table_id = p_table_id AND deleted_at IS NULL;

  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_think_hub_record_limit';
  END IF;

  INSERT INTO think_hub_record (
    table_id, owner_user_id, title, status, priority,
    category, next_action_date, tags, notes, extension_fields
  ) VALUES (
    p_table_id, v_user, v_title,
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'moi'),
    coalesce(p_priority, 'trung_binh'),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_next_action_date,
    coalesce(p_tags, '{}'),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_extension_fields, '{}'::jsonb)
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_think_hub_sub_table(p_record_id uuid, p_name text DEFAULT NULL::text, p_purpose text DEFAULT NULL::text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user     uuid := auth.uid();
  v_record   think_hub_record%ROWTYPE;
  v_parent   think_hub_table%ROWTYPE;
  v_existing think_hub_table%ROWTYPE;
  v_name     text;
  v_row      think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_record FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_record.table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  SELECT * INTO v_parent FROM think_hub_table WHERE id = v_record.table_id;
  IF v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_table_missing';
  END IF;
  -- AVORA-37 / A: no new sub-table under a table that belongs to a blocked 1-1.
  PERFORM private.assert_direct_talk(v_parent.conversation_id, v_user, 'rich');
  IF v_parent.depth >= 3 THEN
    RAISE EXCEPTION 'avora_think_hub_depth_limit';
  END IF;

  -- Đúng 1 bảng con. Bảng con đã cất đi thì lấy lại thay vì tạo cái thứ hai.
  SELECT * INTO v_existing FROM think_hub_table WHERE parent_record_id = p_record_id;
  IF FOUND THEN
    IF v_existing.deleted_at IS NULL THEN
      RAISE EXCEPTION 'avora_think_hub_sub_table_exists';
    END IF;
    UPDATE think_hub_table SET deleted_at = NULL WHERE id = v_existing.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_record.title);

  INSERT INTO think_hub_table (owner_user_id, name, purpose, parent_record_id, position)
  VALUES (
    v_user, v_name,
    CASE WHEN p_purpose IS NULL THEN 'Theo dõi cho: ' || v_record.title
         ELSE nullif(btrim(p_purpose), '') END,
    p_record_id, 0
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invite_task_participant(p_task_id uuid, p_user_id uuid)
 RETURNS task_participants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_row public.task_participants%rowtype;
begin
  if v_me is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found or v_task.creator_id <> v_me then raise exception 'avora_invite_not_creator'; end if;
  if v_task.type not in ('1-1-shared','group-shared') or v_task.conversation_id is null then
    raise exception 'avora_invite_shared_only';
  end if;
  if p_user_id = v_me then raise exception 'avora_invite_self'; end if;
  -- AVORA-37 / A: no invitation inside a blocked 1-1. Groups are untouched.
  perform private.assert_direct_talk (v_task.conversation_id, v_me, 'rich');
  if not private.is_conversation_participant(v_task.conversation_id, p_user_id) then
    raise exception 'avora_invite_not_member';
  end if;

  insert into public.task_participants (task_id, user_id, invited_by)
  values (p_task_id, p_user_id, v_me)
  on conflict (task_id, user_id) do update
    set invitation_status = 'pending', invited_by = excluded.invited_by,
        invited_at = now(), responded_at = null
    where public.task_participants.invitation_status = 'declined'
  returning * into v_row;
  if v_row.id is null then raise exception 'avora_invite_exists'; end if;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_content text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.messages%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
begin
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select
    * into v_row
  from
    public.messages
  where
    id = p_message_id
  for update;
  if not found then
    raise exception 'avora_message_not_found';
  end if;

  if v_row.sender_id <> v_uid then
    raise exception 'avora_message_not_yours';
  end if;

  -- AVORA-37 / A: rewriting an old line is still putting new words into a blocked 1-1.
  perform private.assert_direct_talk (v_row.conversation_id, v_uid, 'reaction');

  -- A withdrawn message has no text to correct; bringing it back would undo the withdrawal.
  if v_row.deleted_at is not null then
    raise exception 'avora_message_recalled';
  end if;

  if now() - v_row.created_at > public.message_edit_window () then
    raise exception 'avora_message_edit_expired';
  end if;

  if v_content = '' then
    raise exception 'messages_content_not_blank';
  end if;
  if char_length(v_content) > 4000 then
    raise exception 'messages_content_max_len';
  end if;

  -- Rewriting the same words is not an edit, and must not stamp the message as one.
  if v_content = v_row.content then
    return v_row;
  end if;

  update
    public.messages
  set
    content = v_content,
    edited_at = now()
  where
    id = p_message_id;

  select
    * into v_row
  from
    public.messages
  where
    id = p_message_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_shared_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-38 (item 6): answering is refused between a blocked pair, like every other 1-1 write.
  if private.direct_peer_blocked (v_row.conversation_id, v_uid) then raise exception 'avora_contact_unavailable'; end if;

  -- Two-party confirmation: the creator cannot confirm their own task.
  if v_uid = v_row.creator_id then
    raise exception 'avora_task_self_confirm';
  end if;

  -- In a group, everyone else can see the task but only one person was asked to do it.
  if not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_assignee';
  end if;

  if v_row.status = 'pending_confirmation' then
    insert into public.task_confirmations (task_id, user_id)
    values (p_task_id, v_uid)
    on conflict (task_id, user_id) do nothing;

    update public.tasks
    set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
    where id = p_task_id and status = 'pending_confirmation';
  end if;
  -- already confirmed or done: retry is a no-op success

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_contact_available(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- AVORA-38: reactions and recall requests — allowed inside a verification frame, need bạn otherwise.
  return private.assert_direct_talk (p_conversation_id, p_user_id, 'reaction');
end;
$function$;

drop policy "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages
  as permissive for insert to authenticated
  with check (((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'text')));

drop policy "tasks_insert_creator" on public.tasks;
create policy "tasks_insert_creator" on public.tasks
  as permissive for insert to authenticated
  with check (((creator_id = ( SELECT auth.uid() AS uid)) AND (((type = 'personal'::text) AND (conversation_id IS NULL) AND (status = 'confirmed'::text)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND (status = 'pending_confirmation'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'rich')));

drop policy "Participants can attach" on public.message_attachments;
create policy "Participants can attach" on public.message_attachments
  as permissive for insert to authenticated
  with check ((((attached_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_attachments.message_id) AND (m.conversation_id = message_attachments.conversation_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))))) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'attachment'));

drop policy "task_lists_insert_participant" on public.task_lists;
create policy "task_lists_insert_participant" on public.task_lists
  as permissive for insert to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_direct_talk(conversation_id, ( SELECT auth.uid() AS uid), 'rich')));

revoke execute on function public.create_1_1_shared_task(uuid,text,text,date,uuid,time without time zone,text,uuid,boolean,text,jsonb) from public, anon, authenticated;

-- ===================== Previous definitions (verbatim) =====================
-- CREATE OR REPLACE FUNCTION public.send_message_with_attachments(p_conversation_id uuid, p_content text, p_reply_to_message_id uuid DEFAULT NULL::uuid, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_origin_group_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
--  RETURNS messages
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid ();
--   v_message_id uuid := gen_random_uuid ();
--   v_count integer := coalesce(jsonb_array_length(p_attachments), 0);
--   v_content text := coalesce(btrim(p_content), '');
--   v_row public.messages%rowtype;
--   v_item jsonb;
--   v_path text;
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
-- 
--   -- The caller's claim about who they are is never read; membership is checked for the
--   -- session's own identity.
--   if not private.is_conversation_participant (p_conversation_id, v_uid) then
--     raise exception 'avora_not_a_participant';
--   end if;
-- 
--   -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
--   if private.direct_peer_blocked (p_conversation_id, v_uid) then
--     raise exception 'avora_contact_unavailable';
--   end if;
-- 
--   if v_count > 10 then
--     raise exception 'avora_attachment_too_many';
--   end if;
-- 
--   if v_content = '' and v_count = 0 then
--     raise exception 'messages_content_not_blank';
--   end if;
-- 
--   -- Each file must already sit in this conversation's own folder. Storage write access is
--   -- folder-scoped, so this is what stops a row pointing at a file from a thread the sender
--   -- is not in. Forwarding an existing file is a different operation with its own rules.
--   for v_item in select * from jsonb_array_elements(p_attachments)
--   loop
--     v_path := v_item ->> 'storage_path';
-- 
--     if v_path is null or v_path not like (p_conversation_id::text || '/%') then
--       raise exception 'avora_attachment_path_invalid';
--     end if;
-- 
--     if not exists (
--       select 1 from storage.objects o
--       where o.bucket_id = 'chat-attachments' and o.name = v_path
--     ) then
--       raise exception 'avora_attachment_missing';
--     end if;
--   end loop;
-- 
--   -- Written with the real count so the not-blank rule passes for a wordless message; the
--   -- trigger on the inserts below recomputes it from the rows that actually landed, so a
--   -- wrong number here cannot survive the statement.
--   insert into public.messages (
--     id, conversation_id, sender_id, content, reply_to_message_id,
--     mentioned_user_ids, origin_group_id, attachment_count
--   )
--   values (
--     v_message_id, p_conversation_id, v_uid, v_content, p_reply_to_message_id,
--     coalesce(p_mentioned_user_ids, '{}'), p_origin_group_id, v_count
--   );
-- 
--   insert into public.message_attachments (
--     message_id, conversation_id, attached_by, kind, storage_path,
--     file_name, mime_type, byte_size, width, height, duration_seconds, permission
--   )
--   select
--     v_message_id,
--     p_conversation_id,
--     v_uid,
--     item ->> 'kind',
--     item ->> 'storage_path',
--     item ->> 'file_name',
--     item ->> 'mime_type',
--     (item ->> 'byte_size')::bigint,
--     nullif(item ->> 'width', '')::integer,
--     nullif(item ->> 'height', '')::integer,
--     nullif(item ->> 'duration_seconds', '')::numeric,
--     coalesce(nullif(item ->> 'permission', ''), 'export')
--   from jsonb_array_elements(p_attachments) as item;
-- 
--   select * into v_row from public.messages where id = v_message_id;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.forward_messages(p_message_ids uuid[], p_target_conversation_id uuid)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid ();
--   v_source public.messages%rowtype;
--   v_new_id uuid;
--   v_forwarded integer := 0;
--   v_carried integer := 0;
--   v_blocked integer := 0;
--   v_allowed integer;
--   v_denied integer;
--   v_content text;
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
-- 
--   if not private.is_conversation_participant (p_target_conversation_id, v_uid) then
--     raise exception 'avora_not_a_participant';
--   end if;
-- 
--   -- AVORA-37 / A: nothing new goes into a 1-1 where either person has blocked the other.
--   if private.direct_peer_blocked (p_target_conversation_id, v_uid) then
--     raise exception 'avora_contact_unavailable';
--   end if;
-- 
--   if coalesce(array_length(p_message_ids, 1), 0) = 0 then
--     return jsonb_build_object('forwarded', 0, 'files_carried', 0, 'files_blocked', 0);
--   end if;
-- 
--   if array_length(p_message_ids, 1) > 50 then
--     raise exception 'avora_forward_too_many';
--   end if;
-- 
--   -- Oldest first, so a forwarded run of messages reads in the order it was said.
--   for v_source in
--     select * from public.messages
--     where id = any (p_message_ids)
--     order by created_at, id
--   loop
--     -- Readable by the forwarder, or it cannot be carried anywhere. Checked per message
--     -- rather than once, because the list can span several conversations.
--     if not private.is_conversation_participant (v_source.conversation_id, v_uid) then
--       raise exception 'avora_not_a_participant';
--     end if;
-- 
--     -- Withdrawn words are gone; there is nothing left to forward.
--     if v_source.deleted_at is not null then
--       continue;
--     end if;
-- 
--     -- The permission ladder decides what travels. 'view' means the file stops here: the
--     -- reader may look at it where it was sent, and carrying it onward is exactly the thing
--     -- that rung refuses.
--     select
--       count(*) filter (where permission in ('forward', 'export')),
--       count(*) filter (where permission = 'view')
--     into v_allowed, v_denied
--     from public.message_attachments
--     where message_id = v_source.id;
-- 
--     v_content := v_source.content;
-- 
--     -- Said plainly rather than by omission: a file quietly missing from a forward is worse
--     -- than a forward that admits what it could not bring.
--     if v_denied > 0 then
--       v_content := case when btrim(v_content) = '' then
--         public.forward_blocked_note ()
--       else
--         v_content || E'\n' || public.forward_blocked_note ()
--       end;
--     end if;
-- 
--     v_new_id := gen_random_uuid ();
-- 
--     insert into public.messages (
--       id, conversation_id, sender_id, content,
--       mentioned_user_ids, attachment_count, origin_content_id, origin_sender_id
--     )
--     values (
--       v_new_id,
--       p_target_conversation_id,
--       v_uid,
--       v_content,
--       -- Mentions are not carried: naming someone in a room they are not in would notify
--       -- nobody and read as a summons from a conversation they cannot see.
--       '{}',
--       v_allowed,
--       v_source.id,
--       v_source.sender_id
--     );
-- 
--     -- The file itself is not copied. Both rows point at the same object, and the storage
--     -- policy grants access to whoever is in a conversation that points at it — so the
--     -- forward costs no bytes and revoking it is a matter of the message going away.
--     insert into public.message_attachments (
--       message_id, conversation_id, attached_by, kind, storage_path, file_name,
--       mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id
--     )
--     select
--       v_new_id,
--       p_target_conversation_id,
--       v_uid,
--       a.kind,
--       a.storage_path,
--       a.file_name,
--       a.mime_type,
--       a.byte_size,
--       a.width,
--       a.height,
--       a.duration_seconds,
--       -- Never widened on the way through. Nobody can hand on more than they were given,
--       -- so the copy carries the same rung it arrived at.
--       a.permission,
--       a.message_id
--     from public.message_attachments a
--     where a.message_id = v_source.id
--       and a.permission in ('forward', 'export');
-- 
--     v_forwarded := v_forwarded + 1;
--     v_carried := v_carried + v_allowed;
--     v_blocked := v_blocked + v_denied;
--   end loop;
-- 
--   return jsonb_build_object(
--     'forwarded', v_forwarded,
--     'files_carried', v_carried,
--     'files_blocked', v_blocked
--   );
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_shared_task(p_conversation_id uuid, p_type text, p_title text, p_description text, p_deadline date, p_task_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb, p_context_snapshot jsonb DEFAULT NULL::jsonb)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_title text := btrim(coalesce(p_title, ''));
--   v_description text := btrim(coalesce(p_description, ''));
--   v_id uuid := coalesce(p_task_id, gen_random_uuid());
--   v_type text := btrim(coalesce(p_type, ''));
--   v_conv_type text;
--   v_assignee uuid := p_assignee_id;
--   v_row public.tasks%rowtype;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
--   if v_title = '' then raise exception 'avora_task_title_blank'; end if;
--   if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
-- 
--   -- Asking someone for work without saying what you need, or by when, is not a task.
--   if v_description = '' then raise exception 'avora_task_description_required'; end if;
--   if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
--   if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
--   if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
-- 
--   -- A suggestion with no trace of the exchange that produced it is exactly the thing this
--   -- feature exists to prevent: the person receiving it cannot tell what it refers to.
--   if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
-- 
--   select c.type into v_conv_type
--   from public.conversations c
--   join public.conversation_participants cp on cp.conversation_id = c.id
--   where c.id = p_conversation_id and cp.user_id = v_uid;
-- 
--   if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
--   -- AVORA-37 / A: no shared task into a blocked 1-1. Groups are untouched.
--   if private.direct_peer_blocked (p_conversation_id, v_uid) then raise exception 'avora_contact_unavailable'; end if;
-- 
--   -- The kind of task and the kind of room have to agree, or a group task could be filed
--   -- against a 1-1 thread and inherit the wrong idea of who the assignee is.
--   if v_type = '1-1-shared' and v_conv_type <> 'direct' then raise exception 'avora_task_wrong_conversation'; end if;
--   if v_type = 'group-shared' and v_conv_type <> 'group' then raise exception 'avora_task_wrong_conversation'; end if;
-- 
--   if v_type = '1-1-shared' then
--     -- Exactly one other person is in the room; naming them is a convenience, not a choice.
--     select cp.user_id into v_assignee
--     from public.conversation_participants cp
--     where cp.conversation_id = p_conversation_id and cp.user_id <> v_uid
--     limit 1;
--   end if;
-- 
--   if v_assignee is null then raise exception 'avora_task_assignee_required'; end if;
-- 
--   -- Work you give yourself is a personal task; the two-party flow needs two parties.
--   if v_assignee = v_uid then raise exception 'avora_task_self_assign'; end if;
-- 
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = p_conversation_id and user_id = v_assignee
--   ) then
--     raise exception 'avora_task_assignee_not_participant';
--   end if;
-- 
--   -- Idempotent on retry: the client may replay the same generated id.
--   insert into public.tasks (
--     id, type, creator_id, assignee_id, conversation_id, title, description, status, deadline_date,
--     deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern,
--     context_snapshot
--   )
--   values (
--     v_id, v_type, v_uid, v_assignee, p_conversation_id, v_title, v_description, 'pending_confirmation',
--     p_deadline, p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'),
--     p_category_id, coalesce(p_is_important, false),
--     coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern, p_context_snapshot
--   )
--   on conflict (id) do nothing;
-- 
--   -- The creator's half of the two-party confirmation, recorded at creation.
--   insert into public.task_confirmations (task_id, user_id)
--   values (v_id, v_uid)
--   on conflict (task_id, user_id) do nothing;
-- 
--   select * into v_row from public.tasks where id = v_id;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_task_suggestion(p_conversation_id uuid, p_assignee_id uuid, p_title text, p_description text, p_deadline date, p_context_snapshot jsonb, p_suggestion_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
--  RETURNS task_suggestions
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
--   v_title text := btrim(coalesce(p_title, ''));
--   v_description text := btrim(coalesce(p_description, ''));
--   v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
--   v_conv_type text;
--   v_snapshot_conv uuid;
--   v_row public.task_suggestions%rowtype;
--   v_self boolean;
--   k text;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
--   if v_title = '' then raise exception 'avora_task_title_blank'; end if;
--   if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
--   if v_description = '' then raise exception 'avora_task_description_required'; end if;
--   if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
--   if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
--   if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
--   if not exists (select 1 from pg_timezone_names where name = v_tz) then
--     raise exception 'avora_task_timezone_invalid';
--   end if;
-- 
--   -- Same bar a shared task has to clear: a suggestion with no trace of the exchange behind it
--   -- leaves the person receiving it unable to tell what it refers to.
--   if p_context_snapshot is null then raise exception 'avora_task_context_required'; end if;
--   if jsonb_typeof(p_context_snapshot) <> 'object' then
--     raise exception 'avora_context_snapshot_not_object';
--   end if;
--   foreach k in array array[
--     'conversation_type', 'conversation_id', 'conversation_name',
--     'original_message_id', 'original_message_text', 'original_message_sender_id',
--     'original_message_sender_name', 'original_message_created_at',
--     'user_response', 'snapshot_created_at'
--   ] loop
--     if not (p_context_snapshot ? k) then
--       raise exception 'avora_context_snapshot_missing_key_%', k;
--     end if;
--   end loop;
-- 
--   v_snapshot_conv := nullif(p_context_snapshot->>'conversation_id', '')::uuid;
--   if v_snapshot_conv is null then raise exception 'avora_context_snapshot_conversation_required'; end if;
--   -- The snapshot must describe the room this is actually being raised in, or it becomes a way
--   -- to write a fabricated quote into someone else's context.
--   if v_snapshot_conv <> p_conversation_id then
--     raise exception 'avora_context_snapshot_foreign_conversation';
--   end if;
--   if nullif(p_context_snapshot->>'snapshot_created_at', '') is null then
--     raise exception 'avora_context_snapshot_time_required';
--   end if;
-- 
--   select c.type into v_conv_type
--   from public.conversations c
--   join public.conversation_participants cp on cp.conversation_id = c.id
--   where c.id = p_conversation_id and cp.user_id = v_uid;
--   if v_conv_type is null then raise exception 'avora_not_a_participant'; end if;
--   -- AVORA-37 / A: no suggestion into a blocked 1-1. Groups are untouched.
--   if private.direct_peer_blocked (p_conversation_id, v_uid) then raise exception 'avora_contact_unavailable'; end if;
-- 
--   if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
--     raise exception 'avora_context_snapshot_type_mismatch';
--   end if;
-- 
--   if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
--   v_self := (p_assignee_id = v_uid);
--   -- Asking yourself is only meaningful in a group. In a 1-1 the other person is the only one
--   -- there is to ask, so naming yourself is a mistake rather than a choice.
--   if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = p_conversation_id and user_id = p_assignee_id
--   ) then
--     raise exception 'avora_task_assignee_not_participant';
--   end if;
-- 
--   -- A quoted message has to belong to this conversation.
--   if p_message_id is not null and not exists (
--     select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
--   ) then
--     raise exception 'avora_context_snapshot_foreign_conversation';
--   end if;
-- 
--   -- Idempotent on retry: the client may replay the same generated id.
--   insert into public.task_suggestions (
--     id, conversation_id, message_id, proposer_id, assignee_id,
--     proposed_title, proposed_description, proposed_deadline,
--     proposed_deadline_time, proposed_deadline_tz, context_snapshot, status
--   )
--   values (
--     v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
--     v_title, v_description, p_deadline,
--     p_deadline_time, v_tz, p_context_snapshot, 'pending'
--   )
--   on conflict (id) do nothing;
-- 
--   -- Work taken on by the person raising it needs no answer, so it is answered here and now,
--   -- through the ordinary acceptance path. Re-running this for an already-accepted row is a
--   -- no-op inside that function, which keeps the whole call idempotent.
--   if v_self then
--     perform public.accept_task_suggestion(v_id, gen_random_uuid());
--   end if;
-- 
--   select * into v_row from public.task_suggestions where id = v_id;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_think_hub_table(p_name text, p_purpose text DEFAULT NULL::text, p_conversation_id uuid DEFAULT NULL::uuid)
--  RETURNS think_hub_table
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_user uuid := auth.uid();
--   v_name text;
--   v_row  think_hub_table%ROWTYPE;
-- BEGIN
--   IF v_user IS NULL THEN
--     RAISE EXCEPTION 'avora_not_signed_in';
--   END IF;
-- 
--   v_name := btrim(coalesce(p_name, ''));
--   IF v_name = '' THEN
--     RAISE EXCEPTION 'avora_think_hub_table_name_required';
--   END IF;
-- 
--   IF p_conversation_id IS NOT NULL
--      AND NOT private.is_conversation_participant(p_conversation_id, v_user) THEN
--     RAISE EXCEPTION 'avora_not_a_participant';
--   END IF;
-- 
--   -- AVORA-37 / A: no new table in a blocked 1-1.
--   IF private.direct_peer_blocked(p_conversation_id, v_user) THEN
--     RAISE EXCEPTION 'avora_contact_unavailable';
--   END IF;
-- 
--   -- Bảng gốc của dự án chỉ sinh cùng dự án; ở đây là bảng độc lập (Diary, 1-1, Nhóm).
--   INSERT INTO think_hub_table (owner_user_id, name, purpose, conversation_id, position)
--   SELECT v_user, v_name, nullif(btrim(coalesce(p_purpose, '')), ''), p_conversation_id,
--          coalesce(max(position), -1) + 1
--   FROM think_hub_table
--   WHERE deleted_at IS NULL AND parent_record_id IS NULL AND project_id IS NULL
--     AND conversation_id IS NOT DISTINCT FROM p_conversation_id
--     AND (p_conversation_id IS NOT NULL OR owner_user_id = v_user)
--   RETURNING * INTO v_row;
-- 
--   RETURN v_row;
-- END;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_think_hub_record(p_table_id uuid, p_title text, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_next_action_date date DEFAULT NULL::date, p_tags text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text, p_extension_fields jsonb DEFAULT NULL::jsonb, p_scope_conversation_id uuid DEFAULT NULL::uuid, p_scope_project_id uuid DEFAULT NULL::uuid)
--  RETURNS think_hub_record
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_user  uuid := auth.uid();
--   v_title text;
--   v_count integer;
--   v_table think_hub_table%ROWTYPE;
--   v_row   think_hub_record%ROWTYPE;
-- BEGIN
--   IF v_user IS NULL THEN
--     RAISE EXCEPTION 'avora_not_signed_in';
--   END IF;
-- 
--   v_title := btrim(coalesce(p_title, ''));
--   IF v_title = '' THEN
--     RAISE EXCEPTION 'avora_think_hub_record_title_required';
--   END IF;
-- 
--   IF p_priority IS NOT NULL AND p_priority NOT IN ('thap', 'trung_binh', 'cao') THEN
--     RAISE EXCEPTION 'avora_think_hub_priority_invalid';
--   END IF;
-- 
--   SELECT * INTO v_table FROM think_hub_table WHERE id = p_table_id AND deleted_at IS NULL;
--   IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
--     RAISE EXCEPTION 'avora_think_hub_table_not_yours';
--   END IF;
-- 
--   -- Bảng phải thuộc đúng ngữ cảnh đang tạo, kể cả khi người gọi có quyền đọc bảng đó.
--   IF v_table.conversation_id IS DISTINCT FROM p_scope_conversation_id
--      OR v_table.project_id IS DISTINCT FROM p_scope_project_id THEN
--     RAISE EXCEPTION 'avora_think_hub_table_out_of_scope';
--   END IF;
-- 
--   -- AVORA-37 / A: no new row in a table that belongs to a blocked 1-1.
--   IF private.direct_peer_blocked(v_table.conversation_id, v_user) THEN
--     RAISE EXCEPTION 'avora_contact_unavailable';
--   END IF;
-- 
--   SELECT count(*) INTO v_count FROM think_hub_record
--   WHERE table_id = p_table_id AND deleted_at IS NULL;
-- 
--   IF v_count >= 1000 THEN
--     RAISE EXCEPTION 'avora_think_hub_record_limit';
--   END IF;
-- 
--   INSERT INTO think_hub_record (
--     table_id, owner_user_id, title, status, priority,
--     category, next_action_date, tags, notes, extension_fields
--   ) VALUES (
--     p_table_id, v_user, v_title,
--     coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'moi'),
--     coalesce(p_priority, 'trung_binh'),
--     nullif(btrim(coalesce(p_category, '')), ''),
--     p_next_action_date,
--     coalesce(p_tags, '{}'),
--     nullif(btrim(coalesce(p_notes, '')), ''),
--     coalesce(p_extension_fields, '{}'::jsonb)
--   ) RETURNING * INTO v_row;
-- 
--   RETURN v_row;
-- END;
-- $function$

-- CREATE OR REPLACE FUNCTION public.create_think_hub_sub_table(p_record_id uuid, p_name text DEFAULT NULL::text, p_purpose text DEFAULT NULL::text)
--  RETURNS think_hub_table
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_user     uuid := auth.uid();
--   v_record   think_hub_record%ROWTYPE;
--   v_parent   think_hub_table%ROWTYPE;
--   v_existing think_hub_table%ROWTYPE;
--   v_name     text;
--   v_row      think_hub_table%ROWTYPE;
-- BEGIN
--   IF v_user IS NULL THEN
--     RAISE EXCEPTION 'avora_not_signed_in';
--   END IF;
-- 
--   SELECT * INTO v_record FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
--   IF NOT FOUND OR NOT private.think_hub_table_visible(v_record.table_id, v_user) THEN
--     RAISE EXCEPTION 'avora_think_hub_record_not_yours';
--   END IF;
-- 
--   SELECT * INTO v_parent FROM think_hub_table WHERE id = v_record.table_id;
--   IF v_parent.deleted_at IS NOT NULL THEN
--     RAISE EXCEPTION 'avora_think_hub_table_missing';
--   END IF;
--   -- AVORA-37 / A: no new sub-table under a table that belongs to a blocked 1-1.
--   IF private.direct_peer_blocked(v_parent.conversation_id, v_user) THEN
--     RAISE EXCEPTION 'avora_contact_unavailable';
--   END IF;
--   IF v_parent.depth >= 3 THEN
--     RAISE EXCEPTION 'avora_think_hub_depth_limit';
--   END IF;
-- 
--   -- Đúng 1 bảng con. Bảng con đã cất đi thì lấy lại thay vì tạo cái thứ hai.
--   SELECT * INTO v_existing FROM think_hub_table WHERE parent_record_id = p_record_id;
--   IF FOUND THEN
--     IF v_existing.deleted_at IS NULL THEN
--       RAISE EXCEPTION 'avora_think_hub_sub_table_exists';
--     END IF;
--     UPDATE think_hub_table SET deleted_at = NULL WHERE id = v_existing.id RETURNING * INTO v_row;
--     RETURN v_row;
--   END IF;
-- 
--   v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_record.title);
-- 
--   INSERT INTO think_hub_table (owner_user_id, name, purpose, parent_record_id, position)
--   VALUES (
--     v_user, v_name,
--     CASE WHEN p_purpose IS NULL THEN 'Theo dõi cho: ' || v_record.title
--          ELSE nullif(btrim(p_purpose), '') END,
--     p_record_id, 0
--   )
--   RETURNING * INTO v_row;
-- 
--   RETURN v_row;
-- END;
-- $function$

-- CREATE OR REPLACE FUNCTION public.invite_task_participant(p_task_id uuid, p_user_id uuid)
--  RETURNS task_participants
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_me uuid := auth.uid();
--   v_task public.tasks%rowtype;
--   v_row public.task_participants%rowtype;
-- begin
--   if v_me is null then raise exception 'avora_not_signed_in'; end if;
--   select * into v_task from public.tasks where id = p_task_id;
--   if not found or v_task.creator_id <> v_me then raise exception 'avora_invite_not_creator'; end if;
--   if v_task.type not in ('1-1-shared','group-shared') or v_task.conversation_id is null then
--     raise exception 'avora_invite_shared_only';
--   end if;
--   if p_user_id = v_me then raise exception 'avora_invite_self'; end if;
--   -- AVORA-37 / A: no invitation inside a blocked 1-1. Groups are untouched.
--   if private.direct_peer_blocked (v_task.conversation_id, v_me) then raise exception 'avora_contact_unavailable'; end if;
--   if not private.is_conversation_participant(v_task.conversation_id, p_user_id) then
--     raise exception 'avora_invite_not_member';
--   end if;
-- 
--   insert into public.task_participants (task_id, user_id, invited_by)
--   values (p_task_id, p_user_id, v_me)
--   on conflict (task_id, user_id) do update
--     set invitation_status = 'pending', invited_by = excluded.invited_by,
--         invited_at = now(), responded_at = null
--     where public.task_participants.invitation_status = 'declined'
--   returning * into v_row;
--   if v_row.id is null then raise exception 'avora_invite_exists'; end if;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_content text)
--  RETURNS messages
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid ();
--   v_row public.messages%rowtype;
--   v_content text := btrim(coalesce(p_content, ''));
-- begin
--   if v_uid is null then
--     raise exception 'avora_not_signed_in';
--   end if;
-- 
--   select
--     * into v_row
--   from
--     public.messages
--   where
--     id = p_message_id
--   for update;
--   if not found then
--     raise exception 'avora_message_not_found';
--   end if;
-- 
--   if v_row.sender_id <> v_uid then
--     raise exception 'avora_message_not_yours';
--   end if;
-- 
--   -- AVORA-37 / A: rewriting an old line is still putting new words into a blocked 1-1.
--   if private.direct_peer_blocked (v_row.conversation_id, v_uid) then
--     raise exception 'avora_contact_unavailable';
--   end if;
-- 
--   -- A withdrawn message has no text to correct; bringing it back would undo the withdrawal.
--   if v_row.deleted_at is not null then
--     raise exception 'avora_message_recalled';
--   end if;
-- 
--   if now() - v_row.created_at > public.message_edit_window () then
--     raise exception 'avora_message_edit_expired';
--   end if;
-- 
--   if v_content = '' then
--     raise exception 'messages_content_not_blank';
--   end if;
--   if char_length(v_content) > 4000 then
--     raise exception 'messages_content_max_len';
--   end if;
-- 
--   -- Rewriting the same words is not an edit, and must not stamp the message as one.
--   if v_content = v_row.content then
--     return v_row;
--   end if;
-- 
--   update
--     public.messages
--   set
--     content = v_content,
--     edited_at = now()
--   where
--     id = p_message_id;
-- 
--   select
--     * into v_row
--   from
--     public.messages
--   where
--     id = p_message_id;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION public.confirm_shared_task(p_task_id uuid)
--  RETURNS tasks
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid();
--   v_row public.tasks%rowtype;
-- begin
--   if v_uid is null then raise exception 'avora_not_signed_in'; end if;
-- 
--   select * into v_row from public.tasks
--   where id = p_task_id and type in ('1-1-shared', 'group-shared');
--   if not found then raise exception 'avora_task_not_found'; end if;
-- 
--   if not exists (
--     select 1 from public.conversation_participants
--     where conversation_id = v_row.conversation_id and user_id = v_uid
--   ) then
--     raise exception 'avora_not_a_participant';
--   end if;
-- 
--   -- Two-party confirmation: the creator cannot confirm their own task.
--   if v_uid = v_row.creator_id then
--     raise exception 'avora_task_self_confirm';
--   end if;
-- 
--   -- In a group, everyone else can see the task but only one person was asked to do it.
--   if not public.is_task_assignee(v_row, v_uid) then
--     raise exception 'avora_task_not_assignee';
--   end if;
-- 
--   if v_row.status = 'pending_confirmation' then
--     insert into public.task_confirmations (task_id, user_id)
--     values (p_task_id, v_uid)
--     on conflict (task_id, user_id) do nothing;
-- 
--     update public.tasks
--     set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
--     where id = p_task_id and status = 'pending_confirmation';
--   end if;
--   -- already confirmed or done: retry is a no-op success
-- 
--   select * into v_row from public.tasks where id = p_task_id;
--   return v_row;
-- end;
-- $function$

-- CREATE OR REPLACE FUNCTION private.assert_contact_available(p_conversation_id uuid, p_user_id uuid)
--  RETURNS boolean
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- begin
--   if private.is_conversation_participant (p_conversation_id, p_user_id)
--      and private.direct_peer_blocked (p_conversation_id, p_user_id) then
--     raise exception 'avora_contact_unavailable';
--   end if;
--   return true;
-- end;
-- $function$

-- POLICY messages."Participants can send messages" [INSERT] TO authenticated
-- WITH CHECK ((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND private.assert_contact_available(conversation_id, ( SELECT auth.uid() AS uid)))

-- POLICY tasks."tasks_insert_creator" [INSERT] TO authenticated
-- WITH CHECK ((creator_id = ( SELECT auth.uid() AS uid)) AND (((type = 'personal'::text) AND (conversation_id IS NULL) AND (status = 'confirmed'::text)) OR ((type = ANY (ARRAY['1-1-shared'::text, 'group-shared'::text])) AND (status = 'pending_confirmation'::text) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)))) AND (NOT private.direct_peer_blocked(conversation_id, ( SELECT auth.uid() AS uid))))

-- POLICY message_attachments."Participants can attach" [INSERT] TO authenticated
-- WITH CHECK ((attached_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
--    FROM messages m
--   WHERE ((m.id = message_attachments.message_id) AND (m.conversation_id = message_attachments.conversation_id) AND (m.sender_id = ( SELECT auth.uid() AS uid))))))

-- POLICY task_lists."task_lists_insert_participant" [INSERT] TO authenticated
-- WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)) AND private.is_conversation_participant(conversation_id, ( SELECT auth.uid() AS uid)) AND (NOT private.direct_peer_blocked(conversation_id, ( SELECT auth.uid() AS uid))))
