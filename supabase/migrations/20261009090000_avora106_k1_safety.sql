-- AVORA-106 · K1 — An toàn. "Không còn trong cuộc = không có gì" (VMT 08/10 16:51).
--
-- One helper decides every chat action: private.can_act_in(conversation, uid, action).
-- Writes to messages / message_attachments go through RPCs only (M1, M3); every RPC that touches a
-- message checks can_act_in (M2); realtime topics are per conversation (M4, M5); the bucket refuses
-- dangerous files and > 50 MB (L2, L3); mentions ≤ 20 (L4); join / push ownership fixed (L5, L6);
-- rate limits (L8). Leaving a group hands its tasks back (K1.4).

-- ============================================================ helper
create table if not exists private.chat_rate_events (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists chat_rate_events_user_kind_at on private.chat_rate_events (user_id, kind, at desc);
revoke all on private.chat_rate_events from public, anon, authenticated;

/**
 * The one rule. `read` = still a member (a closed Dự án stays readable); every other action also
 * needs the project open; 1-1 actions other than read keep the block / bạn gate (ADR-029).
 * Actions: read · send · edit · recall · pin · react · mark · sign.
 */
create or replace function private.can_act_in(p_conversation uuid, p_uid uuid, p_action text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_type text; v_deleted timestamptz;
begin
  if p_conversation is null or p_uid is null then return false; end if;
  select c.type, c.deleted_at into v_type, v_deleted from public.conversations c where c.id = p_conversation;
  if v_type is null then return false; end if;
  if not exists (select 1 from public.conversation_participants cp where cp.conversation_id = p_conversation and cp.user_id = p_uid) then
    return false;
  end if;
  if p_action in ('read', 'sign', 'mark') then return true; end if;
  if v_deleted is not null then return false; end if;
  if private.conversation_project_closed(p_conversation) then return false; end if;
  if v_type = 'direct' and private.direct_peer_blocked(p_conversation, p_uid) then return false; end if;
  return true;
end $$;
revoke execute on function private.can_act_in(uuid, uuid, text) from public, anon, authenticated;

/** Same rule, raising the error the app already translates. */
create or replace function private.assert_can_act_in(p_conversation uuid, p_uid uuid, p_action text)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from public.conversation_participants cp where cp.conversation_id = p_conversation and cp.user_id = p_uid) then
    raise exception 'avora_not_a_participant' using errcode = '42501';
  end if;
  if not private.can_act_in(p_conversation, p_uid, p_action) then
    if private.conversation_project_closed(p_conversation) then raise exception 'avora_project_chat_closed'; end if;
    raise exception 'avora_contact_unavailable';
  end if;
end $$;
revoke execute on function private.assert_can_act_in(uuid, uuid, text) from public, anon, authenticated;

/** L8: n events of a kind in a window. Records the event when allowed. */
create or replace function private.rate_take(p_uid uuid, p_kind text, p_limit int, p_window interval)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid::text || p_kind, 0));
  if (select count(*) from private.chat_rate_events e where e.user_id = p_uid and e.kind = p_kind and e.at > now() - p_window) >= p_limit then
    raise exception 'avora_rate_limited';
  end if;
  insert into private.chat_rate_events (user_id, kind) values (p_uid, p_kind);
end $$;
revoke execute on function private.rate_take(uuid, text, int, interval) from public, anon, authenticated;

-- ============================================================ M1 / L1 / L2 / L3: files
/** Ends that are never accepted, by name or by real type (L2). */
create or replace function private.attachment_blocked(p_name text, p_mime text)
returns boolean
language sql immutable set search_path = '' as $$
  select lower(coalesce(p_name, '')) ~ '\.(exe|msi|bat|cmd|sh|apk|ipa|dmg|js|mjs|jar|scr|html|htm|svg|svgz|xhtml|xht)$'
      or lower(coalesce(p_mime, '')) ~ '^(text/html|application/xhtml|image/svg|application/javascript|text/javascript|application/x-msdownload|application/x-msdos-program|application/vnd\.android\.package-archive|application/x-sh|application/java-archive|application/x-apple-diskimage)'
$$;
revoke execute on function private.attachment_blocked(text, text) from public, anon, authenticated;

update storage.buckets set file_size_limit = 52428800 where id = 'chat-attachments';

