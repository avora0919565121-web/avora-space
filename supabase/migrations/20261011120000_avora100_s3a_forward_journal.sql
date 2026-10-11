-- AVORA-100 · S.3 (a) (KHỐI 3B) — Mọi file trong Nhật ký đều chuyển tiếp được.
--
-- ADR-012 holds: a forward points at the original file, no byte is copied.
-- • A file of `File của tôi` (a journal message's file, chat-attachments) → new message in the
--   target with the same storage path, at the permission I choose.
-- • A file attached in a ghi chép (note-files) → the pointer is written `note-files:{path}` in
--   message_attachments.storage_path; the note-files bucket lets members of that conversation read
--   exactly those objects, and the owner can no longer delete an object someone was sent.
-- • A whole ghi chép → `messages.note_card` (a snapshot of the title and its levelled lines) plus
--   its files as above. The recipient reads it, never edits the original; `Lưu vào Nhật ký`
--   makes their own note from the snapshot.
-- Két sắt files never come through here (they are not in these tables — ADR-068).

alter table public.messages add column if not exists note_card jsonb null;
alter table public.messages drop constraint if exists messages_note_card_shape;
alter table public.messages add constraint messages_note_card_shape check (
  note_card is null or (
    jsonb_typeof(note_card -> 'title') = 'string'
    and jsonb_typeof(note_card -> 'blocks') = 'array'
    and jsonb_array_length(note_card -> 'blocks') <= 2000
  )
);

-- A ghi chép card is a message on its own, even with no words and no file.
alter table public.messages drop constraint if exists messages_content_not_blank;
alter table public.messages add constraint messages_content_not_blank check (
  btrim(content) <> '' or deleted_at is not null or attachment_count > 0 or contact_card_user_id is not null
  or sticker_id is not null or note_card is not null
);

-- Recipients read a forwarded note file; the owner keeps their own folder rule.
drop policy if exists note_files_read_shared on storage.objects;
create policy note_files_read_shared on storage.objects for select to authenticated
using (
  bucket_id = 'note-files'
  and exists (
    select 1 from public.message_attachments a
    where a.storage_path = 'note-files:' || objects.name
      and private.can_act_in(a.conversation_id, (select auth.uid()), 'sign')
  )
);
drop policy if exists note_files_delete_own on storage.objects;
create policy note_files_delete_own on storage.objects for delete to authenticated
using (
  bucket_id = 'note-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (select 1 from public.message_attachments a where a.storage_path = 'note-files:' || objects.name)
);

create or replace function private.assert_forward_target(p_target uuid, p_uid uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_conversation_participant(p_target, p_uid) then raise exception 'avora_not_a_participant'; end if;
  perform private.assert_direct_talk(p_target, p_uid, 'rich');
  perform private.assert_can_act_in(p_target, p_uid, 'send');
end $$;
revoke execute on function private.assert_forward_target(uuid, uuid) from public, anon, authenticated;

create or replace function private.check_permission(p text)
returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p not in ('view', 'forward', 'export') then raise exception 'avora_bad_permission'; end if;
  return p;
end $$;

/** A file from `File của tôi`: one of my own journal messages, its files at the permission I choose. */
create or replace function public.forward_journal_file(p_message_id uuid, p_target uuid, p_permission text default 'export')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_src public.messages%rowtype;
  v_new uuid := gen_random_uuid();
  v_count int;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.check_permission(p_permission);
  perform private.assert_forward_target(p_target, v_uid);
  select m.* into v_src from public.messages m join public.conversations c on c.id = m.conversation_id
   where m.id = p_message_id and c.type = 'personal' and m.sender_id = v_uid and m.deleted_at is null;
  if v_src.id is null then raise exception 'avora_not_my_journal'; end if;
  select count(*) into v_count from public.message_attachments where message_id = v_src.id;
  if v_count = 0 then raise exception 'avora_nothing_to_forward'; end if;
  insert into public.messages (id, conversation_id, sender_id, content, mentioned_user_ids, attachment_count, origin_content_id, origin_sender_id)
  values (v_new, p_target, v_uid, '', '{}', v_count, v_src.id, v_uid);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id)
  select v_new, p_target, v_uid, a.kind, a.storage_path, a.file_name, a.mime_type, a.byte_size, a.width, a.height, a.duration_seconds, p_permission, a.message_id
    from public.message_attachments a where a.message_id = v_src.id;
  return v_new;
end $$;
revoke execute on function public.forward_journal_file(uuid, uuid, text) from public, anon;
grant execute on function public.forward_journal_file(uuid, uuid, text) to authenticated;

create or replace function private.note_kind(p_kind text, p_mime text)
returns text
language sql immutable set search_path = '' as $$
  select case when p_kind in ('image', 'file', 'voice') then p_kind
              when coalesce(p_mime, '') like 'image/%' then 'image'
              when coalesce(p_mime, '') like 'audio/%' then 'voice'
              else 'file' end
$$;

/** Files attached in my ghi chép (note-files), by id. One message carries them. */
create or replace function public.forward_note_files(p_attachment_ids uuid[], p_target uuid, p_permission text default 'export')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_new uuid := gen_random_uuid();
  v_count int;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.check_permission(p_permission);
  perform private.assert_forward_target(p_target, v_uid);
  if coalesce(array_length(p_attachment_ids, 1), 0) = 0 or array_length(p_attachment_ids, 1) > 10 then raise exception 'avora_nothing_to_forward'; end if;
  select count(*) into v_count from public.note_attachments n
   where n.id = any (p_attachment_ids) and n.owner_user_id = v_uid;
  if v_count <> array_length(p_attachment_ids, 1) then raise exception 'avora_not_my_note'; end if;
  insert into public.messages (id, conversation_id, sender_id, content, mentioned_user_ids, attachment_count, origin_sender_id)
  values (v_new, p_target, v_uid, '', '{}', v_count, v_uid);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, duration_seconds, permission)
  select v_new, p_target, v_uid, private.note_kind(n.kind, n.mime_type), 'note-files:' || n.storage_path, n.file_name,
         coalesce(n.mime_type, 'application/octet-stream'), greatest(1, coalesce(n.byte_size, 1)), n.duration_seconds, p_permission
    from public.note_attachments n where n.id = any (p_attachment_ids) and n.owner_user_id = v_uid;
  return v_new;
