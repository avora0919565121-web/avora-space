-- Đợt gộp 2 · B1: forwarding two or more messages makes ONE message carrying the conversation
-- as words only (speaker's public name + text). No sender ids, PIN, email, phone or avatar.

alter table public.messages
  add column if not exists forward_bundle jsonb null;

alter table public.messages drop constraint if exists messages_forward_bundle_object;
alter table public.messages
  add constraint messages_forward_bundle_object
  check (forward_bundle is null or jsonb_typeof(forward_bundle) = 'object');

-- SELECT on messages is granted table-wide, so the new column is readable like the rest.
-- Clients never write it: INSERT is column-granted and does not include forward_bundle.
revoke insert (forward_bundle), update (forward_bundle) on public.messages from authenticated;

create or replace function public.forward_messages_as_bundle(
  p_message_ids uuid[],
  p_target_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_source_conv uuid;
  v_conv_count integer;
  v_items jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  v_first timestamptz;
  v_last timestamptz;
  v_count integer := 0;
  v_files_left integer := 0;
  v_row record;
  v_name text;
  v_text text;
  v_files integer;
  v_summary text;
  v_new_id uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_target_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  -- Blocked pair → avora_contact_unavailable; verification frame → avora_verification_text_only;
  -- no longer bạn → avora_not_connected. The same gate every rich write into a 1-1 goes through.
  perform private.assert_direct_talk(p_target_conversation_id, v_uid, 'rich');

  if coalesce(array_length(p_message_ids, 1), 0) < 2 then raise exception 'avora_forward_bundle_min_two'; end if;
  if array_length(p_message_ids, 1) > 50 then raise exception 'avora_forward_too_many'; end if;

  select count(distinct m.conversation_id), min(m.conversation_id::text)::uuid
    into v_conv_count, v_source_conv
  from public.messages m where m.id = any(p_message_ids);
  if v_conv_count = 0 then raise exception 'avora_not_a_participant'; end if;
  if v_conv_count > 1 then raise exception 'avora_forward_bundle_mixed'; end if;
  if not private.is_conversation_participant(v_source_conv, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  for v_row in
    select m.id, m.sender_id, m.content, m.created_at, m.attachment_count, m.forward_bundle
    from public.messages m
    where m.id = any(p_message_ids)
      and m.deleted_at is null
      and m.system_kind is null
    order by m.created_at, m.id
  loop
    select coalesce(nullif(btrim(p.display_name), ''), 'Thành viên AVORA') into v_name
    from public.profiles p where p.id = v_row.sender_id;
    v_name := coalesce(v_name, 'Thành viên AVORA');

    if v_row.forward_bundle is not null then
      -- Never nested: a forwarded bundle inside a bundle is one line saying so.
      v_text := format('[Đoạn hội thoại được chuyển tiếp · %s tin]', coalesce(v_row.forward_bundle->>'count', '?'));
      v_files := 0;
    else
      v_text := v_row.content;
      v_files := coalesce(v_row.attachment_count, 0);
    end if;
    v_files_left := v_files_left + v_files;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'at', v_row.created_at, 'text', v_text, 'files', v_files
    ));
    if not (v_name = any(v_names)) then v_names := v_names || v_name; end if;
    v_first := coalesce(v_first, v_row.created_at);
    v_last := v_row.created_at;
    v_count := v_count + 1;
  end loop;

  if v_count < 2 then raise exception 'avora_forward_bundle_min_two'; end if;

  v_summary := format('Đoạn hội thoại · %s tin · %s%s',
    v_count,
    array_to_string(v_names[1:3], ', '),
    case when array_length(v_names, 1) > 3 then format(' +%s', array_length(v_names, 1) - 3) else '' end);
  v_summary := left(v_summary, 4000);

  insert into public.messages (
    id, conversation_id, sender_id, content, mentioned_user_ids, attachment_count, forward_bundle
  ) values (
    v_new_id, p_target_conversation_id, v_uid, v_summary, '{}', 0,
    jsonb_build_object('v', 1, 'count', v_count, 'first_at', v_first, 'last_at', v_last, 'items', v_items)
  );

  return jsonb_build_object('forwarded', v_count, 'files_left_behind', v_files_left, 'message_id', v_new_id);
end;
$$;

revoke all on function public.forward_messages_as_bundle(uuid[], uuid) from public, anon;
grant execute on function public.forward_messages_as_bundle(uuid[], uuid) to authenticated;

-- forward_messages (one message): a bundle forwarded on is the same bundle, never nested.
create or replace function public.forward_messages(p_message_ids uuid[], p_target_conversation_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  perform private.assert_direct_talk (p_target_conversation_id, v_uid, 'rich');

  if coalesce(array_length(p_message_ids, 1), 0) = 0 then
    return jsonb_build_object('forwarded', 0, 'files_carried', 0, 'files_blocked', 0);
  end if;

  if array_length(p_message_ids, 1) > 50 then
    raise exception 'avora_forward_too_many';
  end if;

  for v_source in
    select * from public.messages
    where id = any (p_message_ids)
    order by created_at, id
  loop
    if not private.is_conversation_participant (v_source.conversation_id, v_uid) then
      raise exception 'avora_not_a_participant';
    end if;

    if v_source.deleted_at is not null then
      continue;
    end if;

    select
      count(*) filter (where permission in ('forward', 'export')),
      count(*) filter (where permission = 'view')
    into v_allowed, v_denied
    from public.message_attachments
    where message_id = v_source.id;

    v_content := v_source.content;

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
      mentioned_user_ids, attachment_count, origin_content_id, origin_sender_id, forward_bundle
    )
    values (
      v_new_id,
      p_target_conversation_id,
      v_uid,
      v_content,
      '{}',
      v_allowed,
      v_source.id,
      v_source.sender_id,
      v_source.forward_bundle
    );

    insert into public.message_attachments (
      message_id, conversation_id, attached_by, kind, storage_path, file_name,
      mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id
    )
    select
      v_new_id, p_target_conversation_id, v_uid, a.kind, a.storage_path, a.file_name,
      a.mime_type, a.byte_size, a.width, a.height, a.duration_seconds, a.permission, a.message_id
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