alter table public.message_attachments drop constraint if exists message_attachments_byte_size_check;
alter table public.message_attachments add constraint message_attachments_byte_size_check check (byte_size > 0 and byte_size <= 52428800);

-- Storage refuses the dangerous ends at upload too (the bucket's mime list cannot express "all but").
drop policy if exists chat_attachments_write_participants on storage.objects;
create policy chat_attachments_write_participants on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.can_act_in(((storage.foldername(name))[1])::uuid, (select auth.uid()), 'send')
  and not private.attachment_blocked(name, coalesce(metadata ->> 'mimetype', ''))
);

-- Reading a file = still in a conversation that holds it (K1.3: `sign` is membership).
drop policy if exists chat_attachments_read_participants on storage.objects;
create policy chat_attachments_read_participants on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and exists (
    select 1 from public.message_attachments a
    where a.storage_path = objects.name and private.can_act_in(a.conversation_id, (select auth.uid()), 'sign')
  )
);

-- M1: no direct attach. Only the RPCs below write here.
revoke insert on public.message_attachments from authenticated, anon;
drop policy if exists "Participants can attach" on public.message_attachments;

drop policy if exists "Participants can read attachments" on public.message_attachments;
create policy "Participants can read attachments" on public.message_attachments for select to authenticated
using (private.can_act_in(conversation_id, (select auth.uid()), 'read'));

-- ============================================================ M3: one send RPC
revoke insert on public.messages from authenticated, anon;
drop policy if exists "Participants can send messages" on public.messages;

drop policy if exists "Participants can read messages" on public.messages;
create policy "Participants can read messages" on public.messages for select to authenticated
using (private.can_act_in(conversation_id, (select auth.uid()), 'read'));

/**
 * The only way a person writes a message (text, files, both). The id comes from the device so a
 * retry returns the same message (K2 · C1); created_at, sender, system_kind and origin are the
 * server's. Files must sit in this conversation's folder, really exist, and are described by
 * storage (size, type), not by the device.
 */