end $$;
revoke execute on function public.forward_note_files(uuid[], uuid, text) from public, anon;
grant execute on function public.forward_note_files(uuid[], uuid, text) to authenticated;

/** A whole ghi chép: a snapshot of its title and levelled lines, with its files pointed at. */
create or replace function public.forward_note(p_note_id uuid, p_target uuid, p_permission text default 'export')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_note public.notes%rowtype;
  v_new uuid := gen_random_uuid();
  v_count int;
  v_card jsonb;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.check_permission(p_permission);
  perform private.assert_forward_target(p_target, v_uid);
  select * into v_note from public.notes where id = p_note_id and owner_user_id = v_uid and deleted_at is null;
  if v_note.id is null then raise exception 'avora_not_my_note'; end if;
  v_card := jsonb_build_object(
    'title', coalesce(nullif(btrim(v_note.title), ''), 'Ghi chép'),
    'note_id', v_note.id,
    'blocks', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'text', coalesce(b ->> 'text', ''),
               'level', coalesce((b ->> 'level')::int, 0),
               'style', b -> 'style',
               'numbering', b -> 'numbering')) order by ord)
        from jsonb_array_elements(coalesce(v_note.blocks, '[]'::jsonb)) with ordinality as t(b, ord)), '[]'::jsonb)
  );
  select count(*) into v_count from public.note_attachments where note_id = v_note.id and owner_user_id = v_uid;
  insert into public.messages (id, conversation_id, sender_id, content, mentioned_user_ids, attachment_count, origin_sender_id, note_card)
  values (v_new, p_target, v_uid, '', '{}', v_count, v_uid, v_card);
  insert into public.message_attachments (message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, duration_seconds, permission)
  select v_new, p_target, v_uid, private.note_kind(n.kind, n.mime_type), 'note-files:' || n.storage_path, n.file_name,
         coalesce(n.mime_type, 'application/octet-stream'), greatest(1, coalesce(n.byte_size, 1)), n.duration_seconds, p_permission
    from public.note_attachments n where n.note_id = v_note.id and n.owner_user_id = v_uid;
  return v_new;
end $$;
revoke execute on function public.forward_note(uuid, uuid, text) from public, anon;
grant execute on function public.forward_note(uuid, uuid, text) to authenticated;

/**
 * `Lưu vào Nhật ký`: the recipient's own ghi chép, made from the snapshot (text and levels only —
 * the files stay where they were sent, at the sender's permission). The original is never touched.
 */
create or replace function public.save_note_card(p_message_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages%rowtype;
  v_id uuid := gen_random_uuid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_msg from public.messages where id = p_message_id and note_card is not null and deleted_at is null;
  if v_msg.id is null or not private.can_act_in(v_msg.conversation_id, v_uid, 'read') then raise exception 'avora_not_a_participant'; end if;
  insert into public.notes (id, owner_user_id, folder_id, title, blocks)
  values (
    v_id, v_uid, null, left(v_msg.note_card ->> 'title', 300),
    coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', substr(md5(v_id::text || ord::text), 1, 12),
               'text', coalesce(b ->> 'text', ''),
               'level', coalesce((b ->> 'level')::int, 0),
               'style', b -> 'style',
               'numbering', b -> 'numbering')) order by ord)
        from jsonb_array_elements(v_msg.note_card -> 'blocks') with ordinality as t(b, ord)), '[]'::jsonb)
  );
  return v_id;
end $$;
revoke execute on function public.save_note_card(uuid) from public, anon;
grant execute on function public.save_note_card(uuid) to authenticated;
