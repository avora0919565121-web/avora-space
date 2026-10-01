-- AVORA-57 — Chỉn chu giao diện sau thử máy.
--
-- F. profiles.button_style — round / rounded / icon (ADR-037).
-- D. Ghim hội thoại: conversation_participants.pinned_at, per person, at most 5. The column is
--    NOT granted for SELECT: participants can read each other's member rows, and who pinned
--    whom is nobody else's business. It is read only through list_my_conversation_pins().
-- B. forward_messages_as_bundle now carries images (each at its own permission) onto the one
--    bundle message, in the original send order. View-only images and non-image files stay
--    behind and are counted, as before.
-- J. Cần xem lại: only a channel whose kind is really ambiguous stays flagged — two or more
--    values of that kind that cannot be told apart by label. Re-run once on existing data.

-- ---------------------------------------------------------------------------------------
-- F. Button style
-- ---------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists button_style text not null default 'round';
alter table public.profiles drop constraint if exists profiles_button_style_check;
alter table public.profiles
  add constraint profiles_button_style_check check (button_style in ('round', 'rounded', 'icon'));
grant select (button_style), update (button_style) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------------
-- D. Pinned conversations
-- ---------------------------------------------------------------------------------------
alter table public.conversation_participants add column if not exists pinned_at timestamptz;
-- Deliberately no grant on pinned_at (see header).

create or replace function public.set_conversation_pinned (p_conversation_id uuid, p_pinned boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_at timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if not coalesce (p_pinned, false) then
    update public.conversation_participants set pinned_at = null
    where conversation_id = p_conversation_id and user_id = v_uid;
    return null;
  end if;
  select pinned_at into v_at from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = v_uid;
  if v_at is not null then return v_at; end if;
  if (select count (*) from public.conversation_participants
      where user_id = v_uid and pinned_at is not null) >= 5 then
    raise exception 'avora_pin_limit';
  end if;
  update public.conversation_participants set pinned_at = now()
  where conversation_id = p_conversation_id and user_id = v_uid
  returning pinned_at into v_at;
  return v_at;
end;
$$;

create or replace function public.list_my_conversation_pins ()
returns table (conversation_id uuid, pinned_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select cp.conversation_id, cp.pinned_at
  from public.conversation_participants cp
  where auth.uid () is not null and cp.user_id = auth.uid () and cp.pinned_at is not null
  order by cp.pinned_at;
$$;

revoke all on function public.set_conversation_pinned (uuid, boolean) from public, anon;
revoke all on function public.list_my_conversation_pins () from public, anon;
grant execute on function public.set_conversation_pinned (uuid, boolean) to authenticated;
grant execute on function public.list_my_conversation_pins () to authenticated;

-- ---------------------------------------------------------------------------------------
-- B. Bundle forward carries images
-- ---------------------------------------------------------------------------------------
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
  v_images_blocked integer := 0;
  v_images_carried integer := 0;
  v_row record;
  v_att record;
  v_name text;
  v_text text;
  v_left integer;
  v_carried integer;
  v_summary text;
  v_new_id uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_target_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
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

  -- The message row goes first so its images can reference it; the summary is filled in last.
  insert into public.messages (id, conversation_id, sender_id, content, mentioned_user_ids, attachment_count, forward_bundle)
  values (v_new_id, p_target_conversation_id, v_uid, 'Đoạn hội thoại', '{}', 0, jsonb_build_object('v', 1, 'count', 0, 'items', '[]'::jsonb));

  -- Original send order, whatever order they were picked in.
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
    v_left := 0;
    v_carried := 0;

    if v_row.forward_bundle is not null then
      v_text := format('[Đoạn hội thoại được chuyển tiếp · %s tin]', coalesce(v_row.forward_bundle->>'count', '?'));
    else
      v_text := v_row.content;
      for v_att in
        select a.* from public.message_attachments a
        where a.message_id = v_row.id
        order by a.created_at, a.id
      loop
        if v_att.kind = 'image' and v_att.permission in ('forward', 'export') then
          -- clock_timestamp keeps the grid in send order: now() is one value per transaction.
          insert into public.message_attachments (
            message_id, conversation_id, attached_by, kind, storage_path, file_name,
            mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id, created_at
          ) values (
            v_new_id, p_target_conversation_id, v_uid, v_att.kind, v_att.storage_path, v_att.file_name,
            v_att.mime_type, v_att.byte_size, v_att.width, v_att.height, v_att.duration_seconds,
            v_att.permission, v_att.message_id, clock_timestamp()
          );
          v_carried := v_carried + 1;
        else
          if v_att.kind = 'image' then v_images_blocked := v_images_blocked + 1; end if;
          v_left := v_left + 1;
        end if;
      end loop;
    end if;
    v_files_left := v_files_left + v_left;
    v_images_carried := v_images_carried + v_carried;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'at', v_row.created_at, 'text', v_text, 'files', v_left, 'images', v_carried
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

  update public.messages
  set content = v_summary,
      attachment_count = v_images_carried,
      forward_bundle = jsonb_build_object('v', 1, 'count', v_count, 'first_at', v_first, 'last_at', v_last,
                                          'images', v_images_carried, 'items', v_items)
  where id = v_new_id;

  return jsonb_build_object(
    'forwarded', v_count,
    'files_left_behind', v_files_left,
    'images_carried', v_images_carried,
    'images_blocked', v_images_blocked,
    'message_id', v_new_id
  );
end;
$$;
revoke all on function public.forward_messages_as_bundle(uuid[], uuid) from public, anon;
grant execute on function public.forward_messages_as_bundle(uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- J. Cần xem lại — only when it is really a choice
-- ---------------------------------------------------------------------------------------

/**
 * True when a contact has two or more values of this kind (the contact's own field counts as
 * one, unlabelled) that cannot be told apart: two unlabelled, or two with the same label.
 * Mirrored in lib/contact-candidates.ts (kindIsAmbiguous).
 */
create or replace function private.channel_kind_is_ambiguous (p_contact_id uuid, p_kind text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  with vals as (
    select distinct on (v.norm) v.norm, v.label
    from (
      select private.normalize_channel (p_kind, case when p_kind = 'phone' then c.phone else c.email end) as norm,
             null::text as label, 0 as rank
      from public.contact c where c.id = p_contact_id
      union all
      select ch.value_normalized, nullif (btrim (ch.label), ''), 1
      from public.contact_channel ch where ch.contact_id = p_contact_id and ch.kind = p_kind
    ) v
    where coalesce (v.norm, '') <> ''
    order by v.norm, v.rank
  )
  select count (*) >= 2
     and (count (*) filter (where label is null) >= 2
          or count (distinct lower (label)) filter (where label is not null) < count (*) filter (where label is not null))
  from vals;
$$;
revoke all on function private.channel_kind_is_ambiguous (uuid, text) from public, anon, authenticated;

update public.contact_channel ch
set needs_review = false
where ch.needs_review
  and not private.channel_kind_is_ambiguous (ch.contact_id, ch.kind);