create or replace function public.send_message(
  p_id uuid,
  p_conversation uuid,
  p_content text default '',
  p_reply_to uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_refs jsonb default null,
  p_mentioned uuid[] default '{}'::uuid[],
  p_origin_group uuid default null,
  p_daily_thought text default null,
  p_urgent boolean default false
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.messages%rowtype;
  v_count int := coalesce(jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)), 0);
  v_content text := btrim(coalesce(p_content, ''));
  v_item jsonb;
  v_path text;
  v_obj record;
  v_total bigint := 0;
  v_size bigint;
  v_mime text;
  v_kind text;
  v_dur numeric;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_id is null then raise exception 'avora_message_id_required'; end if;

  -- C1: the same id twice is the same message — return it, never a second one.
  select * into v_row from public.messages m where m.id = p_id;
  if v_row.id is not null then
    if v_row.sender_id <> v_uid then raise exception 'avora_message_id_taken'; end if;
    return v_row;
  end if;

  perform private.assert_can_act_in(p_conversation, v_uid, 'send');
  perform private.assert_direct_talk(p_conversation, v_uid, case when v_count > 0 then 'attachment' else 'text' end);

  -- L8: 5 / second, 30 / minute.
  perform private.rate_take(v_uid, 'msg_s', 5, interval '1 second');
  perform private.rate_take(v_uid, 'msg_m', 30, interval '1 minute');

  if v_count > 10 then raise exception 'avora_attachment_too_many'; end if;
  if v_content = '' and v_count = 0 then raise exception 'messages_content_not_blank'; end if;
  if coalesce(array_length(p_mentioned, 1), 0) > 20 then raise exception 'avora_mentions_too_many'; end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages r where r.id = p_reply_to and r.conversation_id = p_conversation
  ) then
    raise exception 'avora_reply_out_of_scope';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_path := v_item ->> 'storage_path';
    if v_path is null or v_path not like (p_conversation::text || '/%') or v_path like '%..%' then
      raise exception 'avora_attachment_path_invalid';
    end if;
    select o.owner_id, o.metadata into v_obj from storage.objects o where o.bucket_id = 'chat-attachments' and o.name = v_path;
    if not found then raise exception 'avora_attachment_missing'; end if;
    if v_obj.owner_id is distinct from v_uid::text then raise exception 'avora_attachment_path_invalid'; end if;
    if exists (select 1 from public.message_attachments a where a.storage_path = v_path) then
      raise exception 'avora_attachment_path_invalid';
    end if;
    v_size := coalesce((v_obj.metadata ->> 'size')::bigint, 0);
    v_mime := coalesce(nullif(v_obj.metadata ->> 'mimetype', ''), 'application/octet-stream');
    if private.attachment_blocked(v_path, v_mime) or private.attachment_blocked(v_item ->> 'file_name', v_mime) then
      raise exception 'avora_attachment_type_blocked';
    end if;
    v_dur := nullif(v_item ->> 'duration_seconds', '')::numeric;
    if v_mime like 'video/%' then
      if v_size > 52428800 then raise exception 'avora_attachment_too_large'; end if;
      if v_dur is not null and v_dur > 180 then raise exception 'avora_video_too_long'; end if;
    elsif v_size > 26214400 then
      raise exception 'avora_attachment_too_large';
    end if;
    v_total := v_total + v_size;
  end loop;
  if v_total > 104857600 then raise exception 'avora_attachment_total_too_large'; end if;

  insert into public.messages (
    id, conversation_id, sender_id, content, reply_to_message_id, mentioned_user_ids, origin_group_id,
    attachment_count, refs, reply_to_daily_thought_id, is_urgent
  ) values (
    p_id, p_conversation, v_uid, v_content, p_reply_to, coalesce(p_mentioned, '{}'), p_origin_group,
    v_count, case when p_refs is null or jsonb_array_length(p_refs) = 0 then null else p_refs end,
    p_daily_thought, coalesce(p_urgent, false)
  );

  insert into public.message_attachments (
    message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size,
    width, height, duration_seconds, permission, capture_source
  )
  select p_id, p_conversation, v_uid,
    case when item ->> 'kind' = 'voice' then 'voice'
         when o.metadata ->> 'mimetype' like 'image/%' then 'image' else 'file' end,
    item ->> 'storage_path',
    left(coalesce(nullif(btrim(item ->> 'file_name'), ''), 'tep'), 255),
    coalesce(nullif(o.metadata ->> 'mimetype', ''), 'application/octet-stream'),
    greatest(coalesce((o.metadata ->> 'size')::bigint, 1), 1),
    nullif(item ->> 'width', '')::int,
    nullif(item ->> 'height', '')::int,
    least(nullif(item ->> 'duration_seconds', '')::numeric, 300),
    case when item ->> 'permission' in ('view', 'forward', 'export') then item ->> 'permission' else 'export' end,
    case when (o.metadata ->> 'mimetype' like 'image/%' or o.metadata ->> 'mimetype' like 'video/%')
              and item ->> 'capture_source' in ('camera', 'library') then item ->> 'capture_source' end
  from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) item
  join storage.objects o on o.bucket_id = 'chat-attachments' and o.name = item ->> 'storage_path';

  select * into v_row from public.messages m where m.id = p_id;
  return v_row;
end $$;
revoke execute on function public.send_message(uuid, uuid, text, uuid, jsonb, jsonb, uuid[], uuid, text, boolean) from public, anon;
grant execute on function public.send_message(uuid, uuid, text, uuid, jsonb, jsonb, uuid[], uuid, text, boolean) to authenticated;

-- The old file RPC now rides the one send path (same checks, same limits).
create or replace function public.send_message_with_attachments(
  p_conversation_id uuid, p_content text, p_reply_to_message_id uuid default null,
  p_mentioned_user_ids uuid[] default '{}'::uuid[], p_origin_group_id uuid default null, p_attachments jsonb default '[]'::jsonb
) returns public.messages
language sql security definer set search_path = '' as $$
  select * from public.send_message(gen_random_uuid(), p_conversation_id, p_content, p_reply_to_message_id,
    p_attachments, null, p_mentioned_user_ids, p_origin_group_id, null, false)
$$;
revoke execute on function public.send_message_with_attachments(uuid, text, uuid, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.send_message_with_attachments(uuid, text, uuid, uuid[], uuid, jsonb) to authenticated;

-- L4: ≤ 20 @ per message, whoever writes it.
create or replace function public.enforce_message_mentions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_person uuid;
begin
  if new.mentioned_user_ids = '{}' then return new; end if;
  if tg_op = 'UPDATE' and new.mentioned_user_ids is distinct from old.mentioned_user_ids then
    raise exception 'avora_message_mentions_immutable';
  end if;
  if tg_op = 'INSERT' then
    if coalesce(array_length(new.mentioned_user_ids, 1), 0) > 20 then raise exception 'avora_mentions_too_many'; end if;
    foreach v_person in array new.mentioned_user_ids loop
      if not private.is_conversation_participant(new.conversation_id, v_person) then
        raise exception 'avora_message_mention_not_participant';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- ============================================================ M2: every message action checks can_act_in
create or replace function public.edit_message(p_message_id uuid, p_content text)
returns public.messages
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.messages%rowtype; v_content text := btrim(coalesce(p_content, ''));
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.messages where id = p_message_id for update;
  if not found then raise exception 'avora_message_not_found'; end if;
  perform private.assert_can_act_in(v_row.conversation_id, v_uid, 'edit');
  if v_row.sender_id <> v_uid then raise exception 'avora_message_not_yours'; end if;
  perform private.assert_direct_talk(v_row.conversation_id, v_uid, 'reaction');
  if v_row.deleted_at is not null then raise exception 'avora_message_recalled'; end if;
  if now() - v_row.created_at > public.message_edit_window() then raise exception 'avora_message_edit_expired'; end if;
  if v_content = '' then raise exception 'messages_content_not_blank'; end if;
  if char_length(v_content) > 4000 then raise exception 'messages_content_max_len'; end if;
  if v_content = v_row.content then return v_row; end if;
  update public.messages set content = v_content, edited_at = now() where id = p_message_id;
  select * into v_row from public.messages where id = p_message_id;
  return v_row;
end $$;

create or replace function public.recall_message(p_message_id uuid)
returns public.messages
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.messages%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.messages where id = p_message_id for update;
  if not found then raise exception 'avora_message_not_found'; end if;
  perform private.assert_can_act_in(v_row.conversation_id, v_uid, 'recall');
  if v_row.sender_id <> v_uid then raise exception 'avora_message_not_yours'; end if;
  if v_row.deleted_at is not null then return v_row; end if;
  if now() - v_row.created_at > public.message_edit_window() then raise exception 'avora_message_recall_expired'; end if;
  delete from public.message_attachments where message_id = p_message_id;
  update public.messages set content = '', deleted_at = now() where id = p_message_id;
  select * into v_row from public.messages where id = p_message_id;
  return v_row;
end $$;

-- pin_message: add the gate at the top, keep the rest of its body as it was.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.pin_message(uuid, text)'::regprocedure);
  v_def := replace(v_def,
    E'  if not private.is_conversation_participant (v_conversation, v_uid) then\n    raise exception ''avora_not_a_participant'';\n  end if;',
    E'  perform private.assert_can_act_in (v_conversation, v_uid, ''pin'');');
  if position('assert_can_act_in' in v_def) = 0 then raise exception 'K1: pin_message body changed, gate not placed'; end if;
  execute v_def;
end $do$;

-- Reactions: membership + 1-1 gate on every write, rate 60 / minute.
create or replace function private.reaction_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conv uuid;
begin
  select m.conversation_id into v_conv from public.messages m where m.id = new.message_id;
  if not private.can_act_in(v_conv, auth.uid(), 'react') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then perform private.rate_take(auth.uid(), 'react', 60, interval '1 minute'); end if;
  return new;
end $$;
drop trigger if exists message_reactions_guard on public.message_reactions;
create trigger message_reactions_guard before insert or update on public.message_reactions
for each row when (auth.uid() is not null) execute function private.reaction_guard();

drop policy if exists message_reactions_select_participant on public.message_reactions;
create policy message_reactions_select_participant on public.message_reactions for select to authenticated
using (exists (select 1 from public.messages m where m.id = message_reactions.message_id
               and private.can_act_in(m.conversation_id, (select auth.uid()), 'read')));
drop policy if exists message_reactions_delete_own on public.message_reactions;
create policy message_reactions_delete_own on public.message_reactions for delete to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.messages m where m.id = message_reactions.message_id
               and private.can_act_in(m.conversation_id, (select auth.uid()), 'react')));

drop policy if exists message_pins_select_visible on public.message_pins;
create policy message_pins_select_visible on public.message_pins for select to authenticated
using (private.can_act_in(conversation_id, (select auth.uid()), 'read')
       and (scope = 'group' or (scope = 'personal' and pinned_by = (select auth.uid()))));

-- ============================================================ M4 / M5: realtime per conversation
create or replace function private.realtime_topic_ok(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  -- Typing / online, and (K3) the per-conversation broadcast.
  if p_topic ~ '^(thread|conv)-[0-9a-f-]{36}$' then
    return private.can_act_in(substr(p_topic, strpos(p_topic, '-') + 1)::uuid, auth.uid(), 'read');
  end if;
  -- Per-person topic (list of conversations, tasks, invitations): only its owner.
  if p_topic ~ '^user-[0-9a-f-]{36}$' then
    return substr(p_topic, 6)::uuid = auth.uid();
  end if;
  -- `avora-milestone` is gone: milestone bursts ride `conv-<id>` now.
  return false;
end $$;
revoke execute on function private.realtime_topic_ok(text) from public, anon;

-- ============================================================ K1.4: leaving hands tasks back
/** After someone leaves a Nhóm / Dự án: their assigned tasks return to the one who assigned them. */
create or replace function private.on_participant_left()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_task record; v_type text; v_name text;
begin
  select c.type into v_type from public.conversations c where c.id = old.conversation_id;
  if v_type is distinct from 'group' then return old; end if;
  v_name := private.push_display_name(old.user_id);
  for v_task in
    select t.id, t.creator_id, t.title from public.tasks t
    where t.conversation_id = old.conversation_id and t.assignee_id = old.user_id
      and t.creator_id <> old.user_id and t.status not in ('done', 'skipped')
  loop
    update public.tasks set assignee_id = v_task.creator_id where id = v_task.id;
    -- ADR-030: the receiver's own part goes with them.
    delete from public.task_flags where task_id = v_task.id and user_id = old.user_id;
    delete from public.task_reminders where task_id = v_task.id and user_id = old.user_id;
    delete from public.task_participants where task_id = v_task.id and user_id = old.user_id;
    perform set_config('avora.project_system', 'on', true);
    insert into public.messages (conversation_id, sender_id, content, system_kind)
    values (old.conversation_id, v_task.creator_id,
            v_name || ' đã rời nhóm — việc "' || left(v_task.title, 80) || '" trả về ' || private.push_display_name(v_task.creator_id),
            'member_left_task');
    perform set_config('avora.project_system', '', true);
  end loop;
  -- Nothing of this conversation keeps waking them up.
  delete from public.push_outbox where user_id = old.user_id and conversation_id = old.conversation_id and sent_at is null;
  return old;
end $$;
revoke execute on function private.on_participant_left() from public, anon, authenticated;

alter table public.messages drop constraint if exists messages_system_kind_check;
alter table public.messages add constraint messages_system_kind_check check (system_kind is null or system_kind = any (array[
  'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected', 'proposal_expired', 'proposal_withdrawn',
  'shared_restored', 'recall_expired', 'member_added', 'column_delete_requested', 'board_update', 'board_created',
  'board_shared', 'board_moved', 'member_left_task']));

drop trigger if exists conversation_participants_left on public.conversation_participants;
create trigger conversation_participants_left after delete on public.conversation_participants
for each row execute function private.on_participant_left();

-- ============================================================ L5 / L6
create or replace function public.join_group_with_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_conv uuid; v_owner uuid; v_deleted timestamptz;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select l.conversation_id into v_conv from public.group_invite_links l
  where l.token = p_token and l.revoked_at is null and l.expires_at > now();
  if v_conv is null then raise exception 'Invite link not found'; end if;
  select c.deleted_at into v_deleted from public.conversations c where c.id = v_conv;
  if v_deleted is not null then raise exception 'Invite link not found'; end if;
  if exists (select 1 from public.conversation_participants where conversation_id = v_conv and user_id = v_uid) then
    return v_conv;
  end if;
  -- Someone who blocked / was blocked by the owner does not come in through a link.
  select g.owner_id into v_owner from public.conversation_groups g where g.conversation_id = v_conv;
  if v_owner is not null and private.is_blocked_between(v_uid, v_owner) then raise exception 'Invite link not found'; end if;
  insert into public.conversation_participants (conversation_id, user_id, role) values (v_conv, v_uid, 'member');
  return v_conv;
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device_label text)
returns public.push_subscriptions
language plpgsql security definer set search_path = '' as $$
declare v public.push_subscriptions%rowtype; v_uid uuid := auth.uid(); v_owner uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select s.user_id into v_owner from public.push_subscriptions s where s.endpoint = btrim(p_endpoint);
  -- An endpoint is a browser's mailbox. Another account cannot take it over by naming it; the old
  -- account signs out of that browser (and frees it) first.
  if v_owner is not null and v_owner <> v_uid then
    delete from public.push_subscriptions s where s.endpoint = btrim(p_endpoint) and s.user_id = v_owner
      and not exists (select 1 from auth.sessions x where x.user_id = v_owner);
    if found is false then raise exception 'avora_push_endpoint_taken'; end if;
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_uid, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(coalesce(nullif(btrim(p_device_label), ''), 'Thiết bị'), 80))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label
    where public.push_subscriptions.user_id = excluded.user_id
  returning * into v;
  return v;
end $$;

-- ============================================================ read / delivered / unread: members only
do $do$
declare f text; v_def text;
begin
  foreach f in array array['public.mark_conversation_read(uuid)', 'public.mark_unread_from(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_def := replace(v_def, 'not private.is_conversation_participant(p_conversation_id, v_user)', 'not private.can_act_in(p_conversation_id, v_user, ''mark'')');
    v_def := replace(v_def, 'not private.is_conversation_participant(v_msg.conversation_id, v_uid)', 'not private.can_act_in(v_msg.conversation_id, v_uid, ''mark'')');
    if position('can_act_in' in v_def) = 0 then raise exception 'K1: % body changed, gate not placed', f; end if;
    execute v_def;
  end loop;
  v_def := pg_get_functiondef('public.mark_messages_delivered(uuid[])'::regprocedure);
  v_def := replace(v_def, 'private.is_conversation_participant(m.conversation_id, v_uid)', 'private.can_act_in(m.conversation_id, v_uid, ''mark'')');
  if position('can_act_in' in v_def) = 0 then raise exception 'K1: mark_messages_delivered body changed'; end if;
  execute v_def;
end $do$;

-- L8: groups 10 / day.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.create_group_conversation(text, uuid[])'::regprocedure);
  v_def := replace(v_def, E'if v_name is null then raise exception ''avora_group_name_required''; end if;',
    E'if v_name is null then raise exception ''avora_group_name_required''; end if;\n  perform private.rate_take(v_uid, ''group'', 10, interval ''1 day'');');
  if position('rate_take' in v_def) = 0 then raise exception 'K1: create_group_conversation body changed'; end if;
  execute v_def;
end $do$;

-- L8 / verification quota: the 5-message count is taken under a row lock on the conversation.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.assert_direct_talk(uuid, uuid, text)'::regprocedure);
  v_def := replace(v_def, E'    if p_kind = ''text'' then\n      select count',
    E'    if p_kind = ''text'' then\n      perform 1 from public.conversations c where c.id = p_conversation_id for update;\n      select count');
  if position('for update' in v_def) = 0 then raise exception 'K1: assert_direct_talk body changed'; end if;
  v_def := replace(v_def, 'STABLE SECURITY DEFINER', 'VOLATILE SECURITY DEFINER');
  execute v_def;
end $do$;

-- Old rate events are only needed for a day.
delete from private.chat_rate_events where at < now() - interval '1 day';

-- Policies run as the caller: like is_conversation_participant, these two must be callable by
-- `authenticated` (private schema is not exposed by the API, so they stay unreachable as RPCs).
grant execute on function private.can_act_in(uuid, uuid, text) to authenticated;
grant execute on function private.attachment_blocked(text, text) to authenticated;

-- Unpinning (direct DELETE from the app) also needs to still be in the room.
drop policy if exists message_pins_delete_allowed on public.message_pins;
create policy message_pins_delete_allowed on public.message_pins for delete to authenticated
using (private.can_act_in(conversation_id, (select auth.uid()), 'pin')
       and ((scope = 'personal' and pinned_by = (select auth.uid()))
            or (scope = 'group' and private.is_group_officer(conversation_id, (select auth.uid())))));

-- Advisors: every table has a primary key.
alter table private.chat_rate_events add column if not exists id bigint generated always as identity primary key;
