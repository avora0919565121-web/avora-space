set check_function_bodies = off;
CREATE OR REPLACE FUNCTION private.act_as(p_user uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$function$;

CREATE OR REPLACE FUNCTION private.activity_board_key_ok(p_key text, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.think_hub_table_visible(p_key::uuid, p_user);
  end if;
  return p_key in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','habits','cashflow','summary','loans','payment_calendar','expiring_docs','assets');
end $function$;

CREATE OR REPLACE FUNCTION private.announce_board_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_conv uuid; v_msg uuid;
begin
  if new.parent_record_id is not null or (new.conversation_id is null and new.project_id is null) then return null; end if;
  v_conv := coalesce(new.conversation_id, (select pr.conversation_id from projects pr where pr.id = new.project_id));
  if v_conv is null then return null; end if;
  v_msg := private.post_system_line(v_conv, new.owner_user_id, 'board_created',
    format('%s tạo Bảng "%s"', private.public_name(new.owner_user_id), new.name));
  insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind)
  values (new.id, v_conv, v_msg, new.owner_user_id, 'created');
  return null;
exception when others then
  raise warning 'avora_board_created_line_failed';
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.app_config_invite_since()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.key = 'invite_required' and new.value = 'true'::jsonb
     and (tg_op = 'INSERT' or old.value is distinct from new.value) then
    insert into public.app_config (key, value) values ('invite_required_since', to_jsonb(now()))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.app_origin(p_origin text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- Device emails always lead to the primary address. The passed origin is only kept for the
  -- Rork preview build, so links made while testing a preview open that preview.
  select case
    when p_origin = 'https://9gn7yyx8sbtban1pcozwb-web.rork.live' then p_origin
    else private.app_origin_primary()
  end
$function$;

CREATE OR REPLACE FUNCTION private.app_origin_allowed(p_origin text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_origin = any (array[
    'https://avorachat.com',
    'https://www.avorachat.com',
    'https://avoraspace.rork.app',
    'https://myavora.rork.app',
    'https://9gn7yyx8sbtban1pcozwb-web.rork.live'
  ])
$function$;

CREATE OR REPLACE FUNCTION private.app_origin_primary()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select 'https://avorachat.com'
$function$;

CREATE OR REPLACE FUNCTION private.appearance_line(p_conversation uuid, p_uid uuid, p_what text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text;
begin
  select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_name from public.profiles p where p.id = p_uid;
  insert into public.messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_uid, coalesce(v_name, 'Một thành viên') || ' đã đổi ' || p_what, 'appearance_changed');
end $function$;

CREATE OR REPLACE FUNCTION private.apply_structure_to_table(p_table_id uuid, p_cols jsonb, p_status jsonb, p_title_label text, p_default_view text, p_mobile_labels text[], p_source_key text, p_source_version integer, p_purpose text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_new jsonb; v_mobile text[]; v_row think_hub_table%rowtype;
begin
  v_new := private.materialize_template_columns(p_cols);
  select array_agg(c->>'key' order by array_position(p_mobile_labels, c->>'label'))
    into v_mobile
  from jsonb_array_elements(v_new) c
  where c->>'label' = any(coalesce(p_mobile_labels, '{}'));

  update think_hub_table set
    column_defs = column_defs || v_new,
    status_options = private.clean_status_options(p_status),
    title_label = nullif(btrim(coalesce(p_title_label, '')), ''),
    default_view = p_default_view,
    mobile_columns = case when v_mobile is null then null else v_mobile[1:2] end,
    source_template_key = p_source_key,
    source_template_version = p_source_version,
    purpose = case
      when purpose is null and not (project_id is not null and parent_record_id is null) and p_purpose is not null
        then p_purpose else purpose end
  where id = p_table_id
  returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION private.are_connected(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.user_connections uc
    where uc.user_low = least (p_a, p_b) and uc.user_high = greatest (p_a, p_b)
      and uc.status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION private.assert_can_act_in(p_conversation uuid, p_uid uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from public.conversation_participants cp where cp.conversation_id = p_conversation and cp.user_id = p_uid) then
    raise exception 'avora_not_a_participant' using errcode = '42501';
  end if;
  if not private.can_act_in(p_conversation, p_uid, p_action) then
    if private.conversation_project_closed(p_conversation) then raise exception 'avora_project_chat_closed'; end if;
    raise exception 'avora_contact_unavailable';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.assert_can_style(p_conversation uuid, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_type text; v_role text;
begin
  perform private.assert_can_act_in(p_conversation, p_uid, 'send');
  select c.type into v_type from public.conversations c where c.id = p_conversation;
  if v_type not in ('direct', 'group') then raise exception 'avora_not_allowed'; end if;
  if v_type = 'group' then
    select cp.role into v_role from public.conversation_participants cp where cp.conversation_id = p_conversation and cp.user_id = p_uid;
    if coalesce(v_role, '') not in ('owner', 'admin') then raise exception 'avora_not_admin'; end if;
  end if;
  return v_type;
end $function$;

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

CREATE OR REPLACE FUNCTION private.assert_direct_talk(p_conversation_id uuid, p_user_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
  v_started timestamptz;
  v_peer uuid;
  v_sent integer;
begin
  if p_conversation_id is null then return true; end if;
  select c.type, c.verification_started_at into v_type, v_started
  from public.conversations c where c.id = p_conversation_id;
  if v_type is distinct from 'direct' then return true; end if;
  -- Membership is checked by the caller; a stranger gets the caller's own refusal, not this one.
  if not private.is_conversation_participant (p_conversation_id, p_user_id) then return true; end if;

  -- AVORA-37 first, exactly as before: a blocked pair reads as "unavailable".
  if private.direct_peer_blocked (p_conversation_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  if private.verification_is_live (p_conversation_id) then
    if p_kind in ('attachment', 'rich') then
      raise exception 'avora_verification_text_only';
    end if;
    if p_kind = 'text' then
      perform 1 from public.conversations c where c.id = p_conversation_id for update;
      select count (*) into v_sent from public.messages m
      where m.conversation_id = p_conversation_id and m.sender_id = p_user_id
        and m.created_at >= v_started;
      if v_sent >= 5 then raise exception 'avora_verification_quota'; end if;
    end if;
    return true;
  end if;

  v_peer := private.direct_peer_of (p_conversation_id, p_user_id);
  if not private.can_talk_direct (p_user_id, v_peer) then
    raise exception 'avora_not_connected';
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_feature(p_key text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if private.feature_status(p_key) <> 'stable' then
    raise exception 'avora_feature_off' using detail = p_key;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.assert_forward_target(p_target uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_conversation_participant(p_target, p_uid) then raise exception 'avora_not_a_participant'; end if;
  perform private.assert_direct_talk(p_target, p_uid, 'rich');
  perform private.assert_can_act_in(p_target, p_uid, 'send');
end $function$;

CREATE OR REPLACE FUNCTION private.assert_session_allowed()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.session_allowed() then raise exception 'avora_session_not_allowed'; end if;
end $function$;

CREATE OR REPLACE FUNCTION private.attachment_blocked(p_name text, p_mime text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select lower(coalesce(p_name, '')) ~ '\.(exe|msi|bat|cmd|sh|apk|ipa|dmg|js|mjs|jar|scr|html|htm|svg|svgz|xhtml|xht)$'
      or lower(coalesce(p_mime, '')) ~ '^(text/html|application/xhtml|image/svg|application/javascript|text/javascript|application/x-msdownload|application/x-msdos-program|application/vnd\.android\.package-archive|application/x-sh|application/java-archive|application/x-apple-diskimage)'
$function$;

CREATE OR REPLACE FUNCTION private.attachment_count_storage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.expires_at := coalesce(new.expires_at, new.created_at + interval '30 days');
    if new.retain_reason is null and exists (select 1 from public.meeting_note_files f where f.storage_path = new.storage_path) then
      new.retain_reason := 'decision';
    end if;
    return new;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.attachment_tally()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sign int; v_row public.message_attachments%rowtype;
begin
  if tg_op = 'INSERT' then v_sign := 1; v_row := new; else v_sign := -1; v_row := old; end if;
  -- A forwarded file points at the same bytes (ADR-012): it is counted where it was first sent only.
  if v_row.origin_message_id is not null then return null; end if;
  insert into public.conversation_storage (conversation_id, bytes, files, cap_bytes)
  values (v_row.conversation_id, greatest(0, v_sign * v_row.byte_size), greatest(0, v_sign), coalesce(private.cap_for(v_row.conversation_id), 1073741824))
  on conflict (conversation_id) do update set
    bytes = greatest(0, public.conversation_storage.bytes + v_sign * v_row.byte_size),
    files = greatest(0, public.conversation_storage.files + v_sign),
    updated_at = now();
  if v_row.attached_by is not null then
    insert into public.storage_usage (user_id, bytes, files, day_bytes, day)
    values (v_row.attached_by, greatest(0, v_sign * v_row.byte_size), greatest(0, v_sign), greatest(0, v_sign * v_row.byte_size), current_date)
    on conflict (user_id) do update set
      bytes = greatest(0, public.storage_usage.bytes + v_sign * v_row.byte_size),
      files = greatest(0, public.storage_usage.files + v_sign),
      day_bytes = case when public.storage_usage.day = current_date
        then greatest(0, public.storage_usage.day_bytes + greatest(0, v_sign * v_row.byte_size))
        else greatest(0, v_sign * v_row.byte_size) end,
      day = current_date,
      updated_at = now();
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.avatar_notice(p_to uuid, p_about uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform realtime.send(jsonb_build_object('user_id', p_about), 'avatar', 'user-' || p_to::text, true);
exception when others then
  null; -- a failed notice never blocks the change; the next open re-reads by version
end $function$;

CREATE OR REPLACE FUNCTION private.avatar_notify_friends(p_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_friend uuid;
begin
  perform private.avatar_notice(p_owner, p_owner);
  for v_friend in
    select case when uc.user_low = p_owner then uc.user_high else uc.user_low end
    from public.user_connections uc
    where (uc.user_low = p_owner or uc.user_high = p_owner) and uc.status = 'active'
  loop
    perform private.avatar_notice(v_friend, p_owner);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.avatar_on_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.user_blocks%rowtype;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  perform private.avatar_notice(v_row.blocker_id, v_row.blocked_id);
  perform private.avatar_notice(v_row.blocked_id, v_row.blocker_id);
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.avatar_on_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  perform private.avatar_notice(new.user_low, new.user_high);
  perform private.avatar_notice(new.user_high, new.user_low);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.avatar_paths_for(p_viewer uuid, p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, path text, version timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.avatar_url, p.avatar_updated_at
  from public.profiles p
  where p_viewer is not null
    and p.id = any (p_user_ids)
    and p.avatar_url is not null
    and private.can_see_avatar(p_viewer, p.id);
$function$;

CREATE OR REPLACE FUNCTION private.avatar_write(p_owner uuid, p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old text;
begin
  -- Only ever the caller's own row: the public wrappers pass auth.uid(), nothing else.
  if p_owner is null or p_owner is distinct from auth.uid() then raise exception 'avora_not_allowed'; end if;
  select avatar_url into v_old from public.profiles where id = p_owner for update;
  update public.profiles set avatar_url = p_path, avatar_updated_at = now() where id = p_owner;
  perform private.avatar_notify_friends(p_owner);
  return v_old;
end $function$;

CREATE OR REPLACE FUNCTION private.block_archived_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if private.think_hub_table_archived(new.table_id) then raise exception 'avora_table_archived'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.block_archived_record_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_table uuid;
begin
  if new.record_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.record_id is not distinct from old.record_id then return new; end if;
  select table_id into v_table from think_hub_record where id = new.record_id;
  if private.think_hub_table_archived(v_table) then raise exception 'avora_table_archived'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.block_archived_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_parent_table uuid;
begin
  if tg_op = 'INSERT' then
    if new.parent_record_id is not null then
      select table_id into v_parent_table from think_hub_record where id = new.parent_record_id;
      if private.think_hub_table_archived(v_parent_table) then raise exception 'avora_table_archived'; end if;
    end if;
    return new;
  end if;
  -- Archiving / unarchiving / binning an archived table are the only changes allowed.
  if (old.archived_at is not null or private.think_hub_table_archived(old.id))
     and (new.name, new.purpose, new.column_defs, new.position, new.status_options, new.title_label,
          new.default_view, new.mobile_columns)
         is distinct from
         (old.name, old.purpose, old.column_defs, old.position, old.status_options, old.title_label,
          old.default_view, old.mobile_columns)
  then
    raise exception 'avora_table_archived';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.block_orphan_sub_restore()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.deleted_at is not null and new.deleted_at is null and new.parent_record_id is not null
     and not private.sub_table_scope_matches(new.id) then
    raise exception 'avora_think_hub_table_out_of_scope';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.block_sessions(p_user uuid, p_sessions uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.blocked_sessions (session_id, user_id, reason)
  select s, p_user, p_reason from unnest(p_sessions) s where s is not null
  on conflict (session_id) do nothing;
  delete from auth.sessions where user_id = p_user and id = any (p_sessions);
end $function$;

CREATE OR REPLACE FUNCTION private.board_change_summary(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'added', count(*) filter (where kind = 'record_add'),
    'cells', coalesce(sum(cells) filter (where kind = 'record_edit'), 0),
    'deleted', count(*) filter (where kind = 'record_delete'),
    'columns', count(*) filter (where kind like 'column_%'),
    'board', count(*) filter (where kind = 'board_edit'),
    'total', count(*) filter (where kind <> 'record_edit') + coalesce(sum(cells) filter (where kind = 'record_edit'), 0))
  from think_hub_change_log where id = any (p_ids)
$function$;

CREATE OR REPLACE FUNCTION private.board_file_record(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 2)::uuid end
$function$;

CREATE OR REPLACE FUNCTION private.board_file_table(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$function$;

CREATE OR REPLACE FUNCTION private.board_file_uploader(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select uploaded_by from think_hub_cell_files where storage_path = p_name
$function$;

CREATE OR REPLACE FUNCTION private.board_has_others(p_table uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from private.think_hub_table_tree(p_table) tr join think_hub_record r on r.table_id = tr.id
    where r.owner_user_id <> p_owner or exists (select 1 from unnest(coalesce(r.editor_ids, '{}'::uuid[])) e where e <> p_owner)
  ) or exists (
    select 1 from private.think_hub_table_tree(p_table) tr join think_hub_cell_files f on f.table_id = tr.id where f.uploaded_by <> p_owner
  )
$function$;

CREATE OR REPLACE FUNCTION private.board_hourly()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare g record; v_ids uuid[]; v_summary jsonb; v_msg uuid; v_ann uuid; v_text text;
begin
  -- Safety net: someone changed MY Hạng mục and never said so — a private line to me only.
  for g in
    select l.record_owner_id as owner_id, l.actor_id, l.table_id, l.record_id, max(l.record_title) as title,
           array_agg(l.id) as ids, max(t.name) as table_name
    from think_hub_change_log l join think_hub_table t on t.id = l.table_id
    where l.announced_at is null and l.nudged_at is null and l.created_at < now() - interval '24 hours'
      and l.record_owner_id is not null and l.record_owner_id <> l.actor_id and t.deleted_at is null
      and private.think_hub_table_visible(l.table_id, l.record_owner_id)
    group by l.record_owner_id, l.actor_id, l.table_id, l.record_id
  loop
    v_text := format('%s đã %s "%s" trong Bảng %s', private.public_name(g.actor_id),
      case when exists (select 1 from think_hub_change_log where id = any (g.ids) and kind = 'record_delete') then 'xoá' else 'sửa' end,
      coalesce(g.title, 'Hạng mục'), g.table_name);
    insert into think_hub_nudges (user_id, table_id, record_id, actor_id, content)
    values (g.owner_id, g.table_id, g.record_id, g.actor_id, left(v_text, 400));
    perform private.board_push(g.owner_id, null, g.table_id, 'Kế hoạch', v_text);
    update think_hub_change_log set nudged_at = now() where id = any (g.ids);
  end loop;

  -- Tóm tắt cuối ngày: at 18:00 in the owner's own time, one card for everyone's unannounced changes.
  for g in
    select t.id, t.name, t.owner_user_id,
           coalesce(t.conversation_id, (select pr.conversation_id from projects pr where pr.id = t.project_id)) as conv
    from think_hub_table t join profiles p on p.id = t.owner_user_id
    where t.deleted_at is null and t.announce_mode = 'daily'
      and extract(hour from now() at time zone coalesce(p.timezone, 'Asia/Ho_Chi_Minh')) = 18
      and exists (select 1 from think_hub_change_log l where l.table_id = t.id and l.announced_at is null)
  loop
    if g.conv is null or not private.conversation_is_live(g.conv) then continue; end if;
    select array_agg(id) into v_ids from think_hub_change_log where table_id = g.id and announced_at is null;
    v_summary := private.board_change_summary(v_ids);
    v_msg := private.post_system_line(g.conv, g.owner_user_id, 'board_update',
      format('Tóm tắt cuối ngày · Bảng "%s" · %s', g.name, private.board_summary_words(v_summary)));
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind, change_ids, summary)
    values (g.id, g.conv, v_msg, g.owner_user_id, 'digest', v_ids, v_summary) returning id into v_ann;
    update think_hub_change_log set announced_at = now(), announcement_id = v_ann where id = any (v_ids);
  end loop;

  delete from think_hub_change_log where created_at < now() - interval '90 days';
  delete from think_hub_nudges where created_at < now() - interval '90 days';
end;
$function$;

CREATE OR REPLACE FUNCTION private.board_place_label(p_conversation uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_conversation is null then 'Bảng riêng của ' || private.public_name(p_owner)
    when (select type from conversations where id = p_conversation) = 'group'
      then 'nhóm "' || coalesce((select nullif(btrim(name), '') from conversation_groups where conversation_id = p_conversation), 'Nhóm') || '"'
    else 'một cuộc trò chuyện 1-1'
  end
$function$;

CREATE OR REPLACE FUNCTION private.board_push(p_user uuid, p_conversation uuid, p_table_id uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_surface text := case when p_conversation is null then 'group' else private.push_surface(p_conversation) end;
begin
  -- Never Khẩn; a muted conversation, Tắt thông báo or Chế độ tập trung all hold it back.
  if p_conversation is not null and private.push_mute_blocks(p_user, coalesce(v_surface, 'group'), p_conversation, false, false, false) then return; end if;
  if p_conversation is null and private.push_mute_blocks(p_user, 'group', '00000000-0000-0000-0000-000000000000'::uuid, false, false, false) then return; end if;
  insert into push_outbox (user_id, kind, conversation_id, payload, send_after)
  values (p_user, 'board', p_conversation,
    jsonb_build_object('title', left(p_title, 80), 'body', left(p_body, 160), 'table_id', p_table_id,
      'url', '/ke-hoach?bang=' || p_table_id || '&thay-doi=1'),
    now());
end;
$function$;

CREATE OR REPLACE FUNCTION private.board_summary_words(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_temp'
AS $function$
  select coalesce(nullif(array_to_string(array_remove(array[
    case when (p->>'added')::int > 0 then format('Thêm %s Hạng mục', p->>'added') end,
    case when (p->>'cells')::int > 0 then format('Sửa %s ô', p->>'cells') end,
    case when (p->>'deleted')::int > 0 then format('Xoá %s Hạng mục', p->>'deleted') end,
    case when (p->>'columns')::int > 0 then format('Đổi %s cột', p->>'columns') end,
    case when coalesce((p->>'board')::int, 0) > 0 then 'Cập nhật kết luận / trạng thái' end
  ], null), ' · '), ''), 'Không có thay đổi mới')
$function$;

CREATE OR REPLACE FUNCTION private.book_catalog_fold()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.search_text := private.fold_search(new.title || ' ' || coalesce(new.title_vi, '') || ' ' || coalesce(new.authors, ''));
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_chat_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conv uuid; v_msg uuid; v_kind text;
begin
  if tg_table_name = 'messages' then
    v_conv := coalesce(new.conversation_id, old.conversation_id);
    v_msg := coalesce(new.id, old.id);
    v_kind := case tg_op when 'INSERT' then 'message' else 'message_update' end;
  elsif tg_table_name = 'message_reactions' then
    v_msg := coalesce(new.message_id, old.message_id);
    select m.conversation_id into v_conv from public.messages m where m.id = v_msg;
    v_kind := 'reaction';
  elsif tg_table_name = 'message_pins' then
    v_conv := coalesce(new.conversation_id, old.conversation_id);
    v_msg := coalesce(new.message_id, old.message_id);
    v_kind := 'pin';
  elsif tg_table_name = 'message_deliveries' then
    v_msg := coalesce(new.message_id, old.message_id);
    select m.conversation_id into v_conv from public.messages m where m.id = v_msg;
    v_kind := 'delivered';
  end if;
  if v_conv is null then return null; end if;
  perform realtime.send(jsonb_build_object('conversation_id', v_conv, 'message_id', v_msg, 'op', lower(tg_op)),
                        v_kind, 'conv-' || v_conv::text, true);
  return null;
exception when others then
  return null; -- a lost broadcast is healed by the next read; it must never fail a write
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_message_to_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_member uuid; v_row jsonb;
begin
  v_row := to_jsonb(new) - 'key_version' - 'algorithm_version';
  for v_member in select cp.user_id from public.conversation_participants cp where cp.conversation_id = new.conversation_id loop
    perform realtime.send(jsonb_build_object('message', v_row, 'op', lower(tg_op)),
                          case tg_op when 'INSERT' then 'message' else 'message_update' end,
                          'user-' || v_member::text, true);
  end loop;
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_participant_added()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.send_to_users(private.members_of(new.conversation_id), 'participant_added',
    jsonb_build_object('conversation_id', new.conversation_id));
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_read_mark()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.send_to_users(array[new.user_id], 'read_mark',
    jsonb_build_object('new', jsonb_build_object('conversation_id', new.conversation_id, 'user_id', new.user_id)));
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_removal_resolution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    perform private.send_to_users(array[new.requested_by], 'removal_request', jsonb_build_object('new', to_jsonb(new)));
  end if;
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_suggestion_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.send_to_users(
    private.members_of(coalesce(new.conversation_id, old.conversation_id)), 'task_suggestion',
    jsonb_build_object('eventType', tg_op,
      'new', case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end,
      'old', jsonb_build_object('id', coalesce(old.id, new.id))));
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.broadcast_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_users uuid[] := '{}';
  v_row public.tasks%rowtype;
  v_visible boolean;
begin
  if tg_op <> 'INSERT' then
    v_users := v_users || case when old.type = 'personal' then array[old.creator_id] else private.members_of(old.conversation_id) end;
  end if;
  if tg_op <> 'DELETE' then
    v_users := v_users || case when new.type = 'personal' then array[new.creator_id] else private.members_of(new.conversation_id) end;
    v_row := new;
    v_visible := new.pending_decision_id is null
      and (new.type = 'personal' or (new.conversation_id is not null and private.conversation_is_live(new.conversation_id)));
  else
    v_visible := false;
  end if;
  perform private.send_to_users(v_users, 'task', jsonb_build_object(
    'eventType', case when not v_visible then 'DELETE' else tg_op end,
    'new', case when v_visible then to_jsonb(v_row) else '{}'::jsonb end,
    'old', jsonb_build_object('id', coalesce(old.id, new.id))));
  return null;
exception when others then
  return null; -- a lost event is healed by the backfill on reconnect; it must never fail a write
end $function$;

CREATE OR REPLACE FUNCTION private.call_book_covers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret text;
begin
  if not exists (select 1 from public.book_catalog where cover_checked_at is null and pd_status = 'ok' and source <> 'wikisource') then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/book-cover',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{"backfill":true}'::jsonb,
    timeout_milliseconds := 60000
  );
end $function$;

CREATE OR REPLACE FUNCTION private.call_send_push()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $function$;

CREATE OR REPLACE FUNCTION private.call_storage_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/storage-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $function$;

CREATE OR REPLACE FUNCTION private.can_act_in(p_conversation uuid, p_uid uuid, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION private.can_edit_board_head(p_table uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user is not null
    and private.think_hub_table_visible(p_table, p_user)
    and exists (
      select 1 from public.think_hub_table t
      where t.id = p_table and t.deleted_at is null and t.sync_source is null
        and t.kind is distinct from 'bookshelf'
        and (t.share_mode = 'edit' or t.owner_user_id = p_user)
        and (t.project_id is null or private.project_is_open(t.project_id)))
    and not private.think_hub_table_archived(p_table)
$function$;

CREATE OR REPLACE FUNCTION private.can_edit_meeting_note(p_decision_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.group_decisions d
    where d.id = p_decision_id
      and d.kind = 'meeting_note'
      and d.status = 'draft'
      and d.created_by = p_user
      and private.is_conversation_participant (d.conversation_id, p_user)
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_link_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and (t.creator_id = p_user or public.is_task_assignee (t, p_user))
            -- AVORA-39 Phần 3 · D3: once a suggestion was accepted into it, only the assignee.
            and (public.is_task_assignee (t, p_user) or not private.task_owned_by_assignee (t.id)))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_meeting_file(p_decision_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.group_decisions d
    where d.id = p_decision_id
      and d.kind = 'meeting_note'
      and d.created_by = p_user
      and private.is_conversation_participant (d.conversation_id, p_user)
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_see_avatar(p_viewer uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_viewer is not null and p_owner is not null and (
    p_viewer = p_owner
    or (private.are_connected(p_viewer, p_owner) and not private.is_blocked_between(p_viewer, p_owner))
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_talk_direct(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.are_connected (p_a, p_b) and not private.is_blocked_between (p_a, p_b);
$function$;

CREATE OR REPLACE FUNCTION private.can_toggle_task_lists(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_user_id is null then false
    when not private.is_conversation_participant(p_conversation_id, p_user_id) then false
    else coalesce((
      select case c.type
        -- A group is the owner's to configure.
        when 'group' then exists (
          select 1 from public.conversation_groups g
          where g.conversation_id = c.id and g.owner_id = p_user_id
        )
        -- direct: one shared row, either party may change it.
        -- personal: the sole participant, which is the person themselves.
        else true
      end
      from public.conversations c
      where c.id = p_conversation_id
    ), false)
  end;
$function$;

CREATE OR REPLACE FUNCTION private.can_view_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.pending_decision_id is null
      and (
        (t.type = 'personal' and t.creator_id = p_user)
        or (t.type in ('1-1-shared', 'group-shared')
            and private.is_conversation_participant (t.conversation_id, p_user)
            and private.conversation_is_live (t.conversation_id))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_view_task_private(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.can_view_task (p_task, p_user)
    and (
      not private.task_owned_by_assignee (p_task)
      or exists (select 1 from public.tasks t where t.id = p_task and public.is_task_assignee (t, p_user))
    );
$function$;

CREATE OR REPLACE FUNCTION private.cap_for(p_conversation uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when c.type = 'direct' then 1073741824::bigint else 2147483648::bigint end
  from public.conversations c where c.id = p_conversation
$function$;

CREATE OR REPLACE FUNCTION private.cascade_table_tasks(p_table_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_batch uuid := gen_random_uuid(); v_count integer := 0; v_task record;
begin
  for v_task in
    select distinct t.id, t.type, t.status, t.deleted_by_creator, t.deleted_by_peer
    from private.think_hub_table_tree(p_table_id) tr
    join think_hub_record r on r.table_id = tr.id
    left join think_hub_record_tasks rt on rt.record_id = r.id
    left join project_tasks pt on pt.record_id = r.id
    join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
  loop
    if not v_task.deleted_by_creator then
      update tasks set deleted_by_creator = true, updated_at = now() where id = v_task.id;
      insert into think_hub_delete_cascade (batch_id, table_id, task_id, side) values (v_batch, p_table_id, v_task.id, 'creator');
      v_count := v_count + 1;
    end if;
    if v_task.type <> 'personal' and not v_task.deleted_by_peer and v_task.status in ('done', 'skipped') then
      update tasks set deleted_by_peer = true, updated_at = now() where id = v_task.id;
      insert into think_hub_delete_cascade (batch_id, table_id, task_id, side) values (v_batch, p_table_id, v_task.id, 'peer');
    end if;
  end loop;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION private.channel_kind_is_ambiguous(p_contact_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.check_daily_thought_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.reply_to_daily_thought_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND c.type = 'personal'
  ) THEN
    RAISE EXCEPTION 'avora_thought_reply_journal_only';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.check_password(p_uid uuid, p_password text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hash text;
begin
  delete from private.password_checks where checked_at < now() - interval '1 day';
  if (select count(*) from private.password_checks where user_id = p_uid and checked_at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_password_check_rate';
  end if;
  insert into private.password_checks (user_id) values (p_uid);
  select encrypted_password into v_hash from auth.users where id = p_uid;
  return coalesce(v_hash, '') <> '' and length(coalesce(p_password, '')) between 1 and 200
    and extensions.crypt(p_password, v_hash) = v_hash;
end $function$;

CREATE OR REPLACE FUNCTION private.check_permission(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if p is null or p not in ('view', 'forward', 'export') then raise exception 'avora_bad_permission'; end if;
  return p;
end $function$;

CREATE OR REPLACE FUNCTION private.clean_short(p_value text, p_max integer, p_pattern text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select left(regexp_replace(coalesce(p_value, ''), p_pattern, '', 'g'), p_max)
$function$;

CREATE OR REPLACE FUNCTION private.clean_status_options(p_opts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb := '[]'::jsonb; o jsonb; seen text[] := '{}'; k text; l text;
begin
  if p_opts is null or jsonb_typeof(p_opts) <> 'array' then return null; end if;
  for o in select * from jsonb_array_elements(p_opts) loop
    continue when jsonb_typeof(o) <> 'object';
    k := btrim(coalesce(o->>'key', '')); l := btrim(coalesce(o->>'label', ''));
    continue when k = '' or l = '' or k = any(seen);
    seen := seen || k;
    v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', k, 'label', l,
      'done', case when (o->>'done')::boolean is true then true end)));
  end loop;
  if jsonb_array_length(v) = 0 then return null; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION private.cleanup_own_board(p_table_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.think_hub_table t
    where t.id = p_table_id and t.owner_user_id = p_user and t.conversation_id is null and t.project_id is null
      and t.deleted_at is null and t.archived_at is null and t.parent_record_id is null and t.kind is distinct from 'bookshelf')
$function$;

CREATE OR REPLACE FUNCTION private.client_error_write(p_user uuid, p_app_version text, p_platform text, p_route text, p_error_name text, p_message_short text, p_stack_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route text;
  v_hash text := private.clean_short(p_stack_hash, 32, '[^a-z0-9]');
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if p_user is null or p_user is distinct from auth.uid() then raise exception 'avora_not_signed_in'; end if;
  if v_hash = '' then raise exception 'avora_client_error_invalid'; end if;
  -- A repeat of today's same error only bumps its counter (no new row, no rate cost beyond the limit).
  update public.client_errors set count = count + 1, last_at = now()
    where user_id = p_user and stack_hash = v_hash and day = v_day;
  if found then return; end if;
  perform private.rate_take(p_user, 'client_error', 20, interval '1 hour');
  -- Paths keep their shape, never their ids: /tin-nhan/<uuid>?q=… → /tin-nhan/:id
  v_route := regexp_replace(split_part(split_part(coalesce(p_route, ''), '?', 1), '#', 1),
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9]{3,}', ':id', 'g');
  insert into public.client_errors (user_id, app_version, platform, route, error_name, message_short, stack_hash, day)
  values (
    p_user,
    private.clean_short(p_app_version, 24, '[^A-Za-z0-9.+-]'),
    private.clean_short(p_platform, 16, '[^a-z]'),
    private.clean_short(v_route, 120, '[^A-Za-z0-9/:_.-]'),
    private.clean_short(p_error_name, 64, '[^A-Za-z0-9_.-]'),
    private.clean_short(p_message_short, 120, '[^A-Za-z0-9_. -]'),
    v_hash, v_day)
  on conflict (user_id, stack_hash, day) do update set count = public.client_errors.count + 1, last_at = now();
end $function$;

CREATE OR REPLACE FUNCTION private.close_blocked_recall_requests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  update message_recall_request r set resolved_at = now(), close_reason = 'closed'
  from messages m
  where m.id = r.message_id and r.resolved_at is null
    and private.is_blocked_between(m.sender_id, r.requested_by);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.close_blocked_recall_requests_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.close_blocked_recall_requests();
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.close_dead_suggestions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  with dead as (
    select s.id, private.suggestion_dead_reason(s) as reason from task_suggestions s where s.status = 'pending'
  )
  update task_suggestions s set status = 'withdrawn', resolved_at = now(), close_reason = dead.reason
  from dead where dead.id = s.id and dead.reason is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.close_dead_suggestions_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.close_dead_suggestions();
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.close_verifications_on_group_leave()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.conversations c
  set verification_status = 'closed', verification_resolved_at = now()
  where c.verification_status = 'pending'
    and c.verification_via_group_id = old.conversation_id
    and exists (select 1 from public.conversation_participants cp
                where cp.conversation_id = c.id and cp.user_id = old.user_id);
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.connect_users(p_a uuid, p_b uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_a is null or p_b is null or p_a = p_b then return; end if;
  insert into public.user_connections (user_low, user_high, status, source)
  values (least (p_a, p_b), greatest (p_a, p_b), 'active', p_source)
  on conflict (user_low, user_high) do update
    set status = 'active',
        source = case when public.user_connections.status = 'active' then public.user_connections.source else excluded.source end,
        created_at = case when public.user_connections.status = 'active' then public.user_connections.created_at else now() end,
        removed_at = null,
        removed_by = null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.contact_card_allowed(p_conv uuid, p_sender uuid, p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_conv is not null and p_person is not null and p_sender <> p_person
    and exists (select 1 from public.conversations c where c.id = p_conv and c.type in ('direct', 'group') and c.deleted_at is null)
    and private.is_conversation_participant(p_conv, p_sender)
    and not private.is_conversation_participant(p_conv, p_person)
    and private.are_connected(p_sender, p_person)
    and exists (select 1 from public.user_pins up where up.user_id = p_person)
    and not private.is_blocked_between(p_sender, p_person)
    and not exists (select 1 from public.conversation_participants cp
                    where cp.conversation_id = p_conv and cp.user_id <> p_sender and private.is_blocked_between(cp.user_id, p_person));
$function$;

CREATE OR REPLACE FUNCTION private.contact_details_filled()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.needs_details and (nullif(btrim(coalesce(new.phone, '')), '') is not null or nullif(btrim(coalesce(new.email, '')), '') is not null) then
    new.needs_details := false;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.contact_holding(p_owner uuid, p_phones text[], p_emails text[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id from (
    select c.id, c.created_at from public.contact c
     where c.owner_user_id = p_owner and c.phone is not null and private.normalize_channel('phone', c.phone) = any (p_phones)
    union all
    select c.id, c.created_at from public.contact c
     where c.owner_user_id = p_owner and c.email is not null and private.normalize_channel('email', c.email) = any (p_emails)
    union all
    select c.id, c.created_at from public.contact_channel ch join public.contact c on c.id = ch.contact_id
     where ch.owner_user_id = p_owner and ((ch.kind = 'phone' and ch.value_normalized = any (p_phones)) or (ch.kind = 'email' and ch.value_normalized = any (p_emails)))
  ) s order by created_at, id limit 1
$function$;

CREATE OR REPLACE FUNCTION private.contact_link_change(p_owner uuid, p_kind text, p_from uuid, p_to uuid, p_user uuid, p_change uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from public.contact%rowtype;
  v_to public.contact%rowtype;
  v_user uuid;
  v_change public.contact_link_changes%rowtype;
  v_id uuid;
begin
  if p_owner is null or p_owner is distinct from auth.uid() then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(p_owner, 'contact_link', 30, interval '1 hour');

  if p_kind = 'unlink' then
    select * into v_from from public.contact where id = p_from for update;
    if not found or v_from.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_from.linked_user_id is null then raise exception 'avora_contact_not_linked'; end if;
    v_user := v_from.linked_user_id;
    update public.contact
      set linked_user_id = null, link_suggestion_dismissed = private.contact_link_fingerprint(p_from, v_user)
      where id = p_from;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, linked_user_id)
      values (p_owner, 'unlink', p_from, v_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'relink' then
    if p_from is null or p_to is null then raise exception 'avora_contact_not_yours'; end if;
    if p_from = p_to then raise exception 'avora_contact_same'; end if;
    -- Khoá theo thứ tự id để hai lời gọi đảo chiều không chờ nhau mãi.
    perform 1 from public.contact where id in (p_from, p_to) order by id for update;
    select * into v_from from public.contact where id = p_from;
    select * into v_to from public.contact where id = p_to;
    if v_from.id is null or v_to.id is null or v_from.owner_user_id <> p_owner or v_to.owner_user_id <> p_owner then
      raise exception 'avora_contact_not_yours';
    end if;
    if v_from.linked_user_id is null then raise exception 'avora_contact_not_linked'; end if;
    if v_to.contact_type <> 'individual' then raise exception 'avora_contact_not_individual'; end if;
    if v_to.linked_user_id is not null then raise exception 'avora_contact_target_linked'; end if;
    v_user := v_from.linked_user_id;
    -- Gỡ trước rồi gắn: ràng buộc duy nhất (chủ, tài khoản) không bao giờ thấy hai dòng cùng lúc.
    update public.contact
      set linked_user_id = null, link_suggestion_dismissed = private.contact_link_fingerprint(p_from, v_user)
      where id = p_from;
    update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null where id = p_to;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, to_contact_id, linked_user_id)
      values (p_owner, 'relink', p_from, p_to, v_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'link' then
    select * into v_to from public.contact where id = p_to for update;
    if not found or v_to.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_to.contact_type <> 'individual' then raise exception 'avora_contact_not_individual'; end if;
    if v_to.linked_user_id is not null then raise exception 'avora_contact_target_linked'; end if;
    -- Chỉ bạn bè đang kết nối: không gắn được tên vào một người lạ bất kỳ.
    if not private.are_connected(p_owner, p_user) then raise exception 'avora_contact_not_friend'; end if;
    if exists (select 1 from public.contact c where c.owner_user_id = p_owner and c.linked_user_id = p_user) then
      raise exception 'avora_contact_account_linked_elsewhere';
    end if;
    update public.contact set linked_user_id = p_user, link_suggestion_dismissed = null where id = p_to;
    insert into public.contact_link_changes (owner_user_id, kind, to_contact_id, linked_user_id)
      values (p_owner, 'link', p_to, p_user) returning id into v_id;
    return v_id;
  end if;

  if p_kind = 'undo' then
    select * into v_change from public.contact_link_changes where id = p_change for update;
    if not found or v_change.owner_user_id <> p_owner then raise exception 'avora_contact_not_yours'; end if;
    if v_change.undone_at is not null or v_change.kind = 'undo' or v_change.at < now() - interval '15 minutes' then
      raise exception 'avora_contact_undo_expired';
    end if;
    v_user := v_change.linked_user_id;
    perform 1 from public.contact where id in (v_change.from_contact_id, v_change.to_contact_id) order by id for update;
    if v_change.kind = 'unlink' then
      if exists (select 1 from public.contact c where c.owner_user_id = p_owner and c.linked_user_id = v_user) then
        raise exception 'avora_contact_account_linked_elsewhere';
      end if;
      update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null
        where id = v_change.from_contact_id and owner_user_id = p_owner and linked_user_id is null;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    elsif v_change.kind = 'relink' then
      update public.contact set linked_user_id = null, link_suggestion_dismissed = null
        where id = v_change.to_contact_id and owner_user_id = p_owner and linked_user_id = v_user;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
      update public.contact set linked_user_id = v_user, link_suggestion_dismissed = null
        where id = v_change.from_contact_id and owner_user_id = p_owner and linked_user_id is null;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    else -- link
      update public.contact set linked_user_id = null
        where id = v_change.to_contact_id and owner_user_id = p_owner and linked_user_id = v_user;
      if not found then raise exception 'avora_contact_undo_expired'; end if;
    end if;
    update public.contact_link_changes set undone_at = now() where id = p_change;
    insert into public.contact_link_changes (owner_user_id, kind, from_contact_id, to_contact_id, linked_user_id)
      values (p_owner, 'undo', v_change.from_contact_id, v_change.to_contact_id, v_user) returning id into v_id;
    return v_id;
  end if;

  raise exception 'avora_contact_link_kind';
end $function$;

CREATE OR REPLACE FUNCTION private.contact_link_fingerprint(p_contact_id uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select encode(extensions.digest(p_contact_id::text || ':' || p_user::text, 'sha256'), 'hex')
$function$;

CREATE OR REPLACE FUNCTION private.contact_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Hàm SECURITY DEFINER chạy dưới vai trò chủ hàm, nên chỉ lời gọi thẳng từ máy khách rơi vào đây.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.linked_user_id is not null then
      raise exception 'avora_contact_link_server_only';
    end if;
    if tg_op = 'UPDATE' and new.linked_user_id is distinct from old.linked_user_id then
      raise exception 'avora_contact_link_server_only';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.contact_link_match(p_contact_id uuid, p_owner uuid)
 RETURNS TABLE(user_id uuid, matched_by text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with target as (
    select c.* from public.contact c
    where c.id = p_contact_id and c.owner_user_id = p_owner
      and c.contact_type = 'individual' and c.linked_user_id is null
  ),
  emails as (
    select nullif(lower(btrim(t.email)), '') v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'email'
  ),
  phones as (
    select private.normalize_phone (t.phone) v from target t
    union
    select ch.value_normalized from public.contact_channel ch, target t
    where ch.contact_id = t.id and ch.owner_user_id = p_owner and ch.kind = 'phone'
  ),
  hits as (
    select u.id uid, 'email'::text how from auth.users u
    where u.deleted_at is null and lower(u.email) in (select v from emails where v is not null)
    union all
    select u.id, 'phone' from auth.users u
    where u.deleted_at is null and coalesce(u.phone, '') <> ''
      and private.normalize_phone (u.phone) in (select v from phones where v is not null)
  ),
  eligible as (
    select h.* from hits h
    where h.uid <> p_owner
      -- AVORA-37 / A: a blocked pair is treated as no account at all, so the link
      -- suggestion cannot be used to find someone who blocked you (or whom you blocked).
      and not private.is_blocked_between (h.uid, p_owner)
      -- AVORA-38 / ADR-029: suggesting a stranger would be a way to find them by email/phone.
      and private.are_connected (h.uid, p_owner)
      and not exists (
        select 1 from public.contact c
        where c.owner_user_id = p_owner and c.linked_user_id = h.uid and c.id <> p_contact_id
      )
  )
  select e.uid,
    case when count(distinct e.how) > 1 then 'email_phone' else min(e.how) end
  from eligible e
  where (select count(distinct uid) from eligible) = 1
  group by e.uid
$function$;

CREATE OR REPLACE FUNCTION private.contact_removed_opportunities()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.crm_opportunity set removed_at = coalesce(removed_at, now()),
    contact_snapshot = jsonb_build_object('name', old.name)
  where contact_id = old.id;
  return old;
end $function$;

CREATE OR REPLACE FUNCTION private.contact_values(p_owner uuid)
 RETURNS TABLE(contact_id uuid, kind text, value_normalized text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, 'phone', private.normalize_channel('phone', c.phone), c.created_at
    from public.contact c where c.owner_user_id = p_owner and nullif(btrim(coalesce(c.phone, '')), '') is not null
  union all
  select c.id, 'email', private.normalize_channel('email', c.email), c.created_at
    from public.contact c where c.owner_user_id = p_owner and nullif(btrim(coalesce(c.email, '')), '') is not null
  union all
  select ch.contact_id, ch.kind, ch.value_normalized, c.created_at
    from public.contact_channel ch join public.contact c on c.id = ch.contact_id
   where ch.owner_user_id = p_owner and c.owner_user_id = p_owner
$function$;

CREATE OR REPLACE FUNCTION private.context_conversation(p_context text, p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  if p_user is null or p_context is null then return null; end if;
  if p_context = 'journal' then
    select c.id into v_id from public.conversations c
      join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = p_user
      where c.type = 'personal' and c.deleted_at is null limit 1;
    return v_id;
  end if;
  if p_context ~ '^conversation:[0-9a-f-]{36}$' then
    v_id := substr(p_context, 14)::uuid;
  elsif p_context ~ '^project:[0-9a-f-]{36}$' then
    select pr.conversation_id into v_id from public.projects pr where pr.id = substr(p_context, 9)::uuid and pr.deleted_at is null;
  else
    return null;
  end if;
  if v_id is null or not private.is_conversation_participant(v_id, p_user) then return null; end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.conversation_is_live(p_conversation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_group_id, c.deleted_at, 1 AS lvl
    FROM public.conversations c
    WHERE c.id = p_conversation
    UNION ALL
    SELECT c.id, c.parent_group_id, c.deleted_at, chain.lvl + 1
    FROM public.conversations c
    JOIN chain ON c.id = chain.parent_group_id
    WHERE chain.lvl < 4
  )
  SELECT EXISTS (SELECT 1 FROM chain)
     AND NOT EXISTS (SELECT 1 FROM chain WHERE deleted_at IS NOT NULL);
$function$;

CREATE OR REPLACE FUNCTION private.conversation_project_closed(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE conversation_id = p_conversation_id AND status <> 'active' AND deleted_at IS NULL
  )
$function$;

CREATE OR REPLACE FUNCTION private.current_device()
 RETURNS account_devices
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.* from public.account_devices d
  where d.user_id = auth.uid() and d.session_id = private.current_session_id() and private.current_session_id() is not null
  limit 1
$function$;

CREATE OR REPLACE FUNCTION private.current_session_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION private.current_task_record(p_task_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select rt.record_id from public.think_hub_record_tasks rt where rt.task_id = p_task_id),
    (select pt.record_id from public.project_tasks pt where pt.task_id = p_task_id and pt.record_id is not null))
$function$;

CREATE OR REPLACE FUNCTION private.decision_conversation(p_decision_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select d.conversation_id from public.group_decisions d where d.id = p_decision_id $function$;

CREATE OR REPLACE FUNCTION private.decision_is_settled(p_decision_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select d.status in ('finalized','closed') from public.group_decisions d where d.id = p_decision_id), false)
$function$;

CREATE OR REPLACE FUNCTION private.deliver_due_scheduled_messages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.scheduled_messages;
  v_msg uuid;
  v_done integer := 0;
begin
  for v_row in
    select * from public.scheduled_messages
    where status = 'pending' and send_at <= now()
    order by send_at
    limit 200
    for update skip locked
  loop
    begin
      v_msg := private.deliver_scheduled_row(v_row);
      update public.scheduled_messages set status = 'sent', sent_message_id = v_msg, updated_at = now() where id = v_row.id;
      v_done := v_done + 1;
    exception when others then
      update public.scheduled_messages
        set status = 'failed',
            fail_reason = case when sqlerrm like 'avora_%' or sqlerrm like '%_%_%' and sqlerrm !~ ' ' then 'Không gửi được tin này' else left(sqlerrm, 200) end,
            updated_at = now()
        where id = v_row.id;
    end;
  end loop;
  return v_done;
end;
$function$;

CREATE OR REPLACE FUNCTION private.deliver_scheduled_row(p_row scheduled_messages)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid := gen_random_uuid();
  v_reply uuid := p_row.reply_to_message_id;
begin
  if not exists (select 1 from public.conversations where id = p_row.conversation_id and deleted_at is null)
     or not private.is_conversation_participant(p_row.conversation_id, p_row.sender_id) then
    raise exception 'Bạn không còn trong cuộc trò chuyện này';
  end if;
  begin
    perform private.assert_direct_talk(p_row.conversation_id, p_row.sender_id, 'text');
  exception when others then
    raise exception 'Không gửi được tới người này';
  end;
  -- The quoted message was withdrawn: still send, just without the quote.
  if v_reply is not null and exists (select 1 from public.messages where id = v_reply and deleted_at is not null) then
    v_reply := null;
  end if;
  -- The ordinary write path: same table, same triggers, created_at = now(), so unread counts,
  -- realtime and ordering behave exactly like a message typed now.
  insert into public.messages (id, conversation_id, sender_id, content, reply_to_message_id, mentioned_user_ids)
  values (v_id, p_row.conversation_id, p_row.sender_id, p_row.content, v_reply,
    array(select u from unnest(p_row.mentioned_user_ids) u
          where private.is_conversation_participant(p_row.conversation_id, u)));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.device_notify(p_user uuid, p_body jsonb, p_push text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text;
begin
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    perform private.vault_send_mail(p_body || jsonb_build_object('kind', 'device', 'email', v_email, 'when', private.local_when(p_user)));
  end if;
  if p_push is not null then
    insert into public.push_outbox (user_id, kind, payload, dedupe_key)
    values (p_user, 'security', jsonb_build_object('text', p_push), 'device:' || (p_body ->> 'action') || ':' || gen_random_uuid()::text);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.device_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;
begin
  -- Nobody pressed a button before the deadline: treated as `Đúng` (VMT 02/10).
  for r in select id from public.account_devices where lost_status = 'pending' and lost_deadline < now() loop
    perform private.resolve_lost(r.id, 'confirm');
  end loop;
  delete from public.account_device_lock where unlock_requested_at < now() - interval '72 hours';
  -- S12: a guest device never holds a rank and is forgotten after 24 hours unseen.
  delete from public.account_devices where guest and last_seen_at < now() - interval '24 hours';
  delete from private.device_challenges where expires_at < now();
  delete from private.device_action_tokens where expires_at < now() - interval '1 day';
  delete from private.blocked_sessions where blocked_at < now() - interval '3 days';
  delete from private.device_alarm_log where sent_at < now() - interval '1 day';
end $function$;

CREATE OR REPLACE FUNCTION private.direct_for_connected(p_me uuid, p_other uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := least (p_me::text, p_other::text) || ':' || greatest (p_me::text, p_other::text);
  v_conv uuid;
begin
  select c.id into v_conv from public.conversations c where c.direct_key = v_key and c.deleted_at is null;
  if v_conv is null then
    insert into public.conversations (type, direct_key) values ('direct', v_key)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.direct_key = v_key;
      update public.conversations set deleted_at = null where id = v_conv;
    end if;
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv, p_me), (v_conv, p_other) on conflict do nothing;
  end if;
  update public.conversations
  set verification_status = case when verification_status = 'pending' then 'confirmed' else verification_status end
  where id = v_conv;
  return v_conv;
end;
$function$;

CREATE OR REPLACE FUNCTION private.direct_peer_blocked(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_participants cp
      on cp.conversation_id = c.id and cp.user_id <> p_user_id
    where c.id = p_conversation_id
      and c.type = 'direct'
      and private.is_blocked_between (cp.user_id, p_user_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.direct_peer_of(p_conversation_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select cp.user_id
  from public.conversations c
  join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id <> p_user_id
  where c.id = p_conversation_id and c.type = 'direct'
  order by cp.joined_at
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION private.disappear_label(p_seconds integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_seconds when 3600 then '1 giờ' when 86400 then '24 giờ' when 604800 then '7 ngày' when 2592000 then '30 ngày' end
$function$;

CREATE OR REPLACE FUNCTION private.disappear_line(p_conversation uuid, p_uid uuid, p_text text, p_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text; v_id uuid;
begin
  select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_name from public.profiles p where p.id = p_uid;
  insert into public.messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_uid, coalesce(v_name, 'Một thành viên') || ' ' || p_text, p_kind)
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.dissolve_group(p_group uuid, p_proposal uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tbl uuid;
begin
  -- The group, every sub-group under it, their projects, and every shared table of those.
  create temp table if not exists _avora_dissolve (id uuid) on commit drop;
  truncate _avora_dissolve;
  insert into _avora_dissolve
    with recursive tree as (
      select id, 1 as lvl from conversations where id = p_group
      union all select c.id, tree.lvl + 1 from conversations c join tree on c.parent_group_id = tree.id where tree.lvl < 4
    ) select id from tree;

  for v_tbl in
    select t.id from think_hub_table t
    where t.deleted_at is null and t.parent_record_id is null
      and (t.conversation_id in (select id from _avora_dissolve)
           or t.project_id in (select pr.id from projects pr where pr.conversation_id in (select id from _avora_dissolve)))
  loop
    perform private.cascade_table_tasks(v_tbl);
    update think_hub_table set deleted_at = now(), deleted_via = p_proposal where id = v_tbl;
  end loop;

  update projects set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Nhóm đã giải tán', deleted_via = p_proposal
  where deleted_at is null and conversation_id in (select id from _avora_dissolve);
  update conversations set deleted_at = now(), deleted_via = p_proposal
  where deleted_at is null and id in (select id from _avora_dissolve);
end $function$;

CREATE OR REPLACE FUNCTION private.enforce_group_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if (select type from public.conversations where id = new.conversation_id) is distinct from 'group' then
    return new;
  end if;
  perform pg_advisory_xact_lock (hashtext ('avora_group_capacity:' || new.conversation_id::text));
  if exists (select 1 from public.conversation_participants
             where conversation_id = new.conversation_id and user_id = new.user_id) then
    return new;
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = new.conversation_id) >= 300 then
    raise exception 'avora_group_full';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_group_depth()
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

CREATE OR REPLACE FUNCTION private.enforce_message_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_type text; v_ref jsonb; v_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.refs is distinct from old.refs or new.contact_card_user_id is distinct from old.contact_card_user_id then
      raise exception 'avora_ref_out_of_scope';
    end if;
    return new;
  end if;
  select c.type into v_type from public.conversations c where c.id = new.conversation_id;
  -- 1-1: the other person is already here; nobody to name. Journal: `@` links a contact, never notifies.
  if v_type in ('direct', 'personal') and coalesce(array_length(new.mentioned_user_ids, 1), 0) > 0 then
    raise exception 'avora_ref_out_of_scope';
  end if;
  if new.refs is not null then
    for v_ref in select * from jsonb_array_elements(new.refs) loop
      begin
        v_id := (v_ref ->> 'id')::uuid;
      exception when others then raise exception 'avora_ref_out_of_scope';
      end;
      if not private.ref_in_conversation(new.conversation_id, new.sender_id, v_ref ->> 'type', v_id) then
        raise exception 'avora_ref_out_of_scope';
      end if;
    end loop;
  end if;
  if new.contact_card_user_id is not null and not private.contact_card_allowed(new.conversation_id, new.sender_id, new.contact_card_user_id) then
    raise exception 'avora_contact_card_not_allowed';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.enforce_project_chat_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(current_setting('avora.project_system', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF private.conversation_project_closed(NEW.conversation_id) THEN
    RAISE EXCEPTION 'avora_project_chat_closed';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_urgent_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_state record;
  v_since timestamptz;
  v_count int;
  v_first timestamptz;
begin
  if not new.is_urgent then return new; end if;
  if (select type from conversations where id = new.conversation_id) = 'personal' then
    raise exception 'avora_urgent_not_here';
  end if;
  perform pg_advisory_xact_lock(hashtext('avora_urgent:' || new.sender_id::text));
  select * into v_state from private.urgent_state(new.sender_id, new.conversation_id);
  if v_state.locked_until is not null then raise exception 'avora_urgent_locked'; end if;
  if v_state.used_today then raise exception 'avora_urgent_daily_limit'; end if;

  insert into private.urgent_usage (user_id, conversation_id) values (new.sender_id, new.conversation_id);

  -- A chain starts fresh after the last lock ended; 3 uses inside 7 days lock for 7 days from the first.
  v_since := greatest(now() - interval '7 days',
    coalesce((select max(locked_until) from private.urgent_locks where user_id = new.sender_id), '-infinity'::timestamptz));
  select count(*), min(used_at) into v_count, v_first
    from private.urgent_usage where user_id = new.sender_id and used_at > v_since;
  if v_count >= 3 then
    insert into private.urgent_locks (user_id, locked_until) values (new.sender_id, v_first + interval '7 days');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.enqueue_due_habits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n integer;
begin
  with p as (
    select pr.id, coalesce(pr.timezone, 'Asia/Ho_Chi_Minh') tz, pr.rest_weekday,
           (now() at time zone coalesce(pr.timezone, 'Asia/Ho_Chi_Minh')) local_now
    from public.profiles pr
    where pr.push_reminders
      and (pr.focus_mode is null or (pr.focus_until is not null and pr.focus_until <= now()))
      and exists (select 1 from public.push_subscriptions s where s.user_id = pr.id)
      and not exists (select 1 from public.mute_settings m where m.user_id = pr.id and m.scope = 'avora' and m.muted_until > now())
  ), due as (
    select h.id habit_id, h.user_id, h.name, (w.ord - 1)::integer idx, w.value->>'time' at_time, p.local_now::date local_date
    from public.habits h
    join p on p.id = h.user_id
    cross join lateral jsonb_array_elements(h.windows) with ordinality w(value, ord)
    where h.paused_at is null and h.archived_at is null and h.reminders_on
      and extract(isodow from p.local_now)::integer = any (h.weekdays)
      and extract(dow from p.local_now)::integer <> coalesce(p.rest_weekday, -1)
      and coalesce((w.value->>'remind')::boolean, true)
      and (p.local_now::date + (w.value->>'time')::time) <= p.local_now
      and (p.local_now::date + (w.value->>'time')::time) > p.local_now - interval '1 hour'
      and not exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.local_date = p.local_now::date
                      and l.window_index = (w.ord - 1) and l.status = 'done')
  )
  insert into public.push_outbox (user_id, kind, dedupe_key, payload)
  select d.user_id, 'habit', 'hb:' || d.habit_id || ':' || d.local_date || ':' || d.idx,
         jsonb_build_object('habit_id', d.habit_id, 'title', d.name, 'at', d.at_time)
  from due d
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.enqueue_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer := 0; v_step integer;
begin
  -- 1. task_reminders: is_sent keeps it to one; only the reminder's own person.
  with due as (
    update task_reminders r set is_sent = true
    from tasks t
    where t.id = r.task_id and not r.is_sent and r.reminder_time <= now() and r.reminder_time > now() - interval '1 hour'
      and t.status not in ('done', 'skipped')
    returning r.id, r.user_id, r.task_id, r.reminder_time
  )
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select d.user_id, 'reminder', d.task_id, 'tr:' || d.id, jsonb_build_object('at', d.reminder_time)
  from due d join profiles p on p.id = d.user_id
  where p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = d.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 2. tasks.departure_reminder_at: the person who does the task (never the proposer, D3).
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select coalesce(t.assignee_id, t.creator_id), 'reminder', t.id, 'dep:' || t.id || ':' || t.departure_reminder_at, jsonb_build_object('at', t.departure_reminder_at, 'go', true)
  from tasks t join profiles p on p.id = coalesce(t.assignee_id, t.creator_id)
  where t.departure_reminder_at <= now() and t.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped') and t.pending_decision_id is null
    and (t.type = 'personal' or t.assignee_id is not null)
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = p.id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 3. task_travel_plans: the assignee's own travel for a task from a suggestion.
  insert into push_outbox (user_id, kind, task_id, dedupe_key, payload)
  select tp.user_id, 'reminder', tp.task_id, 'tp:' || tp.task_id || ':' || tp.departure_reminder_at, jsonb_build_object('at', tp.departure_reminder_at, 'go', true)
  from task_travel_plans tp join tasks t on t.id = tp.task_id join profiles p on p.id = tp.user_id
  where tp.departure_reminder_at <= now() and tp.departure_reminder_at > now() - interval '1 hour'
    and t.status not in ('done', 'skipped')
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = tp.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;

  -- 4. `Nhắc tôi xem lại`: only the person who set it, while they can still see the board (AVORA-69).
  insert into push_outbox (user_id, kind, dedupe_key, payload)
  select m.user_id, 'reminder', 'rec:' || r.id || ':' || m.user_id || ':' || m.remind_at,
         jsonb_build_object('at', m.remind_at, 'record_id', r.id, 'table_id', r.table_id, 'title', r.title)
  from think_hub_record_reminders m
  join think_hub_record r on r.id = m.record_id
  join profiles p on p.id = m.user_id
  where r.deleted_at is null and m.remind_at <= now() and m.remind_at > now() - interval '1 hour'
    and private.think_hub_table_visible(r.table_id, m.user_id)
    and p.push_reminders and exists (select 1 from push_subscriptions s where s.user_id = m.user_id)
  on conflict do nothing;
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.enqueue_message_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_surface text; v_pending boolean;
begin
  if new.system_kind is not null or new.deleted_at is not null then return null; end if;
  v_surface := private.push_surface(new.conversation_id);
  if v_surface is null then return null; end if;
  select c.verification_status = 'pending' into v_pending from public.conversations c where c.id = new.conversation_id;
  insert into public.push_outbox (user_id, kind, conversation_id, message_id, send_after)
  select cp.user_id, case when coalesce(v_pending, false) then 'friend_request' else 'message' end,
         new.conversation_id, new.id,
         -- Đọc yên tĩnh holds the push (never drops it) until the reader's quiet window ends.
         greatest(pg_catalog.now() + interval '20 seconds',
                  coalesce((select p.quiet_reading_until from public.profiles p
                            where p.id = cp.user_id and p.quiet_reading_until > pg_catalog.now()), pg_catalog.now()))
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id
    and exists (select 1 from public.push_subscriptions s where s.user_id = cp.user_id)
    and not private.is_blocked_between(cp.user_id, new.sender_id)
    and not private.push_mute_blocks(cp.user_id, v_surface, new.conversation_id,
          exists (select 1 from public.family_relations f where f.user_id = cp.user_id and f.related_user_id = new.sender_id),
          cp.user_id = any (coalesce(new.mentioned_user_ids, '{}'::uuid[])),
          new.is_urgent);
  return null;
exception when others then
  raise warning 'avora_push_enqueue_failed';
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.ensure_opportunity_board(p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  select id into v_id from public.think_hub_table where owner_user_id = p_user and sync_source = 'contact_opportunities' and deleted_at is null;
  if v_id is not null then return v_id; end if;
  perform set_config('avora.sync_board', 'on', true);
  insert into public.think_hub_table (owner_user_id, name, purpose, column_defs, status_options, title_label, default_view, sync_source, position)
  values (p_user, 'Danh bạ | Danh sách cơ hội', private.opportunity_board_purpose(), '[]'::jsonb,
    '[{"key":"lead","label":"Mới ghi nhận"},{"key":"tiem_nang","label":"Tiềm năng"},{"key":"dang_cham_soc","label":"Đang chăm sóc"},{"key":"doi_tac","label":"Đối tác","done":true},{"key":"khong_thanh","label":"Không thành"}]'::jsonb,
    'Tiêu đề', 'table', 'contact_opportunities', -1)
  returning id into v_id;
  perform set_config('avora.sync_board', 'off', true);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.execute_proposal(p_id uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v shared_proposals%rowtype; v_title text;
begin
  select * into v from shared_proposals where id = p_id;
  perform private.act_as(p_actor);
  perform set_config('avora.proposal_exec', 'on', true);
  if v.target_type = 'think_hub_table' then
    if v.action = 'move' then
      perform private.move_board_tree(v.target_id, v.move_to_conversation, coalesce(v.move_mode, 'edit'), v.proposed_by);
    elsif v.action = 'delete' then
      perform public.delete_think_hub_table(v.target_id);
      update think_hub_table set deleted_via = v.id where id = v.target_id;
    else
      perform public.set_think_hub_table_archived(v.target_id, v.action = 'archive');
    end if;
  elsif v.target_type = 'group' then
    perform private.dissolve_group(v.target_id, v.id);
  elsif v.action = 'delete' then
    select title into v_title from projects where id = v.target_id;
    perform public.delete_project(v.target_id, v_title, v.reason);
    update projects set deleted_via = v.id where id = v.target_id;
  else
    perform public.reopen_project(v.target_id);
  end if;
  perform set_config('avora.proposal_exec', 'off', true);
end $function$;

CREATE OR REPLACE FUNCTION private.expire_recall_requests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v record; v_n integer := 0;
begin
  for v in
    update message_recall_request r set resolved_at = now(), close_reason = 'expired'
    from messages m join conversations c on c.id = m.conversation_id
    where m.id = r.message_id and r.resolved_at is null and r.created_at < now() - interval '30 days'
    returning r.requested_by, m.conversation_id, c.type, c.deleted_at
  loop
    v_n := v_n + 1;
    if v.type = 'direct' and v.deleted_at is null then
      begin
        perform private.post_system_line(v.conversation_id, v.requested_by, 'recall_expired',
          'Đề nghị thu hồi một tin nhắn đã hết hạn sau 30 ngày. Tin nhắn vẫn giữ nguyên.');
      exception when others then
        raise warning 'avora_recall_expiry_line_failed';
      end;
    end if;
  end loop;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.feature_set(p_actor uuid, p_key text, p_status text, p_note text)
 RETURNS app_features
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old text;
  v_row public.app_features%rowtype;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then
    raise exception 'avora_not_allowed';
  end if;
  if p_status not in ('stable', 'soon', 'hidden') then raise exception 'avora_feature_status'; end if;
  select status into v_old from public.app_features where key = p_key for update;
  if not found then raise exception 'avora_feature_unknown'; end if;
  update public.app_features
    set status = p_status, note = coalesce(nullif(btrim(p_note), ''), note), updated_at = now(), updated_by = p_actor
    where key = p_key returning * into v_row;
  insert into public.app_feature_changes (key, from_status, to_status, note, changed_by)
    values (p_key, v_old, p_status, nullif(btrim(p_note), ''), p_actor);
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION private.feature_status(p_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select f.status from public.app_features f where f.key = p_key), 'stable')
$function$;

CREATE OR REPLACE FUNCTION private.fold_search(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select lower(regexp_replace(translate(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')), 'đĐ', 'dD'), '\s+', ' ', 'g'))
$function$;

CREATE OR REPLACE FUNCTION private.folder_uuid(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid end
$function$;

CREATE OR REPLACE FUNCTION private.freeze_removed_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.removed_at is not null and new.removed_at is not null then
    raise exception 'avora_finance_in_trash';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.group_root(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current uuid := p_conversation_id;
  v_parent uuid;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT parent_group_id INTO v_parent FROM conversations WHERE id = v_current;
    EXIT WHEN v_parent IS NULL;
    v_current := v_parent;
  END LOOP;
  RETURN v_current;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_opportunity_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.opportunity_id is not null and auth.uid() is not null then raise exception 'avora_opportunity_row_locked'; end if;
    return old;
  end if;
  if coalesce(current_setting('avora.opp_sync', true), '') <> 'on'
     and exists (select 1 from public.think_hub_table where id = new.table_id and sync_source is not null) then
    raise exception 'avora_opportunity_use_new';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_sync_board()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.sync_source is not null and auth.uid() is not null then raise exception 'avora_sync_board_locked'; end if;
    return old;
  end if;
  if old.sync_source is null or coalesce(current_setting('avora.sync_board', true), '') = 'on' then return new; end if;
  if new.name is distinct from old.name or new.purpose is distinct from old.purpose or new.deleted_at is distinct from old.deleted_at
     or new.archived_at is distinct from old.archived_at or new.conversation_id is distinct from old.conversation_id
     or new.sync_source is distinct from old.sync_source or new.status_options is distinct from old.status_options then
    raise exception 'avora_sync_board_locked';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.habit_date_ok(p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
$function$;

CREATE OR REPLACE FUNCTION private.habit_owned(p_habit uuid, p_uid uuid)
 RETURNS habits
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v public.habits;
begin
  if p_uid is null or not private.session_allowed() then raise exception 'avora_not_signed_in' using errcode = '42501'; end if;
  select * into v from public.habits where id = p_habit;
  if v.id is null or v.user_id <> p_uid then raise exception 'avora_habit_not_found' using errcode = '42501'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION private.habit_windows_clean(p_windows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_out jsonb := '[]'::jsonb; v_item jsonb; v_time text;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) not between 1 and 12 then
    raise exception 'avora_habit_windows' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_windows) loop
    v_time := v_item->>'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'avora_habit_windows' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('time', v_time, 'remind', coalesce((v_item->>'remind')::boolean, true)));
  end loop;
  -- Theo giờ trong ngày, không trùng giờ.
  select coalesce(jsonb_agg(w order by w->>'time'), '[]'::jsonb) into v_out from (select distinct on (w->>'time') w from jsonb_array_elements(v_out) w order by w->>'time') x;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION private.health_summary(p_actor uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_since date := (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(1, least(coalesce(p_days, 7), 90)) + 1;
begin
  if p_actor is null or p_actor is distinct from auth.uid() or not private.is_ops(p_actor) then raise exception 'avora_not_allowed'; end if;
  return jsonb_build_object(
    'since', v_since,
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n, 'people', d.p) order by d.day)
      from (select day, sum(count) n, count(distinct user_id) p from public.client_errors where day >= v_since group by day) d), '[]'),
    'byScope', coalesce((select jsonb_agg(jsonb_build_object('scope', d.s, 'count', d.n) order by d.n desc)
      from (select error_name s, sum(count) n from public.client_errors where day >= v_since group by error_name) d), '[]'),
    'byVersion', coalesce((select jsonb_agg(jsonb_build_object('version', d.v, 'count', d.n) order by d.n desc)
      from (select app_version v, sum(count) n from public.client_errors where day >= v_since group by app_version) d), '[]'),
    'sendFailed', coalesce((select sum(count) from public.client_errors where day >= v_since and error_name = 'outbox' and message_short like 'send_failed%'), 0),
    'realtimeReconnects', coalesce((select sum(count) from public.client_errors where day >= v_since and error_name = 'realtime'), 0),
    'top', coalesce((select jsonb_agg(t) from (
      select jsonb_build_object('scope', error_name, 'code', message_short, 'route', min(route), 'count', sum(count), 'people', count(distinct user_id)) t
      from public.client_errors where day >= v_since group by error_name, message_short order by sum(count) desc limit 10) x), '[]')
  );
end $function$;

CREATE OR REPLACE FUNCTION private.invite_blocks(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'invite_required'), false)
     and exists (
       select 1 from public.profiles p
        where p.id = p_uid and p.invite_code is null
          and p.created_at >= coalesce(
            (select (c.value #>> '{}')::timestamptz from public.app_config c where c.key = 'invite_required_since'),
            'infinity'::timestamptz))
$function$;

CREATE OR REPLACE FUNCTION private.invite_message_or_raise(p_message text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v text := regexp_replace (btrim (coalesce (p_message, '')), '\s+', ' ', 'g');
begin
  if char_length (v) < 10 or char_length (v) > 200 then raise exception 'avora_invite_message_length'; end if;
  if private.text_has_link (v) then raise exception 'avora_verification_no_links'; end if;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION private.is_blocked_between(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = p_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_group_officer(p_conversation_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = p_user
      and cp.role in ('owner','admin')
  )
$function$;

CREATE OR REPLACE FUNCTION private.is_group_root_owner(p_conversation_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = private.group_root(p_conversation_id)
      AND cp.user_id = p_user AND cp.role = 'owner'
  )
$function$;

CREATE OR REPLACE FUNCTION private.is_ops(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_uid is not null and coalesce(
    (select c.value ? p_uid::text from public.app_config c where c.key = 'ops_user_ids' and jsonb_typeof(c.value) = 'array'),
    false)
$function$;

CREATE OR REPLACE FUNCTION private.is_proposal_party(p_proposal uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from shared_proposals p where p.id = p_proposal and p.proposed_by = p_user)
      or exists (select 1 from shared_proposal_votes v where v.proposal_id = p_proposal and v.user_id = p_user)
$function$;

CREATE OR REPLACE FUNCTION private.keep_message_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(current_setting('avora.expiring', true), '') <> '1' then
    new.expires_at := old.expires_at;
    new.expired_at := old.expired_at;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.live_verification_between(p_a uuid, p_b uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.id from public.conversations c
  where c.direct_key = least (p_a::text, p_b::text) || ':' || greatest (p_a::text, p_b::text)
    and c.deleted_at is null and private.verification_is_live (c.id)
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION private.local_when(p_user uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select to_char(p_at at time zone coalesce((select timezone from public.profiles where id = p_user), 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY')
$function$;

CREATE OR REPLACE FUNCTION private.log_task_link(p_record_id uuid, p_kind text, p_task_title text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_table uuid; v_owner uuid; v_title text;
begin
  select r.table_id, r.owner_user_id, r.title into v_table, v_owner, v_title from public.think_hub_record r where r.id = p_record_id;
  if v_table is null or not private.think_hub_is_shared(v_table) then return; end if;
  insert into public.think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, after)
  values (v_table, p_actor, p_kind, p_record_id, v_owner, v_title, 1, jsonb_build_object('task', p_task_title));
exception when others then
  raise warning 'avora_board_log_failed';
end $function$;

CREATE OR REPLACE FUNCTION private.log_think_hub_column_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null or (new.conversation_id is null and new.project_id is null) then return null; end if;
  if old.column_defs is not distinct from new.column_defs then return null; end if;
  for v_new in select d from jsonb_array_elements(new.column_defs) d loop
    select d into v_old from jsonb_array_elements(old.column_defs) d where d->>'id' = v_new->>'id';
    if v_old is null then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, after) values (new.id, v_actor, 'column_add', v_new->>'id', v_new);
    elsif (v_old - 'width') is distinct from (v_new - 'width') then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, before, after) values (new.id, v_actor, 'column_edit', v_new->>'id', v_old, v_new);
    end if;
  end loop;
  for v_old in select d from jsonb_array_elements(old.column_defs) d loop
    if not exists (select 1 from jsonb_array_elements(new.column_defs) d where d->>'id' = v_old->>'id') then
      insert into think_hub_change_log (table_id, actor_id, kind, column_id, before) values (new.id, v_actor, 'column_delete', v_old->>'id', v_old);
    end if;
  end loop;
  return null;
exception when others then
  raise warning 'avora_board_log_failed';
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.log_think_hub_record_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_cells integer := 0;
  v_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null or not private.think_hub_is_shared(new.table_id) then return null; end if;

  if tg_op = 'INSERT' then
    insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, after)
    values (new.table_id, v_actor, 'record_add', new.id, new.owner_user_id, new.title, 1, jsonb_build_object('title', new.title));
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, before)
    values (new.table_id, v_actor, 'record_delete', new.id, new.owner_user_id, new.title, 1, jsonb_build_object('title', old.title));
    return null;
  end if;
  if old.deleted_at is not null then return null; end if;

  -- Only what a reader sees counts; bookkeeping columns do not.
  v_old := jsonb_build_object('title', old.title, 'status', old.status, 'priority', old.priority, 'category', old.category,
    'next_action_date', old.next_action_date, 'tags', to_jsonb(old.tags), 'notes', old.notes, 'remind_at', old.remind_at);
  v_new := jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority, 'category', new.category,
    'next_action_date', new.next_action_date, 'tags', to_jsonb(new.tags), 'notes', new.notes, 'remind_at', new.remind_at);
  for v_key in select jsonb_object_keys(v_new) loop
    if (v_old->v_key) is distinct from (v_new->v_key) then
      v_before := v_before || jsonb_build_object(v_key, v_old->v_key);
      v_after := v_after || jsonb_build_object(v_key, v_new->v_key);
      v_cells := v_cells + 1;
    end if;
  end loop;
  for v_key in
    select k from jsonb_object_keys(coalesce(old.extension_fields, '{}'::jsonb) || coalesce(new.extension_fields, '{}'::jsonb)) k
  loop
    if nullif(coalesce(old.extension_fields, '{}'::jsonb)->v_key, 'null'::jsonb) is distinct from nullif(coalesce(new.extension_fields, '{}'::jsonb)->v_key, 'null'::jsonb) then
      v_before := v_before || jsonb_build_object('ext:' || v_key, coalesce(old.extension_fields->v_key, 'null'::jsonb));
      v_after := v_after || jsonb_build_object('ext:' || v_key, coalesce(new.extension_fields->v_key, 'null'::jsonb));
      v_cells := v_cells + 1;
    end if;
  end loop;
  if v_cells = 0 then return null; end if;

  insert into think_hub_change_log (table_id, actor_id, kind, record_id, record_owner_id, record_title, cells, before, after)
  values (new.table_id, v_actor, 'record_edit', new.id, new.owner_user_id, new.title, v_cells, v_before, v_after);
  return null;
exception when others then
  -- The log must never stop an edit.
  raise warning 'avora_board_log_failed';
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.materialize_template_columns(p_cols jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', k.id, 'key', k.id, 'label', btrim(c->>'label'), 'type', c->>'type',
      'options', case when c->>'type' = 'select' then c->'options' end
    )) order by k.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cols, '[]'::jsonb)) with ordinality as e(c, ord)
  cross join lateral (select e.ord, 'col_' || replace(gen_random_uuid()::text, '-', '') as id) k
$function$;

CREATE OR REPLACE FUNCTION private.members_of(p_conversation uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(cp.user_id), '{}') from public.conversation_participants cp where cp.conversation_id = p_conversation
$function$;

CREATE OR REPLACE FUNCTION private.move_board_tree(p_table uuid, p_dest uuid, p_mode text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_root think_hub_table%rowtype; v_tree uuid[]; v_dest_type text; v_rows int; v_msg uuid; v_actor_name text;
begin
  select * into v_root from think_hub_table where id = p_table for update;
  select array_agg(id) into v_tree from private.think_hub_table_tree(p_table);
  if p_dest is not null then select type into v_dest_type from conversations where id = p_dest; end if;

  perform set_config('avora.board_move', 'on', true);
  update think_hub_table set conversation_id = p_dest, share_mode = case when p_dest is null then 'edit' else p_mode end
  where id = any (v_tree);

  -- Tasks the owner raised from the board's rows go with it: they become the room's shared tasks,
  -- assigned to the owner as before. Their private part (reminders, travel, steps) stays the owner's.
  if p_dest is not null then
    update tasks t set
      type = case when v_dest_type = 'direct' then '1-1-shared' else 'group-shared' end,
      conversation_id = p_dest,
      assignee_id = coalesce(t.assignee_id, t.creator_id),
      confirmed_at = coalesce(t.confirmed_at, now()),
      completed_confirmed_at = case when t.status = 'done' then coalesce(t.completed_confirmed_at, t.done_at, now()) else null end,
      task_list_id = null
    from think_hub_record_tasks rt join think_hub_record r on r.id = rt.record_id
    where rt.task_id = t.id and r.table_id = any (v_tree)
      and t.type = 'personal' and t.creator_id = v_root.owner_user_id and t.pending_decision_id is null;
  end if;
  -- A task that cannot follow (another room's task, someone else's) stays where it lives, unlinked.
  delete from think_hub_record_tasks rt using think_hub_record r, tasks t
  where rt.record_id = r.id and t.id = rt.task_id and r.table_id = any (v_tree)
    and ((p_dest is null and not (t.type = 'personal' and t.creator_id = v_root.owner_user_id))
      or (p_dest is not null and t.conversation_id is distinct from p_dest));
  perform set_config('avora.board_move', 'off', true);

  select count(*) into v_rows from think_hub_record where table_id = p_table and deleted_at is null;
  v_actor_name := private.public_name(v_root.owner_user_id);
  if p_dest is not null then
    v_msg := private.post_system_line(p_dest, p_actor, 'board_shared',
      case when v_root.conversation_id is null
        then format('%s chia sẻ Bảng "%s" · %s Hạng mục', v_actor_name, v_root.name, v_rows)
        else format('Bảng "%s" của %s đã chuyển vào đây · %s Hạng mục', v_root.name, v_actor_name, v_rows) end);
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind)
    values (p_table, p_dest, v_msg, p_actor, 'shared');
  end if;
  if v_root.conversation_id is not null then
    perform private.post_system_line(v_root.conversation_id, p_actor, 'board_moved',
      format('Bảng "%s" đã chuyển sang %s', v_root.name, private.board_place_label(p_dest, v_root.owner_user_id)));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.mute_decide(p_avora boolean, p_focus text, p_messages boolean, p_conversation boolean, p_tab boolean, p_surface text, p_family boolean, p_mention boolean, p_urgent boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_temp'
AS $function$
  select case
    when p_avora then true
    when p_family or p_urgent then false
    when p_focus is not null then true
    when p_messages then true
    when p_conversation or p_tab then not (p_surface = 'group' and p_mention)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION private.mute_settings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A conversation mute always ends: the longest choice is "Hết hôm nay".
  if new.scope = 'conversation' and new.muted_until > now() + interval '25 hours' then
    raise exception 'avora_mute_too_long';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.new_action_token(p_user uuid, p_kind text, p_device uuid, p_expires timestamp with time zone, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into private.device_action_tokens (user_id, kind, device_id, token_hash, expires_at, meta)
  values (p_user, p_kind, p_device, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_expires, p_meta);
  return v_token;
end $function$;

CREATE OR REPLACE FUNCTION private.normalize_channel(p_kind text, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '';
  END IF;

  IF p_kind = 'email' THEN
    RETURN lower(btrim(p_value));
  END IF;

  -- +84 912 345 678 và 0912345678 là cùng một số: người lưu dạng này rồi nhập
  -- dạng kia vẫn phải ra một liên hệ, không phải hai.
  v := regexp_replace(p_value, '[^0-9+]', '', 'g');
  v := regexp_replace(v, '^\+?84', '0');
  RETURN regexp_replace(v, '[^0-9]', '', 'g');
END;
$function$;

CREATE OR REPLACE FUNCTION private.normalize_phone(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select nullif(regexp_replace(
    regexp_replace(regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g'), '^\+?84', '0'),
    '[^0-9]', '', 'g'), '')
$function$;

CREATE OR REPLACE FUNCTION private.note_attachment_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from notes n where n.id = new.note_id and n.owner_user_id = new.owner_user_id) then
    raise exception 'avora_note_not_yours';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.note_attachments_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update notes set title = title where id = coalesce(new.note_id, old.note_id);
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.note_connection_attempt(p_user uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Shared: 20 openings per hour across both paths (anti PIN-scanning).
  if (select count (*) from private.connection_attempts
      where user_id = p_user and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'avora_pin_rate_limited';
  end if;
  insert into private.connection_attempts (user_id, kind) values (p_user, p_kind);
end;
$function$;

CREATE OR REPLACE FUNCTION private.note_folder_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    -- Allowed only when the owner's account itself is going (the cascade has removed them already).
    if old.is_system and exists (select 1 from auth.users where id = old.owner_user_id) then raise exception 'avora_note_folder_system'; end if;
    return old;
  end if;
  if old.is_system and (new.name <> old.name or new.is_system <> old.is_system or new.system_key is distinct from old.system_key) then
    raise exception 'avora_note_folder_system';
  end if;
  if new.owner_user_id <> old.owner_user_id then raise exception 'avora_note_not_yours'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.note_folder_tree_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_parent public.note_folders%rowtype;
  v_parent_depth int := 0;
  v_subtree_height int := 1;
  v_cursor uuid;
  v_steps int := 0;
begin
  if new.parent_id is null then
    -- A root folder: only its own subtree can make it too deep.
    null;
  else
    if new.is_system then raise exception 'avora_note_folder_system'; end if;
    if new.parent_id = new.id then raise exception 'avora_note_folder_cycle'; end if;

    select * into v_parent from public.note_folders where id = new.parent_id;
    if not found or v_parent.owner_user_id <> new.owner_user_id then
      raise exception 'avora_note_folder_parent';
    end if;
    if v_parent.is_system then raise exception 'avora_note_folder_system'; end if;

    -- Walk up from the parent: a cycle is the new row turning up among its own ancestors.
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      if v_cursor = new.id then raise exception 'avora_note_folder_cycle'; end if;
      v_parent_depth := v_parent_depth + 1;
      v_steps := v_steps + 1;
      if v_steps > 10 then raise exception 'avora_note_folder_depth'; end if;
      select parent_id into v_cursor from public.note_folders where id = v_cursor;
    end loop;
  end if;

  -- How many levels hang below this folder already (1 = none).
  if tg_op = 'UPDATE' then
    with recursive sub(id, lvl) as (
      select id, 1 from public.note_folders where id = new.id
      union all
      select f.id, sub.lvl + 1 from public.note_folders f join sub on f.parent_id = sub.id where sub.lvl < 10
    )
    select coalesce(max(lvl), 1) into v_subtree_height from sub;
  end if;

  if v_parent_depth + v_subtree_height > 3 then
    raise exception 'avora_note_folder_depth';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.note_kind(p_kind text, p_mime text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_kind in ('image', 'file', 'voice') then p_kind
              when coalesce(p_mime, '') like 'image/%' then 'image'
              when coalesce(p_mime, '') like 'audio/%' then 'voice'
              else 'file' end
$function$;

CREATE OR REPLACE FUNCTION private.note_plain_text(p_blocks jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(string_agg(b->>'text', E'\n' order by ord), '')
  from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) with ordinality as t(b, ord)
$function$;

CREATE OR REPLACE FUNCTION private.notes_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_files text;
begin
  if tg_op = 'UPDATE' and new.owner_user_id <> old.owner_user_id then raise exception 'avora_note_not_yours'; end if;
  if new.folder_id is not null and not exists (select 1 from note_folders f where f.id = new.folder_id and f.owner_user_id = new.owner_user_id) then
    raise exception 'avora_note_folder_missing';
  end if;
  if new.book_record_id is not null and (tg_op = 'INSERT' or new.book_record_id is distinct from old.book_record_id) then
    if not exists (select 1 from think_hub_record r join think_hub_table t on t.id = r.table_id
                   where r.id = new.book_record_id and t.kind = 'bookshelf' and t.owner_user_id = new.owner_user_id) then
      raise exception 'avora_note_book_missing';
    end if;
    select r.title into new.book_title from think_hub_record r where r.id = new.book_record_id;
  end if;
  -- tags: trimmed, lower-case-unique ("bài giảng" = "Bài giảng"), the first spelling kept
  select coalesce(array_agg(t order by ord), '{}') into new.tags from (
    select distinct on (lower(btrim(t))) btrim(t) as t, ord
    from unnest(coalesce(new.tags, '{}')) with ordinality as u(t, ord)
    where btrim(t) <> '' order by lower(btrim(t)), ord
  ) x;
  select coalesce(string_agg(file_name, ' '), '') into v_files from note_attachments where note_id = new.id;
  new.search_text := public.f_unaccent(concat_ws(' ', new.title, private.note_plain_text(new.blocks), array_to_string(new.tags, ' '), new.book_title, v_files));
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.notes_with(p_notes text, p_lines text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nullif(btrim(concat_ws(E'\n\n', nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(array_to_string(p_lines, E'\n'), ''))), '')
$function$;

CREATE OR REPLACE FUNCTION private.notify_participant_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', old.conversation_id,
                       'name', (select g.name from public.conversation_groups g where g.conversation_id = old.conversation_id)),
    'removed', 'user-' || old.user_id::text, true);
  return old;
exception when others then
  return old; -- a failed notice never blocks leaving
end $function$;

CREATE OR REPLACE FUNCTION private.obligation_status(p_due_date date, p_amount numeric, p_settled numeric, p_today date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
           WHEN p_settled >= p_amount THEN 'hoan_thanh'
           WHEN p_due_date < p_today  THEN 'qua_han'
           WHEN p_settled > 0         THEN 'hoan_thanh_mot_phan'
           WHEN p_due_date = p_today  THEN 'den_han'
           ELSE 'ke_hoach'
         END;
$function$;

CREATE OR REPLACE FUNCTION private.on_device_removed(p_device uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from private.vault_device_shares s using public.account_devices d
  where d.id = p_device and s.user_id = d.user_id and s.device_id = d.device_id;
end $function$;

CREATE OR REPLACE FUNCTION private.on_participant_left()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION private.open_verification(p_me uuid, p_other uuid, p_via_group uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := least (p_me::text, p_other::text) || ':' || greatest (p_me::text, p_other::text);
  v_conv uuid;
begin
  select c.id into v_conv from public.conversations c where c.direct_key = v_key and c.deleted_at is null;
  if v_conv is null then
    insert into public.conversations (type, direct_key) values ('direct', v_key)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.direct_key = v_key;
      -- A soft-deleted 1-1 comes back to life rather than colliding on the unique key.
      update public.conversations set deleted_at = null where id = v_conv;
    end if;
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv, p_me), (v_conv, p_other) on conflict do nothing;
  end if;

  delete from public.conversation_verification_confirms where conversation_id = v_conv;
  update public.conversations
  set verification_status = 'pending',
      verification_started_at = now(),
      verification_expires_at = now() + interval '7 days',
      verification_via_group_id = p_via_group,
      verification_opened_by = p_me,
      verification_resolved_at = null
  where id = v_conv;
  return v_conv;
end;
$function$;

CREATE OR REPLACE FUNCTION private.opportunity_board_purpose()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select 'Ai đang là cơ hội, đang ở giai đoạn nào, bước tiếp theo là gì?'::text $function$;

CREATE OR REPLACE FUNCTION private.opportunity_to_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_board uuid;
begin
  if coalesce(current_setting('avora.opp_sync', true), '') = 'on' then return new; end if;
  perform set_config('avora.opp_sync', 'on', true);
  if tg_op = 'INSERT' then
    v_board := private.ensure_opportunity_board(new.owner_user_id);
    insert into public.think_hub_record (table_id, owner_user_id, title, status, opportunity_id)
    values (v_board, new.owner_user_id, new.title, new.stage, new.id);
  else
    update public.think_hub_record set
      title = new.title, status = new.stage,
      deleted_at = case when new.removed_at is not null and old.removed_at is null then now()
                        when new.removed_at is null and old.removed_at is not null then null else deleted_at end
    where opportunity_id = new.id;
  end if;
  perform set_config('avora.opp_sync', 'off', true);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.patch_think_hub_column(p_table_id uuid, p_column_id text, p_patch jsonb)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.column_defs) d WHERE d->>'id' = p_column_id) THEN
    RAISE EXCEPTION 'avora_think_hub_column_missing';
  END IF;

  UPDATE think_hub_table
  SET column_defs = (
    SELECT jsonb_agg(
      CASE WHEN d->>'id' = p_column_id THEN jsonb_strip_nulls(d || p_patch) ELSE d END
      ORDER BY ord)
    FROM jsonb_array_elements(v_row.column_defs) WITH ORDINALITY AS e(d, ord)
  )
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION private.plan_record_transfer(p_record_id uuid, p_target_table_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r think_hub_record%rowtype; src think_hub_table%rowtype; dst think_hub_table%rowtype;
  v_sub think_hub_table%rowtype;
  v_same boolean; v_src_shared boolean; v_dst_shared boolean;
  v_status_to text; v_status_changed boolean;
  v_ext jsonb := '{}'::jsonb; v_kept jsonb := '[]'::jsonb; v_unmatched jsonb := '[]'::jsonb;
  c jsonb; m jsonb; v_val jsonb; v_text text;
  v_others_tasks int; v_task_count int; v_project_links int := 0; v_record_links int := 0;
  v_move_block text := null; v_count int;
begin
  select * into r from think_hub_record where id = p_record_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(r.table_id, p_user) then
    raise exception 'avora_think_hub_record_not_yours';
  end if;
  select * into src from think_hub_table where id = r.table_id;
  select * into dst from think_hub_table where id = p_target_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_target_table_id, p_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if dst.id = src.id then raise exception 'avora_record_move_same_table'; end if;
  if dst.kind = 'bookshelf' then raise exception 'avora_record_move_bookshelf'; end if;
  if src.deleted_at is not null then raise exception 'avora_think_hub_table_missing'; end if;
  if private.think_hub_table_archived(src.id) or private.think_hub_table_archived(dst.id) then
    raise exception 'avora_table_archived';
  end if;
  if dst.project_id is not null and not private.project_is_open(dst.project_id) then raise exception 'avora_project_closed'; end if;

  v_same := src.conversation_id is not distinct from dst.conversation_id and src.project_id is not distinct from dst.project_id;
  v_src_shared := src.conversation_id is not null or src.project_id is not null;
  v_dst_shared := dst.conversation_id is not null or dst.project_id is not null;

  -- status
  if exists (select 1 from jsonb_array_elements(private.table_statuses(dst.status_options)) o where o->>'key' = r.status) then
    v_status_to := r.status; v_status_changed := false;
  else
    v_status_to := private.table_statuses(dst.status_options)->0->>'key'; v_status_changed := true;
  end if;

  -- extra columns
  for c in select * from jsonb_array_elements(src.column_defs) loop
    v_val := r.extension_fields -> (c->>'key');
    continue when v_val is null or jsonb_typeof(v_val) = 'null' or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '');
    select d into m from jsonb_array_elements(dst.column_defs) d
      where lower(btrim(d->>'label')) = lower(btrim(c->>'label')) and d->>'type' = c->>'type'
        and (d->>'type' <> 'select' or d->'options' @> jsonb_build_array(v_val #>> '{}'))
      limit 1;
    if m is not null then
      v_ext := v_ext || jsonb_build_object(m->>'key', v_val);
      v_kept := v_kept || jsonb_build_array(c->>'label');
    else
      v_text := case when c->>'type' = 'number' then to_char((v_val #>> '{}')::numeric, 'FM999G999G999G990D########')
                     when c->>'type' = 'date' then to_char((v_val #>> '{}')::date, 'DD/MM/YYYY')
                     else v_val #>> '{}' end;
      v_unmatched := v_unmatched || jsonb_build_array(jsonb_build_object('label', c->>'label', 'value', rtrim(v_text, ',.')));
    end if;
    m := null;
  end loop;

  -- tasks
  select count(distinct t.id),
         count(distinct t.id) filter (where t.creator_id <> p_user or (t.assignee_id is not null and t.assignee_id <> p_user)
                                            or (t.type = '1-1-shared' and t.assignee_id is null))
    into v_task_count, v_others_tasks
  from tasks t
  where t.id in (select task_id from think_hub_record_tasks where record_id = r.id
                 union select task_id from project_tasks where record_id = r.id);
  if src.project_id is not null and src.project_id is distinct from dst.project_id then
    select count(*) into v_project_links from project_tasks where record_id = r.id;
  end if;
  if dst.project_id is not null then
    select count(*) into v_record_links from think_hub_record_tasks where record_id = r.id;
  end if;

  -- sub-table (only a live one counts)
  select * into v_sub from think_hub_table where parent_record_id = r.id and deleted_at is null;
  if found then v_move_block := 'has_subtable'; end if;

  if v_move_block is null and not (r.owner_user_id = p_user or src.owner_user_id = p_user) then
    v_move_block := 'not_owner';
  end if;
  if v_move_block is null and v_src_shared and not v_same then
    if r.owner_user_id <> p_user or exists (select 1 from unnest(r.editor_ids) e where e <> p_user) or v_others_tasks > 0 then
      v_move_block := 'shared';
    end if;
  end if;

  select count(*) into v_count from think_hub_record where table_id = dst.id and deleted_at is null;

  return jsonb_build_object(
    'can_move', v_move_block is null and v_count < 1000,
    'can_copy', v_count < 1000,
    'move_block', case when v_count >= 1000 then 'target_full' else v_move_block end,
    'sub_table_name', v_sub.name,
    'scope', case when v_same then 'same' when not v_src_shared and v_dst_shared then 'to_shared'
                  when v_src_shared then 'from_shared' else 'personal' end,
    'source_table_name', src.name,
    'target_table_name', dst.name,
    'target_scope_name', private.scope_name(dst.conversation_id, dst.project_id),
    'status_from', private.status_label_in(src.status_options, r.status),
    'status_to', private.status_label_in(dst.status_options, v_status_to),
    'status_to_key', v_status_to,
    'status_changed', v_status_changed,
    'kept_columns', v_kept,
    'unmatched', v_unmatched,
    'extension_fields', v_ext,
    'tasks', v_task_count,
    'project_links_dropped', v_project_links,
    'record_links_dropped', v_record_links
  );
end $function$;

CREATE OR REPLACE FUNCTION private.post_invite_message(p_conv uuid, p_uid uuid, p_message text, p_fresh boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_conv is null then return; end if;
  if not p_fresh and exists (select 1 from public.conversations c
                             where c.id = p_conv and c.verification_opened_by = p_uid
                               and private.verification_is_live (c.id)) then
    return;
  end if;
  perform private.assert_direct_talk (p_conv, p_uid, 'text');
  insert into public.messages (conversation_id, sender_id, content, mentioned_user_ids)
  values (p_conv, p_uid, p_message, '{}');
  if p_fresh then
    insert into public.conversation_verification_confirms (conversation_id, user_id)
    values (p_conv, p_uid) on conflict do nothing;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.post_system_line(p_conversation uuid, p_sender uuid, p_kind text, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid;
begin
  perform set_config('avora.project_system', 'on', true);
  insert into messages (conversation_id, sender_id, content, system_kind)
  values (p_conversation, p_sender, left(p_content, 4000), p_kind)
  returning id into v_id;
  perform set_config('avora.project_system', 'off', true);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.profiles_keep_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and (new.invite_code is distinct from old.invite_code or new.country is distinct from old.country)
     and coalesce(current_setting('avora.redeeming', true), '') <> 'on' then
    new.invite_code := old.invite_code;
    new.country := old.country;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.project_is_open(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND status = 'active' AND deleted_at IS NULL)
$function$;

CREATE OR REPLACE FUNCTION private.project_owned_by(p_project_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.created_by = p_user
      AND private.is_conversation_participant(p.conversation_id, p_user)
  )
$function$;

CREATE OR REPLACE FUNCTION private.proposal_conversation(p_target_type text, p_target_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case p_target_type
    when 'think_hub_table' then (
      select coalesce(t.conversation_id, (select pr.conversation_id from projects pr where pr.id = t.project_id))
      from think_hub_table t where t.id = p_target_id)
    when 'group' then p_target_id
    when 'project' then (select conversation_id from projects where id = p_target_id)
  end
$function$;

CREATE OR REPLACE FUNCTION private.proposal_stakeholders(p_target_type text, p_target_id uuid, p_proposer uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_conv uuid := private.proposal_conversation(p_target_type, p_target_id); v_type text; v_table think_hub_table%rowtype;
begin
  select type into v_type from conversations where id = v_conv;
  if p_target_type = 'think_hub_table' then
    select * into v_table from think_hub_table where id = p_target_id;
    if v_type = 'direct' then
      return query select cp.user_id from conversation_participants cp
        where cp.conversation_id = v_conv and cp.user_id <> p_proposer
          and not private.is_blocked_between(cp.user_id, p_proposer);
      return;
    end if;
    return query
      select distinct s.uid from (
        select v_table.owner_user_id as uid
        union all
        select unnest(r.owner_user_id || r.editor_ids) from private.think_hub_table_tree(p_target_id) tr
          join think_hub_record r on r.table_id = tr.id
        union all
        select t.assignee_id from private.think_hub_table_tree(p_target_id) tr
          join think_hub_record r on r.table_id = tr.id
          left join think_hub_record_tasks rt on rt.record_id = r.id
          left join project_tasks pt on pt.record_id = r.id
          join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
          where t.status not in ('done', 'skipped') and t.assignee_id is not null
      ) s
      where s.uid is not null and s.uid <> p_proposer
        and private.is_conversation_participant(v_conv, s.uid)
        and not private.is_blocked_between(s.uid, p_proposer);
    return;
  end if;
  return query select cp.user_id from conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id <> p_proposer
      and not private.is_blocked_between(cp.user_id, p_proposer);
end $function$;

CREATE OR REPLACE FUNCTION private.proposal_words(p_action text, p_target_type text, p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_target_type = 'group' then 'giải tán Nhóm "' || p_name || '"'
    else (case p_action when 'delete' then 'xoá ' when 'archive' then 'lưu trữ ' when 'move' then 'chuyển ' else 'mở lại ' end)
      || (case p_target_type when 'project' then 'Dự án "' else 'Bảng "' end) || p_name || '"'
  end
$function$;

CREATE OR REPLACE FUNCTION private.public_name(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((select nullif(btrim(display_name), '') from profiles where id = p_user), 'Thành viên AVORA')
$function$;

CREATE OR REPLACE FUNCTION private.purge_journal_trash()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', p, 'journal_trash'
  from (
    select a.storage_path as p from message_attachments a join messages m on m.id = a.message_id
    where m.trashed_at is not null and m.trashed_at < now() - interval '30 days' and a.origin_message_id is null
    union
    select regexp_replace(a.storage_path, '/[^/]+$', '/thumb-320.webp') from message_attachments a join messages m on m.id = a.message_id
    where m.trashed_at is not null and m.trashed_at < now() - interval '30 days' and a.origin_message_id is null and a.kind = 'image'
  ) x
  -- never a file another message still points at (forwarded copies share bytes)
  where not exists (
    select 1 from message_attachments b join messages mb on mb.id = b.message_id
    where b.storage_path = x.p and (mb.trashed_at is null or mb.trashed_at >= now() - interval '30 days')
  )
  on conflict do nothing;
  delete from message_attachments a using messages m
  where a.message_id = m.id and m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  delete from messages m where m.trashed_at is not null and m.trashed_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.purge_note_trash()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  delete from notes where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.push_display_name(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(nullif(btrim(display_name), ''), 'Người dùng AVORA') from profiles where id = p_user
$function$;

CREATE OR REPLACE FUNCTION private.push_mute_blocks(p_user uuid, p_surface text, p_conversation uuid, p_from_family boolean, p_mentions boolean, p_urgent boolean, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.mute_decide(
    exists (select 1 from mute_settings where user_id = p_user and scope = 'avora' and muted_until > p_now),
    (select pr.focus_mode from profiles pr where pr.id = p_user and pr.focus_mode is not null
       and (pr.focus_until is null or pr.focus_until > p_now)),
    exists (select 1 from mute_settings where user_id = p_user and scope = 'messages' and muted_until > p_now),
    exists (select 1 from mute_settings where user_id = p_user and scope = 'conversation'
              and conversation_id = p_conversation and muted_until > p_now),
    exists (select 1 from mute_settings where user_id = p_user and scope = p_surface and muted_until > p_now),
    p_surface, p_from_family, p_mentions, p_urgent)
$function$;

CREATE OR REPLACE FUNCTION private.push_surface(p_conversation uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when exists (select 1 from projects p where p.conversation_id = p_conversation and p.deleted_at is null) then 'project'
    when c.type = 'group' then 'group'
    when c.type = 'direct' then 'direct'
    else null end
  from conversations c where c.id = p_conversation
$function$;

CREATE OR REPLACE FUNCTION private.queue_task_file_object()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  values ('task-files', old.storage_path, 'task_file')
  on conflict do nothing;
  return old;
end $function$;

CREATE OR REPLACE FUNCTION private.rate_take(p_uid uuid, p_kind text, p_limit integer, p_window interval)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid::text || p_kind, 0));
  if (select count(*) from private.chat_rate_events e where e.user_id = p_uid and e.kind = p_kind and e.at > now() - p_window) >= p_limit then
    raise exception 'avora_rate_limited';
  end if;
  insert into private.chat_rate_events (user_id, kind) values (p_uid, p_kind);
end $function$;

CREATE OR REPLACE FUNCTION private.reaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conv uuid;
begin
  if tg_op = 'INSERT' then perform private.assert_feature('reactions'); end if;
  select m.conversation_id into v_conv from public.messages m where m.id = new.message_id;
  if not private.can_act_in(v_conv, auth.uid(), 'react') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then perform private.rate_take(auth.uid(), 'react', 60, interval '1 minute'); end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.realtime_topic_ok(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION private.receipt_scope(p_conversation uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when c.type = 'direct' then 'direct'
    when c.type = 'group' and (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) <= 100 then 'group'
    else null end
  from public.conversations c where c.id = p_conversation
$function$;

CREATE OR REPLACE FUNCTION private.record_is_done(p_status_options jsonb, p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_status = 'khong_lam' or coalesce(
    (select (o ->> 'done')::boolean from jsonb_array_elements(coalesce(p_status_options, '[]'::jsonb)) o where o ->> 'key' = p_status limit 1),
    p_status = 'xong')
$function$;

CREATE OR REPLACE FUNCTION private.record_path(p_record_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select concat_ws(' › ', pr.title, case when pr.title is null then 'Bảng ' || b.name else b.name end)
  from public.think_hub_record r
  join public.think_hub_table b on b.id = r.table_id
  left join public.projects pr on pr.id = b.project_id
  where r.id = p_record_id
$function$;

CREATE OR REPLACE FUNCTION private.record_task_celebration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- Only the crossing into done, once.
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN
    RETURN NEW;
  END IF;

  -- Shared work only, and only work both people actually agreed to: an unconfirmed task that
  -- somehow reaches done was never a shared promise, so closing it is not news for a room.
  IF NEW.type NOT IN ('1-1-shared', 'group-shared')
     OR NEW.conversation_id IS NULL
     OR NEW.confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.task_celebrations (task_id, conversation_id, burst_count)
  VALUES (NEW.id, NEW.conversation_id, CASE WHEN NEW.is_milestone THEN 3 ELSE 1 END)
  ON CONFLICT (task_id) DO NOTHING;

  -- Whoever pressed the button is present by definition and sees it play immediately, so
  -- their view is recorded here rather than left for their next visit.
  IF v_actor IS NOT NULL THEN
    INSERT INTO public.task_celebration_views (task_id, user_id)
    VALUES (NEW.id, v_actor)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_to_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.opportunity_id is null or coalesce(current_setting('avora.opp_sync', true), '') = 'on' then return new; end if;
  if new.title is distinct from old.title or new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
    if new.status not in ('lead', 'tiem_nang', 'dang_cham_soc', 'doi_tac', 'khong_thanh') then raise exception 'avora_opportunity_stage'; end if;
    if old.deleted_at is not null and new.deleted_at is null
       and (select contact_id from public.crm_opportunity where id = new.opportunity_id) is null then
      raise exception 'avora_opportunity_contact_gone';
    end if;
    perform set_config('avora.opp_sync', 'on', true);
    update public.crm_opportunity set title = new.title, stage = new.status,
      removed_at = case when new.deleted_at is not null then coalesce(removed_at, now()) else null end
    where id = new.opportunity_id;
    perform set_config('avora.opp_sync', 'off', true);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.redeem_invite_for(p_uid uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.invite_code%rowtype;
  v_current text;
begin
  select invite_code into v_current from public.profiles where id = p_uid;
  if v_current is not null then
    if v_current = upper(btrim(p_code)) then return jsonb_build_object('ok', true); end if;
    raise exception 'avora_invite_already';
  end if;
  select * into v_row from public.invite_code where code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_row.code is null or not v_row.active then raise exception 'avora_invite_not_found'; end if;
  if v_row.used >= v_row.max_uses then raise exception 'avora_invite_used_up'; end if;
  update public.invite_code set used = used + 1 where code = v_row.code;
  perform set_config('avora.redeeming', 'on', true);
  update public.profiles
     set invite_code = v_row.code,
         country = v_row.country,
         prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('locale', v_row.locale)
   where id = p_uid;
  perform set_config('avora.redeeming', '', true);
  return jsonb_build_object('ok', true, 'country', v_row.country, 'locale', v_row.locale);
end $function$;

CREATE OR REPLACE FUNCTION private.redeem_invite_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
begin
  if v_code is not null then
    begin
      perform private.redeem_invite_for(new.id, v_code);
    exception when others then null;
    end;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.ref_in_conversation(p_conv uuid, p_user uuid, p_type text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_type text;
begin
  select c.type into v_type from public.conversations c where c.id = p_conv;
  if v_type is null then return false; end if;
  if p_type = 'file' then
    return exists (select 1 from public.message_attachments a join public.messages m on m.id = a.message_id
                   where a.id = p_id and a.conversation_id = p_conv and m.deleted_at is null and m.trashed_at is null);
  elsif p_type in ('record', 'board') then
    return exists (
      select 1 from public.think_hub_table t
      left join public.think_hub_record r on p_type = 'record' and r.id = p_id and r.table_id = t.id and r.deleted_at is null
      left join public.projects pr on pr.id = t.project_id
      where t.deleted_at is null
        and (case when p_type = 'board' then t.id = p_id else r.id is not null end)
        and (case
               when v_type = 'personal' then t.owner_user_id = p_user and t.conversation_id is null and t.project_id is null
               else t.conversation_id = p_conv or pr.conversation_id = p_conv
             end));
  elsif p_type = 'note' then
    return v_type = 'personal' and exists (select 1 from public.notes n where n.id = p_id and n.owner_user_id = p_user and n.deleted_at is null);
  elsif p_type = 'contact' then
    return v_type = 'personal' and exists (select 1 from public.contact ct where ct.id = p_id and ct.owner_user_id = p_user);
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION private.refuse_links_while_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.content is null or not private.text_has_link (new.content) then return new; end if;
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then return new; end if;
  if exists (select 1 from public.conversations c
             where c.id = new.conversation_id and c.type = 'direct' and c.verification_status = 'pending')
     and private.verification_is_live (new.conversation_id) then
    raise exception 'avora_verification_no_links';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.resolve_lost(p_device uuid, p_choice text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_dev public.account_devices%rowtype; v_reporter public.account_devices%rowtype;
begin
  select * into v_dev from public.account_devices where id = p_device;
  if v_dev.id is null or v_dev.lost_status is distinct from 'pending' then raise exception 'avora_device_lost_settled'; end if;
  select * into v_reporter from public.account_devices where id = v_dev.lost_reported_by_device;
  if p_choice = 'confirm' then
    update public.account_devices set lost_status = 'confirmed', revoked_at = now(), rank = 3 where id = v_dev.id;
    perform private.on_device_removed(v_dev.id);
  elsif p_choice = 'reject' then
    -- "Sai — tôi không báo mất": the reporting device may be the one in a stranger's hands.
    update public.account_devices set lost_status = 'rejected', lost_deadline = null where id = v_dev.id;
    if v_reporter.id is not null then perform private.block_sessions(v_dev.user_id, array[v_reporter.session_id], 'lost_rejected'); end if;
  elsif p_choice = 'found' then
    update public.account_devices set lost_status = 'found', lost_deadline = null where id = v_dev.id;
  else
    raise exception 'avora_device_choice';
  end if;
  update private.device_action_tokens set used_at = now() where kind = 'lost_confirm' and device_id = v_dev.device_id and user_id = v_dev.user_id and used_at is null;
  perform private.device_notify(v_dev.user_id, jsonb_build_object('action', 'lost_result', 'label', v_dev.label, 'result', p_choice, 'reporter', v_reporter.label), null);
end $function$;

CREATE OR REPLACE FUNCTION private.restore_table_tasks(p_table_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update tasks t set deleted_by_creator = false, updated_at = now()
  from think_hub_delete_cascade c where c.table_id = p_table_id and c.task_id = t.id and c.side = 'creator';
  update tasks t set deleted_by_peer = false, updated_at = now()
  from think_hub_delete_cascade c where c.table_id = p_table_id and c.task_id = t.id and c.side = 'peer';
  delete from think_hub_delete_cascade where table_id = p_table_id;
end $function$;

CREATE OR REPLACE FUNCTION private.retire_user_pin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.retired_pins (pin) values (OLD.pin) on conflict (pin) do nothing;
  return OLD;
end $function$;

CREATE OR REPLACE FUNCTION private.schedule_guard(p_conversation_id uuid, p_user uuid, p_send_at timestamp with time zone, p_skip_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
begin
  if p_user is null then raise exception 'avora_not_signed_in'; end if;
  select c.type into v_type from public.conversations c where c.id = p_conversation_id and c.deleted_at is null;
  if v_type is null or not private.is_conversation_participant(p_conversation_id, p_user) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_type = 'personal' then raise exception 'avora_schedule_not_here'; end if;
  if v_type = 'direct' and private.verification_is_live(p_conversation_id) then
    raise exception 'avora_schedule_not_here';
  end if;
  -- Blocked / no longer bạn → the same refusals as any rich write into a 1-1.
  perform private.assert_direct_talk(p_conversation_id, p_user, 'rich');
  if p_send_at < now() + interval '5 minutes' then raise exception 'avora_schedule_too_soon'; end if;
  if p_send_at > now() + interval '30 days' then raise exception 'avora_schedule_too_far'; end if;
  if (select count(*) from public.scheduled_messages s
      where s.sender_id = p_user and s.conversation_id = p_conversation_id and s.status = 'pending'
        and s.id is distinct from p_skip_id) >= 20 then
    raise exception 'avora_schedule_limit';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.scope_name(p_conversation uuid, p_project uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_project is not null then coalesce((select title from projects where id = p_project), 'Dự án')
    when p_conversation is null then 'Của tôi'
    else coalesce((select name from conversation_groups where conversation_id = p_conversation),
                  (select 'Cuộc 1-1' from conversations where id = p_conversation and type = 'direct'), 'Cuộc trò chuyện')
  end
$function$;

CREATE OR REPLACE FUNCTION private.send_to_users(p_users uuid[], p_event text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid;
begin
  for v_user in select distinct u from unnest(p_users) u where u is not null loop
    perform realtime.send(p_payload, p_event, 'user-' || v_user::text, true);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.session_allowed()
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
  if v_dev.id is null then return false; end if;
  if v_lock.locked_rank = 1 then return v_dev.rank = 1; end if;
  return v_dev.rank in (1, 2);
end $function$;

CREATE OR REPLACE FUNCTION private.session_guard_exempt()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['device_challenge', 'device_status', 'lost_device_dispute', 'request_lock_escape', 'forget_this_device',
               'device_key_for', 'device_bind', 'device_action_info', 'device_action']
$function$;

CREATE OR REPLACE FUNCTION private.session_guard_gaps()
 RETURNS TABLE(kind text, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'table', c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'avora_session_allowed' and p.permissive = 'RESTRICTIVE')
  union all
  select 'table', c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select 'function', p.proname::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and p.prosrc not like '%assert_session_allowed%' and not (p.proname = any (private.session_guard_exempt()))
$function$;

CREATE OR REPLACE FUNCTION private.set_message_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_seconds integer;
begin
  new.expired_at := null;
  new.expires_at := null;
  if new.system_kind is not null then return new; end if;
  select c.disappear_after_seconds into v_seconds
  from public.conversations c
  where c.id = new.conversation_id and c.type in ('direct', 'group');
  if v_seconds is not null then
    new.expires_at := coalesce(new.created_at, now()) + make_interval(secs => v_seconds);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.settle_proposal(p_id uuid, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v shared_proposals%rowtype; v_total int; v_agree int;
begin
  select * into v from shared_proposals where id = p_id for update;
  if v.status <> 'open' then return v.status; end if;
  -- Someone who left the conversation is no longer asked.
  delete from shared_proposal_votes pv where pv.proposal_id = p_id
    and not private.is_conversation_participant(v.conversation_id, pv.user_id);
  select count(*), count(*) filter (where vote = 'agree') into v_total, v_agree
  from shared_proposal_votes where proposal_id = p_id;
  if v_agree < v_total then return 'open'; end if;

  perform private.execute_proposal(p_id, coalesce(p_actor, v.proposed_by));
  update shared_proposals set status = 'approved', resolved_at = now() where id = p_id;
  perform private.post_system_line(v.conversation_id, coalesce(p_actor, v.proposed_by), 'proposal_approved',
    case when v_total = 0 then
      format('%s đã %s (không ai khác từng dùng).', private.public_name(v.proposed_by),
        replace(private.proposal_words(v.action, v.target_type, v.target_name), 'giải tán', 'giải tán'))
    else format('Đã %s theo đề nghị của %s · %s/%s đồng ý.',
      private.proposal_words(v.action, v.target_type, v.target_name), private.public_name(v.proposed_by), v_agree, v_total)
    end);
  return 'approved';
end $function$;

CREATE OR REPLACE FUNCTION private.shares_read(p_conversation uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select mp.share_read_status from public.conversation_member_prefs mp where mp.conversation_id = p_conversation and mp.user_id = p_uid),
    (select p.share_read_status from public.profiles p where p.id = p_uid),
    true)
$function$;

CREATE OR REPLACE FUNCTION private.skip_push_on_read()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update push_outbox set status = 'skipped', sent_at = now()
  where user_id = new.user_id and conversation_id = new.conversation_id and status = 'pending';
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.soft_delete_group_origin_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.messages
     set deleted_at = now()
   where origin_group_id = old.id
     and deleted_at is null;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.stamp_checklist_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at := now();
  elsif not new.completed then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.stamp_think_hub_contact_labels()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_defs   jsonb;
  v_def    jsonb;
  v_key    text;
  v_new    text;
  v_old    text;
  v_labels jsonb;
  v_name   text;
  v_uid    uuid := auth.uid();
  v_by     text;
begin
  -- Whatever the client sent is ignored: start from what was stored.
  v_labels := case when tg_op = 'UPDATE' then coalesce(old.contact_labels, '{}'::jsonb) else '{}'::jsonb end;
  select column_defs into v_defs from think_hub_table where id = new.table_id;

  for v_def in select * from jsonb_array_elements(coalesce(v_defs, '[]'::jsonb)) loop
    continue when v_def->>'type' is distinct from 'contact';
    v_key := v_def->>'key';
    v_new := nullif(btrim(coalesce(new.extension_fields->>v_key, '')), '');
    v_old := case when tg_op = 'UPDATE' then nullif(btrim(coalesce(old.extension_fields->>v_key, '')), '') else null end;

    if v_new is null then
      v_labels := v_labels - v_key;
    elsif v_new is distinct from v_old or not (v_labels ? v_key) then
      select c.name into v_name from contact c where c.id = v_new::uuid and c.owner_user_id = v_uid;
      if v_name is not null then
        select coalesce(nullif(btrim(p.display_name), ''), 'Một thành viên') into v_by from profiles p where p.id = v_uid;
        v_labels := v_labels || jsonb_build_object(
          v_key, jsonb_build_object('name', left(v_name, 80), 'by', v_uid, 'by_name', coalesce(v_by, 'Một thành viên')));
      elsif v_new is distinct from v_old then
        -- Not in the writer's book (a moved / copied row): no name travels with it.
        v_labels := v_labels - v_key;
      end if;
    end if;
  end loop;

  new.contact_labels := v_labels;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.status_label_in(p_status_options jsonb, p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select o->>'label' from jsonb_array_elements(private.table_statuses(p_status_options)) o where o->>'key' = p_status limit 1),
    (select o->>'label' from jsonb_array_elements(private.table_statuses(null)) o where o->>'key' = p_status limit 1),
    p_status)
$function$;

CREATE OR REPLACE FUNCTION private.sub_table_scope_matches(p_table_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select t.conversation_id is not distinct from p.conversation_id and t.project_id is not distinct from p.project_id
    from think_hub_table t join think_hub_record r on r.id = t.parent_record_id join think_hub_table p on p.id = r.table_id
    where t.id = p_table_id), true)
$function$;

CREATE OR REPLACE FUNCTION private.suggestion_dead_reason(s task_suggestions)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_type text; v_table uuid;
begin
  if s.status <> 'pending' then return null; end if;
  if not private.conversation_is_live(s.conversation_id) then return 'conversation_deleted'; end if;
  if not private.is_conversation_participant(s.conversation_id, s.proposer_id) then return 'proposer_left'; end if;
  if not private.is_conversation_participant(s.conversation_id, s.assignee_id) then return 'assignee_left'; end if;
  if private.is_blocked_between(s.proposer_id, s.assignee_id) then return 'blocked'; end if;
  select type into v_type from conversations where id = s.conversation_id;
  if v_type = 'direct' and not private.are_connected(s.proposer_id, s.assignee_id) then return 'disconnected'; end if;
  if s.proposed_record_id is not null then
    select table_id into v_table from think_hub_record where id = s.proposed_record_id and deleted_at is null;
    if v_table is null or exists (select 1 from think_hub_table where id = v_table and deleted_at is not null)
       or private.think_hub_table_archived(v_table) then
      return 'record_gone';
    end if;
  end if;
  if s.proposed_project_id is not null and not private.project_is_open(s.proposed_project_id) then return 'project_closed'; end if;
  if s.created_at < now() - interval '30 days' then return 'stale'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.sweep_dead_ends()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.close_dead_suggestions();
  begin perform private.purge_journal_trash(); exception when others then raise warning 'avora_journal_purge_failed'; end;
  begin perform private.purge_note_trash(); exception when others then raise warning 'avora_note_purge_failed'; end;
end $function$;

CREATE OR REPLACE FUNCTION private.sweep_expired_messages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_paths text[]; v_count integer := 0;
begin
  update public.disappear_proposals set status = 'expired', resolved_at = now()
  where status = 'open' and created_at < now() - interval '3 days';

  select array_agg(s.id) into v_ids from (
    select m.id from public.messages m
    where m.expires_at <= now() and m.expired_at is null
    order by m.expires_at
    limit 2000
    for update skip locked
  ) s;
  if v_ids is null then return 0; end if;

  select array_agg(distinct a.storage_path) into v_paths from public.message_attachments a where a.message_id = any (v_ids);
  delete from public.message_attachments where message_id = any (v_ids);
  -- A forwarded copy elsewhere keeps its file: only paths nothing points to any more are removed.
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', p, 'expired' from unnest(coalesce(v_paths, '{}')) p
  where not exists (select 1 from public.message_attachments a where a.storage_path = p)
  on conflict do nothing;
  delete from public.message_reactions where message_id = any (v_ids);
  delete from public.message_pins where message_id = any (v_ids);
  delete from public.message_deliveries where message_id = any (v_ids);
  delete from public.push_outbox where message_id = any (v_ids) and sent_at is null;

  perform set_config('avora.expiring', '1', true);
  update public.messages set
    content = '', forward_bundle = null, note_card = null, sticker_id = null, contact_card_user_id = null,
    refs = null, effect = null, mentioned_user_ids = '{}', attachment_count = 0, is_urgent = false,
    deleted_at = coalesce(deleted_at, now()), expired_at = now()
  where id = any (v_ids);
  get diagnostics v_count = row_count;
  perform set_config('avora.expiring', '', true);

  if coalesce(array_length(v_paths, 1), 0) > 0 then perform private.call_storage_sweep(); end if;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION private.sweep_shared_proposals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v shared_proposals%rowtype; v_n integer := 0;
begin
  for v in select * from shared_proposals where status = 'open' order by created_at loop
    begin
      if v.created_at < now() - interval '14 days' then
        update shared_proposals set status = 'expired', resolved_at = now() where id = v.id;
        perform private.post_system_line(v.conversation_id, v.proposed_by, 'proposal_expired',
          format('Hết hạn — chưa đủ đồng ý để %s.', private.proposal_words(v.action, v.target_type, v.target_name)));
      else
        perform private.settle_proposal(v.id, v.proposed_by);
        if v.reminded_at is null and v.created_at < now() - interval '3 days' then
          update shared_proposals set reminded_at = now() where id = v.id and status = 'open';
        end if;
      end if;
      v_n := v_n + 1;
    exception when others then
      raise warning 'avora_sweep_proposal_failed %', v.id;
    end;
  end loop;
  begin
    v_n := v_n + private.close_blocked_recall_requests() + private.expire_recall_requests();
  exception when others then
    raise warning 'avora_sweep_recall_failed';
  end;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION private.sync_meeting_note_task(p_note group_decisions, p_agenda text[], p_item jsonb, p_create boolean, p_strict boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_task uuid := case when coalesce(p_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$'
    then (p_item->>'task_id')::uuid else null end;
  v_desc text := btrim(coalesce(p_item->>'description', ''));
  v_assignee uuid;
  v_deadline date;
  v_idx int;
  v_line text;
  v_quote text;
  v_group text;
  v_snapshot jsonb;
  v_personal boolean;
begin
  if v_task is null and not p_create then
    return p_item;
  end if;

  begin
    v_assignee := nullif(p_item->>'assignee_id', '')::uuid;
    v_deadline := nullif(p_item->>'deadline', '')::date;
  exception when others then
    if p_strict then raise exception 'avora_note_action_invalid'; end if;
    return p_item;
  end;

  if v_desc = '' then
    if p_strict then raise exception 'avora_note_action_needs_description'; end if;
    return p_item;
  end if;
  if v_assignee is null then
    if p_strict then raise exception 'avora_note_action_needs_assignee'; end if;
    return p_item;
  end if;
  if v_deadline is null then
    if p_strict then raise exception 'avora_note_action_needs_deadline'; end if;
    return p_item;
  end if;
  if not private.is_conversation_participant (p_note.conversation_id, v_assignee) then
    if p_strict then raise exception 'avora_note_person_not_participant'; end if;
    return p_item;
  end if;

  v_idx := case when jsonb_typeof(p_item->'agenda_index') = 'number' then (p_item->>'agenda_index')::int end;
  v_line := case when v_idx is not null then p_agenda[v_idx + 1] end;
  if v_line is null then v_idx := null; end if;
  v_quote := 'Biên bản họp: ' || p_note.title
    || coalesce(' — Mục ' || (v_idx + 1)::text || ': ' || v_line, '');

  select name into v_group from public.conversation_groups where conversation_id = p_note.conversation_id;

  v_snapshot := jsonb_build_object(
    'conversation_type', 'group',
    'conversation_id', p_note.conversation_id::text,
    'conversation_name', coalesce(v_group, ''),
    'original_message_id', null,
    'original_message_text', left(v_quote, 2000),
    'original_message_sender_id', p_note.created_by::text,
    'original_message_sender_name',
      coalesce((select display_name from public.profiles where id = p_note.created_by), ''),
    'original_message_created_at', to_char(p_note.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'user_response', v_desc,
    'snapshot_created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'source_meeting_note_id', p_note.id::text,
    'source_agenda_index', to_jsonb(v_idx),
    'source_agenda_item', to_jsonb(v_line));

  v_personal := v_assignee = p_note.created_by;

  if v_task is null then
    v_task := gen_random_uuid ();
    if v_personal then
      insert into public.tasks (id, type, creator_id, title, description, status, deadline_date,
        context_snapshot, pending_decision_id)
      values (v_task, 'personal', p_note.created_by, left(v_desc, 200), v_desc, 'confirmed', v_deadline,
        v_snapshot, p_note.id);
    else
      insert into public.tasks (id, type, creator_id, assignee_id, conversation_id, title, description, status,
        deadline_date, context_snapshot, pending_decision_id)
      values (v_task, 'group-shared', p_note.created_by, v_assignee, p_note.conversation_id, left(v_desc, 200),
        v_desc, 'pending_confirmation', v_deadline, v_snapshot, p_note.id);
      insert into public.task_confirmations (task_id, user_id) values (v_task, p_note.created_by)
        on conflict (task_id, user_id) do nothing;
    end if;
  else
    if not exists (select 1 from public.tasks where id = v_task and pending_decision_id = p_note.id) then
      return p_item;
    end if;
    update public.tasks set
      type = case when v_personal then 'personal' else 'group-shared' end,
      conversation_id = case when v_personal then null else p_note.conversation_id end,
      assignee_id = case when v_personal then null else v_assignee end,
      title = left(v_desc, 200),
      description = v_desc,
      deadline_date = v_deadline,
      status = case when v_personal then 'confirmed' else 'pending_confirmation' end,
      confirmed_at = null,
      confirmed_by = null,
      context_snapshot = v_snapshot
    where id = v_task;
    if v_personal then
      delete from public.task_confirmations where task_id = v_task;
    else
      insert into public.task_confirmations (task_id, user_id) values (v_task, p_note.created_by)
        on conflict (task_id, user_id) do nothing;
    end if;
  end if;

  return p_item || jsonb_build_object('task_id', v_task::text, 'create_task', true);
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_message_attachment_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_message_id uuid := coalesce(new.message_id, old.message_id);
begin
  update public.messages m
  set attachment_count = (
    select count(*) from public.message_attachments a where a.message_id = m.id
  )
  where m.id = v_message_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.table_statuses(p_status_options jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_status_options,
    '[{"key":"moi","label":"Mới"},{"key":"dang_lam","label":"Đang làm"},{"key":"cho_phan_hoi","label":"Chờ phản hồi"},{"key":"xong","label":"Xong","done":true}]'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION private.task_closed_reason(p_task tasks, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_conv conversations%rowtype; v_project projects%rowtype;
begin
  if p_task.type not in ('1-1-shared', 'group-shared') then return null; end if;
  if p_task.status = 'done' then return 'done'; end if;
  if p_task.status = 'skipped' then return 'skipped'; end if;
  if p_task.deleted_by_creator then return 'creator_deleted'; end if;
  select * into v_conv from conversations where id = p_task.conversation_id;
  if not found or not private.conversation_is_live(p_task.conversation_id) then return 'conversation_deleted'; end if;
  if not private.is_conversation_participant(p_task.conversation_id, p_task.creator_id) then return 'creator_left'; end if;
  if private.is_blocked_between(p_task.creator_id, p_user) then return 'blocked'; end if;
  if v_conv.type = 'direct' and not private.are_connected(p_task.creator_id, p_user) then return 'disconnected'; end if;
  select pr.* into v_project from project_tasks pt join projects pr on pr.id = pt.project_id where pt.task_id = p_task.id limit 1;
  if found and (v_project.deleted_at is not null or v_project.status <> 'active') then return 'project_closed'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.task_file_deletable(p_task uuid, p_uploader uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user is not null and (
    p_uploader = p_user
    or exists (select 1 from public.tasks t where t.id = p_task and t.creator_id = p_user)
  ) and private.can_view_task(p_task, p_user)
$function$;

CREATE OR REPLACE FUNCTION private.task_file_task(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$function$;

CREATE OR REPLACE FUNCTION private.task_file_uploader(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select uploaded_by from public.task_files where storage_path = p_name
$function$;

CREATE OR REPLACE FUNCTION private.task_owned_by_assignee(p_task uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_task is not null and exists (
    select 1 from public.task_suggestions s where s.accepted_task_id = p_task
  );
$function$;

CREATE OR REPLACE FUNCTION private.task_place_label(p_task_id uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when t.type = 'personal' then 'Nhật ký'
    when c.type = 'direct' then '1-1 với ' || coalesce((
      select nullif(btrim(p.display_name), '') from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = c.id and cp.user_id <> p_user limit 1), 'người kia')
    when exists (select 1 from public.projects pr where pr.conversation_id = c.id and pr.deleted_at is null)
      then 'Dự án ' || (select pr.title from public.projects pr where pr.conversation_id = c.id and pr.deleted_at is null limit 1)
    else 'Nhóm ' || coalesce((select nullif(btrim(g.name), '') from public.conversation_groups g where g.conversation_id = c.id), 'này')
  end
  from public.tasks t
  left join public.conversations c on c.id = t.conversation_id
  where t.id = p_task_id
$function$;

CREATE OR REPLACE FUNCTION private.task_record_same_place(p_task_id uuid, p_record_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.think_hub_record r
    join public.think_hub_table b on b.id = r.table_id
    join public.tasks t on t.id = p_task_id
    left join public.projects pr on pr.id = b.project_id
    where r.id = p_record_id
      and case
        when b.project_id is not null then
          t.type <> 'personal'
          and (t.conversation_id = pr.conversation_id
               or t.conversation_id = (select c.parent_group_id from public.conversations c where c.id = pr.conversation_id))
        when b.conversation_id is null then t.type = 'personal' and t.creator_id = b.owner_user_id
        else t.type <> 'personal' and t.conversation_id = b.conversation_id
      end
  )
$function$;

CREATE OR REPLACE FUNCTION private.test_ephemeral_user(p_label text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
          'tester' || lower(p_label) || '+' || replace(v_id::text, '-', '') || '@avora-test.invalid',
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', 'Tester ' || upper(p_label)),
          now(), now(), now());
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION private.text_has_link(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select coalesce (p_text, '') ~* (
    '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(com|net|org|vn|io|co|info|biz|me|app|dev|xyz|top|site|online|link|ly|gl|shop|store|us|uk|tv|cc|ai|gg|to|in|ru|cn|edu|gov|asia|club|live|page|tk|ml)\M)'
  );
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_cell_file_deletable(p_table_id uuid, p_uploader uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The person who attached it, or the board's owner. Nobody else.
  select p_user is not null and private.think_hub_table_visible(p_table_id, p_user)
    and (p_uploader = p_user or exists (select 1 from think_hub_table t where t.id = p_table_id and t.owner_user_id = p_user))
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_cell_file_insertable(p_table_id uuid, p_record_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_user is not null
    and private.think_hub_table_visible(p_table_id, p_user)
    and exists (select 1 from think_hub_table t where t.id = p_table_id and t.deleted_at is null and t.archived_at is null
      and (t.share_mode = 'edit' or t.owner_user_id = p_user))
    and exists (select 1 from think_hub_record r where r.id = p_record_id and r.table_id = p_table_id and r.deleted_at is null)
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_is_shared(p_table_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((select t.conversation_id is not null or t.project_id is not null from think_hub_table t where t.id = p_table_id), false)
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_record_editable(p_record_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user is not null and exists (
    select 1
    from public.think_hub_record r
    join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.deleted_at is null and r.archived_at is null
      and t.deleted_at is null and t.archived_at is null
      and private.think_hub_table_visible(t.id, p_user)
      and (t.share_mode = 'edit' or t.owner_user_id = p_user)
      and (t.project_id is null or private.project_is_open(t.project_id))
  )
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_scope_visible(p_owner uuid, p_conversation_id uuid, p_project_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_user IS NULL THEN false
    WHEN p_project_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM projects pr
      JOIN conversation_participants cp ON cp.conversation_id = pr.conversation_id
      WHERE pr.id = p_project_id AND pr.deleted_at IS NULL AND cp.user_id = p_user)
    WHEN p_conversation_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id AND cp.user_id = p_user)
    ELSE p_owner = p_user
  END
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_table_archived(p_table_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recursive chain as (
    select t.id, t.parent_record_id, t.archived_at, 1 as lvl from think_hub_table t where t.id = p_table_id
    union all
    select p.id, p.parent_record_id, p.archived_at, chain.lvl + 1
    from chain
    join think_hub_record r on r.id = chain.parent_record_id
    join think_hub_table p on p.id = r.table_id
    where chain.lvl < 5
  )
  select exists (select 1 from chain where archived_at is not null)
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_table_lifecycle_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.thinking_type is null and new.source_template_key is not null then
      select tpl.thinking_type into new.thinking_type from public.think_hub_template tpl where tpl.key = new.source_template_key;
      if new.thinking_type is null then
        select ut.thinking_type into new.thinking_type from public.think_hub_user_template ut where ut.id::text = new.source_template_key;
      end if;
    end if;
    new.lifecycle := case when new.archived_at is not null then 'archived' else 'waiting' end;
    return new;
  end if;
  -- Bảng Avora mặc định: no lifecycle, no thinking type (ADR-045 · AVORA-77 · A4).
  if old.sync_source is not null and coalesce(current_setting('avora.sync_board', true), '') <> 'on'
     and (new.lifecycle is distinct from old.lifecycle or new.thinking_type is distinct from old.thinking_type) then
    raise exception 'avora_sync_board_locked';
  end if;
  if new.archived_at is distinct from old.archived_at then
    new.lifecycle := case when new.archived_at is not null then 'archived' else 'waiting' end;
    return new;
  end if;
  if new.lifecycle is distinct from old.lifecycle then
    if new.lifecycle = 'archived' then raise exception 'avora_lifecycle_archive_via_archive'; end if;
    if old.archived_at is not null then raise exception 'avora_table_archived'; end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.think_hub_table_tree(p_table_id uuid)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recursive tree as (
    select t.id, 1 as lvl from think_hub_table t where t.id = p_table_id
    union all
    select c.id, tree.lvl + 1
    from tree
    join think_hub_record r on r.table_id = tree.id
    join think_hub_table c on c.parent_record_id = r.id
    where tree.lvl < 4
  )
  select tree.id from tree
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_table_visible(p_table_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT private.think_hub_scope_visible(t.owner_user_id, t.conversation_id, t.project_id, p_user)
    FROM think_hub_table t WHERE t.id = p_table_id
  ), false)
$function$;

CREATE OR REPLACE FUNCTION private.think_hub_trash_purge()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tables uuid[]; v_records uuid[]; v_paths text[]; v_n integer := 0;
begin
  select coalesce(array_agg(tree.id), '{}') into v_tables
  from public.think_hub_table t, lateral private.think_hub_table_tree(t.id) tree
  where t.deleted_at is not null and t.deleted_at < now() - interval '30 days'
    and t.conversation_id is null and t.project_id is null and t.parent_record_id is null and t.kind is distinct from 'bookshelf';
  select coalesce(array_agg(r.id), '{}') into v_records
  from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
  where r.deleted_at is not null and r.deleted_at < now() - interval '30 days'
    and t.conversation_id is null and t.project_id is null and t.deleted_at is null
    and not (r.table_id = any (v_tables));
  -- Bảng con dưới các mục bị xoá hẳn cũng đi theo.
  select v_tables || coalesce(array_agg(tree.id), '{}') into v_tables
  from public.think_hub_table c, lateral private.think_hub_table_tree(c.id) tree
  where c.parent_record_id = any (v_records);
  select coalesce(array_agg(f.storage_path), '{}') into v_paths from public.think_hub_cell_files f
  where f.table_id = any (v_tables) or f.record_id = any (v_records);
  if cardinality(v_paths) > 0 then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects o where o.bucket_id = 'board-files' and o.name = any (v_paths);
  end if;
  delete from public.think_hub_delete_cascade where table_id = any (v_tables);
  delete from public.think_hub_table where id = any (v_tables);
  get diagnostics v_n = row_count;
  delete from public.think_hub_record where id = any (v_records);
  return v_n + cardinality(v_records);
end $function$;

CREATE OR REPLACE FUNCTION private.touch_contact_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.touch_opportunity_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.crm_opportunity set last_contact_at = new.created_at
  where conversation_id = new.conversation_id and owner_user_id = new.sender_id and removed_at is null
    and (last_contact_at is null or last_contact_at < new.created_at);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.touch_view_row_meta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.track_record_editor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.editor_ids := array[new.owner_user_id];
  elsif v_uid is not null and not (v_uid = any(new.editor_ids)) then
    new.editor_ids := new.editor_ids || v_uid;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.transaction_confirm_word(p_description text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'XOÁ') $function$;

CREATE OR REPLACE FUNCTION private.transaction_signed_amount(p_type transaction_type, p_amount numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_type
           WHEN 'income'  THEN p_amount
           WHEN 'vay'     THEN p_amount
           ELSE -p_amount
         END;
$function$;

CREATE OR REPLACE FUNCTION private.urgent_state(p_user uuid, p_conversation uuid)
 RETURNS TABLE(used_today boolean, locked_until timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with tz as (select coalesce((select timezone from profiles where id = p_user), 'Asia/Ho_Chi_Minh') as z)
  select
    exists (
      select 1 from private.urgent_usage u, tz
      where u.user_id = p_user and u.conversation_id = p_conversation
        and u.used_at >= (date_trunc('day', now() at time zone tz.z) at time zone tz.z)
    ),
    (select max(l.locked_until) from private.urgent_locks l where l.user_id = p_user and l.locked_until > now())
$function$;

CREATE OR REPLACE FUNCTION private.user_pin_problem(p_pin text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_pin is null or p_pin !~ '^A-.{8}$' then 'avora_pin_format'
    when substr(p_pin, 3) ~ '[01OI]' then 'avora_pin_confusing'
    when substr(p_pin, 3) !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$' then 'avora_pin_format'
    when substr(p_pin, 3, 1) !~ '[A-Z]' or substr(p_pin, 10, 1) !~ '[A-Z]' then 'avora_pin_edges'
    when char_length(regexp_replace(substr(p_pin, 3), '[^A-Z]', '', 'g')) < 4 then 'avora_pin_letters'
    when substr(p_pin, 3) ~ '(FUCK|FUK|CUNT|SEX|XXX|CAC|DCM|DKM|DMM|DJT|DM2|CUT|DEM|BUCU|META|VISA|GRAB|SAMSUNG|SHOPEE|VNPAY|MBBANK|VCB|TPBANK|ACB|MASTERCARD|AMEX|NVIDIA|TESLA|UBER|ADMN|ROOT)'
      then 'avora_pin_blocked'
    else null
  end
$function$;

CREATE OR REPLACE FUNCTION private.validate_column_defs(p_defs jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def  jsonb;
  v_type text;
  v_keys text[] := '{}';
  v_ids  text[] := '{}';
  v_key  text;
  v_id   text;
BEGIN
  IF p_defs IS NULL OR jsonb_typeof(p_defs) <> 'array' THEN
    RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
  END IF;

  FOR v_def IN SELECT * FROM jsonb_array_elements(p_defs) LOOP
    IF jsonb_typeof(v_def) <> 'object' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;

    v_key := v_def->>'key';
    IF v_key IS NULL OR btrim(v_key) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'avora_think_hub_column_key_taken';
    END IF;
    v_keys := v_keys || v_key;

    v_id := v_def->>'id';
    IF v_id IS NULL OR btrim(v_id) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'avora_think_hub_column_key_taken';
    END IF;
    v_ids := v_ids || v_id;

    IF btrim(coalesce(v_def->>'label', '')) = '' THEN
      RAISE EXCEPTION 'avora_think_hub_column_label_required';
    END IF;

    v_type := v_def->>'type';
    IF v_type IS NULL OR v_type NOT IN ('text', 'number', 'date', 'select', 'link', 'contact', 'checkbox', 'file') THEN
      RAISE EXCEPTION 'avora_think_hub_column_type_invalid';
    END IF;

    IF v_type = 'select' THEN
      IF v_def->'options' IS NULL
         OR jsonb_typeof(v_def->'options') <> 'array'
         OR jsonb_array_length(v_def->'options') = 0 THEN
        RAISE EXCEPTION 'avora_think_hub_column_options_required';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_def->'options') AS opt
        WHERE jsonb_typeof(opt) <> 'string' OR btrim(opt #>> '{}') = ''
      ) THEN
        RAISE EXCEPTION 'avora_think_hub_column_options_required';
      END IF;
    END IF;

    IF v_def ? 'width' AND jsonb_typeof(v_def->'width') <> 'null' THEN
      IF jsonb_typeof(v_def->'width') <> 'number'
         OR (v_def->>'width')::numeric < 60 OR (v_def->>'width')::numeric > 800 THEN
        RAISE EXCEPTION 'avora_think_hub_column_width_invalid';
      END IF;
    END IF;

    IF v_def ? 'hidden' AND jsonb_typeof(v_def->'hidden') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'avora_think_hub_column_defs_shape';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.validate_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.validate_contact_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_user_id INTO v_owner FROM contact WHERE id = NEW.contact_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'Kênh liên hệ phải thuộc cùng chủ với liên hệ';
  END IF;

  IF btrim(private.normalize_channel(NEW.kind, NEW.value)) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.validate_contact_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.validate_crm_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;
begin
  if new.contact_id is null then
    if tg_op = 'UPDATE' and new.removed_at is not null then return new; end if;
    raise exception 'Không tìm thấy liên hệ này';
  end if;
  select owner_user_id into v_owner from public.contact where id = new.contact_id;
  if v_owner is null then raise exception 'Không tìm thấy liên hệ này'; end if;
  if v_owner <> new.owner_user_id then raise exception 'Cơ hội phải gắn với liên hệ của chính bạn'; end if;
  if btrim(coalesce(new.title, '')) = '' then raise exception 'Cơ hội cần một tiêu đề'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.validate_extension_values(p_defs jsonb, p_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def   jsonb;
  v_value jsonb;
  v_type  text;
BEGIN
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'avora_think_hub_extension_shape';
  END IF;

  FOR v_def IN SELECT * FROM jsonb_array_elements(coalesce(p_defs, '[]'::jsonb)) LOOP
    v_value := p_values -> (v_def->>'key');
    -- Chưa ai điền là trạng thái bình thường của một cột vừa thêm.
    CONTINUE WHEN v_value IS NULL OR jsonb_typeof(v_value) = 'null';
    IF jsonb_typeof(v_value) = 'string' AND btrim(v_value #>> '{}') = '' THEN
      CONTINUE;
    END IF;

    v_type := v_def->>'type';

    IF v_type = 'number' THEN
      IF jsonb_typeof(v_value) <> 'number' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_number';
      END IF;

    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_date';
      END IF;
      BEGIN
        PERFORM (v_value #>> '{}')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_date';
      END;

    ELSIF v_type = 'select' THEN
      IF jsonb_typeof(v_value) <> 'string'
         OR NOT (v_def->'options' @> jsonb_build_array(v_value #>> '{}')) THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_option';
      END IF;

    ELSIF v_type = 'link' THEN
      -- AVORA-61 · D: an http(s) link and nothing else.
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* '^https?://[^\s]+$' OR char_length(v_value #>> '{}') > 2000 THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_link';
      END IF;

    ELSIF v_type = 'contact' THEN
      -- The id of a contact in the writer's own book; others see only that it is set.
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_contact';
      END IF;

    ELSIF v_type = 'checkbox' THEN
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') <> '1' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_checkbox';
      END IF;

    ELSIF v_type = 'file' THEN
      -- Files live in think_hub_cell_files; the cell itself holds nothing.
      RAISE EXCEPTION 'avora_think_hub_value_not_text';

    ELSE
      IF jsonb_typeof(v_value) <> 'string' THEN
        RAISE EXCEPTION 'avora_think_hub_value_not_text';
      END IF;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.validate_message_origin_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.origin_group_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.conversations c
     where c.id = new.origin_group_id and c.type = 'group'
  ) then
    raise exception 'avora_origin_group_not_a_group';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = new.origin_group_id
       and cp.user_id = new.sender_id
  ) then
    raise exception 'avora_origin_group_not_participant';
  end if;

  return new;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.validate_suggestion_self_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_type text;
begin
  if new.assignee_id is distinct from new.proposer_id then
    return new;
  end if;

  select type into v_type from public.conversations where id = new.conversation_id;
  -- A 1-1 has exactly one other person in it, so naming yourself is a slip, not a decision.
  if v_type is distinct from 'group' then
    raise exception 'avora_task_self_assign';
  end if;

  return new;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.validate_think_hub_record_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table think_hub_table%ROWTYPE;
  v_task  tasks%ROWTYPE;
BEGIN
  SELECT t.* INTO v_table
  FROM think_hub_record r JOIN think_hub_table t ON t.id = r.table_id
  WHERE r.id = NEW.record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  -- Hạng mục của dự án đi qua project_tasks, không qua đây.
  IF v_table.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_is_project';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_task_missing';
  END IF;

  -- Task và Hạng mục phải cùng một nơi: bảng riêng ↔ việc riêng của chính chủ bảng;
  -- bảng của cuộc trò chuyện ↔ việc chung của đúng cuộc đó.
  IF v_table.conversation_id IS NULL THEN
    IF v_task.type <> 'personal' OR v_task.creator_id <> v_table.owner_user_id THEN
      RAISE EXCEPTION 'avora_think_hub_task_out_of_scope';
    END IF;
  ELSIF v_task.conversation_id IS DISTINCT FROM v_table.conversation_id THEN
    RAISE EXCEPTION 'avora_think_hub_task_out_of_scope';
  END IF;

  RETURN NEW;
END;
$function$;

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

CREATE OR REPLACE FUNCTION private.vault_alarm(p_user uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tz text; v_when text; v_text text; v_email text;
begin
  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from profiles where id = p_user;
  v_when := to_char(now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY');
  v_text := format('Mã Két sắt vừa được %s lúc %s. Không phải bạn? Đổi mật khẩu tài khoản ngay.',
    case when p_kind = 'reset' then 'đặt lại' else 'đổi' end, v_when);
  insert into push_outbox (user_id, kind, payload) values (p_user, 'security', jsonb_build_object('text', v_text));
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    perform private.vault_send_mail(jsonb_build_object('kind', 'alarm', 'action', p_kind, 'email', v_email, 'when', v_when));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_assert_device_allowed()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_device_allowed(auth.uid()) then raise exception 'avora_vault_device_not_allowed'; end if;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_assert_unlocked()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
begin
  update private.vault_unlocks set expires_at = now() + interval '5 minutes'
  where user_id = auth.uid() and session_id = private.vault_session_id() and expires_at > now();
  if not found then raise exception 'avora_vault_locked'; end if;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_code_ok(p_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_temp'
AS $function$
  select coalesce(p_code, '') ~ '^[0-9]{6}$'
$function$;

CREATE OR REPLACE FUNCTION private.vault_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; v_task uuid;
begin
  for r in select * from public.vault_items where remind_on <= current_date and reminder_task_id is null and deleted_at is null loop
    insert into public.tasks (type, creator_id, title, description, status, deadline_date, deadline_tz, is_important, recurrence)
    values ('personal', r.owner_user_id, coalesce(nullif(r.reminder_title, ''), 'Giấy tờ trong Két sắt sắp tới hạn'),
            'Mở trong Két sắt › /ket-sat/' || case r.section when 'certificates' then 'chung-chi' when 'documents' then 'tai-lieu' else 'tai-san' end || '?muc=' || r.id,
            'confirmed', current_date, 'Asia/Ho_Chi_Minh', false, 'none')
    returning id into v_task;
    update public.vault_items set reminder_task_id = v_task where id = r.id;
  end loop;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o using public.vault_items i
  where o.bucket_id = 'vault-files' and i.deleted_at < now() - interval '30 days' and o.name like i.owner_user_id::text || '/' || i.id::text || '/%';
  delete from public.vault_items where deleted_at < now() - interval '30 days';
  delete from private.vault_pass_sessions where proved_at < now() - interval '1 day';
end $function$;

CREATE OR REPLACE FUNCTION private.vault_device_allowed(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not (
    exists (select 1 from public.account_devices d where d.user_id = p_uid and d.rank in (1, 2) and d.revoked_at is null)
    and not coalesce((select p.vault_other_devices_allowed from public.profiles p where p.id = p_uid), false)
    and not exists (
      select 1 from public.account_devices me
      where me.user_id = p_uid and me.session_id = private.current_session_id()
        and private.current_session_id() is not null and me.rank in (1, 2) and me.revoked_at is null
    )
  )
$function$;

CREATE OR REPLACE FUNCTION private.vault_encrypted(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists (select 1 from public.vault_keyring where user_id = p_uid) $function$;

CREATE OR REPLACE FUNCTION private.vault_is_unlocked()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
  select exists (
    select 1 from private.vault_unlocks u
    where u.user_id = auth.uid() and u.session_id = private.vault_session_id() and u.expires_at > now()
  )
$function$;

CREATE OR REPLACE FUNCTION private.vault_items_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.remind_on is distinct from old.remind_on then new.reminder_task_id := null; end if;
  if tg_op = 'INSERT' then new.reminder_task_id := null; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_open_session(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
declare v_sid uuid := private.vault_session_id();
begin
  if v_sid is null then raise exception 'avora_vault_no_session'; end if;
  delete from private.vault_unlocks where user_id = p_user and expires_at <= now();
  insert into private.vault_unlocks (user_id, session_id, expires_at) values (p_user, v_sid, now() + interval '5 minutes')
  on conflict (user_id, session_id) do update set unlocked_at = now(), expires_at = excluded.expires_at;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_proof_rate(p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from private.vault_proof_attempts where at < now() - interval '1 day';
  if (select count(*) from private.vault_proof_attempts where user_id = p_uid and at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_vault_proof_rate';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.vault_register_failure(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
declare v_row private.vault_attempts%rowtype;
begin
  insert into private.vault_attempts (user_id) values (p_user) on conflict (user_id) do nothing;
  update private.vault_attempts set failed_count = failed_count + 1 where user_id = p_user returning * into v_row;
  if v_row.failed_count >= 5 then
    update private.vault_attempts set failed_count = 0, lock_level = lock_level + 1,
      locked_until = now() + case when lock_level = 0 then interval '5 minutes' when lock_level = 1 then interval '15 minutes' else interval '1 hour' end
    where user_id = p_user returning * into v_row;
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_row.locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'remaining', 5 - v_row.failed_count, 'locked_until', null);
end $function$;

CREATE OR REPLACE FUNCTION private.vault_send_mail(p_body jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/vault-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := p_body,
    timeout_milliseconds := 15000
  );
end $function$;

CREATE OR REPLACE FUNCTION private.vault_session_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_temp'
AS $function$
  select case when coalesce(auth.jwt()->>'session_id', '') ~ '^[0-9a-fA-F-]{36}$' then (auth.jwt()->>'session_id')::uuid end
$function$;

CREATE OR REPLACE FUNCTION private.vault_wait_until(p_user uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
  select locked_until from private.vault_attempts where user_id = p_user and locked_until > now()
$function$;

CREATE OR REPLACE FUNCTION private.verification_is_live(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.verification_status = 'pending'
      and c.verification_expires_at > now()
      and (
        c.verification_via_group_id is null
        or exists (
          select 1 from public.conversations g
          where g.id = c.verification_via_group_id and g.deleted_at is null
            and (select count (*) from public.conversation_participants gp
                 where gp.conversation_id = g.id
                   and gp.user_id in (select cp.user_id from public.conversation_participants cp
                                      where cp.conversation_id = c.id)) >= 2
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.abandon_habit_session(p_id uuid, p_habit uuid, p_local_date date, p_window integer, p_duration_seconds integer, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits; v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  v := private.habit_owned(p_habit, v_uid);
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  if p_window is null or p_window < 0 or p_window >= jsonb_array_length(v.windows) then raise exception 'avora_habit_window' using errcode = '22023'; end if;
  if exists (select 1 from public.habit_logs where id = v_id) then
    if exists (select 1 from public.habit_logs where id = v_id and user_id = v_uid) then return v_id; end if;
    raise exception 'avora_habit_id' using errcode = '42501';
  end if;
  insert into public.habit_logs (id, habit_id, user_id, local_date, window_index, status, source, duration_seconds, note)
  values (v_id, p_habit, v_uid, p_local_date, p_window, 'abandoned', 'timer', greatest(coalesce(p_duration_seconds, 0), 0),
          nullif(left(btrim(coalesce(p_note, '')), 500), ''));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite  contact_invite%ROWTYPE;
  v_contact contact%ROWTYPE;
  v_inviter_name text;
  v_reciprocal_id uuid;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_invite FROM contact_invite
  WHERE invite_token = nullif(btrim(p_token), '');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lời mời không tồn tại hoặc đã hết hiệu lực';
  END IF;
  -- AVORA-37 / A: between a blocked pair the invite reads exactly as if it did not exist.
  IF private.is_blocked_between(v_invite.invited_by, auth.uid()) THEN
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

  -- AVORA-38 / ADR-029: both sides agreed through the invite, so they are now bạn.
  PERFORM private.connect_users(v_invite.invited_by, auth.uid(), 'contact_invite');

  RETURN v_reciprocal_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_task_suggestion(p_suggestion_id uuid, p_task_id uuid DEFAULT NULL::uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_task_id uuid;
  v_type text;
  v_conv_type text;
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;
  if v_s.assignee_id <> v_uid then raise exception 'avora_task_not_assignee'; end if;

  if v_s.status = 'accepted' then
    if v_s.accepted_task_id is null then raise exception 'avora_task_not_found'; end if;
    select * into v_row from public.tasks where id = v_s.accepted_task_id;
    if not found then raise exception 'avora_task_not_found'; end if;
    return v_row;
  end if;

  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  -- VMT duyệt mục 6: accepting is a write into the 1-1 — same gate as sending.
  perform private.assert_direct_talk (v_s.conversation_id, v_uid, 'rich');
  if v_s.proposer_id <> v_uid and private.is_blocked_between (v_uid, v_s.proposer_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  select type into v_conv_type from public.conversations where id = v_s.conversation_id;
  v_type := case when v_conv_type = 'group' then 'group-shared' else '1-1-shared' end;
  v_task_id := coalesce(p_task_id, gen_random_uuid());

  perform set_config('avora.accepting_suggestion', 'on', true);

  insert into public.tasks (
    id, type, creator_id, assignee_id, conversation_id, title, description, status,
    confirmed_by, confirmed_at, deadline_date, deadline_time, deadline_tz, context_snapshot,
    start_at, end_at, location, requires_presence
  )
  values (
    v_task_id, v_type, v_s.proposer_id, v_s.assignee_id, v_s.conversation_id,
    v_s.proposed_title, v_s.proposed_description, 'confirmed',
    v_uid, now(), v_s.proposed_deadline, v_s.proposed_deadline_time,
    v_s.proposed_deadline_tz, v_s.context_snapshot,
    v_s.proposed_start_at, v_s.proposed_end_at, v_s.proposed_location, v_s.proposed_requires_presence
  );

  perform set_config('avora.accepting_suggestion', 'off', true);

  insert into public.task_confirmations (task_id, user_id)
  values (v_task_id, v_s.proposer_id), (v_task_id, v_uid)
  on conflict (task_id, user_id) do nothing;

  -- Filed where it was raised from (VMT 29/09 mục 3).
  if v_s.proposed_project_id is not null then
    insert into public.project_tasks (task_id, project_id, record_id, linked_by)
    values (v_task_id, v_s.proposed_project_id, v_s.proposed_record_id, v_uid)
    on conflict (task_id) do nothing;
  elsif v_s.proposed_record_id is not null then
    insert into public.think_hub_record_tasks (task_id, record_id, linked_by)
    values (v_task_id, v_s.proposed_record_id, v_uid)
    on conflict (task_id) do nothing;
  end if;

  update public.task_suggestions
  set status = 'accepted', resolved_at = now(), accepted_task_id = v_task_id
  where id = p_suggestion_id;

  select * into v_row from public.tasks where id = v_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_contact_channel(p_contact_id uuid, p_kind text, p_value text, p_source text DEFAULT 'manual'::text, p_label text DEFAULT NULL::text, p_needs_review boolean DEFAULT false)
 RETURNS contact_channel
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact    contact%ROWTYPE;
  v_row        contact_channel%ROWTYPE;
  v_normalized text;
  v_primary    text;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'Loại kênh phải là phone hoặc email';
  END IF;

  IF p_source NOT IN ('manual', 'import_csv', 'import_device', 'import_vcf') THEN
    RAISE EXCEPTION 'Nguồn kênh phải là manual, import_csv, import_device hoặc import_vcf';
  END IF;

  v_normalized := private.normalize_channel(p_kind, p_value);
  IF btrim(coalesce(v_normalized, '')) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  -- SECURITY DEFINER bỏ qua RLS, nên quyền sở hữu phải tự kiểm: p_contact_id
  -- đến từ client và không được tin.
  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được thêm kênh liên hệ';
  END IF;

  v_primary := private.normalize_channel(
    p_kind,
    CASE WHEN p_kind = 'phone' THEN v_contact.phone ELSE v_contact.email END
  );
  IF v_primary = v_normalized THEN
    RETURN NULL;
  END IF;

  INSERT INTO contact_channel (contact_id, owner_user_id, kind, value, label, source, needs_review)
  VALUES (p_contact_id, auth.uid(), p_kind, btrim(p_value), nullif(btrim(p_label), ''),
          p_source, coalesce(p_needs_review, false))
  ON CONFLICT ON CONSTRAINT contact_channel_unique_per_contact DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_normalized;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_person uuid;
  v_added uuid[] := '{}';
  v_names text;
begin
  perform private.assert_feature('groups');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_user_ids, 1) > 50 then raise exception 'avora_too_many'; end if;
  if not exists (select 1 from conversations where id = p_conversation_id and type = 'group' and deleted_at is null) then
    raise exception 'avora_not_a_group';
  end if;
  select role into v_role from conversation_participants where conversation_id = p_conversation_id and user_id = v_uid;
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'avora_group_add_forbidden'; end if;

  foreach v_person in array p_user_ids loop
    if v_person = v_uid or private.is_conversation_participant(p_conversation_id, v_person) then continue; end if;
    if not private.are_connected(v_uid, v_person) or private.is_blocked_between(v_uid, v_person) then
      raise exception 'avora_group_add_not_friend';
    end if;
    -- The capacity trigger (300) raises avora_group_full and undoes the whole call.
    insert into conversation_participants (conversation_id, user_id, role) values (p_conversation_id, v_person, 'member');
    v_added := v_added || v_person;
  end loop;

  if array_length(v_added, 1) > 0 then
    select string_agg(private.push_display_name(x), ', ') into v_names from unnest(v_added) x;
    insert into messages (conversation_id, sender_id, content, system_kind)
    values (p_conversation_id, v_uid, private.push_display_name(v_uid) || ' đã thêm ' || v_names, 'member_added');
  end if;
  return coalesce(array_length(v_added, 1), 0);
end $function$;

CREATE OR REPLACE FUNCTION public.add_project_success_criterion(p_project_id uuid, p_description text, p_measurement_type text, p_target_percent numeric DEFAULT NULL::numeric)
 RETURNS project_success_criteria
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;
  IF btrim(coalesce(p_description, '')) = '' THEN
    RAISE EXCEPTION 'avora_criterion_description_required';
  END IF;
  IF p_measurement_type IS NULL OR p_measurement_type NOT IN ('percentage', 'meeting_confirmation') THEN
    RAISE EXCEPTION 'avora_criterion_type_invalid';
  END IF;

  INSERT INTO project_success_criteria (project_id, description, measurement_type, target_percent, created_by)
  VALUES (
    p_project_id, btrim(p_description), p_measurement_type,
    CASE WHEN p_measurement_type = 'percentage' THEN p_target_percent END,
    v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_think_hub_column(p_table_id uuid, p_label text, p_type text, p_options text[] DEFAULT NULL::text[])
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_label   text;
  v_options jsonb;
  v_id      text;
  v_def     jsonb;
  v_row     think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  v_label := btrim(coalesce(p_label, ''));
  if v_label = '' then raise exception 'avora_think_hub_column_label_required'; end if;
  if p_type is null or p_type not in ('text', 'number', 'date', 'select', 'link', 'contact', 'checkbox', 'file') then
    raise exception 'avora_think_hub_column_type_invalid';
  end if;

  select * into v_row from think_hub_table
  where id = p_table_id and owner_user_id = v_user and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;

  v_id := 'col_' || replace(gen_random_uuid()::text, '-', '');
  v_def := jsonb_build_object('id', v_id, 'key', v_id, 'label', v_label, 'type', p_type);

  if p_type = 'select' then
    select coalesce(jsonb_agg(distinct btrim(opt)), '[]'::jsonb) into v_options
    from unnest(coalesce(p_options, '{}')) as opt
    where btrim(coalesce(opt, '')) <> '';
    if jsonb_array_length(v_options) = 0 then raise exception 'avora_think_hub_column_options_required'; end if;
    v_def := v_def || jsonb_build_object('options', v_options);
  end if;

  update think_hub_table set column_defs = column_defs || jsonb_build_array(v_def)
  where id = p_table_id returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.am_i_ops()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_ops(auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.announce_think_hub_changes(p_table_id uuid, p_note text DEFAULT NULL::text, p_notify uuid[] DEFAULT '{}'::uuid[], p_mentions uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_conv uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_new uuid[];
  v_recent think_hub_announcements%rowtype;
  v_all uuid[];
  v_summary jsonb;
  v_content text;
  v_msg uuid;
  v_ann uuid;
  v_target uuid;
  v_targets uuid[];
  v_name text;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'avora_board_note_too_long'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  if v_conv is null then raise exception 'avora_board_not_shared'; end if;
  if not private.is_conversation_participant(v_conv, v_user) or not private.conversation_is_live(v_conv) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_table.announce_mode = 'silent' then raise exception 'avora_board_announce_off'; end if;
  if v_table.announce_who = 'admins' and v_table.owner_user_id <> v_user
     and not exists (select 1 from conversation_participants cp where cp.conversation_id = v_conv and cp.user_id = v_user and cp.role in ('owner', 'admin')) then
    raise exception 'avora_board_announce_not_allowed';
  end if;

  select coalesce(array_agg(id order by created_at), '{}') into v_new
  from think_hub_change_log where table_id = p_table_id and actor_id = v_user and announced_at is null;

  -- Within two hours the same editor updates their last card instead of adding one.
  select * into v_recent from think_hub_announcements
  where table_id = p_table_id and actor_id = v_user and kind = 'update' and updated_at > now() - interval '2 hours'
    and message_id is not null
  order by updated_at desc limit 1;

  if coalesce(array_length(v_new, 1), 0) = 0 and v_recent.id is null then raise exception 'avora_board_nothing_to_announce'; end if;

  v_all := coalesce(v_recent.change_ids, '{}') || v_new;
  v_summary := private.board_change_summary(v_all);
  v_name := private.public_name(v_user);
  v_content := format('%s cập nhật Bảng "%s" · %s', v_name, v_table.name, private.board_summary_words(v_summary))
    || case when v_note is not null then ' · ' || v_note else '' end;

  if v_recent.id is not null then
    update messages set content = left(v_content, 4000), created_at = now() where id = v_recent.message_id;
    update think_hub_announcements
      set change_ids = v_all, summary = v_summary, note = coalesce(v_note, note), updated_at = now()
    where id = v_recent.id;
    v_ann := v_recent.id;
    v_msg := v_recent.message_id;
  else
    v_msg := private.post_system_line(v_conv, v_user, 'board_update', v_content);
    insert into think_hub_announcements (table_id, conversation_id, message_id, actor_id, kind, change_ids, summary, note)
    values (p_table_id, v_conv, v_msg, v_user, 'update', v_all, v_summary, v_note)
    returning id into v_ann;
  end if;
  update think_hub_change_log set announced_at = now(), announcement_id = v_ann where id = any (v_new);

  -- Only the people chosen (owners of the Hạng mục touched, by default) and the @-named get a push.
  select coalesce(array_agg(distinct u), '{}') into v_targets
  from unnest(coalesce(p_notify, '{}') || coalesce(p_mentions, '{}')) u
  where u <> v_user and private.is_conversation_participant(v_conv, u) and not private.is_blocked_between(u, v_user);
  foreach v_target in array v_targets loop
    perform private.board_push(v_target, v_conv, p_table_id, format('Bảng "%s"', v_table.name),
      format('%s cập nhật · %s', v_name, private.board_summary_words(v_summary)));
  end loop;
  update think_hub_announcements set notified_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(notified_ids || v_targets) x) where id = v_ann;
  return v_msg;
end;
$function$;

CREATE OR REPLACE FUNCTION public.answer_disappear_proposal(p_proposal_id uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row public.disappear_proposals%rowtype;
begin
  perform private.assert_feature('disappearing');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.disappear_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_not_found'; end if;
  perform private.assert_can_act_in(v_row.conversation_id, v_uid, 'send');
  if v_row.proposed_by = v_uid then raise exception 'avora_proposal_own'; end if;
  if v_row.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  if v_row.created_at < now() - interval '3 days' then
    update public.disappear_proposals set status = 'expired', resolved_at = now() where id = p_proposal_id;
    raise exception 'avora_proposal_closed';
  end if;
  if p_accept then
    update public.disappear_proposals set status = 'accepted', answered_by = v_uid, resolved_at = now() where id = p_proposal_id;
    update public.conversations set disappear_after_seconds = v_row.seconds where id = v_row.conversation_id;
    perform private.disappear_line(v_row.conversation_id, v_uid,
      'đã đồng ý: tin tự biến mất sau ' || private.disappear_label(v_row.seconds), 'disappear_changed');
    return 'accepted';
  end if;
  update public.disappear_proposals set status = 'declined', answered_by = v_uid, resolved_at = now() where id = p_proposal_id;
  perform private.disappear_line(v_row.conversation_id, v_uid, 'chưa đồng ý đổi tin tự biến mất', 'disappear_changed');
  return 'declined';
end $function$;

CREATE OR REPLACE FUNCTION public.apply_template_to_table(p_table_id uuid, p_template_key text, p_user_template_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_tpl think_hub_template%rowtype;
  v_mine think_hub_user_template%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if (p_template_key is null) = (p_user_template_id is null) then raise exception 'avora_template_source_required'; end if;

  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or v_table.owner_user_id <> v_user or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if exists (select 1 from think_hub_record where table_id = p_table_id and deleted_at is null) then
    raise exception 'avora_template_table_not_empty';
  end if;

  if p_template_key is not null then
    select * into v_tpl from think_hub_template where key = p_template_key and is_active and key <> 'reading';
    if not found then raise exception 'avora_template_missing'; end if;
    return private.apply_structure_to_table(p_table_id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
      v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, v_tpl.guiding_question);
  end if;
  select * into v_mine from think_hub_user_template where id = p_user_template_id and owner_user_id = v_user;
  if not found then raise exception 'avora_template_missing'; end if;
  return private.apply_structure_to_table(p_table_id, v_mine.column_defs, v_mine.status_options, v_mine.title_label,
    v_mine.default_view, v_mine.mobile_columns, null, null, v_mine.guiding_question);
end $function$;

CREATE OR REPLACE FUNCTION public.archive_habit(p_id uuid, p_archived boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  perform private.assert_feature('habits');
  v := private.habit_owned(p_id, v_uid);
  -- Lưu trữ không xoá lịch sử.
  update public.habits set archived_at = case when p_archived then coalesce(v.archived_at, now()) end, version = v.version + 1, updated_at = now() where id = p_id;
  return v.version + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.attach_meeting_note_file(p_decision_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_byte_size bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if not private.can_manage_meeting_file (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  if p_storage_path is null
    or p_storage_path not like v_note.conversation_id::text || '/' || p_decision_id::text || '/%' then
    raise exception 'avora_note_file_bad_path';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'meeting-files' and o.name = p_storage_path and o.owner = v_uid
  ) then
    raise exception 'avora_note_file_missing';
  end if;

  select storage_path into v_old from public.meeting_note_files where decision_id = p_decision_id;

  insert into public.meeting_note_files (decision_id, conversation_id, storage_path, file_name, mime_type,
    byte_size, uploaded_by)
  values (p_decision_id, v_note.conversation_id, p_storage_path, left(btrim(p_file_name), 255), p_mime_type,
    p_byte_size, v_uid)
  on conflict (decision_id)
    do update set storage_path = excluded.storage_path, file_name = excluded.file_name,
      mime_type = excluded.mime_type, byte_size = excluded.byte_size, uploaded_by = excluded.uploaded_by,
      created_at = now();

  return case when v_old is distinct from p_storage_path then v_old else null end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.avatar_paths(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, path text, version timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 1000 then raise exception 'avora_too_many'; end if;
  return query select * from private.avatar_paths_for(v_uid, p_user_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.block_category_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.transactions t where t.category_id = old.id) then
    raise exception 'avora_category_in_use';
  end if;
  return old;
end $function$;

CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'avora_block_self'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'avora_user_not_found';
  end if;
  -- Idempotent: blocking again keeps the first date and does not fail.
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_uid, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_catalog_covers(p_refs text[])
 RETURNS TABLE(source text, source_id text, title text, title_vi text, language text, cover_path text, cover_checked boolean, pd_status text, access text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_refs, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  return query
    select c.source, c.source_id, c.title, c.title_vi, c.language, c.cover_path, c.cover_checked_at is not null, c.pd_status, c.access
    from public.book_catalog c
    where (c.source, c.source_id) in (select split_part(r, ':', 1), substr(r, strpos(r, ':') + 1) from unnest(coalesce(p_refs, '{}'::text[])) r);
end $function$;

CREATE OR REPLACE FUNCTION public.book_fetch_slot()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_at timestamptz;
begin
  update private.book_fetch_clock set next_at = greatest(next_at, clock_timestamp()) + interval '1 second'
  where id = 1 returning next_at - interval '1 second' into v_at;
  return greatest(0, ceil(extract(epoch from (v_at - clock_timestamp())) * 1000))::int;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_lock_escape()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me public.account_devices%rowtype := private.current_device();
begin
  perform private.assert_session_allowed();
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  update public.account_device_lock set unlock_requested_at = null where user_id = auth.uid();
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_message(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  update public.scheduled_messages set status = 'cancelled', updated_at = now()
  where id = p_id and sender_id = auth.uid() and status in ('pending', 'failed');
  if not found then raise exception 'avora_schedule_missing'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cast_group_vote(p_decision_id uuid, p_option_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.group_decisions%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'poll' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status <> 'open' then raise exception 'avora_decision_poll_closed'; end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  if not exists (
    select 1 from public.group_decision_options o
    where o.id = p_option_id and o.decision_id = p_decision_id
  ) then
    raise exception 'avora_decision_option_foreign';
  end if;

  -- While the poll is open a person may think again. `created_at` deliberately keeps the moment
  -- they first answered; only the choice itself moves.
  insert into public.group_decision_votes (decision_id, option_id, voter_id)
  values (p_decision_id, p_option_id, v_uid)
  on conflict (decision_id, voter_id) do update
    set option_id = excluded.option_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.change_think_hub_column_type(p_table_id uuid, p_column_id text, p_type text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row  think_hub_table%rowtype;
  v_def  jsonb;
  v_from text;
  v_key  text;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table
  where id = p_table_id and owner_user_id = v_user and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  select d into v_def from jsonb_array_elements(v_row.column_defs) d where d->>'id' = p_column_id;
  if v_def is null then raise exception 'avora_think_hub_column_missing'; end if;
  v_from := v_def->>'type';
  v_key := v_def->>'key';

  -- Only changes that cannot lose or garble a value: anything readable as words becomes Chữ;
  -- Chữ becomes Liên kết only when every filled cell already is an http(s) link.
  if not ((p_type = 'text' and v_from in ('number', 'date', 'select', 'link'))
       or (p_type = 'link' and v_from = 'text')) then
    raise exception 'avora_think_hub_column_type_unsafe';
  end if;
  if p_type = 'link' and exists (
    select 1 from think_hub_record r
    where r.table_id = p_table_id and r.deleted_at is null
      and r.extension_fields ? v_key
      and jsonb_typeof(r.extension_fields->v_key) <> 'null'
      and btrim(r.extension_fields->>v_key) <> ''
      and (r.extension_fields->>v_key) !~* '^https?://[^\s]+$'
  ) then
    raise exception 'avora_think_hub_column_type_unsafe';
  end if;

  -- Numbers are stored as text from now on, so a Chữ column never holds a number.
  if p_type = 'text' and v_from = 'number' then
    update think_hub_record r
    set extension_fields = jsonb_set(r.extension_fields, array[v_key], to_jsonb(r.extension_fields->>v_key))
    where r.table_id = p_table_id and jsonb_typeof(r.extension_fields->v_key) = 'number';
  end if;

  perform set_config('avora.column_reshape', 'on', true);
  update think_hub_table
  set column_defs = (
    select jsonb_agg(case when d->>'id' = p_column_id then (d - 'options') || jsonb_build_object('type', p_type) else d end order by ord)
    from jsonb_array_elements(v_row.column_defs) with ordinality as e(d, ord)
  )
  where id = p_table_id
  returning * into v_row;
  perform set_config('avora.column_reshape', 'off', true);
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.invite_code%rowtype;
begin
  perform private.rate_take(coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), 'check_invite', 60, interval '1 minute');
  select * into v_row from public.invite_code where code = upper(btrim(coalesce(p_code, '')));
  if v_row.code is null or not v_row.active then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.used >= v_row.max_uses then return jsonb_build_object('ok', false, 'reason', 'used_up'); end if;
  return jsonb_build_object('ok', true, 'country', v_row.country, 'locale', v_row.locale);
end $function$;

CREATE OR REPLACE FUNCTION public.check_user_pin(p_pin text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pin text := upper(btrim(coalesce(p_pin, ''))); v_problem text;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  v_problem := private.user_pin_problem(v_pin);
  if v_problem is not null then return v_problem; end if;
  -- A retired PIN answers exactly like a taken one: nothing tells that an account was deleted.
  if exists (select 1 from public.user_pins where pin = v_pin) or exists (select 1 from private.retired_pins where pin = v_pin) then return 'taken'; end if;
  return 'ok';
end $function$;

CREATE OR REPLACE FUNCTION public.claim_user_pin(p_pin text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_pin text := upper(btrim(coalesce(p_pin, ''))); v_problem text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_source not in ('chosen', 'generated') then raise exception 'avora_pin_format'; end if;
  if exists (select 1 from public.user_pins where user_id = v_uid) then raise exception 'avora_pin_permanent'; end if;
  v_problem := private.user_pin_problem(v_pin);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if exists (select 1 from private.retired_pins where pin = v_pin) then raise exception 'avora_pin_taken'; end if;
  begin
    insert into public.user_pins (user_id, pin, source) values (v_uid, v_pin, p_source);
  exception when unique_violation then
    if exists (select 1 from public.user_pins where user_id = v_uid) then raise exception 'avora_pin_permanent'; end if;
    raise exception 'avora_pin_taken';
  end;
  return v_pin;
end $function$;

CREATE OR REPLACE FUNCTION public.clear_avatar()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return private.avatar_write(v_uid, null);
end $function$;

CREATE OR REPLACE FUNCTION public.clear_channel_review_batch(p_limit integer DEFAULT 500)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_ids uuid[];
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.contact_channel where owner_user_id = v_uid and needs_review
     order by id limit least(greatest(coalesce(p_limit, 500), 1), 500) for update
  ) s;
  update public.contact_channel set needs_review = false where id = any (v_ids);
  return v_ids;
end $function$;

CREATE OR REPLACE FUNCTION public.clear_my_book_cover(p_record uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_path text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.book_my_covers where user_id = v_uid and record_id = p_record returning path into v_path;
  return v_path;
end $function$;

CREATE OR REPLACE FUNCTION public.clear_pin_required_at_on_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.profiles set pin_required_at = null where id = new.user_id;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_group_poll(p_decision_id uuid)
 RETURNS group_decisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.group_decisions%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'poll' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status = 'closed' then return v_row; end if;

  if v_row.created_by <> v_uid and not private.is_group_officer(v_row.conversation_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  update public.group_decisions
    set status = 'closed', settled_at = now(), settled_by = v_uid
    where id = p_decision_id;

  select * into v_row from public.group_decisions where id = p_decision_id;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.close_project_early(p_project_id uuid, p_reason text)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'avora_project_close_reason_required'; END IF;
  IF char_length(v_reason) > 2000 THEN RAISE EXCEPTION 'avora_project_close_reason_too_long'; END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'closed_early' THEN RETURN v_project; END IF;
  IF v_project.status <> 'active' THEN RAISE EXCEPTION 'avora_project_closed'; END IF;

  INSERT INTO project_check_adjust (project_id, owner_id, close_reason)
  VALUES (p_project_id, v_uid, v_reason)
  ON CONFLICT (project_id) DO UPDATE SET close_reason = EXCLUDED.close_reason, owner_id = EXCLUDED.owner_id;

  -- Không đăng gì vào chat: đóng sớm là chuyện người lãnh đạo tự nhìn lại.
  UPDATE projects SET status = 'closed_early', closed_at = now() WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_project(p_project_id uuid)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;

  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'done' THEN RETURN v_project; END IF;
  IF v_project.status <> 'active' THEN RAISE EXCEPTION 'avora_project_closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM project_success_criteria c
    WHERE c.project_id = p_project_id AND c.deleted_at IS NULL
      AND ((c.measurement_type = 'percentage' AND c.actual_percent IS NULL)
        OR (c.measurement_type = 'meeting_confirmation' AND c.meeting_note_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'avora_project_criteria_open';
  END IF;

  IF EXISTS (
    SELECT 1 FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id
    WHERE pt.project_id = p_project_id AND t.status <> 'skipped'
      AND t.deadline_date IS NOT NULL AND t.deadline_date > v_project.target_end_date
  ) THEN
    RAISE EXCEPTION 'avora_project_task_past_end';
  END IF;

  UPDATE projects SET status = 'done', closed_at = now() WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_obligation_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.amount_settled >= new.amount and old.amount_settled < old.amount then
    update public.tasks
      set status = 'done', done_at = now()
      where source_transaction_id = new.id
        and creator_id = new.user_id
        and type = 'personal'
        and status <> 'done';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_1_1_task_completion(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared';
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  if v_uid <> v_row.creator_id then
    raise exception 'avora_task_only_creator_reviews';
  end if;

  if v_row.status = 'done' then
    -- already reviewed: retry is a no-op success
    return v_row;
  end if;

  if v_row.status <> 'done_pending_review' then
    raise exception 'avora_task_not_awaiting_review';
  end if;

  update public.tasks
  set status = 'done', completed_confirmed_at = now(), updated_at = now()
  where id = p_task_id and status = 'done_pending_review';

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_1_1_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared';
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Two-party confirmation: the creator cannot confirm their own task.
  if v_uid = v_row.creator_id then
    raise exception 'avora_task_self_confirm';
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

CREATE OR REPLACE FUNCTION public.confirm_contact_link(p_contact_id uuid)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_row public.contact%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then raise exception 'avora_contact_link_no_match'; end if;

  update public.contact
    set linked_user_id = v_match.user_id, link_suggestion_dismissed = null, updated_at = now()
    where id = p_contact_id and owner_user_id = v_uid and linked_user_id is null
    returning * into v_row;
  if not found then raise exception 'avora_contact_link_no_match'; end if;

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
  perform private.assert_session_allowed();
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

CREATE OR REPLACE FUNCTION public.confirm_verification(p_conversation_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_peer uuid;
  v_via uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  v_peer := private.direct_peer_of (p_conversation_id, v_uid);
  if private.is_blocked_between (v_uid, v_peer) then raise exception 'avora_contact_unavailable'; end if;
  if not private.verification_is_live (p_conversation_id) then raise exception 'avora_verification_closed'; end if;

  insert into public.conversation_verification_confirms (conversation_id, user_id)
  values (p_conversation_id, v_uid) on conflict do nothing;

  if (select count (*) from public.conversation_verification_confirms where conversation_id = p_conversation_id) >= 2 then
    select verification_via_group_id into v_via from public.conversations where id = p_conversation_id;
    perform private.connect_users (v_uid, v_peer, case when v_via is null then 'pin' else 'group' end);
    update public.conversations
    set verification_status = 'confirmed', verification_resolved_at = now()
    where id = p_conversation_id;
    return 'connected';
  end if;
  return 'waiting';
end;
$function$;

CREATE OR REPLACE FUNCTION public.contact_card_view(p_message_id uuid)
 RETURNS TABLE(user_id uuid, name text, pin text, avatar_url text, is_friend boolean, is_self boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_person uuid;
begin
  perform private.assert_session_allowed();
  select m.conversation_id, m.contact_card_user_id into v_conv, v_person from public.messages m
    where m.id = p_message_id and m.deleted_at is null;
  if v_conv is null or v_person is null or not private.is_conversation_participant(v_conv, v_user) then return; end if;
  -- AVORA-115: the picture only for its owner and friends.
  return query select v_person, p.display_name, up.pin,
      case when private.can_see_avatar(v_user, v_person) then p.avatar_url end,
      private.are_connected(v_user, v_person), v_person = v_user
    from public.profiles p join public.user_pins up on up.user_id = p.id where p.id = v_person;
end $function$;

CREATE OR REPLACE FUNCTION public.contact_duplicate_pairs()
 RETURNS TABLE(keep_id uuid, keep_name text, drop_id uuid, drop_name text, kind text, value_normalized text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return query
  with v as (select cv.contact_id, cv.kind, cv.value_normalized vn, cv.created_at from private.contact_values(v_uid) cv where cv.value_normalized <> ''),
  pairs as (
    select distinct on (least(a.contact_id, b.contact_id), greatest(a.contact_id, b.contact_id))
      case when a.created_at <= b.created_at then a.contact_id else b.contact_id end k,
      case when a.created_at <= b.created_at then b.contact_id else a.contact_id end d,
      a.kind ck_kind, a.vn
    from v a join v b on a.kind = b.kind and a.vn = b.vn and a.contact_id < b.contact_id
    order by least(a.contact_id, b.contact_id), greatest(a.contact_id, b.contact_id), a.kind desc
  )
  select p.k, ck.name, p.d, cd.name, p.ck_kind, p.vn
    from pairs p
    join public.contact ck on ck.id = p.k
    join public.contact cd on cd.id = p.d
   where ck.contact_type = cd.contact_type
     and not exists (select 1 from private.contact_not_duplicate n
                      where n.owner_user_id = v_uid and n.contact_a = least(p.k, p.d) and n.contact_b = greatest(p.k, p.d))
   order by ck.name, cd.name;
end $function$;

CREATE OR REPLACE FUNCTION public.contact_invite_timed_out(p_status text, p_invited_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_status = 'pending' AND now() - p_invited_at > interval '14 days';
$function$;

CREATE OR REPLACE FUNCTION public.contact_match_channels(p_phones text[], p_emails text[])
 RETURNS TABLE(kind text, value_normalized text, contact_id uuid, contact_name text, contact_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_phones, 1), 0) + coalesce(array_length(p_emails, 1), 0) > 1000 then
    raise exception 'avora_contact_match_too_many';
  end if;
  return query
  with wanted as (
    select distinct 'phone'::text k, private.normalize_channel('phone', v) n from unnest(coalesce(p_phones, '{}')) v
    union
    select distinct 'email', private.normalize_channel('email', v) from unnest(coalesce(p_emails, '{}')) v
  ), cand as (
    select w.k, w.n, c.id contact_id, c.created_at from wanted w join public.contact c
      on c.owner_user_id = v_uid and w.k = 'phone' and c.phone is not null and private.normalize_channel('phone', c.phone) = w.n
    union all
    select w.k, w.n, c.id, c.created_at from wanted w join public.contact c
      on c.owner_user_id = v_uid and w.k = 'email' and c.email is not null and private.normalize_channel('email', c.email) = w.n
    union all
    select w.k, w.n, ch.contact_id, c.created_at from wanted w
      join public.contact_channel ch on ch.owner_user_id = v_uid and ch.kind = w.k and ch.value_normalized = w.n
      join public.contact c on c.id = ch.contact_id
  ), hits as (
    select distinct on (cand.k, cand.n) cand.k, cand.n, cand.contact_id from cand where cand.n <> ''
     order by cand.k, cand.n, cand.created_at, cand.contact_id
  )
  select h.k, h.n, c.id, c.name, c.contact_type from hits h join public.contact c on c.id = h.contact_id;
end $function$;

CREATE OR REPLACE FUNCTION public.convert_currency(p_amount numeric, p_from text, p_to text, p_on date DEFAULT CURRENT_DATE)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r numeric;
  units smallint;
begin
  perform private.assert_session_allowed();
  if p_amount is null then return null; end if;
  if upper(btrim(p_from)) = upper(btrim(p_to)) then return p_amount; end if;

  r := public.currency_rate_at(p_from, p_to, p_on);
  if r is null then
    raise exception 'avora_currency_rate_missing' using
      detail = format('%s->%s on %s', p_from, p_to, p_on);
  end if;

  select c.minor_units into units from public.currencies c where c.code = upper(btrim(p_to));
  return round(p_amount * r, coalesce(units, 2));
end $function$;

CREATE OR REPLACE FUNCTION public.copy_table_to_journal(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_src think_hub_table%rowtype; v_row think_hub_table%rowtype; v_group text; v_conv uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_src from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_src.conversation_id is null and v_src.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  select coalesce(g.name, 'Nhóm') into v_group from conversation_groups g where g.conversation_id = private.group_root(v_conv);

  insert into think_hub_table (owner_user_id, name, purpose, position, column_defs, status_options, title_label,
    default_view, mobile_columns, source_template_key, source_template_version, orphan_origin)
  select v_uid, v_src.name, case when v_src.project_id is not null and v_src.parent_record_id is null then null else v_src.purpose end,
    coalesce(max(position), -1) + 1,
    coalesce((select jsonb_agg(c - 'width') from jsonb_array_elements(v_src.column_defs) c), '[]'::jsonb),
    v_src.status_options, v_src.title_label, v_src.default_view, v_src.mobile_columns,
    v_src.source_template_key, v_src.source_template_version,
    'Từng thuộc nhóm ' || coalesce(v_group, 'đã giải tán')
  from think_hub_table where owner_user_id = v_uid and conversation_id is null and project_id is null and parent_record_id is null
  returning * into v_row;

  insert into think_hub_record (table_id, owner_user_id, title, status, priority, category, next_action_date, tags, notes, extension_fields)
  select v_row.id, v_uid, r.title, r.status, r.priority, r.category, r.next_action_date, r.tags, r.notes, r.extension_fields
  from think_hub_record r where r.table_id = p_table_id and r.deleted_at is null and r.owner_user_id = v_uid
  order by r.created_at limit 1000;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.copy_think_hub_record(p_record_id uuid, p_target_table_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid(); v jsonb; r think_hub_record%rowtype; src think_hub_table%rowtype; dst think_hub_table%rowtype;
  v_lines text[]; v_new think_hub_record%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  v := private.plan_record_transfer(p_record_id, p_target_table_id, v_user);
  if not (v->>'can_copy')::boolean then raise exception 'avora_think_hub_record_limit'; end if;
  select * into r from think_hub_record where id = p_record_id;
  select * into src from think_hub_table where id = r.table_id;
  select * into dst from think_hub_table where id = p_target_table_id;
  perform private.assert_direct_talk(dst.conversation_id, v_user, 'rich');

  select array_agg((u->>'label') || ': ' || (u->>'value')) into v_lines from jsonb_array_elements(v->'unmatched') u;
  v_lines := coalesce(v_lines, '{}') || ('Sao chép từ ' || src.name);

  insert into think_hub_record (table_id, owner_user_id, title, status, priority, category, next_action_date, tags, notes, extension_fields)
  values (dst.id, v_user, r.title, v->>'status_to_key', r.priority, r.category, r.next_action_date, r.tags,
          private.notes_with(r.notes, v_lines), v->'extension_fields')
  returning * into v_new;
  return v_new;
end $function$;

CREATE OR REPLACE FUNCTION public.create_1_1_shared_task(p_conversation_id uuid, p_title text, p_description text, p_deadline date, p_task_id uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT 'Asia/Ho_Chi_Minh'::text, p_category_id uuid DEFAULT NULL::uuid, p_is_important boolean DEFAULT false, p_recurrence text DEFAULT 'none'::text, p_recurrence_pattern jsonb DEFAULT NULL::jsonb)
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
  v_row public.tasks%rowtype;
begin
  perform private.assert_feature('tasks');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- Asking someone for work without saying what you need, or by when, is not a task.
  if v_description = '' then raise exception 'avora_task_description_required'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;

  if not exists (
    select 1
    from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id
    where c.id = p_conversation_id and c.type = 'direct' and cp.user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-37 / A: no shared task into a blocked 1-1.
  if private.direct_peer_blocked (p_conversation_id, v_uid) then
    raise exception 'avora_contact_unavailable';
  end if;

  -- Idempotent on retry: the client may replay the same generated id.
  insert into public.tasks (
    id, type, creator_id, conversation_id, title, description, status, deadline_date,
    deadline_time, deadline_tz, task_category_id, is_important, recurrence, recurrence_pattern
  )
  values (
    v_id, '1-1-shared', v_uid, p_conversation_id, v_title, v_description, 'pending_confirmation', p_deadline,
    p_deadline_time, coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh'), p_category_id,
    coalesce(p_is_important, false), coalesce(nullif(btrim(p_recurrence), ''), 'none'), p_recurrence_pattern
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

CREATE OR REPLACE FUNCTION public.create_contact_invite(p_contact_id uuid, p_method text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_type  text;
  v_phone text;
  v_email text;
  v_token text;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_method NOT IN ('sms', 'email', 'link', 'qr') THEN
    RAISE EXCEPTION 'Cách mời phải là sms, email, link hoặc qr';
  END IF;

  SELECT owner_user_id, contact_type, phone, email
    INTO v_owner, v_type, v_phone, v_email
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

  -- Kênh phải có địa chỉ thật. Chuỗi rỗng cũng là chưa có: create_contact/update_contact
  -- đã nullif(btrim(...)) khi ghi, nhưng hàng cũ hoặc đường ghi khác có thể còn ''.
  IF p_method = 'sms' AND nullif(btrim(coalesce(v_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Liên hệ này chưa có số điện thoại, không thể mời qua SMS';
  END IF;
  IF p_method = 'email' AND nullif(btrim(coalesce(v_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Liên hệ này chưa có email, không thể mời qua email';
  END IF;

  v_token := gen_random_uuid()::text;

  INSERT INTO contact_invite (contact_id, invited_by, method, invite_token)
  VALUES (p_contact_id, auth.uid(), p_method, v_token);

  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_contact_quick(p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_row contact%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_contact_name_required'; end if;
  if char_length(v_name) > 120 then raise exception 'avora_contact_name_too_long'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'avora_contact_email_invalid'; end if;
  insert into contact (owner_user_id, contact_type, name, phone, email, needs_details)
  values (v_uid, 'individual', v_name, v_phone, v_email, v_phone is null and v_email is null)
  returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.create_contact(p_contact_type text, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_relationship_tag text DEFAULT NULL::text, p_tax_code text DEFAULT NULL::text, p_business_address text DEFAULT NULL::text, p_representative_name text DEFAULT NULL::text, p_representative_phone text DEFAULT NULL::text, p_representative_email text DEFAULT NULL::text, p_industry text DEFAULT NULL::text)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform private.assert_session_allowed();
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
$function$;

CREATE OR REPLACE FUNCTION public.create_contacts_bulk(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_row jsonb; v_i int := -1; v_out jsonb := '[]'::jsonb;
  v_contact public.contact%rowtype; v_existing uuid; v_ch jsonb; v_added int; v_src text; v_saved public.contact_channel%rowtype;
begin
  perform private.assert_feature('contact_import');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'avora_contact_bulk_shape'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'avora_contact_bulk_too_many'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_src := coalesce(v_row ->> 'source', 'import_csv');
    if v_src not in ('manual', 'import_csv', 'import_device', 'import_vcf') then v_src := 'import_csv'; end if;
    -- Already in the address book (any phone / email of the row): nothing new. Indexed lookups only.
    v_existing := private.contact_holding(v_uid,
      array(select private.normalize_channel('phone', x) from (select v_row ->> 'phone' x union all select c ->> 'value' from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) c where c ->> 'kind' = 'phone') s where nullif(btrim(coalesce(x, '')), '') is not null),
      array(select private.normalize_channel('email', x) from (select v_row ->> 'email' x union all select c ->> 'value' from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) c where c ->> 'kind' = 'email') s where nullif(btrim(coalesce(x, '')), '') is not null));
    if v_existing is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'exists', 'id', v_existing));
      continue;
    end if;
    begin
      v_contact := public.create_contact(
        coalesce(v_row ->> 'type', 'individual'), v_row ->> 'name', v_row ->> 'phone', v_row ->> 'email', v_row ->> 'note',
        nullif(v_row ->> 'date_of_birth', '')::date, v_row ->> 'relationship_tag', v_row ->> 'tax_code', v_row ->> 'business_address',
        v_row ->> 'representative_name', v_row ->> 'representative_phone', v_row ->> 'representative_email', v_row ->> 'industry');
      v_added := 0;
      for v_ch in select * from jsonb_array_elements(coalesce(v_row -> 'channels', '[]')) loop
        begin
          v_saved := public.add_contact_channel(v_contact.id, v_ch ->> 'kind', v_ch ->> 'value', v_src, v_ch ->> 'label', coalesce((v_ch ->> 'needs_review')::boolean, false));
          if v_saved.id is not null then v_added := v_added + 1; end if;
        exception when others then null; -- a spare number never undoes a good contact
        end;
      end loop;
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'created', 'id', v_contact.id, 'channels', v_added));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'status', 'failed', 'error', left(sqlerrm, 200)));
    end;
  end loop;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.create_direct_conversation(other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := auth.uid();
  pair_key text;
  conv uuid;
begin
  perform private.assert_feature('chat_direct');
  perform private.assert_session_allowed();
  if me is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'AVORA_INVALID_PARTNER' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = other_user_id) then
    raise exception 'AVORA_USER_NOT_FOUND' using errcode = '22023';
  end if;

  pair_key := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);

  select c.id into conv
    from public.conversations c
   where c.direct_key = pair_key and c.deleted_at is null;
  if conv is not null then
    return conv;
  end if;

  -- AVORA-37 / A: an existing 1-1 is left alone (history stays); a new one is not opened
  -- between two people when either has blocked the other.
  if private.is_blocked_between (me, other_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  -- AVORA-38 / ADR-029: an existing 1-1 above stays readable (sending goes through
  -- assert_direct_talk); a NEW one is only opened between bạn. Strangers go through a PIN.
  if not private.are_connected (me, other_user_id) then
    raise exception 'avora_not_connected';
  end if;

  insert into public.conversations (type, direct_key)
  values ('direct', pair_key)
  on conflict (direct_key) where direct_key is not null do nothing
  returning id into conv;

  if conv is null then
    select c.id into conv from public.conversations c where c.direct_key = pair_key;
    return conv;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv, me), (conv, other_user_id)
  on conflict do nothing;

  return conv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_name text, p_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  m uuid;
  v_members uuid[];
begin
  perform private.assert_feature('groups');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_group_name_required'; end if;
  perform private.rate_take(v_uid, 'group', 10, interval '1 day');
  if char_length(v_name) > 120 then raise exception 'avora_group_name_max_len'; end if;

  -- AVORA-38 / F + item 7: members are chosen among bạn; anyone else (unknown, blocked, not bạn)
  -- is skipped like an unknown id. A Nhóm needs 3 people counting the creator, at most 300.
  select coalesce(array_agg(distinct x), '{}') into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) x
  where x <> v_uid and exists (select 1 from public.profiles p where p.id = x)
    and not private.is_blocked_between (x, v_uid)
    and private.are_connected (x, v_uid);
  if coalesce(array_length(v_members, 1), 0) < 2 then raise exception 'avora_group_min_three'; end if;
  if array_length(v_members, 1) + 1 > 300 then raise exception 'avora_group_full'; end if;

  insert into public.conversations (type) values ('group') returning id into v_id;
  insert into public.conversation_groups (conversation_id, name, owner_id) values (v_id, v_name, v_uid);
  insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, v_uid, 'owner')
    on conflict do nothing;

  foreach m in array v_members loop
    -- AVORA-37 / A: a blocked pair is skipped exactly like an unknown id, so a new "group"
    -- of two cannot stand in for the 1-1 that is refused.
    if m <> v_uid and exists (select 1 from public.profiles p where p.id = m)
       and not private.is_blocked_between (m, v_uid) then
      insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, m, 'member')
        on conflict do nothing;
    end if;
  end loop;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_group_decision(p_conversation_id uuid, p_kind text, p_title text, p_body text DEFAULT ''::text, p_options text[] DEFAULT NULL::text[], p_decision_id uuid DEFAULT NULL::uuid)
 RETURNS group_decisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(p_decision_id, gen_random_uuid());
  v_kind text := btrim(coalesce(p_kind, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_grant uuid;
  v_opts text[];
  v_row public.group_decisions%rowtype;
  i integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_kind not in ('meeting_note','poll') then raise exception 'avora_decision_bad_kind'; end if;
  if v_title = '' then raise exception 'avora_decision_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_decision_title_max_len'; end if;
  if char_length(v_body) > 5000 then raise exception 'avora_decision_body_max_len'; end if;

  -- Retry safety: the client may replay the same generated id after a dropped connection.
  select * into v_row from public.group_decisions where id = v_id;
  if found then return v_row; end if;

  if not private.is_conversation_participant(p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.type = 'group') then
    raise exception 'avora_decision_group_only';
  end if;

  if v_kind = 'poll' then
    -- A poll with one answer is not a question.
    v_opts := array(select btrim(o) from unnest(coalesce(p_options, '{}'::text[])) o where btrim(o) <> '');
    if array_length(v_opts, 1) is null or array_length(v_opts, 1) < 2 then
      raise exception 'avora_decision_poll_needs_options';
    end if;
    if array_length(v_opts, 1) > 10 then raise exception 'avora_decision_poll_max_options'; end if;
  end if;

  -- Officers may always open one. Everyone else must spend a single-use permission, and the
  -- spending is what makes it single-use: the row is stamped in the same transaction.
  if not private.is_group_officer(p_conversation_id, v_uid) then
    select g.id into v_grant
    from public.group_decision_grants g
    where g.conversation_id = p_conversation_id
      and g.grantee_id = v_uid
      and g.kind = v_kind
      and g.used_at is null
    for update
    limit 1;

    if v_grant is null then raise exception 'avora_decision_not_allowed'; end if;
  end if;

  insert into public.group_decisions (id, conversation_id, kind, title, body, created_by, status)
  values (v_id, p_conversation_id, v_kind, v_title, v_body, v_uid,
          case when v_kind = 'poll' then 'open' else 'draft' end);

  if v_kind = 'poll' then
    for i in 1 .. array_length(v_opts, 1) loop
      insert into public.group_decision_options (decision_id, label, sort_order)
      values (v_id, left(v_opts[i], 120), i);
    end loop;
  end if;

  if v_grant is not null then
    update public.group_decision_grants
      set used_at = now(), used_decision_id = v_id
      where id = v_grant;
  end if;

  select * into v_row from public.group_decisions where id = v_id;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.create_habit(p_id uuid, p_name text, p_kind text, p_target_minutes integer, p_weekdays integer[], p_windows jsonb, p_reminders_on boolean, p_when_away text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_owner uuid;
begin
  perform private.assert_feature('habits');
  if v_uid is null or not private.session_allowed() then raise exception 'avora_not_signed_in' using errcode = '42501'; end if;
  if p_id is null then raise exception 'avora_habit_id' using errcode = '22023'; end if;
  select user_id into v_owner from public.habits where id = p_id;
  if v_owner = v_uid then return p_id; end if;
  if v_owner is not null then raise exception 'avora_habit_id' using errcode = '42501'; end if;
  if (select count(*) from public.habits where user_id = v_uid and archived_at is null) >= 50 then
    raise exception 'avora_habit_too_many' using errcode = '22023';
  end if;
  insert into public.habits (id, user_id, name, kind, target_minutes, weekdays, windows, reminders_on, when_away)
  values (p_id, v_uid, btrim(p_name), p_kind, case when p_kind = 'timed' then p_target_minutes end,
          coalesce((select array_agg(distinct d order by d) from unnest(p_weekdays) d), '{}'),
          private.habit_windows_clean(p_windows), coalesce(p_reminders_on, true),
          case when p_when_away = 'stop' then 'stop' else 'keep' end);
  return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_invite_code(p_code text, p_country text, p_partner text DEFAULT NULL::text, p_wave integer DEFAULT 0, p_locale text DEFAULT 'vi'::text, p_max_uses integer DEFAULT 50)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('invite_codes');
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  insert into public.invite_code (code, country, partner, wave, locale, max_uses)
  values (upper(btrim(p_code)), upper(btrim(p_country)), nullif(btrim(p_partner), ''), p_wave, p_locale, p_max_uses);
end $function$;

CREATE OR REPLACE FUNCTION public.create_meeting_note_task(p_decision_id uuid, p_item_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_details public.meeting_note_details%rowtype;
  v_pos int;
  v_item jsonb;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  select * into v_details from public.meeting_note_details where decision_id = p_decision_id;
  select t.ord - 1, t.value into v_pos, v_item
  from jsonb_array_elements(coalesce(v_details.action_items, '[]'::jsonb)) with ordinality as t(value, ord)
  where t.value->>'key' = p_item_key
  limit 1;
  if v_pos is null then raise exception 'avora_note_item_not_saved'; end if;

  v_item := private.sync_meeting_note_task (v_note, v_details.agenda_items, v_item, true, true);

  update public.meeting_note_details
    set action_items = jsonb_set(action_items, array[v_pos::text], v_item)
    where decision_id = p_decision_id;

  return (v_item->>'task_id')::uuid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_obligation_reminder_task(p_transaction_id uuid, p_title text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_txn public.transactions%rowtype;
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+—\s.*$', '')), 200);
  v_existing uuid;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_txn from public.transactions where id = p_transaction_id and user_id = v_uid;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if v_txn.type in ('income', 'expense') then raise exception 'avora_txn_not_an_obligation'; end if;
  if v_txn.deleted_at is not null then raise exception 'avora_txn_voided'; end if;
  if v_txn.due_date is null then raise exception 'avora_txn_due_date_required'; end if;
  if v_txn.amount_settled >= v_txn.amount then raise exception 'avora_txn_already_settled'; end if;
  if v_title = '' or v_title not like 'Đến hạn:%' then raise exception 'avora_reminder_bad_title'; end if;

  -- Pressing it twice gives the same task.
  select id into v_existing from public.tasks
  where source_transaction_id = p_transaction_id and creator_id = v_uid
  order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.tasks (type, creator_id, title, description, status, deadline_date, source_transaction_id)
  values ('personal', v_uid, v_title,
    v_title || E'\nTạo từ Két sắt. Việc tự hoàn tất khi khoản này được tất toán.',
    'confirmed', greatest(v_txn.due_date, current_date), p_transaction_id)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_obligation_transaction(p_type transaction_type, p_account_id uuid, p_amount numeric, p_due_date date, p_contact_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_transaction_date date DEFAULT NULL::date, p_tax_period_start date DEFAULT NULL::date, p_tax_period_end date DEFAULT NULL::date, p_business_related boolean DEFAULT false)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
begin
  perform private.assert_feature('finance');
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;
  if p_type not in ('vay', 'cho_vay', 'thue_ca_nhan', 'thue_kinh_doanh') then
    raise exception 'avora_txn_type_not_obligation';
  end if;
  if p_account_id is null then
    raise exception 'avora_txn_account_required';
  end if;
  if p_due_date is null then
    raise exception 'avora_txn_due_date_required';
  end if;
  if p_type in ('vay', 'cho_vay') and p_contact_id is null then
    raise exception 'avora_txn_contact_required';
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, type, amount, transaction_date,
    description, business_related, contact_id, due_date, status,
    amount_settled, tax_period_start, tax_period_end
  ) values (
    v_user, p_account_id, null, p_type, p_amount,
    coalesce(p_transaction_date, current_date),
    p_description, coalesce(p_business_related, false),
    case when p_type in ('vay', 'cho_vay') then p_contact_id else null end,
    p_due_date,
    case when p_due_date <= current_date then 'den_han' else 'ke_hoach' end,
    0, p_tax_period_start, p_tax_period_end
  ) returning * into v_row;

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.create_opportunity(p_contact_id uuid, p_title text, p_estimated_value numeric DEFAULT NULL::numeric)
 RETURNS crm_opportunity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact contact%ROWTYPE;
  v_row     crm_opportunity%ROWTYPE;
  v_title   text;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'Cơ hội cần một tiêu đề';
  END IF;

  IF p_estimated_value IS NOT NULL AND p_estimated_value < 0 THEN
    RAISE EXCEPTION 'Giá trị dự kiến không thể là số âm';
  END IF;

  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ đánh dấu được cơ hội trên liên hệ của chính bạn';
  END IF;

  INSERT INTO crm_opportunity (owner_user_id, contact_id, title, estimated_value)
  VALUES (auth.uid(), p_contact_id, v_title, p_estimated_value)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_project_task(p_project_id uuid, p_record_id uuid, p_task_id uuid, p_title text, p_description text, p_deadline date, p_assignee_id uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_context_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_task tasks%ROWTYPE;
BEGIN
  perform private.assert_feature('projects');
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT conversation_id INTO v_conversation FROM projects WHERE id = p_project_id;
  IF v_conversation IS NULL OR NOT private.is_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;

  -- Cùng đường tạo Task nhóm như trong chat: xác nhận hai bước, ngữ cảnh bất biến, mọi kiểm tra cũ.
  v_task := public.create_shared_task(
    v_conversation, 'group-shared', p_title, p_description, p_deadline, p_task_id,
    p_assignee_id, p_deadline_time, p_deadline_tz, NULL, false, 'none', NULL, p_context_snapshot
  );

  INSERT INTO project_tasks (task_id, project_id, record_id, linked_by)
  VALUES (v_task.id, p_project_id, p_record_id, v_uid)
  ON CONFLICT (task_id) DO UPDATE
    SET project_id = EXCLUDED.project_id, record_id = EXCLUDED.record_id, linked_by = EXCLUDED.linked_by;

  RETURN v_task;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_project(p_conversation_id uuid, p_title text, p_value_orientation text, p_objective text, p_start_date date, p_target_end_date date, p_scope text DEFAULT NULL::text, p_assumptions text DEFAULT NULL::text)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_parent conversations%ROWTYPE;
  v_role text;
  v_sub uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_value text := btrim(coalesce(p_value_orientation, ''));
  v_objective text := btrim(coalesce(p_objective, ''));
BEGIN
  perform private.assert_feature('projects');
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF v_title = '' THEN RAISE EXCEPTION 'avora_project_title_required'; END IF;
  IF v_value = '' THEN RAISE EXCEPTION 'avora_project_value_required'; END IF;
  IF v_objective = '' THEN RAISE EXCEPTION 'avora_project_objective_required'; END IF;
  IF p_start_date IS NULL OR p_target_end_date IS NULL THEN RAISE EXCEPTION 'avora_project_dates_required'; END IF;
  IF p_target_end_date < p_start_date THEN RAISE EXCEPTION 'avora_project_dates_order'; END IF;

  SELECT * INTO v_parent FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_parent.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_not_a_participant'; END IF;
  IF v_parent.type <> 'group' THEN RAISE EXCEPTION 'avora_project_group_only'; END IF;

  SELECT role INTO v_role FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'avora_not_a_participant'; END IF;
  IF v_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'avora_group_sub_not_allowed'; END IF;
  IF v_parent.group_depth >= 3 THEN RAISE EXCEPTION 'avora_group_depth_limit'; END IF;

  -- Nhóm con riêng của dự án: người mở là Owner, mọi thành viên hiện tại của nhóm cha vào theo.
  INSERT INTO conversations (type, parent_group_id) VALUES ('group', p_conversation_id) RETURNING id INTO v_sub;
  INSERT INTO conversation_groups (conversation_id, name, owner_id) VALUES (v_sub, left(v_title, 120), v_uid);
  INSERT INTO conversation_participants (conversation_id, user_id, role)
  SELECT v_sub, cp.user_id, CASE WHEN cp.user_id = v_uid THEN 'owner' ELSE 'member' END
  FROM conversation_participants cp WHERE cp.conversation_id = p_conversation_id
  ON CONFLICT DO NOTHING;

  INSERT INTO projects (
    conversation_id, created_by, title, value_orientation, objective,
    start_date, target_end_date, scope, assumptions
  ) VALUES (
    v_sub, v_uid, v_title, v_value, v_objective, p_start_date, p_target_end_date,
    nullif(btrim(coalesce(p_scope, '')), ''), nullif(btrim(coalesce(p_assumptions, '')), '')
  )
  RETURNING * INTO v_project;

  INSERT INTO think_hub_table (owner_user_id, name, project_id, position)
  VALUES (v_uid, v_title, v_project.id, 0);

  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_record_task(p_record_id uuid, p_task_id uuid, p_title text, p_description text, p_deadline date, p_assignee_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_rec   think_hub_record%ROWTYPE;
  v_table think_hub_table%ROWTYPE;
  v_conv_type text;
  v_task  tasks%ROWTYPE;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc  text := btrim(coalesce(p_description, ''));
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_rec FROM think_hub_record WHERE id = p_record_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(v_rec.table_id, v_uid) THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;
  SELECT * INTO v_table FROM think_hub_table WHERE id = v_rec.table_id;
  IF v_table.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'avora_think_hub_record_is_project';
  END IF;
  IF v_table.conversation_id IS NOT NULL THEN
    SELECT type INTO v_conv_type FROM conversations WHERE id = v_table.conversation_id;
  END IF;

  -- Personal: a private Bảng, or "Cho tôi" on a 1-1 Bảng (the other person does not see it).
  IF v_table.conversation_id IS NULL OR (v_conv_type = 'direct' AND p_assignee_id = v_uid) THEN
    IF v_title = '' THEN RAISE EXCEPTION 'avora_task_title_blank'; END IF;
    IF char_length(v_title) > 200 THEN RAISE EXCEPTION 'avora_task_title_max_len'; END IF;
    INSERT INTO tasks (
      id, type, creator_id, title, description, status, deadline_date, deadline_time, deadline_tz,
      is_important, recurrence
    ) VALUES (
      p_task_id, 'personal', v_uid, v_title, v_desc, 'confirmed', p_deadline, p_deadline_time,
      coalesce(nullif(btrim(coalesce(p_deadline_tz, '')), ''), 'Asia/Ho_Chi_Minh'), false, 'none'
    )
    RETURNING * INTO v_task;
  ELSE
    v_task := public.create_shared_task(
      v_table.conversation_id,
      CASE WHEN v_conv_type = 'group' THEN 'group-shared' ELSE '1-1-shared' END,
      p_title, p_description, p_deadline, p_task_id, p_assignee_id, p_deadline_time, p_deadline_tz,
      NULL, false, 'none', NULL,
      jsonb_build_object(
        'conversation_type', v_conv_type,
        'conversation_id', v_table.conversation_id,
        'conversation_name', v_table.name,
        'original_message_id', NULL,
        'original_message_text', '',
        'original_message_sender_id', NULL,
        'original_message_sender_name', '',
        'original_message_created_at', NULL,
        'user_response', 'Từ Hạng mục: ' || v_rec.title,
        'snapshot_created_at', now()
      )
    );
  END IF;

  INSERT INTO think_hub_record_tasks (task_id, record_id, linked_by)
  VALUES (v_task.id, p_record_id, v_uid);

  RETURN v_task;
END;
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
  perform private.assert_feature('tasks');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_type not in ('1-1-shared', 'group-shared') then raise exception 'avora_task_not_shared'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;

  -- AVORA-39 Phần 3 (VMT 28/09): Ghi chú is optional; the name and the deadline are what a task needs.
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

CREATE OR REPLACE FUNCTION public.create_sub_group(p_parent_group_id uuid, p_name text, p_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
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
  perform private.assert_session_allowed();
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

CREATE OR REPLACE FUNCTION public.create_task_suggestion(p_conversation_id uuid, p_assignee_id uuid, p_title text, p_description text, p_deadline date, p_context_snapshot jsonb, p_suggestion_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_requires_presence boolean DEFAULT false, p_record_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := coalesce(p_suggestion_id, gen_random_uuid());
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
  v_conv_type text;
  v_snapshot_conv uuid;
  v_table public.think_hub_table%rowtype;
  v_row public.task_suggestions%rowtype;
  v_self boolean;
  k text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  -- Ghi chú is optional (VMT 28/09); only its length is bounded.
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;
  if (p_end_at is not null or v_location is not null or v_presence) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;
  if p_end_at is not null and p_end_at < p_start_at then raise exception 'avora_event_end_before_start'; end if;
  if v_location is not null and char_length(v_location) > 300 then raise exception 'avora_task_location_max_len'; end if;

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
  -- AVORA-37 + AVORA-38: blocked / not bạn / verification frame → refused here, as before.
  perform private.assert_direct_talk (p_conversation_id, v_uid, 'rich');

  if coalesce(p_context_snapshot->>'conversation_type', '') is distinct from v_conv_type then
    raise exception 'avora_context_snapshot_type_mismatch';
  end if;

  if p_assignee_id is null then raise exception 'avora_task_assignee_required'; end if;
  v_self := (p_assignee_id = v_uid);
  if v_self and v_conv_type <> 'group' then raise exception 'avora_task_self_assign'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_assignee_id
  ) then
    raise exception 'avora_task_assignee_not_participant';
  end if;
  -- Groups: "Cả nhóm" / "Chọn người" never reach someone blocked with the proposer.
  if not v_self and private.is_blocked_between (v_uid, p_assignee_id) then
    raise exception 'avora_contact_unavailable';
  end if;

  if p_message_id is not null and not exists (
    select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_context_snapshot_foreign_conversation';
  end if;

  -- Where it will be filed once accepted: a project of THIS group, a Hạng mục the proposer can see
  -- on a board of this conversation (or of that project).
  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.conversation_id = p_conversation_id and p.deleted_at is null
  ) then
    raise exception 'avora_project_missing';
  end if;
  if p_record_id is not null then
    select t.* into v_table
    from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.deleted_at is null;
    if not found or not private.think_hub_table_visible (v_table.id, v_uid) then
      raise exception 'avora_think_hub_record_not_yours';
    end if;
    if (p_project_id is not null and v_table.project_id is distinct from p_project_id)
       or (p_project_id is null and v_table.conversation_id is distinct from p_conversation_id) then
      raise exception 'avora_think_hub_record_foreign';
    end if;
  end if;

  insert into public.task_suggestions (
    id, conversation_id, message_id, proposer_id, assignee_id,
    proposed_title, proposed_description, proposed_deadline,
    proposed_deadline_time, proposed_deadline_tz, context_snapshot, status,
    proposed_start_at, proposed_end_at, proposed_location, proposed_requires_presence,
    proposed_record_id, proposed_project_id
  )
  values (
    v_id, p_conversation_id, p_message_id, v_uid, p_assignee_id,
    v_title, v_description, p_deadline,
    p_deadline_time, v_tz, p_context_snapshot, 'pending',
    p_start_at, p_end_at, v_location, v_presence,
    p_record_id, p_project_id
  )
  on conflict (id) do nothing;

  if v_self then
    perform public.accept_task_suggestion(v_id, gen_random_uuid());
  end if;

  select * into v_row from public.task_suggestions where id = v_id;
  return v_row;
end;
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
  perform private.assert_feature('think_hub');
  perform private.assert_session_allowed();
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

  IF v_table.conversation_id IS DISTINCT FROM p_scope_conversation_id
     OR v_table.project_id IS DISTINCT FROM p_scope_project_id THEN
    RAISE EXCEPTION 'avora_think_hub_table_out_of_scope';
  END IF;

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
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_table.status_options->0->>'key', 'moi'),
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
  v_sub      think_hub_template%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
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
  PERFORM private.assert_direct_talk(v_parent.conversation_id, v_user, 'rich');
  IF v_parent.depth >= 3 THEN
    RAISE EXCEPTION 'avora_think_hub_depth_limit';
  END IF;

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

  IF v_parent.source_template_key IS NOT NULL THEN
    SELECT s.* INTO v_sub FROM think_hub_template t JOIN think_hub_template s ON s.key = t.sub_template_key
    WHERE t.key = v_parent.source_template_key;
    IF FOUND THEN
      v_row := private.apply_structure_to_table(v_row.id, v_sub.column_defs, v_sub.status_options, v_sub.title_label,
        v_sub.default_view, v_sub.mobile_columns, v_sub.key, v_sub.version, null);
    END IF;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_think_hub_table_from_template(p_template_key text, p_user_template_id uuid, p_conversation_id uuid, p_name text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_tpl think_hub_template%rowtype;
  v_mine think_hub_user_template%rowtype;
  v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if (p_template_key is null) = (p_user_template_id is null) then
    raise exception 'avora_template_source_required';
  end if;

  if p_template_key is not null then
    select * into v_tpl from think_hub_template where key = p_template_key and is_active;
    if not found then raise exception 'avora_template_missing'; end if;
    if v_tpl.key = 'reading' then raise exception 'avora_template_bookshelf_only'; end if;
  else
    select * into v_mine from think_hub_user_template where id = p_user_template_id and owner_user_id = v_user;
    if not found then raise exception 'avora_template_missing'; end if;
  end if;

  -- Same scope and permission rules as a blank table: one path, not a second copy of the rules.
  v_row := public.create_think_hub_table(
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), coalesce(v_tpl.name, v_mine.name)),
    coalesce(v_tpl.guiding_question, v_mine.guiding_question),
    p_conversation_id);

  if p_template_key is not null then
    v_row := private.apply_structure_to_table(v_row.id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
      v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, null);
  else
    v_row := private.apply_structure_to_table(v_row.id, v_mine.column_defs, v_mine.status_options, v_mine.title_label,
      v_mine.default_view, v_mine.mobile_columns, null, null, null);
  end if;
  return v_row;
end $function$;

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
  perform private.assert_feature('think_hub');
  perform private.assert_session_allowed();
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

CREATE OR REPLACE FUNCTION public.currency_rate_at(p_from text, p_to text, p_on date DEFAULT CURRENT_DATE)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  from_code text := upper(btrim(coalesce(p_from, '')));
  to_code   text := upper(btrim(coalesce(p_to, '')));
  on_date   date := coalesce(p_on, current_date);
  r numeric;
  leg_in numeric;
  leg_out numeric;
begin
  perform private.assert_session_allowed();
  if from_code = '' or to_code = '' then return null; end if;
  if from_code = to_code then return 1; end if;

  -- 2. direct
  select cr.rate into r from public.currency_rates cr
   where cr.from_currency = from_code and cr.to_currency = to_code and cr.rate_date <= on_date
   order by cr.rate_date desc limit 1;
  if r is null then
    select cr.rate into r from public.currency_rates cr
     where cr.from_currency = from_code and cr.to_currency = to_code
     order by cr.rate_date asc limit 1;
  end if;
  if r is not null then return r; end if;

  -- 3. reverse, inverted
  select cr.rate into r from public.currency_rates cr
   where cr.from_currency = to_code and cr.to_currency = from_code and cr.rate_date <= on_date
   order by cr.rate_date desc limit 1;
  if r is null then
    select cr.rate into r from public.currency_rates cr
     where cr.from_currency = to_code and cr.to_currency = from_code
     order by cr.rate_date asc limit 1;
  end if;
  if r is not null and r > 0 then return 1.0 / r; end if;

  -- 4. through the anchor
  if from_code <> 'USD' and to_code <> 'USD' then
    leg_in  := public.currency_rate_at(from_code, 'USD', on_date);
    leg_out := public.currency_rate_at('USD', to_code, on_date);
    if leg_in is not null and leg_out is not null then
      return leg_in * leg_out;
    end if;
  end if;

  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.decline_verification(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.conversations%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  select * into v_row from public.conversations where id = p_conversation_id;
  if v_row.verification_status is distinct from 'pending' then return; end if;

  update public.conversations
  set verification_status = 'closed', verification_resolved_at = now()
  where id = p_conversation_id;

  if v_row.verification_via_group_id is not null and v_row.verification_opened_by is not null
     and v_row.verification_opened_by <> v_uid then
    insert into private.verification_declines (decliner_id, opener_id)
    values (v_uid, v_row.verification_opened_by)
    on conflict (decliner_id, opener_id) do update set declined_at = now();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.default_finance_categories()
 RETURNS TABLE(slug text, name text, applies_to category_scope, color text, sort_order integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  values
    ('salary',        'Lương',            'income'::public.category_scope,  '#3F8F6B', 10),
    ('farming',       'Nông nghiệp',      'income'::public.category_scope,  '#7D8A4F', 20),
    ('rental',        'Cho thuê',         'income'::public.category_scope,  '#5B7B8A', 30),
    ('freelance',     'Làm tự do',        'income'::public.category_scope,  '#C98A3E', 40),
    ('gifts',         'Quà tặng',         'income'::public.category_scope,  '#8C6A4A', 50),
    ('other_income',  'Thu nhập khác',    'income'::public.category_scope,  '#6B635A', 60),
    ('groceries',     'Tạp hoá',          'expense'::public.category_scope, '#E0603C', 10),
    ('dining',        'Ăn uống',          'expense'::public.category_scope, '#D68A6F', 20),
    ('transport',     'Đi lại',           'expense'::public.category_scope, '#5B7B8A', 30),
    ('healthcare',    'Y tế',             'expense'::public.category_scope, '#C0492A', 40),
    ('education',     'Giáo dục',         'expense'::public.category_scope, '#7D8A4F', 50),
    ('tithe',         'Dâng phần mười',   'expense'::public.category_scope, '#3F8F6B', 60),
    ('giving',        'Từ thiện',         'expense'::public.category_scope, '#6FA98B', 70),
    ('investment',    'Đầu tư',           'expense'::public.category_scope, '#4E6E7D', 80),
    ('debt',          'Trả nợ',           'expense'::public.category_scope, '#8C6A4A', 90),
    ('business',      'Kinh doanh',       'expense'::public.category_scope, '#C98A3E', 100),
    ('personal',      'Cá nhân',          'expense'::public.category_scope, '#A8926F', 110),
    ('other_expense', 'Chi khác',         'expense'::public.category_scope, '#6B635A', 120)
$function$;

CREATE OR REPLACE FUNCTION public.delete_1_1_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_is_creator boolean;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared'
  for update;
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  v_is_creator := v_uid = v_row.creator_id;

  -- The person doing the work cannot make unfinished work disappear. Only a task the creator
  -- has confirmed finished is theirs to clear.
  if (not v_is_creator) and v_row.status <> 'done' then
    raise exception 'avora_task_assignee_delete_requires_done';
  end if;

  -- Nobody has accepted the request yet, so there is no shared history to preserve and no
  -- second party whose copy would vanish: withdrawing it removes it.
  if v_is_creator and v_row.status = 'pending_confirmation' then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  -- The other side has already let go: with both bins full the row has no owner left.
  if (v_is_creator and v_row.deleted_by_peer) or ((not v_is_creator) and v_row.deleted_by_creator) then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  -- Already in this person's bin: a retry is a no-op success, never a second delete.
  if (v_is_creator and v_row.deleted_by_creator) or ((not v_is_creator) and v_row.deleted_by_peer) then
    return v_row;
  end if;

  update public.tasks
  set deleted_by_creator = (case when v_is_creator then true else deleted_by_creator end),
      deleted_by_peer = (case when v_is_creator then deleted_by_peer else true end),
      updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_journal_messages(p_message_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_n integer := 0;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_message_ids, 1) > 200 then raise exception 'avora_delete_too_many'; end if;
  if exists (
    select 1 from messages m join conversations c on c.id = m.conversation_id
    where m.id = any (p_message_ids) and (m.sender_id <> v_uid or c.type <> 'personal')
  ) then
    raise exception 'avora_delete_not_allowed';
  end if;
  update messages m set trashed_at = now()
  from conversations c
  where c.id = m.conversation_id and c.type = 'personal' and m.sender_id = v_uid
    and m.id = any (p_message_ids) and m.trashed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_note_folder(p_folder_id uuid, p_trash_notes boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v note_folders%rowtype; v_n integer; v_ids uuid[];
begin
  perform private.assert_session_allowed();
  select * into v from note_folders where id = p_folder_id and owner_user_id = auth.uid() for update;
  if not found then raise exception 'avora_note_folder_missing'; end if;
  if v.is_system then raise exception 'avora_note_folder_system'; end if;

  with recursive sub(id) as (
    select v.id
    union all
    select f.id from note_folders f join sub on f.parent_id = sub.id where f.owner_user_id = v.owner_user_id
  )
  select array_agg(id) into v_ids from sub;

  if coalesce(p_trash_notes, false) then
    update notes set deleted_at = now(), folder_id = null where folder_id = any (v_ids) and deleted_at is null;
  else
    update notes set folder_id = null where folder_id = any (v_ids);
  end if;
  get diagnostics v_n = row_count;
  delete from note_folders where id = v.id;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_project_success_criterion(p_criterion_id uuid)
 RETURNS project_success_criteria
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM project_success_criteria WHERE id = p_criterion_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.project_owned_by(v_row.project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = v_row.project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  -- Xoá mềm: lịch sử những gì từng được hứa vẫn còn đó.
  UPDATE project_success_criteria SET deleted_at = now()
  WHERE id = p_criterion_id RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_project(p_project_id uuid, p_confirm_title text, p_reason text)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_shared_needs_proposal';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;

  PERFORM private.post_system_line(v_project.conversation_id, v_uid, 'project_deleted',
    format('Dự án %s đã bị xoá theo đề nghị — Lý do: %s', v_project.title, v_reason));

  UPDATE projects SET deleted_at = now(), deleted_by = v_uid, delete_reason = v_reason
  WHERE id = p_project_id RETURNING * INTO v_project;
  UPDATE conversations SET deleted_at = now() WHERE id = v_project.conversation_id AND deleted_at IS NULL;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n integer;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  delete from push_subscriptions where endpoint = btrim(p_endpoint) and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_shared_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_is_creator boolean;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared')
  for update;
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  v_is_creator := v_uid = v_row.creator_id;

  if (not v_is_creator) and (not public.is_task_assignee(v_row, v_uid)) then
    raise exception 'avora_task_not_assignee';
  end if;

  -- The person doing the work cannot make open work disappear — but work that can no longer move
  -- (done, skipped, the requester gone / blocked / disconnected, the room or project closed) is
  -- theirs to clear (Đợt gộp 2 · D4: no dead ends).
  if (not v_is_creator) and private.task_closed_reason(v_row, v_uid) is null then
    raise exception 'avora_task_assignee_delete_requires_done';
  end if;

  if v_is_creator and v_row.status = 'pending_confirmation' then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  if (v_is_creator and v_row.deleted_by_peer) or ((not v_is_creator) and v_row.deleted_by_creator) then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  if (v_is_creator and v_row.deleted_by_creator) or ((not v_is_creator) and v_row.deleted_by_peer) then
    return v_row;
  end if;

  update public.tasks
  set deleted_by_creator = (case when v_is_creator then true else deleted_by_creator end),
      deleted_by_peer = (case when v_is_creator then deleted_by_peer else true end),
      updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_think_hub_column(p_table_id uuid, p_column_id text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user   uuid := auth.uid();
  v_row    think_hub_table%rowtype;
  v_def    jsonb;
  v_key    text;
  v_values jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  -- Only the board's owner deletes a column; members propose it in the conversation.
  select * into v_row from think_hub_table
  where id = p_table_id and owner_user_id = v_user and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  select d into v_def from jsonb_array_elements(v_row.column_defs) d where d->>'id' = p_column_id;
  if v_def is null then raise exception 'avora_think_hub_column_missing'; end if;
  v_key := v_def->>'key';

  -- The values travel with the column into the bin, so a later edit of a record (which rewrites
  -- its extension fields) cannot lose them.
  select coalesce(jsonb_object_agg(r.id::text, r.extension_fields->v_key), '{}'::jsonb) into v_values
  from think_hub_record r
  where r.table_id = p_table_id and r.extension_fields ? v_key
    and jsonb_typeof(r.extension_fields->v_key) <> 'null';

  perform set_config('avora.column_reshape', 'on', true);
  update think_hub_table
  set column_defs = coalesce((
        select jsonb_agg(d order by ord)
        from jsonb_array_elements(v_row.column_defs) with ordinality as e(d, ord)
        where d->>'id' <> p_column_id), '[]'::jsonb),
      column_trash = coalesce((
        select jsonb_agg(t) from jsonb_array_elements(v_row.column_trash) t
        where (t->>'deleted_at')::timestamptz > now() - interval '30 days'), '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'def', v_def, 'deleted_at', now(), 'deleted_by', v_user, 'values', v_values))
  where id = p_table_id
  returning * into v_row;
  perform set_config('avora.column_reshape', 'off', true);
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  UPDATE think_hub_record r SET deleted_at = now()
  WHERE r.id = p_record_id AND r.deleted_at IS NULL
    AND private.think_hub_table_visible(r.table_id, v_user)
    AND (r.owner_user_id = v_user
         OR EXISTS (SELECT 1 FROM think_hub_table t WHERE t.id = r.table_id AND t.owner_user_id = v_user))
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.project_id is not null and v_row.parent_record_id is null then
    raise exception 'avora_think_hub_project_root_locked';
  end if;
  if v_row.kind = 'bookshelf' then raise exception 'avora_bookshelf_locked'; end if;
  -- ADR-031: a shared table is never deleted by one person; only an approved proposal gets here.
  if (v_row.conversation_id is not null or v_row.project_id is not null) then
    if coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
      raise exception 'avora_shared_needs_proposal';
    end if;
  elsif v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;

  perform private.cascade_table_tasks(p_table_id);
  update think_hub_table set deleted_at = now() where id = p_table_id returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_user_template(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  delete from think_hub_user_template where id = p_id and owner_user_id = auth.uid();
  if not found then raise exception 'avora_template_missing'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.detach_contact_channel(p_contact_id uuid, p_kind text, p_value text)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact  contact%ROWTYPE;
  v_result   contact%ROWTYPE;
  v_norm     text;
  v_primary  text;
  v_holds    boolean;
  v_other    text;
  v_promoted contact_channel%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_kind NOT IN ('phone', 'email') THEN
    RAISE EXCEPTION 'Loại kênh phải là phone hoặc email';
  END IF;

  v_norm := private.normalize_channel(p_kind, p_value);
  IF btrim(coalesce(v_norm, '')) = '' THEN
    RAISE EXCEPTION 'Kênh liên hệ không được để trống';
  END IF;

  -- SECURITY DEFINER bỏ qua RLS, nên quyền sở hữu phải tự kiểm: p_contact_id
  -- đến từ client và không được tin. Không có dòng này, một người dọn kênh
  -- dùng chung của mình sẽ xoá được số trong danh bạ của người khác.
  SELECT * INTO v_contact FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_contact.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được sửa kênh liên hệ của liên hệ này';
  END IF;

  v_primary := private.normalize_channel(
    p_kind,
    CASE WHEN p_kind = 'phone' THEN v_contact.phone ELSE v_contact.email END
  );

  v_holds := (v_primary = v_norm) OR EXISTS (
    SELECT 1 FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_norm
  );

  -- Liên hệ này không giữ giá trị đó thì coi như xong, không phải lỗi: dọn một
  -- kênh dùng chung là nhiều lần bỏ liên tiếp, và bấm lại một bước đã xong
  -- không có gì sai để báo.
  IF NOT v_holds THEN
    RETURN v_contact;
  END IF;

  DELETE FROM contact_channel
  WHERE contact_id = p_contact_id AND kind = p_kind AND value_normalized = v_norm;

  -- Ô kênh chính vừa trống mà liên hệ còn số khác cùng loại thì số đó lên thay,
  -- theo đúng luật "kênh đầu tiên mỗi loại là kênh chính" mà nhập hàng loạt
  -- đang dùng.
  IF v_primary = v_norm THEN
    SELECT * INTO v_promoted FROM contact_channel
    WHERE contact_id = p_contact_id AND kind = p_kind
    ORDER BY created_at, id
    LIMIT 1;

    IF FOUND THEN
      DELETE FROM contact_channel WHERE id = v_promoted.id;
    END IF;

    IF p_kind = 'phone' THEN
      UPDATE contact SET phone = v_promoted.value WHERE id = p_contact_id
      RETURNING * INTO v_contact;
    ELSE
      UPDATE contact SET email = v_promoted.value WHERE id = p_contact_id
      RETURNING * INTO v_contact;
    END IF;
  END IF;

  -- Nếu đến đây mà CẢ HAI ô kênh chính đều trống trong khi liên hệ vẫn còn một
  -- kênh phụ loại khác, thì kênh đó lên thay. Không làm bước này sẽ sinh ra một
  -- liên hệ mà create_contact / update_contact đều coi là không hợp lệ: mọi lần
  -- sửa về sau bị chính chúng từ chối, dù trên màn hình vẫn thấy một email nằm
  -- đó. Chỉ chạm tới ô của loại khác khi nó đang trống, nên không ghi đè gì.
  IF btrim(coalesce(v_contact.phone, '')) = '' AND btrim(coalesce(v_contact.email, '')) = '' THEN
    SELECT * INTO v_promoted FROM contact_channel
    WHERE contact_id = p_contact_id
    ORDER BY created_at, id
    LIMIT 1;

    IF FOUND THEN
      DELETE FROM contact_channel WHERE id = v_promoted.id;

      IF v_promoted.kind = 'phone' THEN
        UPDATE contact SET phone = v_promoted.value WHERE id = p_contact_id
        RETURNING * INTO v_contact;
      ELSE
        UPDATE contact SET email = v_promoted.value WHERE id = p_contact_id
        RETURNING * INTO v_contact;
      END IF;
    END IF;
  END IF;

  -- Đo bằng đúng thước của create_contact / update_contact, không phải bằng
  -- "còn hàng nào trong bảng kênh không". RAISE ở đây cuộn lại toàn bộ những
  -- gì phía trên vừa làm, nên liên hệ không bao giờ ở lại trạng thái nửa vời.
  IF v_contact.contact_type = 'individual' THEN
    IF btrim(coalesce(v_contact.phone, '')) = '' AND btrim(coalesce(v_contact.email, '')) = '' THEN
      RAISE EXCEPTION 'Đây là cách liên lạc duy nhất của liên hệ này, không bỏ được';
    END IF;
  ELSE
    IF btrim(coalesce(v_contact.phone, '')) = ''
       AND btrim(coalesce(v_contact.email, '')) = ''
       AND btrim(coalesce(v_contact.representative_phone, '')) = ''
       AND btrim(coalesce(v_contact.representative_email, '')) = '' THEN
      RAISE EXCEPTION 'Đây là cách liên lạc duy nhất của liên hệ này, không bỏ được';
    END IF;
  END IF;

  SELECT * INTO v_result FROM contact WHERE id = p_contact_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.device_action_info(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_t private.device_action_tokens%rowtype; v_label text;
begin
  select * into v_t from private.device_action_tokens where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_t.id is null or v_t.kind = 'rank_claim_code' then return jsonb_build_object('status', 'invalid'); end if;
  if v_t.used_at is not null then return jsonb_build_object('status', 'used', 'kind', v_t.kind); end if;
  if v_t.expires_at < now() then return jsonb_build_object('status', 'expired', 'kind', v_t.kind); end if;
  select label into v_label from public.account_devices where user_id = v_t.user_id and device_id = v_t.device_id;
  return jsonb_build_object('status', 'open', 'kind', v_t.kind, 'label', v_label,
    'when', private.local_when(v_t.user_id, v_t.created_at), 'expires_at', v_t.expires_at,
    'claimer', (select label from public.account_devices where id = (v_t.meta ->> 'claimer')::uuid));
end $function$;

CREATE OR REPLACE FUNCTION public.device_action(p_token text, p_choice text, p_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_t private.device_action_tokens%rowtype; v_dev public.account_devices%rowtype; v_hash text;
begin
  select * into v_t from private.device_action_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and kind <> 'rank_claim_code' for update;
  if v_t.id is null then raise exception 'avora_device_token'; end if;
  if v_t.used_at is not null then raise exception 'avora_device_token_used'; end if;
  if v_t.expires_at < now() then raise exception 'avora_device_token_expired'; end if;
  if v_t.kind = 'lost_confirm' then
    select * into v_dev from public.account_devices where user_id = v_t.user_id and device_id = v_t.device_id;
    perform private.resolve_lost(v_dev.id, p_choice);
  elsif v_t.kind = 'not_me_rank' then
    if p_choice <> 'not_me_rank' then raise exception 'avora_device_choice'; end if;
    if v_t.attempts >= 5 then raise exception 'avora_password_check_rate'; end if;
    update private.device_action_tokens set attempts = attempts + 1 where id = v_t.id;
    select encrypted_password into v_hash from auth.users where id = v_t.user_id;
    if coalesce(v_hash, '') = '' or extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
      return jsonb_build_object('ok', false, 'reason', 'password');
    end if;
    select * into v_dev from public.account_devices where id = (v_t.meta ->> 'claimer')::uuid;
    if v_dev.id is not null then
      update public.account_devices set rank = 3, revoked_at = now() where id = v_dev.id;
      perform private.block_sessions(v_t.user_id, array[v_dev.session_id], 'not_me_rank');
      perform private.on_device_removed(v_dev.id);
    end if;
    update public.account_devices set rank = (v_t.meta ->> 'rank')::smallint
    where id = (v_t.meta ->> 'old')::uuid and revoked_at is null
      and not exists (select 1 from public.account_devices o where o.user_id = v_t.user_id and o.rank = (v_t.meta ->> 'rank')::smallint and o.revoked_at is null);
  elsif v_t.kind = 'lock_escape' then
    if p_choice <> 'cancel_escape' then raise exception 'avora_device_choice'; end if;
    update public.account_device_lock set unlock_requested_at = null where user_id = v_t.user_id;
  end if;
  update private.device_action_tokens set used_at = now() where id = v_t.id;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.device_bind(p_user uuid, p_session uuid, p_device_id uuid, p_public_key text, p_nonce text, p_label text, p_kind text, p_guest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dev public.account_devices%rowtype; v_is_new boolean := false; v_had_any boolean; v_challenge bigint;
  v_label text := left(coalesce(nullif(btrim(p_label), ''), 'Thiết bị'), 60);
  v_kind text := case when p_kind in ('phone', 'tablet', 'computer') then p_kind else 'unknown' end;
begin
  delete from private.device_challenges
  where id = (select id from private.device_challenges
              where user_id = p_user and device_id = p_device_id and nonce = decode(p_nonce, 'base64') and expires_at > now() limit 1)
  returning id into v_challenge;
  if v_challenge is null then raise exception 'avora_device_challenge'; end if;
  if p_session is null then raise exception 'avora_device_unbound'; end if;
  if exists (select 1 from private.blocked_sessions where session_id = p_session) then raise exception 'avora_session_not_allowed'; end if;

  update public.account_devices set session_id = null where session_id = p_session and device_id <> p_device_id;
  select * into v_dev from public.account_devices where user_id = p_user and device_id = p_device_id;
  if v_dev.id is not null then
    if v_dev.device_public_key <> p_public_key then raise exception 'avora_device_key_mismatch'; end if;
    update public.account_devices set
      session_id = p_session, last_seen_at = now(),
      -- A removed device that signs in again starts over as Máy khác; a pending report stays.
      rank = case when revoked_at is not null or lost_status = 'confirmed' then 3 else rank end,
      lost_status = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_status end,
      lost_deadline = case when revoked_at is not null or lost_status = 'confirmed' then null else lost_deadline end,
      revoked_at = null
    where id = v_dev.id returning * into v_dev;
  else
    select exists (select 1 from public.account_devices where user_id = p_user and not guest) into v_had_any;
    insert into public.account_devices (user_id, device_id, device_public_key, label, kind, guest, session_id)
    values (p_user, p_device_id, p_public_key, v_label, v_kind, coalesce(p_guest, false), p_session)
    returning * into v_dev;
    v_is_new := true;
    if v_had_any then
      perform private.device_notify(p_user, jsonb_build_object('action', 'new', 'label', v_label),
        'Có máy mới đăng nhập: ' || v_label || '. Không phải bạn? Mở Hồ sơ › Bảo mật.');
    end if;
  end if;
  return jsonb_build_object('device', v_dev.id, 'rank', v_dev.rank, 'is_new', v_is_new);
end $function$;

CREATE OR REPLACE FUNCTION public.device_challenge(p_device_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_nonce bytea := extensions.gen_random_bytes(32);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from private.device_challenges where expires_at < now();
  if (select count(*) from private.device_challenges where user_id = v_uid) >= 20 then raise exception 'avora_device_rate'; end if;
  insert into private.device_challenges (user_id, device_id, nonce) values (v_uid, p_device_id, v_nonce);
  return encode(v_nonce, 'base64');
end $function$;

CREATE OR REPLACE FUNCTION public.device_key_for(p_user uuid, p_device_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select device_public_key from public.account_devices where user_id = p_user and device_id = p_device_id
$function$;

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
  elsif v_lock.user_id is not null and (v_dev.id is null or (v_lock.locked_rank = 1 and v_dev.rank <> 1) or (v_lock.locked_rank = 2 and v_dev.rank = 3)) then
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

CREATE OR REPLACE FUNCTION public.dismiss_contact_duplicate(p_a uuid, p_b uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if (select count(*) from public.contact where id in (p_a, p_b) and owner_user_id = v_uid) <> 2 then raise exception 'avora_contact_not_found'; end if;
  insert into private.contact_not_duplicate (owner_user_id, contact_a, contact_b) values (v_uid, least(p_a, p_b), greatest(p_a, p_b))
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.dismiss_contact_link(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_match record;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then return; end if;

  update public.contact
    set link_suggestion_dismissed = private.contact_link_fingerprint (p_contact_id, v_match.user_id)
    where id = p_contact_id and owner_user_id = v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_think_hub_nudge(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update think_hub_nudges set seen_at = now() where id = p_id and user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_content text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.edit_task_suggestion(p_suggestion_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_requires_presence boolean DEFAULT false)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_tz text := coalesce(nullif(btrim(p_deadline_tz), ''), 'Asia/Ho_Chi_Minh');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_task_title_blank'; end if;
  if char_length(v_title) > 200 then raise exception 'avora_task_title_max_len'; end if;
  if char_length(v_description) > 2000 then raise exception 'avora_task_description_max_len'; end if;
  if p_deadline is null then raise exception 'avora_task_deadline_required'; end if;
  if p_deadline < current_date then raise exception 'avora_task_deadline_past'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;
  if (p_end_at is not null or v_location is not null or v_presence) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;
  if p_end_at is not null and p_end_at < p_start_at then raise exception 'avora_event_end_before_start'; end if;
  if v_location is not null and char_length(v_location) > 300 then raise exception 'avora_task_location_max_len'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;
  if v_s.proposer_id <> v_uid then raise exception 'avora_task_not_proposer'; end if;
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  perform private.assert_direct_talk (v_s.conversation_id, v_uid, 'rich');
  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  update public.task_suggestions
  set proposed_title = v_title,
      proposed_description = v_description,
      proposed_deadline = p_deadline,
      proposed_deadline_time = p_deadline_time,
      proposed_deadline_tz = v_tz,
      proposed_start_at = p_start_at,
      proposed_end_at = p_end_at,
      proposed_location = v_location,
      proposed_requires_presence = v_presence
  where id = p_suggestion_id
  returning * into v_s;

  return v_s;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_account_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'avora_account_name_required';
  end if;
  if length(new.name) > 120 then
    raise exception 'avora_account_name_max_len';
  end if;

  new.other_person_name := nullif(btrim(coalesce(new.other_person_name, '')), '');
  new.account_number := nullif(btrim(coalesce(new.account_number, '')), '');
  new.currency := upper(btrim(coalesce(nullif(new.currency, ''), 'USD')));

  if not exists (select 1 from public.currencies c where c.code = new.currency) then
    raise exception 'avora_account_currency_unsupported';
  end if;

  -- The whole point of this type is naming who is holding the money.
  if new.type = 'other_person_holding' and new.other_person_name is null then
    raise exception 'avora_account_person_required';
  end if;

  -- An account's currency is what every transaction in it was recorded in, so it is fixed
  -- once money has moved: changing it would silently restate history.
  if tg_op = 'UPDATE' and new.currency <> old.currency
     and exists (select 1 from public.transactions t where t.account_id = new.id and t.deleted_at is null) then
    raise exception 'avora_account_currency_locked';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_category_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'avora_category_name_required';
  end if;
  if length(new.name) > 80 then
    raise exception 'avora_category_name_max_len';
  end if;
  if new.color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'avora_category_color_invalid';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_decision_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Settling is the one transition allowed into the frozen state; everything after it is refused.
  if tg_op = 'DELETE' then
    if old.status in ('finalized', 'closed') then
      raise exception 'avora_decision_settled_immutable';
    end if;
    return old;
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

CREATE OR REPLACE FUNCTION public.enforce_decision_option_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decision uuid := coalesce(new.decision_id, old.decision_id);
begin
  if private.decision_is_settled(v_decision) then
    raise exception 'avora_decision_settled_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

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
  raise exception 'avora_decision_vote_immutable';
end
$function$;

CREATE OR REPLACE FUNCTION public.enforce_meeting_note_details_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text;
  v_decision uuid := coalesce(new.decision_id, old.decision_id);
begin
  select
    status into v_status
  from
    public.group_decisions
  where
    id = v_decision;

  if v_status in ('finalized', 'closed') then
    raise exception 'avora_decision_settled_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- The details belong to one note for good; re-pointing them at another note would move a
  -- record of one meeting onto another.
  if tg_op = 'UPDATE'
    and new.decision_id <> old.decision_id then
    raise exception 'avora_decision_identity_immutable';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_message_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_message_pin_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_used integer;
  v_limit integer := public.message_pin_limit ();
begin
  if new.scope = 'group' then
    -- One lock per room's shared wall.
    perform
      pg_advisory_xact_lock(hashtext('avora_pin_group:' || new.conversation_id::text));

    -- The room's shared allowance: everyone's group pins count against one number, whoever
    -- added them. Three pins by three different admins is still three pins on the wall.
    select
      count(*) into v_used
    from
      public.message_pins
    where
      conversation_id = new.conversation_id
      and scope = 'group';

    if v_used >= v_limit then
      raise exception 'avora_pin_group_quota_full';
    end if;
  else
    -- One lock per person per room, so filling your own shelf never blocks anyone else's.
    perform
      pg_advisory_xact_lock(hashtext('avora_pin_personal:' || new.conversation_id::text || ':' || new.pinned_by::text));

    select
      count(*) into v_used
    from
      public.message_pins
    where
      conversation_id = new.conversation_id
      and scope = 'personal'
      and pinned_by = new.pinned_by;

    if v_used >= v_limit then
      raise exception 'avora_pin_personal_quota_full';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_profile_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.base_currency := upper(btrim(coalesce(nullif(new.base_currency, ''), 'VND')));
  new.timezone := btrim(coalesce(nullif(new.timezone, ''), 'Asia/Ho_Chi_Minh'));
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'avora_profile_timezone_invalid';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_task_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_snapshot jsonb := new.context_snapshot;
  v_conv_type text;
  v_list_conversation uuid;
  v_expected uuid;
  k text;
begin
  if tg_op = 'UPDATE'
    and new.context_snapshot is distinct from old.context_snapshot
    and old.pending_decision_id is null then
    raise exception 'avora_context_snapshot_immutable';
  end if;

  if v_snapshot is not null then
    if jsonb_typeof(v_snapshot) <> 'object' then
      raise exception 'avora_context_snapshot_not_object';
    end if;

    foreach k in array array[
      'conversation_type', 'conversation_id', 'conversation_name',
      'original_message_id', 'original_message_text', 'original_message_sender_id',
      'original_message_sender_name', 'original_message_created_at',
      'user_response', 'snapshot_created_at'
    ] loop
      if not (v_snapshot ? k) then
        raise exception 'avora_context_snapshot_missing_key_%', k;
      end if;
    end loop;

    if coalesce(v_snapshot->>'conversation_type', '') not in ('direct', 'group', 'personal') then
      raise exception 'avora_context_snapshot_bad_conversation_type';
    end if;

    if nullif(v_snapshot->>'conversation_id', '') is null then
      raise exception 'avora_context_snapshot_conversation_required';
    end if;

    if not private.is_conversation_participant((v_snapshot->>'conversation_id')::uuid, new.creator_id) then
      raise exception 'avora_context_snapshot_foreign_conversation';
    end if;

    select type into v_conv_type from public.conversations
      where id = (v_snapshot->>'conversation_id')::uuid;
    if v_conv_type is distinct from (v_snapshot->>'conversation_type') then
      raise exception 'avora_context_snapshot_type_mismatch';
    end if;

    if nullif(v_snapshot->>'snapshot_created_at', '') is null then
      raise exception 'avora_context_snapshot_time_required';
    end if;
  end if;

  if new.task_list_id is not null then
    select conversation_id into v_list_conversation from public.task_lists where id = new.task_list_id;
    if v_list_conversation is null then
      raise exception 'avora_task_list_missing';
    end if;

    if new.conversation_id is not null then
      v_expected := new.conversation_id;
    else
      v_expected := public.ensure_personal_journal(new.creator_id);
    end if;

    if v_list_conversation <> v_expected then
      raise exception 'avora_task_list_foreign_conversation';
    end if;
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.enforce_task_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.description := btrim(coalesce(new.description, ''));

  if new.deadline_date is null then
    raise exception 'avora_task_deadline_required';
  end if;
  if char_length(new.description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if new.deadline_date < current_date
     and coalesce(current_setting('avora.accepting_suggestion', true), '') <> 'on' then
    raise exception 'avora_task_deadline_past';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_task_list_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type text;
begin
  select type into v_type from public.conversations where id = new.conversation_id;
  if v_type is null then raise exception 'avora_task_list_conversation_missing'; end if;

  if v_type = 'group' then
    new.group_id := new.conversation_id;
  else
    new.group_id := null;
  end if;

  new.name := nullif(btrim(coalesce(new.name, '')), '');

  if tg_op = 'UPDATE' then
    -- A list cannot be moved between conversations, nor reattributed.
    new.conversation_id := old.conversation_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_task_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  due timestamptz;
begin
  new.reminder_tz := btrim(coalesce(nullif(new.reminder_tz, ''), 'Asia/Ho_Chi_Minh'));
  if not exists (select 1 from pg_timezone_names where name = new.reminder_tz) then
    raise exception 'avora_reminder_timezone_invalid';
  end if;

  select public.task_deadline_instant(t.deadline_date, t.deadline_time, t.deadline_tz)
    into due
  from public.tasks t where t.id = new.task_id;

  if due is null then
    raise exception 'avora_reminder_task_missing';
  end if;

  if new.reminder_time > due then
    raise exception 'avora_reminder_after_deadline';
  end if;

  if tg_op = 'INSERT' and new.reminder_time < now() - interval '1 minute' then
    raise exception 'avora_reminder_in_past';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_task_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.deadline_tz := btrim(coalesce(nullif(new.deadline_tz, ''), 'Asia/Ho_Chi_Minh'));
  if not exists (select 1 from pg_timezone_names where name = new.deadline_tz) then
    raise exception 'avora_task_timezone_invalid';
  end if;

  -- AVORA-39 Phần 3 · A: "cần có mặt" owns the travel fields. Turning it off clears them; the
  -- Event itself (start/end/location) stays, because an Event no longer implies presence.
  if not coalesce(new.requires_presence, false) then
    new.travel_duration_minutes := null;
    new.departure_reminder_at := null;
  end if;

  new.recurrence := coalesce(nullif(btrim(new.recurrence), ''), 'none');
  if new.recurrence = 'none' then
    new.recurrence_pattern := null;
  end if;

  if new.task_category_id is not null and not exists (
    select 1 from public.task_categories c
    where c.id = new.task_category_id
      and c.user_id = new.creator_id
      and c.deleted_at is null
  ) then
    raise exception 'avora_task_category_foreign';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_transaction_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_account public.accounts%rowtype;
  v_category public.categories%rowtype;
  v_contact public.contact%rowtype;
  v_is_obligation boolean := new.type not in ('income', 'expense');
begin
  if new.amount is null or new.amount <= 0 then
    raise exception 'avora_txn_amount_positive';
  end if;

  if new.transaction_date is null then
    raise exception 'avora_txn_date_required';
  end if;
  if new.transaction_date > current_date then
    raise exception 'avora_txn_date_future';
  end if;

  select * into v_account from public.accounts where id = new.account_id;
  if not found or v_account.user_id <> new.user_id then
    raise exception 'avora_txn_account_not_yours';
  end if;
  if v_account.deleted_at is not null and (tg_op = 'INSERT' or old.account_id <> new.account_id) then
    raise exception 'avora_txn_account_closed';
  end if;

  -- Thu/chi: hạng mục bắt buộc và phải khớp loại — y hệt trước.
  if not v_is_obligation then
    if new.category_id is null then
      raise exception 'avora_txn_category_required';
    end if;
    select * into v_category from public.categories where id = new.category_id;
    if not found or v_category.user_id <> new.user_id then
      raise exception 'avora_txn_category_not_yours';
    end if;
    if v_category.deleted_at is not null and (tg_op = 'INSERT' or old.category_id is distinct from new.category_id) then
      raise exception 'avora_txn_category_removed';
    end if;
    if v_category.applies_to::text <> new.type::text then
      raise exception 'avora_txn_category_type_mismatch';
    end if;
  else
    new.category_id := null;
  end if;

  -- Nghĩa vụ: phải có ngày đến hạn; vay/cho vay phải có đối tượng.
  if v_is_obligation then
    if new.due_date is null then
      raise exception 'avora_txn_due_date_required';
    end if;
    if new.type in ('vay', 'cho_vay') and new.contact_id is null then
      raise exception 'avora_txn_contact_required';
    end if;
    -- Trạng thái luôn được tính lại, không bao giờ nhận từ client: mặc định của cột là
    -- 'hoan_thanh' (đúng cho thu/chi), để nguyên thì một khoản vay mới sẽ hiện là đã trả xong.
    new.status := private.obligation_status(new.due_date, new.amount, new.amount_settled, current_date);
  else
    -- Thu/chi không có vòng đời: đã xảy ra rồi.
    new.contact_id := null;
    new.due_date := null;
    new.tax_period_start := null;
    new.tax_period_end := null;
    new.status := 'hoan_thanh';
    new.amount_settled := 0;
  end if;

  -- Đối tượng phải là liên hệ của chính người ghi sổ.
  if new.contact_id is not null then
    select * into v_contact from public.contact where id = new.contact_id;
    if not found or v_contact.owner_user_id <> new.user_id then
      raise exception 'avora_txn_contact_not_yours';
    end if;
  end if;

  if new.tax_period_start is not null and new.tax_period_end is not null
     and new.tax_period_start > new.tax_period_end then
    raise exception 'avora_txn_tax_period_invalid';
  end if;

  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.business_purpose := nullif(btrim(coalesce(new.business_purpose, '')), '');
  new.recurring_label := nullif(btrim(coalesce(new.recurring_label, '')), '');

  if not new.business_related then
    new.business_purpose := null;
  end if;
  if not new.is_recurring then
    new.recurring_frequency := null;
    new.recurring_label := null;
  end if;

  if new.description is not null and length(new.description) > 500 then
    raise exception 'avora_txn_description_max_len';
  end if;
  if new.business_purpose is not null and length(new.business_purpose) > 300 then
    raise exception 'avora_txn_purpose_max_len';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_user_pin_permanent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'avora_pin_permanent';
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_bookshelf()
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype; v_tpl think_hub_template%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('think_hub_bookshelf:' || v_user::text, 0));
  select * into v_row from think_hub_table where owner_user_id = v_user and kind = 'bookshelf';
  if found then
    if v_row.deleted_at is not null or v_row.archived_at is not null then
      update think_hub_table set deleted_at = null, archived_at = null, archived_by = null
      where id = v_row.id returning * into v_row;
    end if;
    return v_row;
  end if;

  select * into v_tpl from think_hub_template where key = 'reading';
  insert into think_hub_table (owner_user_id, name, purpose, position, column_defs, kind)
  values (v_user, 'Kệ sách', v_tpl.guiding_question, 10000, '[]'::jsonb, 'bookshelf')
  returning * into v_row;
  return private.apply_structure_to_table(v_row.id, v_tpl.column_defs, v_tpl.status_options, v_tpl.title_label,
    v_tpl.default_view, v_tpl.mobile_columns, v_tpl.key, v_tpl.version, null);
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_default_categories()
 RETURNS SETOF categories
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;
  perform public.seed_finance_categories(v_user);
  return query
    select * from public.categories
    where user_id = v_user and deleted_at is null
    order by applies_to, sort_order, lower(name);
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_default_task_categories(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform private.assert_session_allowed();
  insert into public.task_categories (user_id, name, slug, color, is_default, sort_order)
  values
    (p_user, 'Công việc', 'work',     '#5B7B8A', true, 1),
    (p_user, 'Sức khỏe',  'health',   '#3F8F6B', true, 2),
    (p_user, 'Gia đình',  'family',   '#C98A3E', true, 3),
    (p_user, 'Học tập',   'learning', '#8C6A4A', true, 4),
    (p_user, 'Tài chính', 'finance',  '#7D8A4F', true, 5),
    (p_user, 'Cá nhân',   'personal', '#D68A6F', true, 6)
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_default_think_hub_table()
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('think_hub_default:' || v_user::text, 0));
  SELECT * INTO v_row FROM think_hub_table
  WHERE owner_user_id = v_user AND deleted_at IS NULL AND kind IS NULL
    AND project_id IS NULL AND conversation_id IS NULL AND parent_record_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO think_hub_table (owner_user_id, name, position, column_defs)
  VALUES (v_user, 'Bảng tổng hợp', 0, '[]'::jsonb)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_personal_journal(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := 'personal:' || p_user_id::text;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  if p_user_id is null then raise exception 'avora_journal_user_required'; end if;

  select id into v_id from public.conversations where direct_key = v_key;

  if v_id is null then
    begin
      insert into public.conversations (type, direct_key) values ('personal', v_key)
        returning id into v_id;
    exception when unique_violation then
      -- Someone else won the race; take their row rather than making a second journal.
      select id into v_id from public.conversations where direct_key = v_key;
    end;
  end if;

  -- A journal has exactly one participant. The composite primary key makes this idempotent.
  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, p_user_id)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_reading_folder()
 RETURNS note_folders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v note_folders%rowtype; v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from note_folders where owner_user_id = v_uid and system_key = 'reading';
  if found then return v; end if;
  insert into note_folders (owner_user_id, name, is_system, system_key, position)
  values (v_uid, 'Ghi chép đọc sách', true, 'reading', 100000)
  on conflict (owner_user_id, system_key) where system_key is not null do nothing
  returning * into v;
  if v.id is null then select * into v from note_folders where owner_user_id = v_uid and system_key = 'reading'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.f_unaccent(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'extensions', 'pg_temp'
AS $function$
  select lower(replace(replace(extensions.unaccent('extensions.unaccent'::regdictionary, p), 'đ', 'd'), 'Đ', 'D'))
$function$;

CREATE OR REPLACE FUNCTION public.finalize_meeting_note(p_decision_id uuid)
 RETURNS group_decisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.group_decisions%rowtype;
  v_details public.meeting_note_details%rowtype;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status = 'finalized' then return v_row; end if;

  if v_row.created_by <> v_uid and not private.is_group_officer (v_row.conversation_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  select * into v_details from public.meeting_note_details where decision_id = p_decision_id;

  if found then
    for v_item in select value from jsonb_array_elements(v_details.action_items) loop
      if coalesce(v_item->>'task_id', '') <> '' then
        v_item := private.sync_meeting_note_task (v_row, v_details.agenda_items, v_item, false, true);
      elsif coalesce((v_item->>'create_task')::boolean, false) then
        v_item := private.sync_meeting_note_task (v_row, v_details.agenda_items, v_item, true, true);
      end if;
      if coalesce(v_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$' then
        v_seen := v_seen || (v_item->>'task_id')::uuid;
      end if;
      v_next := v_next || jsonb_build_array(v_item);
    end loop;

    update public.meeting_note_details set action_items = v_next where decision_id = p_decision_id;
  end if;

  delete from public.tasks where pending_decision_id = p_decision_id and not (id = any(v_seen));
  update public.tasks set pending_decision_id = null where pending_decision_id = p_decision_id;

  update public.group_decisions
    set status = 'finalized', settled_at = now(), settled_by = v_uid
    where id = p_decision_id;

  select * into v_row from public.group_decisions where id = p_decision_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
 RETURNS TABLE(user_id uuid, display_name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  SELECT u.id, p.display_name, u.email::text
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE auth.uid() IS NOT NULL
    AND btrim(p_email) <> ''
    AND lower(u.email) = lower(btrim(p_email))
    AND u.id <> auth.uid()
    -- AVORA-37 / A: a blocked pair looks exactly like an address with no account.
    AND NOT private.is_blocked_between (u.id, auth.uid())
    -- AVORA-38 / ADR-029: strangers are found by PIN only; a non-bạn reads as no account.
    AND private.are_connected (u.id, auth.uid())
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.forget_this_device(p_device_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.account_devices where user_id = auth.uid() and device_id = p_device_id and guest;
end $function$;

CREATE OR REPLACE FUNCTION public.forward_blocked_note()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select '[Tệp không được phép chuyển tiếp]'::text;
$function$;

CREATE OR REPLACE FUNCTION public.forward_journal_file(p_message_id uuid, p_target uuid, p_permission text DEFAULT 'export'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.forward_messages_as_bundle(p_message_ids uuid[], p_target_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform private.assert_session_allowed();
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
  perform private.assert_session_allowed();
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

CREATE OR REPLACE FUNCTION public.forward_note_files(p_attachment_ids uuid[], p_target uuid, p_permission text DEFAULT 'export'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.forward_note(p_note_id uuid, p_target uuid, p_permission text DEFAULT 'export'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_conversation_peer(p_conversation_id uuid)
 RETURNS TABLE(peer_id uuid, peer_display_name text, peer_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  -- AVORA-38 / C: inside a live verification frame opened from a PIN the name and email stay
  -- hidden; one opened from a Nhóm shows the name the Nhóm already shows, never the email.
  SELECT cp.user_id,
    CASE WHEN private.verification_is_live (p_conversation_id) AND c.verification_via_group_id IS NULL
      THEN NULL ELSE pp.display_name END,
    CASE WHEN private.verification_is_live (p_conversation_id) THEN NULL ELSE pu.email::text END
  FROM public.conversation_participants cp
  JOIN public.conversations c ON c.id = cp.conversation_id
  LEFT JOIN public.profiles pp ON pp.id = cp.user_id
  LEFT JOIN auth.users pu ON pu.id = cp.user_id
  WHERE cp.conversation_id = p_conversation_id
    AND cp.user_id <> auth.uid()
    AND private.is_conversation_participant(p_conversation_id, auth.uid())
  ORDER BY cp.joined_at
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_message_receipt_counts(p_message_ids uuid[])
 RETURNS TABLE(message_id uuid, read_count integer, delivered_count integer, total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 50 then raise exception 'avora_too_many'; end if;
  if exists (select 1 from public.messages m where m.id = any (p_message_ids) and not private.can_act_in(m.conversation_id, v_uid, 'read')) then
    raise exception 'avora_not_allowed';
  end if;
  if exists (select 1 from public.messages m where m.id = any (p_message_ids) and private.receipt_scope(m.conversation_id) is not null and not private.shares_read(m.conversation_id, v_uid)) then
    raise exception 'avora_receipts_off';
  end if;
  return query
    select m.id,
           count(*) filter (where not private.is_blocked_between(v_uid, cp.user_id) and private.shares_read(m.conversation_id, cp.user_id)
                              and rm.last_read_at is not null and rm.last_read_at >= m.created_at)::int,
           count(*) filter (where not private.is_blocked_between(v_uid, cp.user_id) and private.shares_read(m.conversation_id, cp.user_id)
                              and (d.delivered_at is not null or (rm.last_read_at is not null and rm.last_read_at >= m.created_at)))::int,
           count(cp.user_id)::int
      from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id <> m.sender_id and cp.user_id <> v_uid
      left join public.conversation_read_marks rm on rm.conversation_id = cp.conversation_id and rm.user_id = cp.user_id
      left join public.message_deliveries d on d.message_id = m.id and d.user_id = cp.user_id
     where m.id = any (p_message_ids)
       and m.system_kind is null and m.deleted_at is null
       and private.receipt_scope(m.conversation_id) is not null
     group by m.id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_message_receipts(p_message_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, state text, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages%rowtype;
  v_scope text;
begin
  perform private.assert_feature('read_receipts');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_msg from public.messages m where m.id = p_message_id;
  if v_msg.id is null or not private.can_act_in(v_msg.conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  v_scope := private.receipt_scope(v_msg.conversation_id);
  if v_scope is null or v_msg.system_kind is not null or v_msg.deleted_at is not null then return; end if;
  if not private.shares_read(v_msg.conversation_id, v_uid) then raise exception 'avora_receipts_off'; end if;
  return query
    select cp.user_id,
           coalesce(nullif(btrim(p.display_name), ''), 'Thành viên'),
           case
             when private.is_blocked_between(v_uid, cp.user_id) then 'unavailable'
             -- 1-1: someone who does not share is simply `delivered` — no word hints at a reason.
             when not private.shares_read(v_msg.conversation_id, cp.user_id) and v_scope = 'direct' then case when d.delivered_at is not null then 'delivered' else 'not_delivered' end
             when not private.shares_read(v_msg.conversation_id, cp.user_id) then 'hidden'
             when rm.last_read_at is not null and rm.last_read_at >= v_msg.created_at then 'read'
             when d.delivered_at is not null then 'delivered'
             else 'not_delivered'
           end,
           case
             when private.is_blocked_between(v_uid, cp.user_id) then null
             when not private.shares_read(v_msg.conversation_id, cp.user_id) and v_scope = 'direct' then d.delivered_at
             when not private.shares_read(v_msg.conversation_id, cp.user_id) then null
             when rm.last_read_at is not null and rm.last_read_at >= v_msg.created_at then rm.last_read_at
             else d.delivered_at
           end
      from public.conversation_participants cp
      left join public.profiles p on p.id = cp.user_id
      left join public.conversation_read_marks rm on rm.conversation_id = cp.conversation_id and rm.user_id = cp.user_id
      left join public.message_deliveries d on d.message_id = v_msg.id and d.user_id = cp.user_id
     where cp.conversation_id = v_msg.conversation_id
       and cp.user_id <> v_msg.sender_id
       -- The caller never sees their own time; in a 1-1 the one other person is the row.
       and cp.user_id <> v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_journal_conversation()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return public.ensure_personal_journal(v_uid);
end $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation_for_group(target_user_id uuid, group_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if group_id is null then
    raise exception 'AVORA_GROUP_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from public.conversations c where c.id = group_id and c.type = 'group') then
    raise exception 'AVORA_GROUP_NOT_FOUND' using errcode = '22023';
  end if;

  -- You can only start a side conversation inside a room you are both actually in.
  if not exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = group_id and cp.user_id = v_uid
  ) then
    raise exception 'AVORA_NOT_GROUP_PARTICIPANT' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
     where cp.conversation_id = group_id and cp.user_id = target_user_id
  ) then
    raise exception 'AVORA_TARGET_NOT_GROUP_PARTICIPANT' using errcode = '22023';
  end if;

  -- AVORA-38 / B2: bạn → the ordinary 1-1; otherwise the verification frame bridged by this Nhóm.
  if private.are_connected (v_uid, target_user_id) then
    return public.create_direct_conversation(target_user_id);
  end if;
  return public.start_group_connection(group_id, target_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_group_decision_permission(p_conversation_id uuid, p_grantee_id uuid, p_kind text)
 RETURNS group_decision_grants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_kind text := btrim(coalesce(p_kind, ''));
  v_row public.group_decision_grants%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_kind not in ('meeting_note','poll') then raise exception 'avora_decision_bad_kind'; end if;
  if not private.is_group_officer(p_conversation_id, v_uid) then
    raise exception 'avora_decision_officers_only';
  end if;
  if p_grantee_id = v_uid then raise exception 'avora_decision_grant_self'; end if;
  if not private.is_conversation_participant(p_conversation_id, p_grantee_id) then
    raise exception 'avora_decision_grantee_not_participant';
  end if;

  -- Re-granting while one is still unspent returns the existing permission rather than stacking
  -- a second: the partial unique index would reject it anyway, and one is the whole point.
  select * into v_row from public.group_decision_grants g
   where g.conversation_id = p_conversation_id and g.grantee_id = p_grantee_id
     and g.kind = v_kind and g.used_at is null;
  if found then return v_row; end if;

  insert into public.group_decision_grants (conversation_id, grantee_id, kind, granted_by)
  values (p_conversation_id, p_grantee_id, v_kind, v_uid)
  returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;

  perform public.ensure_personal_journal(new.id);
  perform private.ensure_opportunity_board(new.id);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.inbox_page(p_limit integer DEFAULT 50, p_before_sort timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_include uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer, is_connected boolean, verification_status text, verification_expires_at timestamp with time zone, verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid, verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allrows as (select * from public.list_my_conversations()),
  direct_page as (
    select a.conversation_id from allrows a
    where a.conversation_type = 'direct'
      and (p_before_sort is null or (a.sort_at, a.conversation_id) < (p_before_sort, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by a.sort_at desc, a.conversation_id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select a.* from allrows a
  where a.conversation_id in (select conversation_id from direct_page)
     or a.conversation_id = any(coalesce(p_include, '{}'))
     or (p_before_sort is null and a.conversation_type <> 'direct')
  order by a.sort_at desc, a.conversation_id desc;
$function$;

CREATE OR REPLACE FUNCTION public.inbox_unread_counts()
 RETURNS TABLE(conversation_type text, unread_messages integer, unread_conversations integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.conversation_type, sum(a.unread_count)::integer, count(*) filter (where a.unread_count > 0)::integer
  from public.list_my_conversations() a
  group by a.conversation_type;
$function$;

CREATE OR REPLACE FUNCTION public.invite_required()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'invite_required'), false)
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
  perform private.assert_session_allowed();
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

CREATE OR REPLACE FUNCTION public.is_project_root_owner(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND private.is_group_root_owner(p.conversation_id, auth.uid())
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_task_assignee(p_task tasks, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_task.assignee_id is not null then p_task.assignee_id = p_user
    when p_task.type = '1-1-shared' then p_task.creator_id <> p_user
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.join_group_with_invite(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_conv uuid; v_owner uuid; v_deleted timestamptz;
begin
  perform private.assert_feature('groups');
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
end $function$;

CREATE OR REPLACE FUNCTION public.leave_group_conversation(target_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_uid;

  if v_role is null then
    raise exception 'You are not a participant of this group';
  end if;

  if v_role = 'owner' then
    raise exception 'Owner must transfer ownership before leaving — use transfer_group_ownership';
  end if;

  delete from public.conversation_participants
  where conversation_id = v_conv and user_id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.link_contact_to_friend(p_contact_id uuid, p_friend_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('contact_link');
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'link', null, p_contact_id, p_friend_id, null);
end $function$;

CREATE OR REPLACE FUNCTION public.link_opportunity_conversation(p_opportunity_id uuid, p_conversation_id uuid)
 RETURNS crm_opportunity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row crm_opportunity%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_row FROM crm_opportunity WHERE id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy cơ hội này';
  END IF;
  IF v_row.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ cơ hội mới được gắn cuộc trò chuyện';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = p_conversation_id) THEN
      RAISE EXCEPTION 'Không tìm thấy cuộc trò chuyện này';
    END IF;
    IF NOT private.is_conversation_participant(p_conversation_id, auth.uid()) THEN
      RAISE EXCEPTION 'Chỉ gắn được cuộc trò chuyện mà bạn là thành viên';
    END IF;
  END IF;

  UPDATE crm_opportunity SET conversation_id = p_conversation_id
  WHERE id = p_opportunity_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_task_to_project(p_task_id uuid, p_project_id uuid, p_record_id uuid DEFAULT NULL::uuid)
 RETURNS project_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_row project_tasks%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT conversation_id INTO v_conversation FROM projects WHERE id = p_project_id AND deleted_at IS NULL;
  IF v_conversation IS NULL OR NOT private.is_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'avora_project_missing';
  END IF;

  INSERT INTO project_tasks (task_id, project_id, record_id, linked_by)
  VALUES (p_task_id, p_project_id, p_record_id, v_uid)
  ON CONFLICT (task_id) DO UPDATE
    SET project_id = EXCLUDED.project_id, record_id = EXCLUDED.record_id, linked_by = EXCLUDED.linked_by
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_task_to_record(p_task_id uuid, p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_project uuid;
  v_previous uuid;
  v_title text;
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  if not private.think_hub_record_editable(p_record_id, v_uid) then
    raise exception 'avora_record_not_editable' using errcode = '42501';
  end if;
  if not private.task_record_same_place(p_task_id, p_record_id) then
    raise exception '%', format('Việc này thuộc %s, chỉ gắn được vào Hạng mục cùng nơi.', private.task_place_label(p_task_id, v_uid))
      using errcode = 'P0001', hint = 'avora_link_scope';
  end if;

  v_previous := private.current_task_record(p_task_id);
  if v_previous = p_record_id then
    return jsonb_build_object('record_id', p_record_id, 'moved_from', null, 'unchanged', true);
  end if;
  select t.title into v_title from public.tasks t where t.id = p_task_id;
  select b.project_id into v_project from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id where r.id = p_record_id;

  if v_project is not null then
    delete from public.think_hub_record_tasks where task_id = p_task_id;
    insert into public.project_tasks (task_id, project_id, linked_by, record_id)
    values (p_task_id, v_project, v_uid, p_record_id)
    on conflict (task_id) do update set project_id = excluded.project_id, record_id = excluded.record_id;
  else
    update public.project_tasks set record_id = null where task_id = p_task_id and record_id is not null;
    insert into public.think_hub_record_tasks (task_id, record_id, linked_by)
    values (p_task_id, p_record_id, v_uid)
    on conflict (task_id) do update set record_id = excluded.record_id, linked_by = excluded.linked_by, created_at = now();
  end if;

  if v_previous is not null then perform private.log_task_link(v_previous, 'task_unlink', v_title, v_uid); end if;
  perform private.log_task_link(p_record_id, 'task_link', v_title, v_uid);
  return jsonb_build_object('record_id', p_record_id, 'moved_from', v_previous, 'unchanged', false);
end $function$;

CREATE OR REPLACE FUNCTION public.list_assigned_by_me()
 RETURNS TABLE(kind text, item_id uuid, conversation_id uuid, title text, assignee_id uuid, assignee_name text, deadline date, status text, done_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (select (select auth.uid()) as uid)
  select 'task'::text, t.id, t.conversation_id, t.title, a.uid,
         coalesce(nullif(btrim(pr.display_name), ''), 'Người dùng AVORA'),
         t.deadline_date, t.status, t.done_at
  from public.tasks t
  cross join me
  cross join lateral (
    select case
      when t.assignee_id is not null then t.assignee_id
      when t.type = '1-1-shared' then (
        select cp.user_id from public.conversation_participants cp
        where cp.conversation_id = t.conversation_id and cp.user_id <> t.creator_id limit 1)
    end as uid
  ) a
  left join public.profiles pr on pr.id = a.uid
  where (select private.session_allowed())
    and t.creator_id = me.uid
    and t.type <> 'personal'
    and a.uid is not null and a.uid <> me.uid
    and t.pending_decision_id is null
    and not t.deleted_by_creator
    and t.status <> 'skipped'
    and (t.done_at is null or t.done_at > now() - interval '30 days')
    and private.is_conversation_participant(t.conversation_id, me.uid)
    and private.conversation_is_live(t.conversation_id)
  union all
  select 'suggestion'::text, s.id, s.conversation_id, s.proposed_title, s.assignee_id,
         coalesce(nullif(btrim(pr.display_name), ''), 'Người dùng AVORA'),
         s.proposed_deadline, 'pending'::text, null::timestamptz
  from public.task_suggestions s
  cross join me
  left join public.profiles pr on pr.id = s.assignee_id
  where (select private.session_allowed())
    and s.proposer_id = me.uid
    and s.status = 'pending'
    and s.assignee_id is not null and s.assignee_id <> me.uid
    and private.is_conversation_participant(s.conversation_id, me.uid)
    and private.conversation_is_live(s.conversation_id)
  limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.list_deleted_projects()
 RETURNS SETOF projects
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  SELECT p.* FROM projects p
  WHERE p.deleted_at IS NOT NULL
    AND (private.is_conversation_participant(p.conversation_id, auth.uid())
         OR private.is_group_root_owner(p.conversation_id, auth.uid()))
  ORDER BY p.deleted_at DESC
$function$;

CREATE OR REPLACE FUNCTION public.list_dissolved_groups()
 RETURNS TABLE(conversation_id uuid, name text, deleted_at timestamp with time zone, restorable_until timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select c.id, coalesce(g.name, 'Nhóm'), c.deleted_at, c.deleted_at + interval '30 days'
  from conversations c
  join conversation_participants cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
  left join conversation_groups g on g.conversation_id = c.id
  where c.type = 'group' and c.deleted_at is not null and c.deleted_via is not null
    and c.parent_group_id is null and c.deleted_at >= now() - interval '30 days'
  order by c.deleted_at desc
$function$;

CREATE OR REPLACE FUNCTION public.list_group_members(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, role text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then
    raise exception 'avora_not_signed_in';
  end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()
  ) then
    raise exception 'You are not a participant of this group';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.type = 'group') then
    raise exception 'Not a group conversation';
  end if;
  return query
  select cp.user_id, pp.display_name, cp.role, cp.joined_at
  from public.conversation_participants cp
  left join public.profiles pp on pp.id = cp.user_id
  where cp.conversation_id = p_conversation_id
  order by cp.joined_at asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_linkable_records(p_task_id uuid, p_query text DEFAULT NULL::text)
 RETURNS TABLE(record_id uuid, record_title text, table_id uuid, table_name text, path text, is_current boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_q text := private.fold_search(btrim(coalesce(p_query, '')));
  v_current uuid;
begin
  if v_uid is null or not private.session_allowed() or not private.can_link_task(p_task_id, v_uid) then return; end if;
  v_current := private.current_task_record(p_task_id);
  return query
    select r.id, r.title, b.id, b.name, private.record_path(r.id), r.id = v_current
    from public.think_hub_record r
    join public.think_hub_table b on b.id = r.table_id
    where r.deleted_at is null and r.archived_at is null and b.deleted_at is null and b.archived_at is null
      and private.task_record_same_place(p_task_id, r.id)
      and private.think_hub_record_editable(r.id, v_uid)
      and (v_q = '' or private.fold_search(r.title) like '%' || v_q || '%' or private.fold_search(b.name) like '%' || v_q || '%')
    order by (r.id = v_current) desc, r.updated_at desc, r.id
    limit 30;
end $function$;

CREATE OR REPLACE FUNCTION public.list_linkable_tasks(p_record_id uuid, p_query text DEFAULT NULL::text)
 RETURNS TABLE(task_id uuid, title text, deadline_date date, status text, linked_record_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_q text := private.fold_search(btrim(coalesce(p_query, '')));
  v_board public.think_hub_table%rowtype;
  v_convs uuid[];
begin
  if v_uid is null or not private.session_allowed() or not private.think_hub_record_editable(p_record_id, v_uid) then return; end if;
  select b.* into v_board from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id where r.id = p_record_id;
  if v_board.project_id is not null then
    select array_remove(array[pr.conversation_id, c.parent_group_id], null) into v_convs
    from public.projects pr join public.conversations c on c.id = pr.conversation_id where pr.id = v_board.project_id;
  elsif v_board.conversation_id is not null then
    v_convs := array[v_board.conversation_id];
  end if;

  return query
    select t.id, t.title, t.deadline_date, t.status,
           (select r2.title from public.think_hub_record r2 where r2.id = private.current_task_record(t.id))
    from public.tasks t
    where t.pending_decision_id is null
      and not t.deleted_by_creator and not t.deleted_by_peer
      and t.status not in ('done', 'skipped', 'done_pending_review')
      and case when v_convs is null then t.type = 'personal' and t.creator_id = v_board.owner_user_id and t.creator_id = v_uid
               else t.type <> 'personal' and t.conversation_id = any (v_convs) end
      and private.can_link_task(t.id, v_uid)
      and private.current_task_record(t.id) is distinct from p_record_id
      and (v_q = '' or private.fold_search(t.title) like '%' || v_q || '%')
    order by (private.current_task_record(t.id) is null) desc, t.created_at desc, t.id
    limit 30;
end $function$;

CREATE OR REPLACE FUNCTION public.list_my_blocks()
 RETURNS TABLE(user_id uuid, display_name text, email text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select b.blocked_id, p.display_name, u.email::text, b.created_at
  from public.user_blocks b
  left join public.profiles p on p.id = b.blocked_id
  left join auth.users u on u.id = b.blocked_id
  where b.blocker_id = auth.uid ()
  order by b.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_closed_shared_tasks()
 RETURNS TABLE(task_id uuid, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select t.id, private.task_closed_reason(t, auth.uid())
  from tasks t
  where t.type in ('1-1-shared', 'group-shared')
    and public.is_task_assignee(t, auth.uid()) and t.creator_id <> auth.uid()
    and not t.deleted_by_peer
    and private.is_conversation_participant(t.conversation_id, auth.uid())
    and private.task_closed_reason(t, auth.uid()) is not null
$function$;

CREATE OR REPLACE FUNCTION public.list_my_connection_requests()
 RETURNS TABLE(conversation_id uuid, display_name text, pin text, via_group_name text, message text, started_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select
    c.id,
    -- Same rule as list_my_conversations: the PIN path shows the PIN, the Nhóm path the name.
    case when c.verification_via_group_id is null then null else p.display_name end,
    case when c.verification_via_group_id is null then up.pin end,
    g.name,
    fm.content,
    c.verification_started_at,
    c.verification_expires_at
  from public.conversations c
  join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid ()
  left join public.profiles p on p.id = c.verification_opened_by
  left join public.user_pins up on up.user_id = c.verification_opened_by
  left join public.conversation_groups g on g.conversation_id = c.verification_via_group_id
  left join lateral (
    select m.content from public.messages m
    where m.conversation_id = c.id and m.sender_id = c.verification_opened_by
      and m.created_at >= c.verification_started_at and m.deleted_at is null
    order by m.created_at, m.id
    limit 1
  ) fm on true
  where auth.uid () is not null
    and c.type = 'direct'
    and c.deleted_at is null
    and c.verification_status = 'pending'
    and c.verification_opened_by is distinct from auth.uid ()
    and private.verification_is_live (c.id)
    and not private.is_blocked_between (auth.uid (), c.verification_opened_by)
    and not exists (select 1 from public.conversation_verification_confirms vc
                    where vc.conversation_id = c.id and vc.user_id = auth.uid ())
  order by c.verification_started_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_connections()
 RETURNS TABLE(user_id uuid, display_name text, pin text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select other.id, p.display_name, up.pin, uc.created_at
  from public.user_connections uc
  cross join lateral (select case when uc.user_low = auth.uid () then uc.user_high else uc.user_low end as id) other
  left join public.profiles p on p.id = other.id
  left join public.user_pins up on up.user_id = other.id
  where auth.uid () is not null
    and auth.uid () in (uc.user_low, uc.user_high)
    and uc.status = 'active'
  order by lower (coalesce (p.display_name, '')), other.id;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_conversation_pins()
 RETURNS TABLE(conversation_id uuid, pinned_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select p.conversation_id, p.pinned_at
  from public.conversation_pins p
  where auth.uid () is not null and p.user_id = auth.uid ()
    and private.is_conversation_participant (p.conversation_id, auth.uid ())
  order by p.pinned_at;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_conversations()
 RETURNS TABLE(conversation_id uuid, peer_id uuid, peer_display_name text, peer_email text, last_message_content text, last_message_at timestamp with time zone, last_message_sender_id uuid, unread_count integer, sort_at timestamp with time zone, conversation_type text, group_name text, member_count integer, is_connected boolean, verification_status text, verification_expires_at timestamp with time zone, verification_via_group_id uuid, verification_group_name text, verification_opened_by uuid, verification_messages_left integer, verification_confirmed_by_me boolean, peer_pin text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select
    c.id,
    peer.user_id,
    case when live.v and c.verification_via_group_id is null then null else pp.display_name end,
    case when live.v then null else pu.email::text end,
    -- B2: nothing left but what disappeared → `—`, not "no messages yet".
    coalesce(lm.content, case when exists (
      select 1 from public.messages mx where mx.conversation_id = c.id and mx.expired_at is not null
    ) then '—' end),
    lm.created_at,
    lm.sender_id,
    coalesce(un.unread_count, 0)::integer,
    coalesce(lm.created_at, c.created_at),
    c.type,
    cg.name,
    coalesce(mc.member_count, 1)::integer,
    case when c.type = 'direct' then private.are_connected (auth.uid(), peer.user_id) end,
    case when live.v then 'pending' end,
    case when live.v then c.verification_expires_at end,
    case when live.v then c.verification_via_group_id end,
    case when live.v then bg.name end,
    case when live.v then c.verification_opened_by end,
    case when live.v then greatest(0, 5 - (
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.sender_id = auth.uid() and m2.created_at >= c.verification_started_at
    ))::integer end,
    case when live.v then exists (
      select 1 from public.conversation_verification_confirms vc
      where vc.conversation_id = c.id and vc.user_id = auth.uid()
    ) end,
    case
      when c.type <> 'direct' then null
      when live.v and c.verification_via_group_id is null then pin.pin
      when not live.v and private.are_connected (auth.uid(), peer.user_id) then pin.pin
    end
  from public.conversations c
  join public.conversation_participants me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_read_marks rm
    on rm.conversation_id = c.id and rm.user_id = auth.uid()
  left join public.conversation_groups cg on cg.conversation_id = c.id
  left join lateral (
    select cp.user_id
    from public.conversation_participants cp
    where cp.conversation_id = c.id
      and cp.user_id <> auth.uid()
      and c.type = 'direct'
    order by cp.joined_at
    limit 1
  ) peer on true
  left join public.profiles pp on pp.id = peer.user_id
  left join auth.users pu on pu.id = peer.user_id
  left join public.user_pins pin on pin.user_id = peer.user_id
  left join public.conversation_groups bg on bg.conversation_id = c.verification_via_group_id
  cross join lateral (select (c.verification_status = 'pending' and private.verification_is_live (c.id)) as v) live
  left join lateral (
    select m.content, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
      -- AVORA-109 · B2: a message that has disappeared is no preview; the latest remaining one is.
      and m.expired_at is null and (m.expires_at is null or m.expires_at > now())
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  left join lateral (
    -- K3 · N9: counting stops at 100; the badge reads 99+ past that.
    select count(*) as unread_count from (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        -- AVORA-62 · E0: "X tạo Bảng" is a quiet line, never unread.
        and m.system_kind is distinct from 'board_created'
        -- AVORA-109 · B2: nor is it unread.
        and m.expired_at is null and (m.expires_at is null or m.expires_at > now())
        and (rm.last_read_at is null or m.created_at > rm.last_read_at)
      limit 100
    ) capped
  ) un on true
  left join lateral (
    select count(*) as member_count
    from public.conversation_participants cp2
    where cp2.conversation_id = c.id
  ) mc on true
  where auth.uid() is not null
    and c.deleted_at is null
    and not (
      c.type = 'direct'
      and c.verification_status in ('pending', 'closed')
      and not live.v
      and not private.are_connected (auth.uid(), peer.user_id)
    )
  order by coalesce(lm.created_at, c.created_at) desc;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_decisions()
 RETURNS TABLE(decision_id uuid, conversation_id uuid, kind text, title text, summary text, settled_at timestamp with time zone, settled_by uuid, settled_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.id, d.conversation_id, d.kind, d.title,
         left(coalesce(nullif(btrim(m.decisions_made), ''), d.body), 300),
         d.settled_at, d.settled_by,
         coalesce(nullif(btrim(p.display_name), ''), 'Người dùng AVORA')
  from public.group_decisions d
  left join public.meeting_note_details m on m.decision_id = d.id
  left join public.profiles p on p.id = d.settled_by
  where (select private.session_allowed())
    and d.status in ('finalized', 'closed')
    and private.is_conversation_participant(d.conversation_id, (select auth.uid()))
    and private.conversation_is_live(d.conversation_id)
  order by d.settled_at desc
  limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_devices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind, 'rank', d.rank, 'guest', d.guest,
      'last_seen_at', d.last_seen_at, 'created_at', d.created_at, 'is_me', d.id = v_me.id,
      'lost_status', d.lost_status, 'can_open_vault', exists (select 1 from private.vault_device_shares s where s.user_id = d.user_id and s.device_id = d.device_id), 'lost_deadline', d.lost_deadline,
      'can_revoke', d.id <> coalesce(v_me.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (v_me.rank = 1 or (v_me.rank = 2 and d.rank = 3)),
      'can_report_lost', d.id <> coalesce(v_me.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and v_me.rank in (1, 2) and d.rank in (1, 2) and d.rank <> v_me.rank and d.lost_status is distinct from 'pending'
    ) order by d.rank, d.last_seen_at desc)
    from public.account_devices d
    where d.user_id = v_uid and d.revoked_at is null and d.lost_status is distinct from 'confirmed'
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.list_my_projects_summary()
 RETURNS TABLE(project_id uuid, conversation_id uuid, parent_group_id uuid, title text, status text, target_end_date date, total integer, done integer, overdue integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.conversation_id, c.parent_group_id, p.title, p.status, p.target_end_date,
         count(t.id)::integer,
         count(t.id) filter (where t.done_at is not null)::integer,
         count(t.id) filter (where t.done_at is null and t.status <> 'skipped' and t.deadline_date < current_date)::integer
  from public.projects p
  join public.conversations c on c.id = p.conversation_id
  left join public.project_tasks pt on pt.project_id = p.id
  left join public.tasks t on t.id = pt.task_id and t.pending_decision_id is null and not t.deleted_by_creator
  where (select private.session_allowed())
    and p.deleted_at is null
    and private.is_conversation_participant(p.conversation_id, (select auth.uid()))
    and private.conversation_is_live(p.conversation_id)
  group by p.id, c.parent_group_id
  order by p.updated_at desc
  limit 200;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_scheduled_messages(p_conversation_id uuid)
 RETURNS SETOF scheduled_messages
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select * from public.scheduled_messages
  where sender_id = auth.uid() and conversation_id = p_conversation_id and status in ('pending', 'failed')
  order by send_at;
$function$;

CREATE OR REPLACE FUNCTION public.list_shared_trash()
 RETURNS TABLE(table_id uuid, name text, conversation_id uuid, project_id uuid, deleted_at timestamp with time zone, proposed_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select t.id, t.name, t.conversation_id, t.project_id, t.deleted_at, private.public_name(p.proposed_by)
  from think_hub_table t join shared_proposals p on p.id = t.deleted_via
  where t.deleted_at is not null and (t.conversation_id is not null or t.project_id is not null)
    and private.think_hub_table_visible(t.id, auth.uid())
    and private.is_proposal_party(t.deleted_via, auth.uid())
  order by t.deleted_at desc
$function$;

CREATE OR REPLACE FUNCTION public.log_activity(p_kind text, p_item_key text, p_day date, p_open boolean, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_seconds integer := greatest(0, least(coalesce(p_seconds, 0), 120));
  v_open boolean := coalesce(p_open, false);
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_kind is null or p_item_key is null or p_day is null then raise exception 'avora_activity_not_allowed'; end if;
  -- The device's own day, within a day of the server's.
  if p_day < current_date - 1 or p_day > current_date + 1 then raise exception 'avora_activity_bad_day'; end if;
  if p_kind = 'board' then
    if not private.activity_board_key_ok(p_item_key, v_user) then raise exception 'avora_activity_not_allowed'; end if;
    -- Két sắt boards: only that it was opened (ADR-034).
    if p_item_key in ('cashflow','loans','payment_calendar','expiring_docs','assets') then v_seconds := 0; end if;
  elsif p_kind = 'book' then
    if p_item_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (
      select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
      where r.id = p_item_key::uuid and r.owner_user_id = v_user and t.owner_user_id = v_user and t.kind = 'bookshelf' and r.deleted_at is null
    ) then raise exception 'avora_activity_not_allowed'; end if;
  else
    raise exception 'avora_activity_not_allowed';
  end if;
  if not v_open and v_seconds = 0 then return; end if;

  insert into public.activity_daily as a (user_id, kind, item_key, day, opens, active_seconds, last_open_at)
  values (v_user, p_kind, p_item_key, p_day, case when v_open then 1 else 0 end, v_seconds, case when v_open then now() end)
  on conflict (user_id, kind, item_key, day) do update set
    active_seconds = least(57600, a.active_seconds + excluded.active_seconds),
    opens = a.opens + case when v_open and (a.last_open_at is null or a.last_open_at < now() - interval '30 minutes') then 1 else 0 end,
    last_open_at = case when v_open and (a.last_open_at is null or a.last_open_at < now() - interval '30 minutes') then now() else a.last_open_at end;

  -- A day can roll over between rows: an open 20 minutes ago yesterday still counts as the same visit.
  if v_open then
    update public.activity_daily set opens = opens - 1, last_open_at = null
    where user_id = v_user and kind = p_kind and item_key = p_item_key and day = p_day and opens > 0 and last_open_at = now()
      and exists (select 1 from public.activity_daily y where y.user_id = v_user and y.kind = p_kind and y.item_key = p_item_key
                  and y.day <> p_day and y.last_open_at >= now() - interval '30 minutes');
  end if;

  insert into private.activity_pruned as p (user_id, pruned_on) values (v_user, current_date)
  on conflict (user_id) do update set pruned_on = excluded.pruned_on where p.pruned_on < excluded.pruned_on;
  if found then delete from public.activity_daily where user_id = v_user and day < current_date - 180; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.log_client_error(p_app_version text, p_platform text, p_route text, p_error_name text, p_message_short text, p_stack_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.client_error_write(auth.uid(), p_app_version, p_platform, p_route, p_error_name, p_message_short, p_stack_hash);
end $function$;

CREATE OR REPLACE FUNCTION public.log_habit(p_id uuid, p_habit uuid, p_local_date date, p_window integer, p_source text DEFAULT 'manual'::text, p_duration_seconds integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits; v_existing uuid;
begin
  perform private.assert_feature('habits');
  v := private.habit_owned(p_habit, v_uid);
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  if p_window is null or p_window < 0 or p_window >= jsonb_array_length(v.windows) then raise exception 'avora_habit_window' using errcode = '22023'; end if;
  select id into v_existing from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  if v_existing is not null then return v_existing; end if;
  insert into public.habit_logs (id, habit_id, user_id, local_date, window_index, status, source, duration_seconds)
  values (coalesce(p_id, gen_random_uuid()), p_habit, v_uid, p_local_date, p_window, 'done',
          case when p_source = 'timer' then 'timer' else 'manual' end,
          case when v.kind = 'timed' then p_duration_seconds end)
  on conflict do nothing
  returning id into v_existing;
  if v_existing is null then
    select id into v_existing from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  end if;
  return v_existing;
end $function$;

CREATE OR REPLACE FUNCTION public.lost_device_dispute(p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.lost_status is distinct from 'pending' then raise exception 'avora_device_lost_settled'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  perform private.resolve_lost(v_me.id, 'reject');
end $function$;

CREATE OR REPLACE FUNCTION public.mark_1_1_task_done(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared';
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Accountability: the creator reviews, so the creator may not also file the claim.
  if v_uid = v_row.creator_id then
    raise exception 'avora_task_only_assignee_marks_done';
  end if;

  if v_row.status = 'pending_confirmation' then
    raise exception 'avora_task_not_confirmed';
  end if;

  if v_row.status = 'confirmed' then
    update public.tasks
    set status = 'done_pending_review', done_at = now(), updated_at = now()
    where id = p_task_id and status = 'confirmed';
  end if;
  -- already in review, or already reviewed: retry is a no-op success

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_board_opened(p_board_key text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_id uuid; v_at timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_board_key is null or char_length(p_board_key) not between 1 and 64 then raise exception 'avora_bad_board'; end if;
  if p_board_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := p_board_key::uuid;
    if not private.think_hub_table_visible(v_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  elsif p_board_key not in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','habits','cashflow','summary','loans','payment_calendar','expiring_docs','assets') then
    raise exception 'avora_bad_board';
  end if;
  insert into public.think_hub_board_opened as o (user_id, board_key, opened_at)
  values (v_user, p_board_key, now())
  on conflict (user_id, board_key) do update set opened_at = excluded.opened_at
    where o.opened_at < now() - interval '10 minutes'
  returning opened_at into v_at;
  if v_at is null then select opened_at into v_at from public.think_hub_board_opened where user_id = v_user and board_key = p_board_key; end if;
  return v_at;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_contact_card_notices_seen()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  update public.contact_card_notice set seen_at = now() where introduced_user_id = auth.uid() and seen_at is null;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_conversation_delivered(p_conversation uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation, v_uid, 'mark') then return 0; end if;
  if private.receipt_scope(p_conversation) is null then return 0; end if;
  insert into public.message_deliveries (message_id, user_id)
  select m.id, v_uid from public.messages m
  where m.conversation_id = p_conversation and m.sender_id <> v_uid and m.system_kind is null
    and m.created_at > now() - interval '30 days'
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid, p_up_to uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_latest timestamptz; v_result timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000'; end if;
  if not private.can_act_in(p_conversation_id, v_user, 'mark') then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  if p_up_to is not null then
    -- Only as far as the device actually showed — a message that arrived after stays unread.
    select m.created_at into v_latest from public.messages m where m.id = p_up_to and m.conversation_id = p_conversation_id;
  else
    select max(m.created_at) into v_latest from public.messages m where m.conversation_id = p_conversation_id;
  end if;
  if v_latest is not null then
    insert into public.conversation_read_marks as r (conversation_id, user_id, last_read_at)
    values (p_conversation_id, v_user, v_latest)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at
      where r.last_read_at < excluded.last_read_at;
  end if;
  select last_read_at into v_result from public.conversation_read_marks where conversation_id = p_conversation_id and user_id = v_user;
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_messages_delivered(p_message_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  -- AVORA-108: 1-1 and groups of ≤ 100; never one's own line, never across a block, never a system line.
  insert into message_deliveries (message_id, user_id)
  select m.id, v_uid
  from messages m
  where m.id = any (p_message_ids)
    and m.sender_id <> v_uid
    and m.system_kind is null
    and private.receipt_scope(m.conversation_id) is not null
    and private.can_act_in(m.conversation_id, v_uid, 'mark')
    and not private.is_blocked_between(v_uid, m.sender_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_shared_task_done_with_output(p_task_id uuid, p_output_value text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before text;
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  select status into v_before from public.tasks where id = p_task_id;

  -- Every accountability rule lives in the original one-argument version: participant,
  -- assignee-only, not-pending, idempotent retries. This wrapper adds only the output,
  -- so the two can never disagree about who may claim a task done.
  v_row := public.mark_shared_task_done(p_task_id);

  -- The claim is the only moment the assignee states their output. Once the creator has
  -- reviewed, the record is closed: a retried call must not rewrite what was already judged.
  if v_before in ('confirmed', 'done_pending_review') then
    update public.tasks
    set output_value = nullif(trim(p_output_value), '')
    where id = p_task_id;
    select * into v_row from public.tasks where id = p_task_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_shared_task_done(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
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

  -- Accountability: the creator reviews, so the creator may not also file the claim.
  if v_uid = v_row.creator_id then
    raise exception 'avora_task_only_assignee_marks_done';
  end if;

  if not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_assignee';
  end if;

  if v_row.status = 'pending_confirmation' then
    raise exception 'avora_task_not_confirmed';
  end if;

  if v_row.status = 'confirmed' then
    update public.tasks
    set status = 'done_pending_review', done_at = now(), updated_at = now()
    where id = p_task_id and status = 'confirmed';
  end if;
  -- already in review, or already reviewed: retry is a no-op success

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_think_hub_table_seen(p_table_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_prev timestamptz;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  -- Runs as the caller: the insert policy (think_hub_table_seen_own_write) checks the board is theirs.
  select seen_at into v_prev from think_hub_table_seen where user_id = v_user and table_id = p_table_id;
  insert into think_hub_table_seen (user_id, table_id, seen_at) values (v_user, p_table_id, now())
  on conflict (user_id, table_id) do update set seen_at = excluded.seen_at;
  return v_prev;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_unread_from(p_message_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_msg messages%rowtype;
  v_mark timestamptz;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'AVORA_NOT_SIGNED_IN' using errcode = '28000'; end if;
  select * into v_msg from messages where id = p_message_id;
  if v_msg.id is null or not private.can_act_in(v_msg.conversation_id, v_uid, 'mark') then
    raise exception 'AVORA_NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  -- Just before that message: it and everything after it count as unread again. Only the
  -- caller's own mark moves; nothing reaches the sender.
  v_mark := v_msg.created_at - interval '1 microsecond';
  insert into conversation_read_marks as r (conversation_id, user_id, last_read_at)
  values (v_msg.conversation_id, v_uid, v_mark)
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_mark;
end $function$;

CREATE OR REPLACE FUNCTION public.merge_contacts(p_keep uuid, p_drop uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_keep public.contact%rowtype; v_drop public.contact%rowtype; v_log uuid;
  v_channels uuid[]; v_added uuid[] := '{}'; v_opps uuid[]; v_tx uuid[]; v_inv uuid[]; v_staff uuid[]; v_ch public.contact_channel%rowtype;
  v_filled jsonb := '{}'::jsonb;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_keep = p_drop then raise exception 'avora_contact_merge_same'; end if;
  select * into v_keep from public.contact where id = p_keep and owner_user_id = v_uid for update;
  select * into v_drop from public.contact where id = p_drop and owner_user_id = v_uid for update;
  if v_keep.id is null or v_drop.id is null then raise exception 'avora_contact_not_found'; end if;
  if v_keep.contact_type <> v_drop.contact_type then raise exception 'avora_contact_merge_type'; end if;

  -- Channels of the dropped contact move (or, when the kept one already has the value, stay behind
  -- and are restored on undo with the row).
  select coalesce(array_agg(id), '{}') into v_channels from public.contact_channel ch
   where ch.contact_id = p_drop
     and not exists (select 1 from public.contact_channel k where k.contact_id = p_keep and k.kind = ch.kind and k.value_normalized = ch.value_normalized)
     and not (ch.kind = 'phone' and ch.value_normalized = private.normalize_channel('phone', v_keep.phone))
     and not (ch.kind = 'email' and ch.value_normalized = private.normalize_channel('email', v_keep.email));
  update public.contact_channel set contact_id = p_keep where id = any (v_channels);
  if nullif(btrim(coalesce(v_drop.phone, '')), '') is not null then
    if nullif(btrim(coalesce(v_keep.phone, '')), '') is null then
      update public.contact set phone = v_drop.phone where id = p_keep; v_filled := v_filled || jsonb_build_object('phone', true);
    else
      v_ch := public.add_contact_channel(p_keep, 'phone', v_drop.phone, 'manual', null, false);
      if v_ch.id is not null and v_ch.created_at > now() - interval '1 second' then v_added := v_added || v_ch.id; end if;
    end if;
  end if;
  if nullif(btrim(coalesce(v_drop.email, '')), '') is not null then
    if nullif(btrim(coalesce(v_keep.email, '')), '') is null then
      update public.contact set email = v_drop.email where id = p_keep; v_filled := v_filled || jsonb_build_object('email', true);
    else
      v_ch := public.add_contact_channel(p_keep, 'email', v_drop.email, 'manual', null, false);
      if v_ch.id is not null and v_ch.created_at > now() - interval '1 second' then v_added := v_added || v_ch.id; end if;
    end if;
  end if;
  if v_keep.note is null and v_drop.note is not null then update public.contact set note = v_drop.note where id = p_keep; v_filled := v_filled || jsonb_build_object('note', true); end if;
  if v_keep.date_of_birth is null and v_drop.date_of_birth is not null then update public.contact set date_of_birth = v_drop.date_of_birth where id = p_keep; v_filled := v_filled || jsonb_build_object('date_of_birth', true); end if;

  select coalesce(array_agg(id), '{}') into v_opps from public.crm_opportunity where contact_id = p_drop;
  update public.crm_opportunity set contact_id = p_keep where id = any (v_opps);
  select coalesce(array_agg(id), '{}') into v_tx from public.transactions where contact_id = p_drop;
  update public.transactions set contact_id = p_keep where id = any (v_tx);
  select coalesce(array_agg(id), '{}') into v_inv from public.contact_invite where contact_id = p_drop;
  update public.contact_invite set contact_id = p_keep where id = any (v_inv);
  select coalesce(array_agg(id), '{}') into v_staff from public.contact where employer_contact_id = p_drop;
  update public.contact set employer_contact_id = p_keep where id = any (v_staff);

  insert into private.contact_merge_log (owner_user_id, keep_id, dropped, moved)
  values (v_uid, p_keep, to_jsonb(v_drop), jsonb_build_object('channels', v_channels, 'added', v_added, 'opportunities', v_opps,
          'transactions', v_tx, 'invites', v_inv, 'staff', v_staff, 'filled', v_filled))
  returning id into v_log;
  delete from public.contact where id = p_drop;
  return v_log;
end $function$;

CREATE OR REPLACE FUNCTION public.message_edit_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    interval '24 hours';
$function$;

CREATE OR REPLACE FUNCTION public.message_pin_limit()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    3;
$function$;

CREATE OR REPLACE FUNCTION public.messages_page(p_conversation uuid, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS SETOF messages
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  if not private.can_act_in(p_conversation, auth.uid(), 'read') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  return query
    select m.* from public.messages m
    where m.conversation_id = p_conversation and m.trashed_at is null
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $function$;

CREATE OR REPLACE FUNCTION public.move_think_hub_record(p_record_id uuid, p_target_table_id uuid, p_append_unmatched_to_notes boolean)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid(); v jsonb; r think_hub_record%rowtype; src think_hub_table%rowtype; dst think_hub_table%rowtype;
  v_lines text[];
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into r from think_hub_record where id = p_record_id and deleted_at is null for update;
  v := private.plan_record_transfer(p_record_id, p_target_table_id, v_user);
  if v->>'move_block' = 'has_subtable' then raise exception 'avora_record_has_subtable'; end if;
  if v->>'move_block' = 'shared' then raise exception 'avora_record_move_shared'; end if;
  if v->>'move_block' = 'not_owner' then raise exception 'avora_think_hub_record_not_yours'; end if;
  if v->>'move_block' = 'target_full' then raise exception 'avora_think_hub_record_limit'; end if;
  if jsonb_array_length(v->'unmatched') > 0 and coalesce(p_append_unmatched_to_notes, false) is not true then
    raise exception 'avora_record_move_unmatched';
  end if;

  select * into src from think_hub_table where id = r.table_id;
  select * into dst from think_hub_table where id = p_target_table_id;
  perform private.assert_direct_talk(dst.conversation_id, v_user, 'rich');

  select array_agg((u->>'label') || ': ' || (u->>'value')) into v_lines from jsonb_array_elements(v->'unmatched') u;

  if (v->>'project_links_dropped')::int > 0 then
    update project_tasks set record_id = null where record_id = r.id;
  end if;
  if (v->>'record_links_dropped')::int > 0 then
    delete from think_hub_record_tasks where record_id = r.id;
  end if;

  perform set_config('avora.record_move', 'on', true);
  update think_hub_record set
    table_id = dst.id,
    status = v->>'status_to_key',
    extension_fields = v->'extension_fields',
    notes = private.notes_with(notes, coalesce(v_lines, '{}')),
    project_id = null,
    moved_from = jsonb_build_object('table_id', src.id, 'table_name', src.name, 'at', now())
  where id = r.id returning * into r;
  perform set_config('avora.record_move', 'off', true);
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.move_think_hub_table(p_table_id uuid, p_conversation_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'edit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid(); v_table think_hub_table%rowtype; v_type text; v_prop shared_proposals%rowtype; v_msg uuid; v_words text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_mode not in ('edit', 'view') then raise exception 'avora_board_move_mode'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_table.owner_user_id <> v_uid then raise exception 'avora_board_move_owner_only'; end if;
  if v_table.parent_record_id is not null then raise exception 'avora_board_move_sub_table'; end if;
  if v_table.kind = 'bookshelf' or v_table.project_id is not null then raise exception 'avora_board_move_locked'; end if;
  if v_table.archived_at is not null then raise exception 'avora_table_archived'; end if;
  if v_table.conversation_id is not distinct from p_conversation_id then
    if p_conversation_id is not null and v_table.share_mode <> p_mode then
      update think_hub_table set share_mode = p_mode where id in (select id from private.think_hub_table_tree(p_table_id));
      return jsonb_build_object('status', 'mode_changed');
    end if;
    raise exception 'avora_board_move_same';
  end if;

  if p_conversation_id is not null then
    select type into v_type from conversations where id = p_conversation_id and deleted_at is null;
    if v_type is null or v_type not in ('direct', 'group') or not private.is_conversation_participant(p_conversation_id, v_uid)
       or not private.conversation_is_live(p_conversation_id) then
      raise exception 'avora_not_a_participant';
    end if;
    if v_type = 'direct' then
      -- Raises avora_not_connected / avora_contact_unavailable / avora_verification_text_only.
      perform private.assert_direct_talk(p_conversation_id, v_uid, 'rich');
    end if;
  end if;

  if v_table.conversation_id is not null and private.board_has_others(p_table_id, v_uid) then
    if exists (select 1 from shared_proposals where target_type = 'think_hub_table' and target_id = p_table_id and status = 'open') then
      raise exception 'avora_proposal_already_open';
    end if;
    v_words := 'Chuyển sang ' || private.board_place_label(p_conversation_id, v_uid);
    insert into shared_proposals (action, target_type, target_id, target_name, conversation_id, proposed_by, reason, move_to_conversation, move_mode)
    values ('move', 'think_hub_table', p_table_id, v_table.name, v_table.conversation_id, v_uid, left(v_words, 300), p_conversation_id, p_mode)
    returning * into v_prop;
    insert into shared_proposal_votes (proposal_id, user_id)
    select v_prop.id, s.user_id from private.proposal_stakeholders('think_hub_table', p_table_id, v_uid) s;
    v_msg := private.post_system_line(v_table.conversation_id, v_uid, 'proposal_opened',
      format('%s đề nghị %s · Lý do: %s', private.public_name(v_uid), private.proposal_words('move', 'think_hub_table', v_table.name), v_words));
    update shared_proposals set message_id = v_msg where id = v_prop.id;
    perform private.settle_proposal(v_prop.id, v_uid);
    select * into v_prop from shared_proposals where id = v_prop.id;
    return jsonb_build_object('status', case when v_prop.status = 'approved' then 'moved' else 'proposed' end, 'proposal_id', v_prop.id);
  end if;

  perform private.move_board_tree(p_table_id, p_conversation_id, p_mode, v_uid);
  return jsonb_build_object('status', 'moved');
end $function$;

CREATE OR REPLACE FUNCTION public.my_habit_totals()
 RETURNS TABLE(habit_id uuid, done_total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select l.habit_id, count(*) from public.habit_logs l where l.user_id = (select auth.uid()) and l.status = 'done' group by l.habit_id
$function$;

CREATE OR REPLACE FUNCTION public.my_invite_gate()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('blocked', private.invite_blocks(auth.uid()))
$function$;

CREATE OR REPLACE FUNCTION public.my_storage_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_out jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  with mine as (
    select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as size, o.created_at,
      case
        when o.bucket_id = 'chat-attachments' and exists (select 1 from public.conversations c where c.id::text = split_part(o.name, '/', 1) and c.type = 'personal') then 'journal'
        when o.bucket_id in ('chat-attachments', 'meeting-files') then 'chat'
        when o.bucket_id = 'note-files' then 'journal'
        when o.bucket_id = 'board-files' then 'boards'
        when o.bucket_id = 'vault-files' then 'vault'
        else 'other'
      end as place
    from storage.objects o where o.owner = v_user and o.bucket_id <> 'public-domain-books'
  )
  select jsonb_build_object(
    'total_bytes', coalesce((select sum(size) from mine), 0),
    'by_place', coalesce((select jsonb_object_agg(place, jsonb_build_object('bytes', b, 'files', n)) from (select place, sum(size) b, count(*) n from mine group by place) x), '{}'::jsonb),
    'boards', (select count(*) from public.think_hub_table t where t.owner_user_id = v_user and t.deleted_at is null),
    'records', (select count(*) from public.think_hub_record r where r.owner_user_id = v_user and r.deleted_at is null),
    'largest', coalesce((select jsonb_agg(x) from (
      select place, bucket_id as bucket, name as path, split_part(name, '/', 1) as ref, regexp_replace(name, '^.*/', '') as file_name, size, created_at
      from mine order by size desc limit 20) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.open_thread(p_conversation uuid, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_out jsonb;
begin
  perform private.assert_session_allowed();
  if not private.can_act_in(p_conversation, v_uid, 'read') then raise exception 'avora_not_a_participant' using errcode = '42501'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select m.id from public.messages m
    where m.conversation_id = p_conversation and m.trashed_at is null
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)) x;
  select jsonb_build_object(
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'key_version' - 'algorithm_version' order by m.created_at, m.id)
                          from public.messages m where m.id = any (v_ids)), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) - 'key_version' - 'algorithm_version')
                             from public.message_attachments a where a.message_id = any (v_ids)), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('message_id', r.message_id, 'user_id', r.user_id, 'emoji', r.emoji))
                           from public.message_reactions r where r.message_id = any (v_ids)), '[]'::jsonb),
    'pins', coalesce((select jsonb_agg(to_jsonb(p)) from public.message_pins p
                      where p.conversation_id = p_conversation and (p.scope = 'group' or p.pinned_by = v_uid)), '[]'::jsonb),
    'summary', jsonb_build_object(
      'type', (select c.type from public.conversations c where c.id = p_conversation),
      'name', (select g.name from public.conversation_groups g where g.conversation_id = p_conversation),
      'member_count', (select count(*) from public.conversation_participants cp where cp.conversation_id = p_conversation),
      'can_send', private.can_act_in(p_conversation, v_uid, 'send')),
    'has_more', coalesce(array_length(v_ids, 1), 0) >= least(greatest(coalesce(p_limit, 30), 1), 100)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.opportunity_board()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  return private.ensure_opportunity_board(auth.uid());
end $function$;

CREATE OR REPLACE FUNCTION public.ops_health_summary(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  return private.health_summary(auth.uid(), p_days);
end $function$;

CREATE OR REPLACE FUNCTION public.ops_set_feature(p_key text, p_status text, p_note text DEFAULT NULL::text)
 RETURNS app_features
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  return private.feature_set(auth.uid(), p_key, p_status, p_note);
end $function$;

CREATE OR REPLACE FUNCTION public.pause_habit(p_id uuid, p_paused boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  perform private.assert_feature('habits');
  v := private.habit_owned(p_id, v_uid);
  update public.habits set paused_at = case when p_paused then coalesce(v.paused_at, now()) end, version = v.version + 1, updated_at = now() where id = p_id;
  return v.version + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.pin_message(p_message_id uuid, p_scope text)
 RETURNS message_pins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_conversation uuid;
  v_deleted timestamptz;
  v_row public.message_pins%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  if p_scope not in ('group', 'personal') then
    raise exception 'avora_pin_bad_scope';
  end if;

  select
    conversation_id,
    deleted_at into v_conversation,
    v_deleted
  from
    public.messages
  where
    id = p_message_id;
  if v_conversation is null then
    raise exception 'avora_message_not_found';
  end if;

  perform private.assert_can_act_in (v_conversation, v_uid, 'pin');

  -- A withdrawn message has no words left to point at, so pinning it would put an empty
  -- placeholder on the noticeboard.
  if v_deleted is not null then
    raise exception 'avora_message_recalled';
  end if;

  -- A shared pin speaks for the room, so it belongs to the seats that answer for it.
  if p_scope = 'group'
    and not private.is_group_officer (v_conversation, v_uid) then
    raise exception 'avora_pin_officers_only';
  end if;

  -- Already pinned for this audience: a retry is a no-op success, and must not consume a
  -- second slot of the quota.
  if p_scope = 'group' then
    select
      * into v_row
    from
      public.message_pins
    where
      conversation_id = v_conversation
      and message_id = p_message_id
      and scope = 'group';
  else
    select
      * into v_row
    from
      public.message_pins
    where
      conversation_id = v_conversation
      and message_id = p_message_id
      and scope = 'personal'
      and pinned_by = v_uid;
  end if;

  if found then
    return v_row;
  end if;

  insert into public.message_pins (message_id, conversation_id, pinned_by, scope)
    values (p_message_id, v_conversation, v_uid, p_scope)
  returning
    * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.place_on_desk(p_table_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if exists (select 1 from public.think_hub_desk where user_id = v_user and table_id = p_table_id) then
    return (select count(*) from public.think_hub_desk where user_id = v_user);
  end if;
  -- One person at a time: a second tab cannot slip a sixth one in.
  perform pg_advisory_xact_lock(hashtextextended('avora_desk:' || v_user::text, 0));
  select count(*) into v_count from public.think_hub_desk where user_id = v_user;
  if v_count >= 5 then raise exception 'avora_desk_full'; end if;
  insert into public.think_hub_desk (user_id, table_id) values (v_user, p_table_id);
  return v_count + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.post_project_thanks(p_project_id uuid, p_body text)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_message uuid;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF NOT private.project_owned_by(p_project_id, v_uid) THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.status <> 'done' OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_thanks_not_closed'; END IF;
  IF v_project.thanks_message_id IS NOT NULL THEN RAISE EXCEPTION 'avora_project_thanks_already'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'avora_project_thanks_empty'; END IF;
  IF char_length(v_body) > 4000 THEN RAISE EXCEPTION 'avora_project_thanks_too_long'; END IF;

  PERFORM set_config('avora.project_system', 'on', true);
  INSERT INTO messages (conversation_id, sender_id, content)
  VALUES (v_project.conversation_id, v_uid, v_body)
  RETURNING id INTO v_message;
  PERFORM set_config('avora.project_system', 'off', true);

  INSERT INTO message_pins (message_id, conversation_id, pinned_by, scope)
  VALUES (v_message, v_project.conversation_id, v_uid, 'group');

  UPDATE projects SET thanks_message_id = v_message WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_contact_invite(p_token text)
 RETURNS TABLE(inviter_name text, status text, is_own_invite boolean, already_linked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite  contact_invite%ROWTYPE;
  v_contact contact%ROWTYPE;
  v_status  text;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_invite FROM contact_invite
  WHERE invite_token = nullif(btrim(p_token), '');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- AVORA-37 / A: between a blocked pair the invite reads exactly as if it did not exist.
  IF private.is_blocked_between(v_invite.invited_by, auth.uid()) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.preview_contact_link(p_contact_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_match record;
  v_dismissed text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_match from private.contact_link_match (p_contact_id, v_uid);
  if v_match.user_id is null then return null; end if;

  select link_suggestion_dismissed into v_dismissed from public.contact where id = p_contact_id;
  if v_dismissed = private.contact_link_fingerprint (p_contact_id, v_match.user_id) then
    return null;
  end if;

  return v_match.matched_by;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_group_invite(p_token uuid)
 RETURNS TABLE(conversation_id uuid, group_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversation_id uuid;
  v_name text;
begin
  perform private.assert_session_allowed();
  select l.conversation_id, g.name into v_conversation_id, v_name
    from public.group_invite_links l
    join public.conversation_groups g on g.conversation_id = l.conversation_id
    where l.token = p_token and l.revoked_at is null and l.expires_at > now();
  if v_conversation_id is null then
    raise exception 'Invite link not found';
  end if;
  conversation_id := v_conversation_id;
  group_name := v_name;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_shared_stakeholders(p_target_type text, p_target_id uuid)
 RETURNS TABLE(user_id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_conv uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_conv := private.proposal_conversation(p_target_type, p_target_id);
  if v_conv is null or not private.is_conversation_participant(v_conv, v_uid) then raise exception 'avora_not_a_participant'; end if;
  return query select s.user_id, private.public_name(s.user_id) from private.proposal_stakeholders(p_target_type, p_target_id, v_uid) s;
end $function$;

CREATE OR REPLACE FUNCTION public.preview_think_hub_record_transfer(p_record_id uuid, p_target_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  v := private.plan_record_transfer(p_record_id, p_target_table_id, auth.uid());
  return v - 'extension_fields' - 'status_to_key';
end $function$;

CREATE OR REPLACE FUNCTION public.preview_think_hub_table_delete(p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  select jsonb_build_object(
    'records', (select count(*) from think_hub_record r join private.think_hub_table_tree(p_table_id) tr on tr.id = r.table_id
                where r.deleted_at is null and r.table_id = p_table_id),
    'sub_tables', (select count(*) - 1 from private.think_hub_table_tree(p_table_id) tr
                   join think_hub_table t on t.id = tr.id where t.deleted_at is null),
    'tasks', (select count(distinct t.id) from private.think_hub_table_tree(p_table_id) tr
              join think_hub_record r on r.table_id = tr.id
              left join think_hub_record_tasks rt on rt.record_id = r.id
              left join project_tasks pt on pt.record_id = r.id
              join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
              where not t.deleted_by_creator),
    'tasks_kept_by_assignee', (select count(distinct t.id) from private.think_hub_table_tree(p_table_id) tr
              join think_hub_record r on r.table_id = tr.id
              left join think_hub_record_tasks rt on rt.record_id = r.id
              left join project_tasks pt on pt.record_id = r.id
              join tasks t on t.id = coalesce(rt.task_id, pt.task_id)
              where t.type <> 'personal' and t.status not in ('done', 'skipped'))
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.promote_contact_channel(p_channel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_ch public.contact_channel%rowtype;
  v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_ch from public.contact_channel where id = p_channel_id and owner_user_id = v_uid;
  if not found then raise exception 'Không tìm thấy kênh liên hệ này'; end if;

  if v_ch.kind = 'phone' then
    select phone into v_old from public.contact where id = v_ch.contact_id and owner_user_id = v_uid;
    update public.contact set phone = v_ch.value where id = v_ch.contact_id and owner_user_id = v_uid;
  else
    select email into v_old from public.contact where id = v_ch.contact_id and owner_user_id = v_uid;
    update public.contact set email = v_ch.value where id = v_ch.contact_id and owner_user_id = v_uid;
  end if;

  if coalesce (btrim (v_old), '') = '' then
    delete from public.contact_channel where id = v_ch.id;
  else
    update public.contact_channel set value = v_old, value_normalized = private.normalize_channel (v_ch.kind, v_old), label = null
    where id = v_ch.id;
  end if;

  update public.contact_channel set needs_review = false
  where contact_id = v_ch.contact_id and kind = v_ch.kind and owner_user_id = v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.propose_shared_action(p_action text, p_target_type text, p_target_id uuid, p_reason text)
 RETURNS shared_proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
  v_conv uuid; v_name text; v_table think_hub_table%rowtype; v_project projects%rowtype; v_conv_row conversations%rowtype;
  v_row shared_proposals%rowtype; v_msg uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_reason = '' then raise exception 'avora_proposal_reason_required'; end if;
  if char_length(v_reason) > 300 then raise exception 'avora_proposal_reason_too_long'; end if;
  if p_action not in ('delete', 'archive', 'reopen') or p_target_type not in ('think_hub_table', 'group', 'project') then
    raise exception 'avora_proposal_action_invalid';
  end if;

  if p_target_type = 'think_hub_table' then
    select * into v_table from think_hub_table where id = p_target_id and deleted_at is null;
    if not found or not private.think_hub_table_visible(p_target_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
    if v_table.conversation_id is null and v_table.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
    if v_table.project_id is not null and v_table.parent_record_id is null then raise exception 'avora_think_hub_project_root_locked'; end if;
    if p_action in ('archive', 'reopen') and (v_table.parent_record_id is not null or v_table.project_id is not null) then
      raise exception 'avora_proposal_action_invalid';
    end if;
    if p_action = 'archive' and v_table.archived_at is not null then raise exception 'avora_table_archived'; end if;
    if p_action = 'reopen' and v_table.archived_at is null then raise exception 'avora_proposal_action_invalid'; end if;
    v_name := v_table.name;
  elsif p_target_type = 'group' then
    select * into v_conv_row from conversations where id = p_target_id and deleted_at is null and type = 'group';
    if not found or exists (select 1 from projects where conversation_id = p_target_id) or p_action <> 'delete' then
      raise exception 'avora_proposal_action_invalid';
    end if;
    select coalesce(name, 'Nhóm') into v_name from conversation_groups where conversation_id = p_target_id;
  else
    select * into v_project from projects where id = p_target_id and deleted_at is null;
    if not found then raise exception 'avora_project_missing'; end if;
    if p_action = 'archive' then raise exception 'avora_proposal_action_invalid'; end if;
    if p_action = 'reopen' and v_project.status = 'active' then raise exception 'avora_proposal_action_invalid'; end if;
    v_name := v_project.title;
  end if;

  v_conv := private.proposal_conversation(p_target_type, p_target_id);
  if v_conv is null or not private.is_conversation_participant(v_conv, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if not private.conversation_is_live(v_conv) and not (p_target_type = 'project') then raise exception 'avora_not_a_participant'; end if;
  if exists (select 1 from shared_proposals where target_type = p_target_type and target_id = p_target_id and status = 'open') then
    raise exception 'avora_proposal_already_open';
  end if;

  insert into shared_proposals (action, target_type, target_id, target_name, conversation_id, proposed_by, reason)
  values (p_action, p_target_type, p_target_id, coalesce(v_name, ''), v_conv, v_uid, v_reason)
  returning * into v_row;
  insert into shared_proposal_votes (proposal_id, user_id)
  select v_row.id, s.user_id from private.proposal_stakeholders(p_target_type, p_target_id, v_uid) s;

  v_msg := private.post_system_line(v_conv, v_uid, 'proposal_opened',
    format('%s đề nghị %s · Lý do: %s', private.public_name(v_uid), private.proposal_words(p_action, p_target_type, v_name), v_reason));
  update shared_proposals set message_id = v_msg where id = v_row.id returning * into v_row;

  -- Nobody else ever touched it: nobody to wait for.
  perform private.settle_proposal(v_row.id, v_uid);
  select * into v_row from shared_proposals where id = v_row.id;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.purge_account(p_account_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from accounts where id = p_account_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_account_not_yours'; end if;
  if exists (select 1 from transactions where account_id = p_account_id and business_related) then
    raise exception 'avora_finance_business_no_purge';
  end if;
  if exists (select 1 from transactions where account_id = p_account_id and removed_at is null) then
    raise exception 'avora_account_has_live_transactions';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_row.name) then raise exception 'avora_confirm_name_mismatch'; end if;
  delete from transactions where account_id = p_account_id;
  delete from accounts where id = p_account_id;
end $function$;

CREATE OR REPLACE FUNCTION public.purge_think_hub_table(p_table_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or v_row.owner_user_id <> v_user then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_row.conversation_id is not null or v_row.project_id is not null then
    raise exception 'avora_shared_no_purge';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_row.name) then
    raise exception 'avora_confirm_name_mismatch';
  end if;
  delete from think_hub_delete_cascade where table_id = p_table_id;
  delete from think_hub_table where id = p_table_id;
end $function$;

CREATE OR REPLACE FUNCTION public.purge_transaction(p_transaction_id uuid, p_confirm text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if v_row.business_related then raise exception 'avora_finance_business_no_purge'; end if;
  if btrim(coalesce(p_confirm, '')) <> private.transaction_confirm_word(v_row.description) then
    raise exception 'avora_confirm_name_mismatch';
  end if;
  delete from transactions where id = p_transaction_id;
end $function$;

CREATE OR REPLACE FUNCTION public.push_claim_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_out jsonb := '[]'::jsonb; g record; v_title text; v_body text; v_count integer; v_last messages%rowtype;
  v_read timestamptz; v_show boolean; v_tz text; v_task tasks%rowtype; v_subs jsonb; v_url text; v_ids uuid[];
  v_mention boolean;
begin
  perform private.assert_session_allowed();
  perform private.enqueue_due_reminders();
  perform private.enqueue_due_habits();
  -- Rows a crashed run left half-sent go back in the queue; old rows are cleared (7 days).
  update push_outbox set status = 'pending' where status in ('sending', 'claimed') and sent_at is null and created_at < now() - interval '5 minutes';
  delete from push_outbox where created_at < now() - interval '7 days';

  -- Messages and friend requests: one notification per (person, conversation), replacing the last (tag).
  -- K2 · C12: rows are locked (SKIP LOCKED) and marked before grouping, so a parallel run cannot take them.
  update push_outbox set status = 'claimed' where id in (
    select o.id from push_outbox o where o.status = 'pending' and o.kind in ('message', 'friend_request')
      and o.send_after <= now() order by o.id limit 2000 for update skip locked);
  for g in
    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest
    from push_outbox o
    where o.status = 'claimed' and o.kind in ('message', 'friend_request')
    group by o.user_id, o.conversation_id, o.kind
    having min(o.send_after) <= now()
    limit 200
  loop
    update push_outbox set status = 'sending' where id = any (g.ids);
    select last_read_at into v_read from conversation_read_marks where conversation_id = g.conversation_id and user_id = g.user_id;
    select count(*) into v_count from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
        and m.created_at > coalesce(v_read, '-infinity'::timestamptz);
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id)
       or private.push_mute_blocks(g.user_id, coalesce(private.push_surface(g.conversation_id), 'direct'), g.conversation_id,
            false, exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}'))),
            exists (select 1 from push_outbox o join messages m on m.id = o.message_id where o.id = any (g.ids) and m.is_urgent)) then
      -- Already read in the app (or nothing left to say): no push.
      update push_outbox set status = 'skipped', sent_at = now() where id = any (g.ids);
      continue;
    end if;
    select m.* into v_last from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
      order by m.created_at desc limit 1;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_mention := g.user_id = any (coalesce(v_last.mentioned_user_ids, '{}'));
    if g.kind = 'friend_request' then
      v_title := 'AVORA';
      v_body := 'Có người muốn kết bạn';
    else
      v_title := coalesce((select name from conversation_groups where conversation_id = g.conversation_id), private.push_display_name(v_last.sender_id));
      if coalesce(v_show, false) then
        v_body := case
          when btrim(v_last.content) <> '' then left(btrim(v_last.content), 80)
          when exists (select 1 from message_attachments a where a.message_id = v_last.id and a.kind = 'image') then '[Ảnh]'
          else '[Tệp]' end;
        if v_count > 1 then v_body := format('(%s) %s', v_count, v_body); end if;
      elsif exists (select 1 from push_outbox o join messages m on m.id = o.message_id
                    where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')))
            and exists (select 1 from conversations where id = g.conversation_id and type = 'group') then
        -- Being named is what matters most: said first, the count after.
        v_body := format('%s nhắc đến bạn', private.push_display_name(
          (select m.sender_id from push_outbox o join messages m on m.id = o.message_id
           where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')) order by m.created_at desc limit 1)))
          || case when v_count > 1 then format(' · %s tin nhắn mới', v_count) else '' end;
      elsif v_count > 1 then
        v_body := format('%s tin nhắn mới', v_count);
      else
        v_body := 'Tin nhắn mới';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', to_jsonb(g.ids), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', v_title, 'body', v_body, 'tag', g.conversation_id::text,
        'url', '/tin-nhan/' || g.conversation_id)));
  end loop;

  -- Reminders: one each.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'reminder' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    select push_show_content, coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_show, v_tz from profiles where id = g.user_id;
    v_task := null;
    if g.task_id is not null then select * into v_task from tasks where id = g.task_id; end if;
    if v_subs is null or (g.task_id is not null and (v_task.id is null or v_task.status in ('done', 'skipped'))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_body := case when (g.payload->>'go') = 'true' then 'Đến giờ đi: ' else 'Đến giờ: ' end
      || to_char(((g.payload->>'at')::timestamptz) at time zone v_tz, 'HH24:MI');
    if coalesce(v_show, false) then
      v_body := v_body || ' · ' || left(coalesce(v_task.title, g.payload->>'title', ''), 80);
    end if;
    v_url := case when g.task_id is not null then '/nhiem-vu?muc=viec&mo=' || g.task_id
                  else '/ke-hoach?bang=' || (g.payload->>'table_id') || '&hang-muc=' || (g.payload->>'record_id') end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'Nhắc việc', 'body', v_body, 'tag', 'nhac:' || coalesce(g.task_id::text, g.payload->>'record_id'), 'url', v_url)));
  end loop;
  -- AVORA-62 · board updates: only to the people a change concerns; mute was checked when queued.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'board' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', coalesce(g.payload->>'title', 'Kế hoạch'),
        'body', case when coalesce(v_show, false) then coalesce(g.payload->>'body', 'Bảng chung có thay đổi') else 'Bảng chung có thay đổi liên quan đến bạn' end,
        'tag', 'bang:' || coalesce(g.payload->>'table_id', g.id::text), 'url', coalesce(g.payload->>'url', '/ke-hoach'))));
  end loop;
  -- AVORA-51 · security alarms (Két sắt code reset / changed): always sent, no mute applies.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'security' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'AVORA · Két sắt', 'body', coalesce(g.payload->>'text', 'Mã Két sắt vừa thay đổi.'), 'tag', 'ket-sat:' || g.id, 'url', '/ket-sat')));
  end loop;
  -- AVORA-107 · Thói quen: nhẹ hơn nhắc việc; chỉ tên thói quen, theo luật ẩn nội dung. Khung đã làm thì bỏ.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'habit' and o.send_after <= now() order by o.created_at limit 200 for update skip locked
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null or not exists (select 1 from habits h where h.id = (g.payload->>'habit_id')::uuid and h.paused_at is null and h.archived_at is null)
       or exists (select 1 from habit_logs l where l.habit_id = (g.payload->>'habit_id')::uuid and l.status = 'done'
                  and l.local_date = split_part(g.dedupe_key, ':', 3)::date and l.window_index = split_part(g.dedupe_key, ':', 4)::integer) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    -- VMT 10/10 21:11 · báo đồng hồ đủ giờ khi app đóng (`ht:`): xét chế độ yên lặng lúc gửi, không lúc xếp hàng.
    if g.dedupe_key like 'ht:%' and exists (
      select 1 from profiles pr where pr.id = g.user_id and (
        not coalesce(pr.push_reminders, true)
        or (pr.focus_mode is not null and (pr.focus_until is null or pr.focus_until > now()))
        or extract(dow from (now() at time zone coalesce(pr.timezone, 'Asia/Ho_Chi_Minh')))::integer = coalesce(pr.rest_weekday, -1)
        or exists (select 1 from mute_settings m where m.user_id = pr.id and m.scope = 'avora' and m.muted_until > now()))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', case when g.dedupe_key like 'ht:%' then jsonb_build_object('title', 'Thói quen',
        'body', case when coalesce(v_show, false) then 'Đủ giờ: ' || left(coalesce(g.payload->>'title', ''), 80) else 'Đồng hồ thói quen đã đủ giờ' end,
        'tag', 'thoi-quen-dong-ho:' || (g.payload->>'habit_id'), 'url', '/nhiem-vu?muc=thoi-quen')
      else jsonb_build_object('title', 'Thói quen',
        'body', case when coalesce(v_show, false) then left(coalesce(g.payload->>'title', ''), 80) else 'Đến giờ thói quen của bạn' end,
        'tag', 'thoi-quen:' || (g.payload->>'habit_id'), 'url', '/nhiem-vu?muc=thoi-quen') end));
  end loop;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.push_report(p_sent uuid[], p_failed uuid[], p_gone text[], p_ok_endpoints text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  update push_outbox set status = 'sent', sent_at = now() where id = any (coalesce(p_sent, '{}'));
  update push_outbox set attempts = attempts + 1,
    status = case when attempts + 1 >= 3 then 'failed' else 'pending' end,
    send_after = now() + interval '1 minute'
  where id = any (coalesce(p_failed, '{}')) and not (id = any (coalesce(p_sent, '{}')));
  delete from push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
  update push_subscriptions set last_ok_at = now() where endpoint = any (coalesce(p_ok_endpoints, '{}'));
end $function$;

CREATE OR REPLACE FUNCTION public.recall_message(p_message_id uuid)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.recompute_account_state(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opening numeric(14,2);
  v_first date;
  v_created date;
begin
  perform private.assert_session_allowed();
  select opening_balance, created_at::date into v_opening, v_created
  from public.accounts where id = p_account_id;
  if not found then return; end if;

  update public.accounts a
  set balance = v_opening + coalesce((
        select sum(private.transaction_signed_amount(t.type, t.amount))
        from public.transactions t
        where t.account_id = a.id and t.deleted_at is null and t.removed_at is null
      ), 0)
  where a.id = p_account_id;

  delete from public.account_balance_history where account_id = p_account_id;

  select min(transaction_date) into v_first
  from public.transactions where account_id = p_account_id and deleted_at is null and removed_at is null;

  insert into public.account_balance_history (account_id, balance_date, balance)
  values (p_account_id, least(v_created, coalesce(v_first, v_created) - 1), v_opening);

  insert into public.account_balance_history (account_id, balance_date, balance)
  select p_account_id, x.d,
         v_opening + sum(x.delta) over (order by x.d rows between unbounded preceding and current row)
  from (
    select t.transaction_date as d,
           sum(private.transaction_signed_amount(t.type, t.amount)) as delta
    from public.transactions t
    where t.account_id = p_account_id and t.deleted_at is null and t.removed_at is null
    group by t.transaction_date
  ) x
  on conflict (account_id, balance_date) do update set balance = excluded.balance;
end $function$;

CREATE OR REPLACE FUNCTION public.record_argon_bench(p_device_kind text, p_browser text, p_standalone boolean, p_profile text, p_runs_ms integer[], p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  -- A page refresh loop must not flood the table: 20 rows a minute is far above any honest run.
  if (select count(*) from private.argon_bench where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'avora_rate_limited';
  end if;
  insert into private.argon_bench (device_kind, browser, standalone, profile, runs_ms, error)
  values (p_device_kind, left(p_browser, 40), coalesce(p_standalone, false), p_profile,
          coalesce(p_runs_ms, '{}'), left(p_error, 120));
end $function$;

CREATE OR REPLACE FUNCTION public.record_project_success_criterion(p_criterion_id uuid, p_actual_percent numeric DEFAULT NULL::numeric, p_meeting_note_id uuid DEFAULT NULL::uuid)
 RETURNS project_success_criteria
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_success_criteria%ROWTYPE;
  v_conversation uuid;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM project_success_criteria WHERE id = p_criterion_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.project_owned_by(v_row.project_id, v_uid) THEN
    RAISE EXCEPTION 'avora_project_not_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = v_row.project_id AND status <> 'active') THEN
    RAISE EXCEPTION 'avora_project_closed';
  END IF;

  IF v_row.measurement_type = 'percentage' THEN
    IF p_meeting_note_id IS NOT NULL THEN
      RAISE EXCEPTION 'avora_criterion_evidence_mismatch';
    END IF;
    UPDATE project_success_criteria SET actual_percent = p_actual_percent
    WHERE id = p_criterion_id RETURNING * INTO v_row;
  ELSE
    IF p_actual_percent IS NOT NULL THEN
      RAISE EXCEPTION 'avora_criterion_evidence_mismatch';
    END IF;
    IF p_meeting_note_id IS NOT NULL THEN
      SELECT conversation_id INTO v_conversation FROM projects WHERE id = v_row.project_id;
      IF NOT EXISTS (
        SELECT 1 FROM group_decisions d
        WHERE d.id = p_meeting_note_id AND d.kind = 'meeting_note'
          AND d.status = 'finalized' AND d.conversation_id = v_conversation
      ) THEN
        RAISE EXCEPTION 'avora_criterion_meeting_note_invalid';
      END IF;
    END IF;
    UPDATE project_success_criteria SET meeting_note_id = p_meeting_note_id
    WHERE id = p_criterion_id RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(v_uid, 'redeem_invite', 10, interval '10 minutes');
  return private.redeem_invite_for(v_uid, p_code);
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_base_amounts_on_profile_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.refresh_transaction_base_amounts(new.id);
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_transaction_base_amounts(p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  touched integer;
begin
  perform private.assert_session_allowed();
  update public.transactions t
     set base_currency = p.base_currency,
         conversion_rate = public.currency_rate_at(a.currency, p.base_currency, t.transaction_date),
         amount_in_base_currency = round(
           t.amount * public.currency_rate_at(a.currency, p.base_currency, t.transaction_date),
           coalesce(c.minor_units, 2)
         )
    from public.profiles p, public.accounts a, public.currencies c
   where t.user_id = p_user
     and p.id = p_user
     and a.id = t.account_id
     and c.code = p.base_currency;
  get diagnostics touched = row_count;
  return touched;
end $function$;

CREATE OR REPLACE FUNCTION public.relink_contact(p_from_contact_id uuid, p_to_contact_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('contact_link');
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'relink', p_from_contact_id, p_to_contact_id, null, null);
end $function$;

CREATE OR REPLACE FUNCTION public.remove_account(p_account_id uuid, p_with_transactions boolean)
 RETURNS accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype; v_live int;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from accounts where id = p_account_id and user_id = v_user and removed_at is null for update;
  if not found then raise exception 'avora_account_not_yours'; end if;
  select count(*) into v_live from transactions where account_id = p_account_id and removed_at is null;

  if v_live > 0 and not coalesce(p_with_transactions, false) then
    -- "Giữ lại giao dịch, chỉ đóng tài khoản".
    update accounts set deleted_at = coalesce(deleted_at, now()) where id = p_account_id returning * into v_row;
    return v_row;
  end if;
  update transactions set removed_at = now(), removed_with_account = true
  where account_id = p_account_id and removed_at is null;
  update accounts set removed_at = now() where id = p_account_id returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_connection(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_user_id is null or p_user_id = v_uid then return; end if;
  update public.user_connections
  set status = 'removed', removed_at = now(), removed_by = v_uid
  where user_low = least (v_uid, p_user_id) and user_high = greatest (v_uid, p_user_id)
    and status = 'active';
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_from_desk(p_table_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_table public.think_hub_table;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.think_hub_desk where user_id = v_user and table_id = p_table_id;
  select * into v_table from public.think_hub_table where id = p_table_id;
  if v_table.id is not null and v_table.owner_user_id = v_user and v_table.conversation_id is null and v_table.project_id is null
     and v_table.lifecycle = 'thinking' then
    update public.think_hub_table set lifecycle = 'waiting' where id = p_table_id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_group_participant(target_conversation_id uuid, target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_target uuid := target_user_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only owner can remove participants directly';
  end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_target;

  if v_role is null then
    raise exception 'Target is not a participant of this group';
  end if;

  if v_role = 'owner' then
    raise exception 'Owner cannot remove themselves this way — use transfer_group_ownership then leave_group_conversation';
  end if;

  delete from public.conversation_participants
  where conversation_id = v_conv and user_id = v_target;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_meeting_note_file(p_decision_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_old text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_manage_meeting_file (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;
  delete from public.meeting_note_files where decision_id = p_decision_id returning storage_path into v_old;
  return v_old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_transaction(p_transaction_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update transactions set removed_at = now(), removed_with_account = false
  where id = p_transaction_id and user_id = v_user and removed_at is null returning * into v_row;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.rename_contacts_bulk(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_id uuid;
  v_name text;
  v_old text;
  v_out jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then raise exception 'avora_contact_rename_shape'; end if;
  if jsonb_array_length(p_changes) > 1000 then raise exception 'avora_contact_rename_too_many'; end if;
  for v_item in select * from jsonb_array_elements(p_changes) loop
    begin
      v_id := (v_item->>'id')::uuid;
    exception when others then
      raise exception 'avora_contact_rename_shape';
    end;
    v_name := regexp_replace(btrim(coalesce(v_item->>'name', '')), '\s+', ' ', 'g');
    if v_name = '' or char_length(v_name) > 200 then raise exception 'avora_contact_name_invalid'; end if;
    select name into v_old from contact where id = v_id and owner_user_id = v_user for update;
    if not found or v_old = v_name then continue; end if;
    update contact set name = v_name where id = v_id and owner_user_id = v_user;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'previous', v_old, 'name', v_name));
  end loop;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_device(p_device uuid, p_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_label text := btrim(coalesce(p_label, ''));
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_label) not between 1 and 60 then raise exception 'avora_device_label'; end if;
  update public.account_devices set label = v_label where id = p_device and user_id = auth.uid();
  if not found then raise exception 'avora_device_not_yours'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rename_group_conversation(p_conversation_id uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_owner uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_group_name_required'; end if;
  if char_length(v_name) > 120 then raise exception 'avora_group_name_max_len'; end if;

  select owner_id into v_owner
  from public.conversation_groups
  where conversation_id = p_conversation_id;

  if v_owner is null then raise exception 'avora_group_not_found'; end if;
  if v_owner <> v_uid then raise exception 'avora_not_group_owner'; end if;

  update public.conversation_groups
  set name = v_name
  where conversation_id = p_conversation_id;

  return v_name;
end
$function$;

CREATE OR REPLACE FUNCTION public.rename_think_hub_column(p_table_id uuid, p_column_id text, p_label text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_row   think_hub_table%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;
  IF v_label = '' THEN
    RAISE EXCEPTION 'avora_think_hub_column_label_required';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.column_defs) d WHERE d->>'id' = p_column_id) THEN
    RAISE EXCEPTION 'avora_think_hub_column_missing';
  END IF;

  -- Chỉ nhãn đổi; id, key, kiểu và lựa chọn giữ nguyên nên không giá trị nào bị mất.
  UPDATE think_hub_table
  SET column_defs = (
    SELECT jsonb_agg(
      CASE WHEN d->>'id' = p_column_id THEN d || jsonb_build_object('label', v_label) ELSE d END
      ORDER BY ord)
    FROM jsonb_array_elements(v_row.column_defs) WITH ORDINALITY AS e(d, ord)
  )
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rename_think_hub_table(p_table_id uuid, p_name text)
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
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'avora_think_hub_table_name_required';
  END IF;

  UPDATE think_hub_table SET name = v_name
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL
    AND private.think_hub_table_visible(id, v_user)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_project(p_project_id uuid)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  IF coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' THEN
    RAISE EXCEPTION 'avora_shared_needs_proposal';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF v_project.status = 'active' THEN RETURN v_project; END IF;
  UPDATE projects SET status = 'active', closed_at = NULL WHERE id = p_project_id RETURNING * INTO v_project;
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.report_device_lost(p_device uuid, p_days integer, p_password text, p_origin text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_target public.account_devices%rowtype;
  v_deadline timestamptz; v_link text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_days not in (3, 7) then raise exception 'avora_device_lost_days'; end if;
  select * into v_target from public.account_devices where id = p_device and user_id = v_uid and revoked_at is null;
  if v_target.id is null then raise exception 'avora_device_not_yours'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) or v_target.rank not in (1, 2) or v_target.rank = v_me.rank then
    raise exception 'avora_device_revoke_rank';
  end if;
  if v_target.lost_status = 'pending' then raise exception 'avora_device_lost_settled'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  v_deadline := now() + make_interval(days => p_days);
  update public.account_devices set lost_status = 'pending', lost_reported_at = now(), lost_reported_by_device = v_me.id, lost_deadline = v_deadline
  where id = v_target.id;
  perform private.block_sessions(v_uid, array[v_target.session_id], 'lost');
  v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' || private.new_action_token(v_uid, 'lost_confirm', v_target.device_id, v_deadline);
  perform private.device_notify(v_uid, jsonb_build_object('action', 'lost_report', 'label', v_target.label, 'reporter', v_me.label, 'days', p_days, 'link', v_link),
    v_target.label || ' đã được báo mất từ ' || v_me.label || '. Kiểm tra email để xác nhận.');
  return v_deadline;
end $function$;

CREATE OR REPLACE FUNCTION public.report_user(p_user_id uuid, p_reason text, p_note text DEFAULT NULL::text, p_conversation_id uuid DEFAULT NULL::uuid, p_message_id uuid DEFAULT NULL::uuid, p_include_message boolean DEFAULT false, p_also_block boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_conversation uuid := p_conversation_id;
  v_content text;
  v_msg public.messages%rowtype;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'avora_report_self'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'avora_user_not_found';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'scam', 'inappropriate', 'impersonation', 'other') then
    raise exception 'avora_report_reason_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'avora_report_note_max_len'; end if;

  -- Serialise one reporter's calls so two parallel requests cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('avora_report:' || v_uid::text, 0));
  if (select count(*) from public.user_reports
      where reporter_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'avora_report_limit';
  end if;

  -- A conversation or message the reporter is not part of is dropped, not echoed back:
  -- the report still goes in, but it carries no pointer and no text from somewhere the
  -- reporter could not read.
  if v_conversation is not null and not private.is_conversation_participant (v_conversation, v_uid) then
    v_conversation := null;
  end if;

  if p_message_id is not null then
    select * into v_msg from public.messages where id = p_message_id;
    if found
       and private.is_conversation_participant (v_msg.conversation_id, v_uid)
       and v_msg.sender_id = p_user_id then
      v_conversation := v_msg.conversation_id;
      if coalesce(p_include_message, false) and v_msg.deleted_at is null then
        v_content := left(v_msg.content, 4000);
      end if;
    else
      v_msg := null;
    end if;
  end if;

  insert into public.user_reports (
    reporter_id, reported_user_id, conversation_id, message_id, reason, note, reported_content
  )
  values (v_uid, p_user_id, v_conversation, v_msg.id, p_reason, v_note, v_content)
  returning id into v_id;

  if coalesce(p_also_block, false) then
    perform public.block_user (p_user_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_lock_escape(p_password text, p_origin text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_lock public.account_device_lock%rowtype; v_link text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if v_lock.user_id is null then raise exception 'avora_device_not_locked'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  if v_lock.unlock_requested_at is null then
    update public.account_device_lock set unlock_requested_at = now() where user_id = v_uid returning * into v_lock;
    v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' || private.new_action_token(v_uid, 'lock_escape', null, now() + interval '72 hours');
    perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_escape', 'link', v_link),
      'Có yêu cầu tắt Khoá thiết bị sau 72 giờ. Không phải bạn? Bấm Huỷ trên máy chính.');
  end if;
  return v_lock.unlock_requested_at + interval '72 hours';
end $function$;

CREATE OR REPLACE FUNCTION public.request_rank_claim_code(p_rank smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_code text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null then raise exception 'avora_device_unbound'; end if;
  if p_rank not in (1, 2) then raise exception 'avora_device_rank_invalid'; end if;
  if (select count(*) from private.device_action_tokens where user_id = v_uid and kind = 'rank_claim_code' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_device_rate';
  end if;
  v_code := lpad((abs(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.device_action_tokens (user_id, kind, device_id, token_hash, expires_at, meta)
  values (v_uid, 'rank_claim_code', v_me.device_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes', jsonb_build_object('rank', p_rank));
  perform private.device_notify(v_uid, jsonb_build_object('action', 'rank_code', 'code', v_code, 'rank', p_rank, 'label', v_me.label), null);
end $function$;

CREATE OR REPLACE FUNCTION public.request_remove_participant(target_conversation_id uuid, target_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_target uuid := target_user_id;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'admin'
  ) then
    raise exception 'Only admin can request a removal';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_target and cp.role = 'member'
  ) then
    raise exception 'Can only request removal of a regular member';
  end if;

  insert into public.group_removal_requests (conversation_id, target_user_id, requested_by)
  values (v_conv, v_target, v_uid)
  returning id into v_id;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.request_think_hub_column_delete(p_table_id uuid, p_column_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user   uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row    think_hub_table%rowtype;
  v_def    jsonb;
  v_conv   uuid;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if v_reason = '' then raise exception 'avora_proposal_reason_required'; end if;
  if char_length(v_reason) > 300 then raise exception 'avora_proposal_reason_too_long'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  if v_conv is null then raise exception 'avora_proposal_personal_table'; end if;
  select d into v_def from jsonb_array_elements(v_row.column_defs) d where d->>'id' = p_column_id;
  if v_def is null then raise exception 'avora_think_hub_column_missing'; end if;
  perform private.post_system_line(v_conv, v_user, 'column_delete_requested',
    format('%s đề nghị xoá cột "%s" trong Bảng "%s" · Lý do: %s · Chủ Bảng xoá trong ⋯ đầu cột.',
      private.public_name(v_user), v_def->>'label', v_row.name, v_reason));
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_message_refs(p_message_id uuid)
 RETURNS TABLE(kind text, id uuid, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_msg public.messages; v_ref jsonb; v_id uuid; v_kind text; v_label text;
begin
  perform private.assert_session_allowed();
  select * into v_msg from public.messages m where m.id = p_message_id;
  if v_msg.id is null or not private.is_conversation_participant(v_msg.conversation_id, v_user) or v_msg.refs is null then return; end if;
  for v_ref in select * from jsonb_array_elements(v_msg.refs) loop
    v_kind := v_ref ->> 'type';
    v_id := (v_ref ->> 'id')::uuid;
    v_label := null;
    -- Journal refs belong to the sender only; elsewhere they must still sit in this conversation.
    if private.ref_in_conversation(v_msg.conversation_id, case when v_kind in ('note', 'contact') or
         (select c.type from public.conversations c where c.id = v_msg.conversation_id) = 'personal' then v_user else v_msg.sender_id end, v_kind, v_id) then
      v_label := case v_kind
        when 'file' then (select a.file_name from public.message_attachments a where a.id = v_id)
        when 'record' then (select r.title from public.think_hub_record r where r.id = v_id)
        when 'board' then (select t.name from public.think_hub_table t where t.id = v_id)
        when 'note' then (select coalesce(nullif(n.title, ''), 'Ghi chép') from public.notes n where n.id = v_id)
        when 'contact' then (select ct.name from public.contact ct where ct.id = v_id)
      end;
    end if;
    kind := v_kind; id := v_id; label := v_label;
    return next;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_removal_request(target_request_id uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req public.group_removal_requests;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_req from public.group_removal_requests r where r.id = target_request_id for update;

  if v_req.id is null then
    raise exception 'Request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Request already resolved';
  end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_req.conversation_id and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only owner can resolve a removal request';
  end if;

  update public.group_removal_requests
    set status = case when approve then 'approved' else 'rejected' end,
        resolved_by = v_uid,
        resolved_at = now()
  where id = v_req.id;

  if approve then
    delete from public.conversation_participants
    where conversation_id = v_req.conversation_id and user_id = v_req.target_user_id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.respond_task_invitation(p_participant_id uuid, p_accept boolean)
 RETURNS task_participants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.task_participants%rowtype;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  update public.task_participants
     set invitation_status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_participant_id and user_id = auth.uid() and invitation_status = 'pending'
  returning * into v_row;
  if not found then raise exception 'avora_invitation_not_open'; end if;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_1_1_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_is_creator boolean;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared';
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  v_is_creator := v_uid = v_row.creator_id;

  update public.tasks
  set deleted_by_creator = (case when v_is_creator then false else deleted_by_creator end),
      deleted_by_peer = (case when v_is_creator then deleted_by_peer else false end),
      updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_account(p_account_id uuid)
 RETURNS accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update accounts set removed_at = null where id = p_account_id and user_id = v_user and removed_at is not null returning * into v_row;
  if not found then raise exception 'avora_account_not_yours'; end if;
  update transactions set removed_at = null, removed_with_account = false
  where account_id = p_account_id and removed_with_account;
  perform public.recompute_account_state(p_account_id);
  select * into v_row from accounts where id = p_account_id;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_group(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_conv conversations%rowtype; v_tbl uuid; v_name text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_conv from conversations where id = p_conversation_id and type = 'group' for update;
  if not found or v_conv.deleted_at is null or v_conv.deleted_via is null then raise exception 'avora_group_missing'; end if;
  if not exists (select 1 from conversation_participants where conversation_id = p_conversation_id and user_id = v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if v_conv.deleted_at < now() - interval '30 days' then raise exception 'avora_group_restore_expired'; end if;

  update conversations set deleted_at = null, deleted_via = null where deleted_via = v_conv.deleted_via;
  update projects set deleted_at = null, deleted_by = null, delete_reason = null, deleted_via = null where deleted_via = v_conv.deleted_via;
  for v_tbl in select id from think_hub_table where deleted_via = v_conv.deleted_via loop
    update think_hub_table set deleted_at = null, deleted_via = null where id = v_tbl;
    perform private.restore_table_tasks(v_tbl);
  end loop;
  select coalesce(name, 'Nhóm') into v_name from conversation_groups where conversation_id = p_conversation_id;
  perform private.post_system_line(p_conversation_id, v_uid, 'shared_restored',
    format('%s đã khôi phục Nhóm "%s".', private.public_name(v_uid), v_name));
end $function$;

CREATE OR REPLACE FUNCTION public.restore_journal_messages(p_message_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_n integer := 0;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  update messages m set trashed_at = null
  from conversations c
  where c.id = m.conversation_id and c.type = 'personal' and m.sender_id = v_uid
    and m.id = any (coalesce(p_message_ids, '{}')) and m.trashed_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_project(p_project_id uuid)
 RETURNS projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_project projects%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  SELECT * INTO v_project FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project.deleted_at IS NULL THEN RAISE EXCEPTION 'avora_project_missing'; END IF;
  IF NOT (private.is_conversation_participant(v_project.conversation_id, v_uid)
          OR private.is_group_root_owner(v_project.conversation_id, v_uid)) THEN
    RAISE EXCEPTION 'avora_not_a_participant';
  END IF;
  IF v_project.deleted_via IS NOT NULL AND EXISTS (
       SELECT 1 FROM conversations WHERE deleted_via = v_project.deleted_via AND type = 'group' AND id <> v_project.conversation_id) THEN
    RAISE EXCEPTION 'avora_project_restore_with_group';
  END IF;

  UPDATE conversations SET deleted_at = NULL WHERE id = v_project.conversation_id;
  UPDATE projects SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, deleted_via = NULL
  WHERE id = p_project_id RETURNING * INTO v_project;
  PERFORM private.post_system_line(v_project.conversation_id, v_uid, 'shared_restored',
    format('%s đã khôi phục Dự án "%s".', private.public_name(v_uid), v_project.title));
  RETURN v_project;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_shared_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_row think_hub_table%rowtype; v_conv uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_uid) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if v_row.conversation_id is null and v_row.project_id is null then raise exception 'avora_proposal_personal_table'; end if;
  if v_row.deleted_via is null or not private.is_proposal_party(v_row.deleted_via, v_uid) then
    raise exception 'avora_shared_restore_not_party';
  end if;
  v_conv := private.proposal_conversation('think_hub_table', p_table_id);
  if not private.conversation_is_live(v_conv) then raise exception 'avora_shared_restore_group_gone'; end if;
  perform set_config('avora.proposal_exec', 'on', true);
  v_row := public.restore_think_hub_table(p_table_id);
  perform set_config('avora.proposal_exec', 'off', true);
  update think_hub_table set deleted_via = null where id = p_table_id returning * into v_row;
  perform private.post_system_line(v_conv, v_uid, 'shared_restored',
    format('%s đã khôi phục Bảng "%s".', private.public_name(v_uid), v_row.name));
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_shared_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_is_creator boolean;
begin
  perform private.assert_session_allowed();
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

  v_is_creator := v_uid = v_row.creator_id;

  if (not v_is_creator) and (not public.is_task_assignee(v_row, v_uid)) then
    raise exception 'avora_task_not_assignee';
  end if;

  update public.tasks
  set deleted_by_creator = (case when v_is_creator then false else deleted_by_creator end),
      deleted_by_peer = (case when v_is_creator then deleted_by_peer else false end),
      updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_think_hub_column(p_table_id uuid, p_column_id text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user  uuid := auth.uid();
  v_row   think_hub_table%rowtype;
  v_entry jsonb;
  v_key   text;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table
  where id = p_table_id and owner_user_id = v_user and deleted_at is null;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  select t into v_entry from jsonb_array_elements(v_row.column_trash) t
  where t->'def'->>'id' = p_column_id and (t->>'deleted_at')::timestamptz > now() - interval '30 days'
  limit 1;
  if v_entry is null then raise exception 'avora_think_hub_column_missing'; end if;
  v_key := v_entry->'def'->>'key';

  -- A value written since (none can be, the column was gone) is never overwritten.
  update think_hub_record r
  set extension_fields = jsonb_set(r.extension_fields, array[v_key], v_entry->'values'->(r.id::text))
  where r.table_id = p_table_id
    and (v_entry->'values') ? (r.id::text)
    and not (r.extension_fields ? v_key and jsonb_typeof(r.extension_fields->v_key) <> 'null');

  update think_hub_table
  set column_defs = column_defs || jsonb_build_array(v_entry->'def'),
      column_trash = coalesce((
        select jsonb_agg(t) from jsonb_array_elements(v_row.column_trash) t
        where t->'def'->>'id' <> p_column_id), '[]'::jsonb)
  where id = p_table_id
  returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_think_hub_record(p_record_id uuid)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_row   think_hub_record%ROWTYPE;
  v_count integer;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT r.* INTO v_row FROM think_hub_record r
  WHERE r.id = p_record_id AND r.deleted_at IS NOT NULL
    AND private.think_hub_table_visible(r.table_id, v_user)
    AND (r.owner_user_id = v_user
         OR EXISTS (SELECT 1 FROM think_hub_table t WHERE t.id = r.table_id AND t.owner_user_id = v_user));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avora_think_hub_record_not_yours';
  END IF;

  SELECT count(*) INTO v_count FROM think_hub_record
  WHERE table_id = v_row.table_id AND deleted_at IS NULL;
  IF v_count >= 1000 THEN
    RAISE EXCEPTION 'avora_think_hub_record_limit';
  END IF;

  UPDATE think_hub_record SET deleted_at = NULL
  WHERE id = p_record_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_think_hub_table(p_table_id uuid)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is not null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.conversation_id is not null or v_row.project_id is not null then
    if coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
      raise exception 'avora_shared_use_restore_shared';
    end if;
  elsif v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  update think_hub_table set deleted_at = null where id = p_table_id returning * into v_row;
  perform private.restore_table_tasks(p_table_id);
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_transaction(p_transaction_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if exists (select 1 from accounts where id = v_row.account_id and removed_at is not null) then
    raise exception 'avora_txn_account_in_trash';
  end if;
  update transactions set removed_at = null, removed_with_account = false where id = p_transaction_id returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.return_1_1_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type = '1-1-shared';
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Only the person who reviews the claim may reject it.
  if v_uid <> v_row.creator_id then
    raise exception 'avora_task_only_creator_returns';
  end if;

  if v_row.status = 'confirmed' then
    -- already sent back: retry is a no-op success
    return v_row;
  end if;

  if v_row.status <> 'done_pending_review' then
    raise exception 'avora_task_not_awaiting_review';
  end if;

  update public.tasks
  set status = 'confirmed', done_at = null, completed_confirmed_at = null, updated_at = now()
  where id = p_task_id and status = 'done_pending_review';

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_shared_task(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
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

  -- Only the person who reviews the claim may reject it.
  if v_uid <> v_row.creator_id then
    raise exception 'avora_task_only_creator_returns';
  end if;

  if v_row.status = 'confirmed' then
    -- already sent back: retry is a no-op success
    return v_row;
  end if;

  if v_row.status <> 'done_pending_review' then
    raise exception 'avora_task_not_awaiting_review';
  end if;

  update public.tasks
  set status = 'confirmed', done_at = null, completed_confirmed_at = null, updated_at = now()
  where id = p_task_id and status = 'done_pending_review';

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_shared_task_completion(p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
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

  if v_uid <> v_row.creator_id then
    raise exception 'avora_task_only_creator_reviews';
  end if;

  if v_row.status = 'done' then
    -- already reviewed: retry is a no-op success
    return v_row;
  end if;

  if v_row.status <> 'done_pending_review' then
    raise exception 'avora_task_not_awaiting_review';
  end if;

  update public.tasks
  set status = 'done', completed_confirmed_at = now(), updated_at = now()
  where id = p_task_id and status = 'done_pending_review';

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_device(p_device uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_target public.account_devices%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_target from public.account_devices where id = p_device and user_id = v_uid and revoked_at is null;
  if v_target.id is null then raise exception 'avora_device_not_yours'; end if;
  if v_me.id is null or v_target.id = v_me.id or not (v_me.rank = 1 or (v_me.rank = 2 and v_target.rank = 3)) then
    raise exception 'avora_device_revoke_rank';
  end if;
  update public.account_devices set revoked_at = now(), rank = 3 where id = v_target.id;
  perform private.block_sessions(v_uid, array[v_target.session_id], 'revoked');
  perform private.on_device_removed(v_target.id);
end $function$;

CREATE OR REPLACE FUNCTION public.revoke_group_decision_permission(p_grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.group_decision_grants%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.group_decision_grants where id = p_grant_id for update;
  if not found then raise exception 'avora_decision_grant_not_found'; end if;
  if not private.is_group_officer(v_row.conversation_id, v_uid) then
    raise exception 'avora_decision_officers_only';
  end if;
  if v_row.used_at is not null then raise exception 'avora_decision_grant_spent'; end if;

  delete from public.group_decision_grants where id = p_grant_id;
end $function$;

CREATE OR REPLACE FUNCTION public.revoke_group_invite(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  select role into v_role
    from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_uid;
  if v_role is null then
    raise exception 'You are not a participant of this group';
  end if;
  if v_role <> 'owner' then
    raise exception 'Only owner can manage the invite link';
  end if;
  update public.group_invite_links
    set revoked_at = now()
    where conversation_id = p_conversation_id and revoked_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rotate_group_invite(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_token uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;
  select role into v_role
    from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_uid;
  if v_role is null then
    raise exception 'You are not a participant of this group';
  end if;
  if v_role <> 'owner' then
    raise exception 'Only owner can manage the invite link';
  end if;
  if not exists (select 1 from public.conversation_groups g where g.conversation_id = p_conversation_id) then
    raise exception 'Not a group conversation';
  end if;
  insert into public.group_invite_links (conversation_id, created_by, expires_at)
    values (p_conversation_id, v_uid, now() + interval '7 days')
    on conflict (conversation_id) do update
      set token = gen_random_uuid(),
          created_by = excluded.created_by,
          created_at = now(),
          expires_at = now() + interval '7 days',
          revoked_at = null
    returning token into v_token;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_meeting_note_details(p_decision_id uuid, p_meeting_type text, p_objective text, p_attendee_ids uuid[], p_absentee_ids uuid[], p_agenda_items text[], p_decisions_made text, p_action_items jsonb, p_risks_issues text, p_next_meeting_at timestamp with time zone, p_reference_links text[], p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text)
 RETURNS meeting_note_details
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_row public.meeting_note_details%rowtype;
  v_attendees uuid[] := coalesce(p_attendee_ids, '{}');
  v_absentees uuid[] := coalesce(p_absentee_ids, '{}');
  v_agenda text[] := coalesce(p_agenda_items, '{}');
  v_agenda_len int;
  v_actions jsonb := coalesce(p_action_items, '[]'::jsonb);
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index jsonb;
  v_number numeric;
  v_person uuid;
  v_key text;
  v_task uuid;
  v_old_tasks uuid[] := '{}';
  v_seen_tasks uuid[] := '{}';
  v_seen_keys text[] := '{}';
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  if jsonb_typeof(v_actions) <> 'array' then raise exception 'avora_note_actions_not_array'; end if;

  v_agenda_len := coalesce(array_length(v_agenda, 1), 0);
  if v_agenda_len > 50 or jsonb_array_length(v_actions) > 50 then
    raise exception 'avora_note_too_many_items';
  end if;

  foreach v_person in array v_attendees || v_absentees loop
    if not private.is_conversation_participant (v_note.conversation_id, v_person) then
      raise exception 'avora_note_person_not_participant';
    end if;
  end loop;

  -- The tasks this draft already owns. A task_id arriving from the client is honoured only if it is one of
  -- these, so no one can attach someone else's task to a note.
  select coalesce(array_agg((e->>'task_id')::uuid), '{}') into v_old_tasks
  from public.meeting_note_details d, jsonb_array_elements(d.action_items) e
  where d.decision_id = p_decision_id and coalesce(e->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$';

  for v_item in select value from jsonb_array_elements(v_actions) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'avora_note_actions_not_array'; end if;

    v_index := v_item -> 'agenda_index';
    if v_index is not null and jsonb_typeof(v_index) <> 'null' then
      if jsonb_typeof(v_index) <> 'number' then raise exception 'avora_note_agenda_index_invalid'; end if;
      v_number := (v_index #>> '{}')::numeric;
      if v_number <> trunc(v_number) or v_number < 0 or v_number >= v_agenda_len then
        raise exception 'avora_note_agenda_index_invalid';
      end if;
    else
      v_item := v_item || jsonb_build_object('agenda_index', null);
    end if;

    v_key := v_item->>'key';
    if v_key is null or char_length(v_key) = 0 or char_length(v_key) > 64 or v_key = any(v_seen_keys) then
      v_key := gen_random_uuid ()::text;
    end if;
    v_seen_keys := v_seen_keys || v_key;

    v_task := case when coalesce(v_item->>'task_id', '') ~ '^[0-9a-fA-F-]{36}$'
      then (v_item->>'task_id')::uuid else null end;
    if v_task is not null and (not (v_task = any(v_old_tasks)) or v_task = any(v_seen_tasks)) then
      v_task := null;
    end if;
    if v_task is not null then v_seen_tasks := v_seen_tasks || v_task; end if;

    v_clean := v_clean || jsonb_build_array(v_item || jsonb_build_object(
      'key', v_key,
      'task_id', case when v_task is null then null else v_task::text end,
      'create_task', v_task is not null or coalesce((v_item->>'create_task')::boolean, false)));
  end loop;

  insert into public.meeting_note_details (decision_id, meeting_type, objective, attendee_ids, absentee_ids,
    agenda_items, decisions_made, action_items, risks_issues, next_meeting_at, reference_links, scheduled_at,
    location)
  values (p_decision_id, left(btrim(coalesce(p_meeting_type, '')), 120),
    left(btrim(coalesce(p_objective, '')), 2000), v_attendees, v_absentees, v_agenda,
    left(btrim(coalesce(p_decisions_made, '')), 5000), v_clean,
    left(btrim(coalesce(p_risks_issues, '')), 5000), p_next_meeting_at, coalesce(p_reference_links, '{}'),
    p_scheduled_at, left(btrim(coalesce(p_location, '')), 300))
  on conflict (decision_id)
    do update set
      meeting_type = excluded.meeting_type, objective = excluded.objective,
      attendee_ids = excluded.attendee_ids, absentee_ids = excluded.absentee_ids,
      agenda_items = excluded.agenda_items, decisions_made = excluded.decisions_made,
      action_items = excluded.action_items, risks_issues = excluded.risks_issues,
      next_meeting_at = excluded.next_meeting_at, reference_links = excluded.reference_links,
      scheduled_at = excluded.scheduled_at, location = excluded.location;

  -- Edits reach the pending tasks (same id); an item that was removed takes its pending task with it.
  for v_item in select value from jsonb_array_elements(v_clean) loop
    perform private.sync_meeting_note_task (v_note, v_agenda, v_item, false, false);
  end loop;
  delete from public.tasks where pending_decision_id = p_decision_id and not (id = any(v_seen_tasks));

  select * into v_row from public.meeting_note_details where decision_id = p_decision_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_meeting_note_to_journal(p_decision_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_journal uuid;
  v_link text;
  v_existing uuid;
  v_group text;
  v_file text;
  v_id uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id;
  if not found or not private.is_conversation_participant (v_note.conversation_id, v_uid) then
    raise exception 'avora_decision_not_found';
  end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'finalized' then raise exception 'avora_note_not_finalized'; end if;

  v_journal := public.ensure_personal_journal (v_uid);
  v_link := '/tin-nhan/' || v_note.conversation_id::text || '?so-quyet-dinh=' || p_decision_id::text;

  -- Saving twice keeps one note.
  select id into v_existing from public.messages
  where conversation_id = v_journal and sender_id = v_uid and deleted_at is null
    and position(v_link in content) > 0
  limit 1;
  if v_existing is not null then return v_existing; end if;

  select name into v_group from public.conversation_groups where conversation_id = v_note.conversation_id;
  select file_name into v_file from public.meeting_note_files where decision_id = p_decision_id;

  insert into public.messages (conversation_id, sender_id, content)
  values (v_journal, v_uid, left(concat_ws(E'\n',
    '📋 Biên bản họp: ' || v_note.title,
    'Nhóm ' || coalesce(nullif(v_group, ''), 'không tên') || ' · khoá ngày '
      || to_char(v_note.settled_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'),
    case when v_file is not null then 'Mẫu riêng: ' || v_file end,
    v_link), 4000))
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_note_card(p_message_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.save_project_check_adjust_note(p_project_id uuid, p_note text)
 RETURNS project_check_adjust
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row project_check_adjust%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'avora_not_signed_in'; END IF;
  UPDATE project_check_adjust
  SET note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE project_id = p_project_id AND owner_id = v_uid
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'avora_project_not_owner'; END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device_label text)
 RETURNS push_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.save_reading_state(p_record_id uuid, p_locator text, p_percent numeric, p_device_label text, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS book_reading_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_at timestamptz := least(coalesce(p_at, now()), now()); v_row public.book_reading_state;
begin
  perform private.assert_feature('books');
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (
    select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.owner_user_id = v_user and t.kind = 'bookshelf' and r.deleted_at is null) then
    raise exception 'avora_book_not_yours';
  end if;
  insert into public.book_reading_state (user_id, record_id, locator, percent, device_label, updated_at)
  values (v_user, p_record_id, left(coalesce(p_locator, ''), 200), least(greatest(coalesce(p_percent, 0), 0), 100), left(nullif(btrim(coalesce(p_device_label, '')), ''), 60), v_at)
  on conflict (user_id, record_id) do update
    set locator = excluded.locator, percent = excluded.percent, device_label = excluded.device_label, updated_at = excluded.updated_at
    where public.book_reading_state.updated_at < excluded.updated_at
  returning * into v_row;
  if v_row.user_id is null then
    select * into v_row from public.book_reading_state where user_id = v_user and record_id = p_record_id;
  end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.save_table_as_template(p_table_id uuid, p_name text)
 RETURNS think_hub_user_template
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_table think_hub_table%rowtype;
  v_type text;
  v_row think_hub_user_template%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_table from think_hub_table where id = p_table_id and deleted_at is null;
  if not found or v_table.owner_user_id <> v_user or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if (select count(*) from think_hub_user_template where owner_user_id = v_user) >= 50 then
    raise exception 'avora_template_limit';
  end if;
  select thinking_type into v_type from think_hub_template where key = v_table.source_template_key;

  -- Structure only: labels, types, options. No ids, no widths, no values, no Hạng mục.
  insert into think_hub_user_template (owner_user_id, name, thinking_type, guiding_question, column_defs,
    status_options, title_label, default_view, mobile_columns)
  values (
    v_user,
    coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_table.name),
    v_type,
    case when v_table.project_id is not null and v_table.parent_record_id is null then null else v_table.purpose end,
    coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', c->>'label', 'type', c->>'type',
        'options', case when c->>'type' = 'select' then c->'options' end)))
      from jsonb_array_elements(v_table.column_defs) c), '[]'::jsonb),
    v_table.status_options, v_table.title_label, v_table.default_view,
    coalesce((select array_agg(c->>'label') from jsonb_array_elements(v_table.column_defs) c
      where c->>'key' = any(coalesce(v_table.mobile_columns, '{}'))), '{}')
  ) returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.schedule_message(p_conversation_id uuid, p_content text, p_send_at timestamp with time zone, p_mentioned_user_ids uuid[], p_reply_to_message_id uuid)
 RETURNS scheduled_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_content, ''));
  v_row public.scheduled_messages;
begin
  perform private.assert_feature('scheduled_messages');
  perform private.assert_session_allowed();
  perform private.schedule_guard(p_conversation_id, v_uid, p_send_at, null);
  if v_text = '' then raise exception 'avora_schedule_empty'; end if;
  if char_length(v_text) > 4000 then raise exception 'avora_message_too_long'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_message_id and conversation_id = p_conversation_id
  ) then
    raise exception 'avora_not_a_participant';
  end if;
  insert into public.scheduled_messages (conversation_id, sender_id, content, mentioned_user_ids, reply_to_message_id, send_at)
  values (p_conversation_id, v_uid, v_text, coalesce(p_mentioned_user_ids, '{}'), p_reply_to_message_id, p_send_at)
  returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_avora(p_query text, p_here jsonb, p_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(kind text, id uuid, title text, snippet text, place_kind text, place_id uuid, place_name text, conversation_id uuid, at timestamp with time zone, in_here boolean, scope text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_first text;
  v_like text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_tab text := coalesce(p_here->>'tab', '');
  v_here_conv uuid := nullif(p_here->>'conversation_id', '')::uuid;
  v_types text[] := coalesce(p_types, array['message', 'file', 'task', 'note', 'record', 'table', 'contact', 'conversation', 'habit']);
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := left(v_q, 120);
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(public.f_unaccent(v_q), '\s+')) w where w <> '';
  if v_words is null then return; end if;
  select w into v_first from unnest(v_words) w order by char_length(w) desc limit 1;
  v_like := '%' || replace(replace(replace(v_first, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- messages (not recalled, not in the journal bin, not system lines)
  if 'message' = any (v_types) then
    return query
    select 'message'::text, m.id, null::text, left(m.content, 240), c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, m.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct'
                when exists (select 1 from projects p where p.conversation_id = c.id) then 'project' else 'group' end
    from messages m
    join conversations c on c.id = m.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where m.deleted_at is null and m.trashed_at is null and m.system_kind is null
      and (m.expires_at is null or m.expires_at > now())
      and public.f_unaccent(m.content) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(m.content) not like '%' || w || '%')
    order by m.created_at desc
    limit v_limit * 3;
  end if;

  if 'file' = any (v_types) then
    return query
    select 'file'::text, a.message_id, a.file_name, null::text, c.type, c.id,
           coalesce(g.name, case c.type when 'personal' then 'Nhật ký' when 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           c.id, a.created_at,
           (v_tab = 'ket-noi' and (v_here_conv is null or v_here_conv = c.id)) or (v_tab = 'nhat-ky' and c.type = 'personal'),
           case when c.type = 'personal' then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from message_attachments a
    join messages m on m.id = a.message_id and m.deleted_at is null and m.trashed_at is null
      and (m.expires_at is null or m.expires_at > now())
    join conversations c on c.id = a.conversation_id and c.deleted_at is null
    left join conversation_groups g on g.conversation_id = c.id
    where public.f_unaccent(a.file_name) like v_like
    order by a.created_at desc
    limit v_limit * 2;
  end if;

  if 'task' = any (v_types) then
    return query
    select 'task'::text, t.id, t.title, left(coalesce(t.description, ''), 200),
           case when t.conversation_id is null then 'personal' else coalesce(c.type, 'personal') end,
           t.conversation_id, coalesce(g.name, case when t.conversation_id is null then 'Của tôi' when c.type = 'direct' then 'Cuộc 1-1' else 'Nhóm' end),
           t.conversation_id, t.updated_at,
           v_tab = 'nhiem-vu' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = t.conversation_id),
           case when t.type = 'personal' then 'personal' when t.type = '1-1-shared' then 'direct' else 'group' end
    from tasks t
    left join conversations c on c.id = t.conversation_id
    left join conversation_groups g on g.conversation_id = t.conversation_id
    where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(t.title || ' ' || coalesce(t.description, '')) not like '%' || w || '%')
      and not (t.creator_id = v_uid and t.deleted_by_creator) and not (t.creator_id <> v_uid and t.deleted_by_peer)
    order by t.updated_at desc
    limit v_limit * 2;
  end if;

  if 'note' = any (v_types) then
    return query
    select 'note'::text, n.id, coalesce(nullif(btrim(n.title), ''), 'Ghi chép'), left(n.search_text, 200),
           'personal'::text, n.folder_id, coalesce(f.name, 'Chưa xếp'), null::uuid, n.updated_at,
           v_tab = 'nhat-ky', 'personal'::text
    from notes n
    left join note_folders f on f.id = n.folder_id
    where n.deleted_at is null and n.search_text like v_like
      and not exists (select 1 from unnest(v_words) w where n.search_text not like '%' || w || '%')
    order by n.updated_at desc
    limit v_limit * 2;
  end if;

  if 'record' = any (v_types) then
    return query
    select 'record'::text, r.id, r.title, case when r.archived_at is not null then 'Đã cất · ' else '' end || left(coalesce(r.notes, ''), 200),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, r.updated_at,
           v_tab = 'ke-hoach' or (v_tab = 'ket-noi' and v_here_conv is not null and v_here_conv = tb.conversation_id),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_record r
    join think_hub_table tb on tb.id = r.table_id and tb.deleted_at is null
    left join conversations c on c.id = tb.conversation_id
    where r.deleted_at is null
      and public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(r.title || ' ' || coalesce(r.notes, '')) not like '%' || w || '%')
    order by r.updated_at desc
    limit v_limit * 2;
  end if;

  if 'table' = any (v_types) then
    return query
    select 'table'::text, tb.id, tb.name, coalesce(tb.purpose, ''),
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' else coalesce(c.type, 'group') end,
           tb.id, tb.name, tb.conversation_id, tb.updated_at, v_tab = 'ke-hoach',
           case when tb.project_id is not null then 'project' when tb.conversation_id is null then 'personal' when c.type = 'direct' then 'direct' else 'group' end
    from think_hub_table tb
    left join conversations c on c.id = tb.conversation_id
    where tb.deleted_at is null and public.f_unaccent(tb.name) like v_like
    order by tb.updated_at desc
    limit v_limit;
  end if;

  if 'contact' = any (v_types) then
    return query
    select 'contact'::text, ct.id, ct.name, null::text, 'contact'::text, ct.id, 'Liên hệ', null::uuid, ct.updated_at,
           v_tab = 'ket-noi' and v_here_conv is null, 'personal'::text
    from contact ct
    where public.f_unaccent(ct.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(ct.name) not like '%' || w || '%')
    order by ct.name
    limit v_limit;
  end if;

  if 'conversation' = any (v_types) then
    return query
    select 'conversation'::text, g.conversation_id, g.name, null::text, 'group'::text, g.conversation_id, g.name, g.conversation_id, g.updated_at,
           v_tab = 'ket-noi', 'group'::text
    from conversation_groups g
    join conversations c on c.id = g.conversation_id and c.deleted_at is null
    where public.f_unaccent(g.name) like v_like
    order by g.updated_at desc
    limit v_limit;
  end if;
  -- AVORA-107 · Thói quen: tìm được như Hạng mục (chỉ của mình — RLS chủ). Đã lưu trữ thì ghi rõ.
  if 'habit' = any (v_types) then
    return query
    select 'habit'::text, h.id, h.name,
           case when h.archived_at is not null then 'Đã lưu trữ' when h.paused_at is not null then 'Đang tạm nghỉ'
                when h.kind = 'timed' then 'Có đồng hồ · ' || h.target_minutes || ' phút' else 'Chỉ đánh dấu' end,
           'personal'::text, null::uuid, 'Thói quen', null::uuid, h.updated_at,
           v_tab = 'nhiem-vu', 'personal'::text
    from habits h
    where h.user_id = v_uid
      and public.f_unaccent(h.name) like v_like
      and not exists (select 1 from unnest(v_words) w where public.f_unaccent(h.name) not like '%' || w || '%')
    order by h.archived_at nulls first, h.updated_at desc
    limit v_limit;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.search_book_catalog(p_query text, p_category text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS SETOF book_catalog
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_q text := btrim(private.fold_search(p_query));
begin
  perform private.assert_feature('books');
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  return query
    select c.* from public.book_catalog c
    where (c.pd_status = 'ok' or c.access = 'borrow')
      and (v_q = '' or c.search_text like '%' || v_q || '%')
      and (p_category is null or c.category = p_category)
      and (p_source is null or c.source = p_source)
    order by (c.source = 'wikisource') desc,
             case when v_q <> '' and private.fold_search(c.title) like v_q || '%' then 0 else 1 end,
             (c.access = 'borrow'),
             case when c.source = 'gutenberg' then c.source_id::int else 0 end,
             c.title
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end $function$;

CREATE OR REPLACE FUNCTION public.security_signout_notice()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_when text;
  v_text text;
  v_email text;
begin
  perform private.assert_session_allowed();
  if v_user is null then
    raise exception 'avora_no_session';
  end if;

  if exists (
    select 1 from push_outbox
    where user_id = v_user and kind = 'security' and dedupe_key like 'signout:%'
      and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;

  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from profiles where id = v_user;
  v_when := to_char(now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY');
  v_text := 'Tài khoản của bạn vừa được đăng xuất trên mọi thiết bị khác lúc ' || v_when
    || '. Không phải bạn? Đổi mật khẩu tài khoản ngay.';
  insert into push_outbox (user_id, kind, payload, dedupe_key)
  values (v_user, 'security', jsonb_build_object('text', v_text), 'signout:' || extract(epoch from now())::bigint);

  select email into v_email from auth.users where id = v_user;
  if v_email is not null then
    perform private.vault_send_mail(
      jsonb_build_object('kind', 'alarm', 'action', 'signout', 'email', v_email, 'when', v_when)
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.seed_finance_categories_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.seed_finance_categories(new.id);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.seed_finance_categories(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_added integer;
begin
  perform private.assert_session_allowed();
  insert into public.categories (user_id, name, type, applies_to, color, slug, sort_order)
  select p_user_id, d.name, 'predefined', d.applies_to, d.color, d.slug, d.sort_order
  from public.default_finance_categories() d
  where not exists (
    select 1 from public.categories c where c.user_id = p_user_id and c.slug = d.slug
  );
  get diagnostics v_added = row_count;
  return v_added;
end $function$;

CREATE OR REPLACE FUNCTION public.seed_task_categories_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.ensure_default_task_categories(new.id);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.send_message_with_attachments(p_conversation_id uuid, p_content text, p_reply_to_message_id uuid DEFAULT NULL::uuid, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_origin_group_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS messages
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select * from public.send_message(gen_random_uuid(), p_conversation_id, p_content, p_reply_to_message_id,
    p_attachments, null, p_mentioned_user_ids, p_origin_group_id, null, false)
$function$;

CREATE OR REPLACE FUNCTION public.send_message(p_id uuid, p_conversation uuid, p_content text DEFAULT ''::text, p_reply_to uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb, p_refs jsonb DEFAULT NULL::jsonb, p_mentioned uuid[] DEFAULT '{}'::uuid[], p_origin_group uuid DEFAULT NULL::uuid, p_daily_thought text DEFAULT NULL::text, p_urgent boolean DEFAULT false, p_effect text DEFAULT NULL::text, p_sticker text DEFAULT NULL::text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_type text;
  v_verifying boolean;
  v_effect text := nullif(btrim(coalesce(p_effect, '')), '');
  v_sticker text := nullif(btrim(coalesce(p_sticker, '')), '');
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

  -- K5 · sticker: an Avora sticker is a message of its own — an id from the catalogue, no words, no files.
  if v_sticker is not null then
    if not exists (select 1 from public.sticker_catalog sc where sc.id = v_sticker and sc.active) then
      raise exception 'avora_sticker_unknown';
    end if;
    if v_count > 0 then raise exception 'avora_sticker_alone'; end if;
    v_content := '';
  end if;
  if v_content = '' and v_count = 0 and v_sticker is null then raise exception 'messages_content_not_blank'; end if;

  -- K5 · send effect: only in a 1-1 or group, never in the journal, a verification frame or an
  -- urgent line; at most 3 per 10 minutes per person per conversation — past that the words still
  -- go, quietly without the effect.
  if v_effect is not null then
    if v_effect not in ('fireworks', 'hearts', 'balloons', 'buzz') then raise exception 'avora_effect_unknown'; end if;
    select c.type, (c.verification_status = 'pending') into v_type, v_verifying from public.conversations c where c.id = p_conversation;
    if v_type not in ('direct', 'group') or coalesce(v_verifying, false) or coalesce(p_urgent, false) or v_sticker is not null then
      v_effect := null;
    elsif (
      select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.sender_id = v_uid and m.effect is not null
        and m.created_at > now() - interval '10 minutes'
    ) >= 3 then
      v_effect := null;
    end if;
  end if;
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
    attachment_count, refs, reply_to_daily_thought_id, is_urgent, effect, sticker_id
  ) values (
    p_id, p_conversation, v_uid, v_content, p_reply_to, coalesce(p_mentioned, '{}'), p_origin_group,
    v_count, case when p_refs is null or jsonb_array_length(p_refs) = 0 then null else p_refs end,
    p_daily_thought, coalesce(p_urgent, false), v_effect, v_sticker
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
end $function$;

CREATE OR REPLACE FUNCTION public.send_scheduled_message_now(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.scheduled_messages;
  v_msg uuid;
begin
  perform private.assert_feature('scheduled_messages');
  perform private.assert_session_allowed();
  select * into v_row from public.scheduled_messages where id = p_id and sender_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'avora_schedule_missing'; end if;
  v_msg := private.deliver_scheduled_row(v_row);
  update public.scheduled_messages set status = 'sent', sent_message_id = v_msg, updated_at = now() where id = p_id;
  return v_msg;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_avatar(p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_old text;
begin
  perform private.assert_feature('avatars');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]{1,64}\.jpg$') then
    raise exception 'avora_avatar_invalid';
  end if;
  -- Read as the caller: the owner policy on `avatars` lets them see their own files only.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'avora_attachment_missing';
  end if;
  v_old := private.avatar_write(v_uid, p_path);
  return case when v_old is distinct from p_path then v_old end;
end $function$;

CREATE OR REPLACE FUNCTION public.set_board_conclusion(p_table_id uuid, p_body text)
 RETURNS think_hub_conclusions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_row public.think_hub_conclusions;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if char_length(v_body) not between 1 and 500 then raise exception 'avora_conclusion_length'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if not private.can_edit_board_head(p_table_id, v_user) then raise exception 'avora_think_hub_view_only'; end if;
  insert into public.think_hub_conclusions (table_id, body, created_by) values (p_table_id, v_body, v_user) returning * into v_row;
  if private.think_hub_is_shared(p_table_id) then
    insert into public.think_hub_change_log (table_id, actor_id, kind, cells, after)
    values (p_table_id, v_user, 'board_edit', 1, jsonb_build_object('conclusion', v_body));
  end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.set_board_lifecycle(p_table_id uuid, p_lifecycle text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_old text;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_lifecycle not in ('waiting', 'thinking', 'concluded', 'archived') then raise exception 'avora_lifecycle_value'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if not private.can_edit_board_head(p_table_id, v_user) then raise exception 'avora_think_hub_view_only'; end if;
  if p_lifecycle = 'archived' then
    -- ADR-031: the archive path decides (a shared board raises avora_shared_needs_proposal).
    perform public.set_think_hub_table_archived(p_table_id, true);
    return 'archived';
  end if;
  select lifecycle into v_old from public.think_hub_table where id = p_table_id;
  if v_old = p_lifecycle then return v_old; end if;
  update public.think_hub_table set lifecycle = p_lifecycle where id = p_table_id;
  if private.think_hub_is_shared(p_table_id) then
    insert into public.think_hub_change_log (table_id, actor_id, kind, cells, before, after)
    values (p_table_id, v_user, 'board_edit', 1, jsonb_build_object('lifecycle', v_old), jsonb_build_object('lifecycle', p_lifecycle));
  end if;
  return p_lifecycle;
end $function$;

CREATE OR REPLACE FUNCTION public.set_board_thinking_type(p_table_id uuid, p_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_type is not null and p_type not in ('track', 'progress', 'breakdown', 'weigh', 'learn') then raise exception 'avora_thinking_type_value'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if not private.can_edit_board_head(p_table_id, v_user) then raise exception 'avora_think_hub_view_only'; end if;
  update public.think_hub_table set thinking_type = p_type where id = p_table_id;
  return p_type;
end $function$;

CREATE OR REPLACE FUNCTION public.set_book_cover(p_source text, p_source_id text, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('books');
  if p_path is not null and p_path <> p_source || '/' || p_source_id || '.webp' then raise exception 'avora_bad_path'; end if;
  update public.book_catalog set cover_path = p_path, cover_checked_at = now() where source = p_source and source_id = p_source_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_book_pin(p_record_id uuid, p_pinned boolean)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_at timestamptz;
begin
  perform private.assert_feature('books');
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (
    select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.owner_user_id = v_user and t.kind = 'bookshelf' and r.deleted_at is null) then
    raise exception 'avora_book_not_yours';
  end if;
  if not p_pinned then
    update public.book_reading_state set pinned_at = null where user_id = v_user and record_id = p_record_id;
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('avora_pin:' || v_user::text, 0));
  if (select count(*) from public.book_reading_state where user_id = v_user and pinned_at is not null and record_id <> p_record_id) >= 3 then
    raise exception 'avora_pin_full';
  end if;
  insert into public.book_reading_state (user_id, record_id, locator, percent, updated_at, pinned_at)
  values (v_user, p_record_id, 'c0:p0', 0, now() - interval '100 years', now())
  on conflict (user_id, record_id) do update set pinned_at = coalesce(public.book_reading_state.pinned_at, now())
  returning pinned_at into v_at;
  return v_at;
end $function$;

CREATE OR REPLACE FUNCTION public.set_conversation_appearance(p_conversation_id uuid, p_color text DEFAULT NULL::text, p_backdrop text DEFAULT NULL::text)
 RETURNS conversation_appearance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row public.conversation_appearance%rowtype; v_old public.conversation_appearance%rowtype; v_what text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_can_style(p_conversation_id, v_uid);
  if p_color is not null and p_color not in ('avora', 'bien', 'ngoc', 'tim', 'than') then raise exception 'avora_appearance_invalid'; end if;
  if p_backdrop is not null and p_backdrop not in ('giay', 'la', 'may', 'song') then raise exception 'avora_appearance_invalid'; end if;
  select * into v_old from public.conversation_appearance a where a.conversation_id = p_conversation_id;
  insert into public.conversation_appearance (conversation_id, color_key, backdrop_key, updated_by)
  values (p_conversation_id, p_color, nullif(p_backdrop, 'giay'), v_uid)
  on conflict (conversation_id) do update set color_key = excluded.color_key, backdrop_key = excluded.backdrop_key,
    updated_by = v_uid, updated_at = now()
  returning * into v_row;
  v_what := case
    when v_old.color_key is distinct from v_row.color_key and v_old.backdrop_key is distinct from v_row.backdrop_key then 'màu và nền cuộc trò chuyện'
    when v_old.color_key is distinct from v_row.color_key then 'màu cuộc trò chuyện'
    when v_old.backdrop_key is distinct from v_row.backdrop_key then 'nền cuộc trò chuyện'
  end;
  if v_what is not null then perform private.appearance_line(p_conversation_id, v_uid, v_what); end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.set_conversation_mute(p_conversation_id uuid, p_until timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if p_until <= now() then raise exception 'avora_mute_in_past'; end if;
  insert into mute_settings (user_id, scope, conversation_id, muted_until)
  values (v_uid, 'conversation', p_conversation_id, p_until)
  on conflict (user_id, scope, conversation_id) do update set muted_until = excluded.muted_until;
  return p_until;
end $function$;

CREATE OR REPLACE FUNCTION public.set_conversation_pinned(p_conversation_id uuid, p_pinned boolean)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_at timestamptz;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant (p_conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if not coalesce (p_pinned, false) then
    delete from public.conversation_pins where user_id = v_uid and conversation_id = p_conversation_id;
    return null;
  end if;
  select pinned_at into v_at from public.conversation_pins
  where user_id = v_uid and conversation_id = p_conversation_id;
  if v_at is not null then return v_at; end if;
  if (select count (*) from public.conversation_pins where user_id = v_uid) >= 5 then
    raise exception 'avora_pin_limit';
  end if;
  insert into public.conversation_pins (user_id, conversation_id) values (v_uid, p_conversation_id)
  returning pinned_at into v_at;
  return v_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_conversation_share_read(p_conversation_id uuid, p_value boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_feature('read_receipts');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, share_read_status)
  values (p_conversation_id, v_uid, p_value)
  on conflict (conversation_id, user_id) do update set share_read_status = excluded.share_read_status, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.set_device_lock(p_on boolean, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_lock public.account_device_lock%rowtype;
  v_keep uuid[];
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_lock from public.account_device_lock where user_id = v_uid;
  if p_on then
    if v_lock.user_id is not null and v_lock.locked_rank = 1 and v_me.rank = 2 then raise exception 'avora_device_lock_owner'; end if;
    insert into public.account_device_lock (user_id, locked_by_device, locked_rank)
    values (v_uid, v_me.id, v_me.rank)
    on conflict (user_id) do update set locked_by_device = excluded.locked_by_device, locked_rank = excluded.locked_rank, locked_at = now(), unlock_requested_at = null;
    select array_agg(session_id) into v_keep from public.account_devices
    where user_id = v_uid and revoked_at is null and lost_status is distinct from 'pending' and session_id is not null
      and (rank = 1 or (v_me.rank = 2 and rank = 2));
    perform private.block_sessions(v_uid, array(select id from auth.sessions where user_id = v_uid and not (id = any (coalesce(v_keep, '{}')))), 'locked');
    perform private.device_notify(v_uid, jsonb_build_object('action', 'lock_on', 'label', v_me.label, 'rank', v_me.rank),
      'Đã bật Khoá thiết bị từ ' || v_me.label || '.');
  else
    if v_lock.user_id is null then return; end if;
    if v_me.rank = 2 and v_lock.locked_rank = 1 then raise exception 'avora_device_lock_owner'; end if;
    delete from public.account_device_lock where user_id = v_uid;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_device_rank(p_rank smallint, p_password text, p_email_code text DEFAULT NULL::text, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
  v_holder public.account_devices%rowtype; v_tok uuid; v_link text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null then raise exception 'avora_device_unbound'; end if;
  if v_me.guest then raise exception 'avora_device_guest'; end if;
  if p_rank not in (1, 2) then raise exception 'avora_device_rank_invalid'; end if;
  if v_me.rank = p_rank then return jsonb_build_object('rank', p_rank); end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_holder from public.account_devices where user_id = v_uid and rank = p_rank and revoked_at is null and id <> v_me.id;
  if v_holder.id is not null then
    update private.device_action_tokens set used_at = now()
    where id = (select id from private.device_action_tokens
                where user_id = v_uid and kind = 'rank_claim_code' and device_id = v_me.device_id and used_at is null and expires_at > now()
                  and (meta ->> 'rank')::int = p_rank and token_hash = encode(extensions.digest(coalesce(p_email_code, ''), 'sha256'), 'hex')
                limit 1)
    returning id into v_tok;
    if v_tok is null then raise exception 'avora_device_code'; end if;
    update public.account_devices set rank = 3 where id = v_holder.id;
    perform private.block_sessions(v_uid, array[v_holder.session_id], 'rank_taken');
    v_link := private.app_origin(p_origin) || '/xac-nhan-thiet-bi?t=' ||
      private.new_action_token(v_uid, 'not_me_rank', v_holder.device_id, now() + interval '24 hours', jsonb_build_object('rank', p_rank, 'old', v_holder.id, 'claimer', v_me.id));
    perform private.device_notify(v_uid, jsonb_build_object('action', 'rank_taken', 'label', v_me.label, 'old_label', v_holder.label, 'rank', p_rank, 'link', v_link),
      v_me.label || ' vừa nhận Ưu tiên ' || p_rank || '. ' || v_holder.label || ' đã thành Máy khác.');
  end if;
  update public.account_devices set rank = p_rank, approved_at = now() where id = v_me.id;
  return jsonb_build_object('rank', p_rank, 'took_from', v_holder.label);
end $function$;

CREATE OR REPLACE FUNCTION public.set_disappear_timer(p_conversation_id uuid, p_seconds integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_type text; v_current integer; v_proposal uuid; v_msg uuid;
begin
  perform private.assert_feature('disappearing');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_seconds is not null and p_seconds not in (3600, 86400, 604800, 2592000) then raise exception 'avora_disappear_invalid'; end if;
  -- Members who may send; Nhóm: owners / admins only (avora_not_admin); never Nhật ký.
  v_type := private.assert_can_style(p_conversation_id, v_uid);
  select c.disappear_after_seconds into v_current from public.conversations c where c.id = p_conversation_id for update;

  if v_type = 'direct' and p_seconds is not null then
    if p_seconds is not distinct from v_current then return 'unchanged'; end if;
    update public.disappear_proposals set status = 'withdrawn', resolved_at = now()
    where conversation_id = p_conversation_id and status = 'open';
    insert into public.disappear_proposals (conversation_id, proposed_by, seconds)
    values (p_conversation_id, v_uid, p_seconds) returning id into v_proposal;
    v_msg := private.disappear_line(p_conversation_id, v_uid,
      'đề nghị tin tự biến mất sau ' || private.disappear_label(p_seconds), 'disappear_proposed');
    update public.disappear_proposals set message_id = v_msg where id = v_proposal;
    return 'proposed';
  end if;

  -- Turning off (anyone, at once) or a Nhóm admin's change.
  if v_type = 'direct' then
    update public.disappear_proposals set status = 'withdrawn', resolved_at = now()
    where conversation_id = p_conversation_id and status = 'open';
  end if;
  if p_seconds is not distinct from v_current then return 'unchanged'; end if;
  update public.conversations set disappear_after_seconds = p_seconds where id = p_conversation_id;
  perform private.disappear_line(p_conversation_id, v_uid,
    case when p_seconds is null then 'đã tắt tin tự biến mất'
         else 'đã đặt tin tự biến mất sau ' || private.disappear_label(p_seconds) end, 'disappear_changed');
  return 'applied';
end $function$;

CREATE OR REPLACE FUNCTION public.set_feedback_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  if p_status not in ('moi', 'dang_xem', 'da_lam', 'khong_lam') then raise exception 'avora_bad_status'; end if;
  update public.feedback set status = p_status where id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_group_admin(target_conversation_id uuid, target_user_id uuid, make_admin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_target uuid := target_user_id;
  v_conv uuid := target_conversation_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only owner can change admin';
  end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_target;

  if v_role is null then raise exception 'Target is not a participant of this group'; end if;
  if v_role = 'owner' then raise exception 'Owner is not an admin slot'; end if;

  if make_admin then
    if exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = v_conv and cp.role = 'admin' and cp.user_id <> v_target
    ) then
      raise exception 'This group already has an admin';
    end if;
    update public.conversation_participants
      set role = 'admin' where conversation_id = v_conv and user_id = v_target;
  else
    update public.conversation_participants
      set role = 'member' where conversation_id = v_conv and user_id = v_target;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_group_icon(p_conversation_id uuid, p_icon_key text DEFAULT NULL::text, p_icon_path text DEFAULT NULL::text)
 RETURNS conversation_appearance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_type text; v_row public.conversation_appearance%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_type := private.assert_can_style(p_conversation_id, v_uid);
  if v_type <> 'group' then raise exception 'avora_not_allowed'; end if;
  if p_icon_key is not null and p_icon_path is not null then raise exception 'avora_appearance_invalid'; end if;
  if p_icon_path is not null then
    if p_icon_path not like p_conversation_id::text || '/%' then raise exception 'avora_appearance_invalid'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'conversation-icons' and o.name = p_icon_path) then
      raise exception 'avora_attachment_missing';
    end if;
  end if;
  insert into public.conversation_appearance (conversation_id, icon_key, icon_path, updated_by)
  values (p_conversation_id, p_icon_key, p_icon_path, v_uid)
  on conflict (conversation_id) do update set icon_key = excluded.icon_key, icon_path = excluded.icon_path,
    updated_by = v_uid, updated_at = now()
  returning * into v_row;
  perform private.appearance_line(p_conversation_id, v_uid, 'icon của nhóm');
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.set_habit_alarm(p_habit uuid, p_local_date date, p_window integer, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  perform private.assert_feature('habits');
  if v_uid is null or not private.session_allowed() then raise exception 'avora_not_signed_in' using errcode = '42501'; end if;
  delete from public.push_outbox where user_id = v_uid and kind = 'habit' and status = 'pending' and dedupe_key like 'ht:%';
  if p_at is null then return false; end if;
  v := private.habit_owned(p_habit, v_uid);
  if v.kind <> 'timed' or v.when_away <> 'keep' then return false; end if;
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  if p_window is null or p_window < 0 or p_window >= jsonb_array_length(v.windows) then raise exception 'avora_habit_window' using errcode = '22023'; end if;
  if p_at <= now() or p_at > now() + interval '12 hours' then return false; end if;
  insert into public.push_outbox (user_id, kind, dedupe_key, send_after, payload)
  values (v_uid, 'habit', 'ht:' || p_habit || ':' || p_local_date || ':' || p_window || ':' || floor(extract(epoch from p_at))::bigint,
          p_at, jsonb_build_object('habit_id', p_habit, 'title', v.name, 'alarm', true))
  on conflict do nothing;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.set_hide_tombstones(p_conversation_id uuid, p_value boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.can_act_in(p_conversation_id, v_uid, 'read') then raise exception 'avora_not_allowed'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, hide_tombstones)
  values (p_conversation_id, v_uid, coalesce(p_value, false))
  on conflict (conversation_id, user_id) do update set hide_tombstones = excluded.hide_tombstones, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.set_invite_code_active(p_code text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('invite_codes');
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  update public.invite_code set active = p_active where code = upper(btrim(p_code));
end $function$;

CREATE OR REPLACE FUNCTION public.set_invite_required(p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_ops(auth.uid()) then raise exception 'avora_not_ops'; end if;
  insert into public.app_config (key, value) values ('invite_required', to_jsonb(p_on))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.set_my_book_cover(p_record uuid, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_uid::text or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-[0-9]{1,15}\.(webp|jpg)$' then
    raise exception 'avora_bad_path';
  end if;
  if not exists (
    select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record and r.deleted_at is null and private.think_hub_table_visible(t.id, v_uid)
  ) then raise exception 'avora_not_found'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'my-book-covers' and o.name = p_path) then
    raise exception 'avora_not_found';
  end if;
  insert into public.book_my_covers (user_id, record_id, path) values (v_uid, p_record, p_path)
  on conflict (user_id, record_id) do update set path = excluded.path, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.set_my_conversation_prefs(p_conversation uuid, p_effects_level text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_can_act_in(p_conversation, v_uid, 'read');
  if p_effects_level is not null and p_effects_level not in ('full', 'light', 'off') then raise exception 'avora_effects_level_invalid'; end if;
  insert into public.conversation_member_prefs (conversation_id, user_id, effects_level)
  values (p_conversation, v_uid, p_effects_level)
  on conflict (conversation_id, user_id) do update set effects_level = excluded.effects_level, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.set_opportunity_board_view(p_hidden_in_list boolean, p_sync_hidden text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  update public.think_hub_table set hidden_in_list = coalesce(p_hidden_in_list, hidden_in_list),
    sync_hidden = coalesce((select array_agg(distinct c) from unnest(p_sync_hidden) c
      where c in ('phone','email','company','type','representative','industry','address','tax_code','relationship','contact_note','value','next','last_contact','place','tasks','contact')), sync_hidden)
  where owner_user_id = auth.uid() and sync_source = 'contact_opportunities';
end $function$;

CREATE OR REPLACE FUNCTION public.set_profile_pin_required_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (select 1 from public.user_pins where user_id = new.id) then
    new.pin_required_at := null;
  else
    new.pin_required_at := coalesce(new.created_at, now()) + interval '30 days';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_quiet_reading(p_on boolean)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_until timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  v_until := case when p_on then now() + interval '3 hours' else null end;
  update public.profiles set quiet_reading_until = v_until where id = v_user;
  if not p_on then
    -- Held pushes go out now — the sender's one combined notification per conversation (send-push groups them).
    update public.push_outbox set send_after = now() where user_id = v_user and status = 'pending' and send_after > now();
  end if;
  return v_until;
end $function$;

CREATE OR REPLACE FUNCTION public.set_share_read_status(p_value boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  update public.profiles set share_read_status = coalesce(p_value, true) where id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.set_space_keepsake(p_keepsake jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_path text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select space_keepsake into v_old from public.profiles where id = v_uid;
  if p_keepsake is not null then
    if p_keepsake ->> 'kind' = 'sticker' then
      if not exists (select 1 from public.sticker_catalog s where s.id = p_keepsake ->> 'sticker_id' and s.active) then
        raise exception 'avora_sticker_unknown';
      end if;
      p_keepsake := jsonb_build_object('kind', 'sticker', 'sticker_id', p_keepsake ->> 'sticker_id');
    elsif p_keepsake ->> 'kind' = 'photo' then
      v_path := p_keepsake ->> 'path';
      if v_path is null or v_path not like (v_uid::text || '/%') or v_path like '%..%'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'keepsakes' and o.name = v_path and o.owner_id = v_uid::text) then
        raise exception 'avora_keepsake_path_invalid';
      end if;
      p_keepsake := jsonb_build_object('kind', 'photo', 'path', v_path,
        'focus_y', greatest(0, least(1, coalesce((p_keepsake ->> 'focus_y')::numeric, 0.5))));
    else
      raise exception 'avora_keepsake_invalid';
    end if;
  end if;
  update public.profiles set space_keepsake = p_keepsake where id = v_uid;
  if v_old ->> 'kind' = 'photo' and (p_keepsake is null or p_keepsake ->> 'path' is distinct from v_old ->> 'path') then
    return v_old ->> 'path';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.set_task_recurrence(p_task_id uuid, p_recurrence text, p_pattern jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  if p_recurrence not in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom') then
    raise exception 'avora_recurrence_invalid' using errcode = '22023';
  end if;
  if p_recurrence = 'custom' and (p_pattern is null or coalesce((p_pattern ->> 'interval')::int, 0) < 1
      or coalesce(p_pattern ->> 'frequency', '') not in ('daily', 'weekly', 'monthly')) then
    raise exception 'avora_recurrence_invalid' using errcode = '22023';
  end if;
  update public.tasks
     set recurrence = p_recurrence,
         recurrence_pattern = case when p_recurrence = 'custom' then p_pattern else null end,
         updated_at = now()
   where id = p_task_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_task_travel(p_task_id uuid, p_travel_duration_minutes integer, p_reminder_offset_minutes integer DEFAULT 10)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_offset integer := greatest(coalesce(p_reminder_offset_minutes, 0), 0);
  v_departure timestamptz;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from public.tasks where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;
  if not public.is_task_assignee (v_row, v_uid) or not private.task_owned_by_assignee (p_task_id) then
    raise exception 'avora_task_not_assignee';
  end if;
  if not v_row.requires_presence or v_row.start_at is null then raise exception 'avora_event_needs_start'; end if;
  if p_travel_duration_minutes is not null and (p_travel_duration_minutes < 0 or p_travel_duration_minutes > 1440) then
    raise exception 'avora_task_travel_range';
  end if;

  if p_travel_duration_minutes is null then
    delete from public.task_travel_plans where task_id = p_task_id;
    return false;
  end if;

  v_departure := v_row.start_at - make_interval(mins => p_travel_duration_minutes + v_offset);
  insert into public.task_travel_plans (task_id, user_id, travel_duration_minutes, reminder_offset_minutes, departure_reminder_at, updated_at)
  values (p_task_id, v_uid, p_travel_duration_minutes, v_offset, v_departure, now())
  on conflict (task_id) do update
    set travel_duration_minutes = excluded.travel_duration_minutes,
        reminder_offset_minutes = excluded.reminder_offset_minutes,
        departure_reminder_at = excluded.departure_reminder_at,
        updated_at = now();
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_announce_settings(p_table_id uuid, p_who text, p_mode text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_who not in ('members', 'admins') or p_mode not in ('manual', 'daily', 'silent') then raise exception 'avora_board_settings_invalid'; end if;
  update think_hub_table set announce_who = p_who, announce_mode = p_mode
  where id = p_table_id and owner_user_id = v_user and deleted_at is null
    and (conversation_id is not null or project_id is not null)
  returning * into v_row;
  if not found then raise exception 'avora_think_hub_table_not_yours'; end if;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_column_hidden(p_table_id uuid, p_column_id text, p_hidden boolean)
 RETURNS think_hub_table
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  SELECT private.patch_think_hub_column(
    p_table_id, p_column_id,
    jsonb_build_object('hidden', CASE WHEN coalesce(p_hidden, false) THEN true ELSE NULL END)
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_column_width(p_table_id uuid, p_column_id text, p_width integer)
 RETURNS think_hub_table
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  -- NULL trả cột về độ rộng mặc định.
  SELECT private.patch_think_hub_column(
    p_table_id, p_column_id,
    jsonb_build_object('width', CASE WHEN p_width IS NULL THEN NULL ELSE greatest(60, least(800, p_width)) END)
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_records_archived(p_record_ids uuid[], p_archived boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_n integer;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_record_ids is null or cardinality(p_record_ids) = 0 then return 0; end if;
  if cardinality(p_record_ids) > 500 then raise exception 'avora_too_many'; end if;
  update public.think_hub_record r set archived_at = case when p_archived then coalesce(r.archived_at, now()) else null end
  where r.id = any (p_record_ids) and r.deleted_at is null
    and private.think_hub_table_visible(r.table_id, v_user)
    and (r.owner_user_id = v_user or exists (select 1 from public.think_hub_table t where t.id = r.table_id and t.owner_user_id = v_user));
  get diagnostics v_n = row_count;
  if v_n <> cardinality(p_record_ids) then raise exception 'avora_think_hub_record_not_yours'; end if;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_table_archived(p_table_id uuid, p_archived boolean)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row think_hub_table%rowtype;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from think_hub_table where id = p_table_id and deleted_at is null for update;
  if not found or not private.think_hub_table_visible(p_table_id, v_user) then
    raise exception 'avora_think_hub_table_not_yours';
  end if;
  if v_row.parent_record_id is not null then raise exception 'avora_think_hub_sub_table_follows_root'; end if;
  if v_row.kind = 'bookshelf' then raise exception 'avora_bookshelf_locked'; end if;
  if v_row.project_id is not null then raise exception 'avora_think_hub_project_root_locked'; end if;
  if v_row.conversation_id is not null
     and coalesce(current_setting('avora.proposal_exec', true), '') <> 'on' then
    raise exception 'avora_shared_needs_proposal';
  end if;
  if v_row.conversation_id is null and v_row.owner_user_id <> v_user then
    raise exception 'avora_think_hub_table_not_yours';
  end if;

  update think_hub_table set
    archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
    archived_by = case when p_archived then coalesce(archived_by, v_user) else null end
  where id = p_table_id returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.set_think_hub_table_purpose(p_table_id uuid, p_purpose text)
 RETURNS think_hub_table
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_table%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'avora_not_signed_in';
  END IF;

  SELECT * INTO v_row FROM think_hub_table
  WHERE id = p_table_id AND owner_user_id = v_user AND deleted_at IS NULL;
  IF NOT FOUND OR NOT private.think_hub_table_visible(p_table_id, v_user) THEN
    RAISE EXCEPTION 'avora_think_hub_table_not_yours';
  END IF;
  -- Bảng gốc của dự án đọc lại Kim chỉ nam / Mục tiêu của dự án, không có mục đích riêng.
  IF v_row.project_id IS NOT NULL AND v_row.parent_record_id IS NULL THEN
    RAISE EXCEPTION 'avora_think_hub_purpose_inherited';
  END IF;

  UPDATE think_hub_table SET purpose = nullif(btrim(coalesce(p_purpose, '')), '')
  WHERE id = p_table_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_transaction_base_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  acct_currency text;
  base text;
  r numeric;
  units smallint;
begin
  select a.currency into acct_currency from public.accounts a where a.id = new.account_id;
  if acct_currency is null then
    raise exception 'avora_txn_account_missing';
  end if;

  -- An entry is denominated by the account that holds it; it is never chosen per transaction.
  new.currency := acct_currency;

  select p.base_currency into base from public.profiles p where p.id = new.user_id;
  base := coalesce(base, acct_currency);
  new.base_currency := base;

  r := public.currency_rate_at(acct_currency, base, new.transaction_date);
  if r is null then
    raise exception 'avora_currency_rate_missing' using
      detail = format('%s->%s on %s', acct_currency, base, new.transaction_date);
  end if;

  select c.minor_units into units from public.currencies c where c.code = base;
  new.conversion_rate := r;
  new.amount_in_base_currency := round(new.amount * r, coalesce(units, 2));
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.set_vault_other_devices_allowed(p_on boolean, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_me.id is null or v_me.rank not in (1, 2) then raise exception 'avora_device_lock_rank'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  update public.profiles set vault_other_devices_allowed = coalesce(p_on, false) where id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.settle_transaction(p_transaction_id uuid, p_amount numeric)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
  v_next numeric(14,2);
begin
  perform private.assert_feature('finance');
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.transactions
  where id = p_transaction_id and user_id = v_user;
  if not found then
    raise exception 'avora_txn_not_yours';
  end if;
  if v_row.type in ('income', 'expense') then
    raise exception 'avora_txn_not_an_obligation';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'avora_txn_voided';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'avora_txn_settle_positive';
  end if;

  v_next := round(v_row.amount_settled + p_amount, 2);
  if v_next > v_row.amount then
    raise exception 'avora_txn_settle_over';
  end if;

  -- Chỉ ghi số đã trả; trạng thái do trigger tính lại từ chính con số đó.
  update public.transactions t
  set amount_settled = v_next
  where t.id = p_transaction_id
  returning * into v_row;

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.share_contact_card(p_context text, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_msg uuid; v_label text;
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null or not private.contact_card_allowed(v_conv, v_user, p_user_id) then
    raise exception 'avora_contact_card_not_allowed';
  end if;
  insert into public.messages (conversation_id, sender_id, content, contact_card_user_id)
  values (v_conv, v_user, '', p_user_id) returning id into v_msg;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  if v_type = 'direct' then
    select coalesce(p.display_name, 'một người') into v_label from public.conversation_participants cp
      left join public.profiles p on p.id = cp.user_id where cp.conversation_id = v_conv and cp.user_id <> v_user limit 1;
  else
    select coalesce(g.name, 'một nhóm') into v_label from public.conversation_groups g where g.conversation_id = v_conv;
  end if;
  insert into public.contact_card_notice (introduced_user_id, introducer_id, audience_label)
  values (p_user_id, v_user, left(coalesce(v_label, 'một người'), 120));
  return v_msg;
end $function$;

CREATE OR REPLACE FUNCTION public.skip_shared_task(p_task_id uuid, p_silent boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_conv_type text;
  v_silent boolean := coalesce(p_silent, false);
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared')
  for update;
  if not found then raise exception 'avora_task_not_found'; end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- Only the person carrying the request may decline it. A group bystander was not asked.
  if not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_assignee';
  end if;

  -- Already declined: a retry is a no-op success, so a dropped response cannot double-report.
  if v_row.status = 'skipped' then
    return v_row;
  end if;

  if v_row.status <> 'pending_confirmation' then
    raise exception 'avora_task_skip_not_pending';
  end if;

  if v_silent then
    select type into v_conv_type from public.conversations where id = v_row.conversation_id;
    if v_conv_type <> 'direct' then
      raise exception 'avora_task_skip_needs_message';
    end if;
  end if;

  update public.tasks
  set status = 'skipped', skipped_at = now(), skipped_silently = v_silent, updated_at = now()
  where id = p_task_id and status = 'pending_confirmation';

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.skip_task_suggestion(p_suggestion_id uuid, p_silent boolean DEFAULT false)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
  v_silent boolean := coalesce(p_silent, false);
  v_conv_type text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;

  -- Declining belongs to the person asked and to nobody else. A proposer who could "skip" on
  -- their behalf would be withdrawing their own request while making it look like a refusal.
  if v_s.assignee_id <> v_uid then raise exception 'avora_task_not_assignee'; end if;

  -- Retry is a no-op success: the answer already stands.
  if v_s.status = 'skipped' then return v_s; end if;
  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  select type into v_conv_type from public.conversations where id = v_s.conversation_id;

  -- Silence is allowed in a 1-1 and refused in a group. In a 1-1 the decline is visible on the
  -- suggestion itself, so saying nothing still leaves the other person informed. In a group the
  -- same silence leaves a room watching a request go unanswered with no way to tell it was seen.
  if v_silent and v_conv_type is distinct from 'direct' then
    raise exception 'avora_task_skip_needs_message';
  end if;

  update public.task_suggestions
  set status = 'skipped', resolved_at = now(), skipped_silently = v_silent
  where id = p_suggestion_id
  returning * into v_s;

  return v_s;
end;
$function$;

CREATE OR REPLACE FUNCTION public.spawn_recurring_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  step interval;
  next_deadline date;
  n integer := 1;
  new_id uuid;
  next_status text;
  freq text;
  every integer;
  due timestamptz;
  r record;
begin
  if new.recurrence in ('daily', 'weekdays') then
    step := interval '1 day';
  elsif new.recurrence = 'weekly' then
    step := interval '7 days';
  elsif new.recurrence = 'monthly' then
    step := interval '1 month';
  elsif new.recurrence = 'custom' then
    freq  := coalesce(new.recurrence_pattern->>'frequency', 'weekly');
    every := greatest(coalesce((new.recurrence_pattern->>'interval')::int, 1), 1);
    step := case freq
              when 'daily' then interval '1 day'
              when 'weekly' then interval '7 days'
              when 'monthly' then interval '1 month'
              else interval '7 days'
            end * every;
  else
    return new;
  end if;

  -- Step forward until the successor is in the future (and, for Ngày làm việc, not a Saturday/Sunday).
  loop
    next_deadline := (new.deadline_date + (step * n))::date;
    exit when (next_deadline > current_date
               and (new.recurrence <> 'weekdays' or extract(isodow from next_deadline) < 6))
      or n > 500;
    n := n + 1;
  end loop;

  if next_deadline <= current_date then
    return new;
  end if;

  next_status := case when new.type = 'personal' then 'confirmed' else 'pending_confirmation' end;

  insert into public.tasks (
    type, creator_id, conversation_id, title, description, status,
    deadline_date, deadline_time, deadline_tz, task_category_id, is_important,
    recurrence, recurrence_pattern, recurrence_origin_id
  ) values (
    new.type, new.creator_id, new.conversation_id, new.title, new.description, next_status,
    next_deadline, new.deadline_time, new.deadline_tz, new.task_category_id, new.is_important,
    new.recurrence, new.recurrence_pattern, coalesce(new.recurrence_origin_id, new.id)
  ) returning id into new_id;

  due := public.task_deadline_instant(next_deadline, new.deadline_time, new.deadline_tz);
  for r in
    select distinct user_id, offset_minutes
    from public.task_reminders
    where task_id = new.id and offset_minutes is not null
  loop
    if due - make_interval(mins => r.offset_minutes) > now() then
      insert into public.task_reminders (task_id, user_id, reminder_time, reminder_tz, offset_minutes)
      values (new_id, r.user_id, due - make_interval(mins => r.offset_minutes), new.deadline_tz, r.offset_minutes)
      on conflict do nothing;
    end if;
  end loop;

  new.recurrence_spawned_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.start_group_connection(p_group_id uuid, p_user_id uuid, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_message text;
  v_conv uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_message := private.invite_message_or_raise (p_message);
  if p_user_id is null or p_user_id = v_uid then raise exception 'avora_invalid_partner'; end if;
  if not exists (select 1 from public.conversations c where c.id = p_group_id and c.type = 'group' and c.deleted_at is null)
     or not private.is_conversation_participant (p_group_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;
  if not private.is_conversation_participant (p_group_id, p_user_id) then
    raise exception 'avora_contact_unavailable';
  end if;
  if private.is_blocked_between (v_uid, p_user_id) then raise exception 'avora_contact_unavailable'; end if;

  if private.are_connected (v_uid, p_user_id) then
    v_conv := private.direct_for_connected (v_uid, p_user_id);
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.live_verification_between (v_uid, p_user_id);
  if v_conv is not null then
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  if not coalesce ((select allow_group_connection from public.profiles where id = p_user_id), true) then
    raise exception 'avora_group_connection_off';
  end if;
  if exists (select 1 from private.verification_declines d
             where d.decliner_id = p_user_id and d.opener_id = v_uid
               and d.declined_at > now() - interval '30 days') then
    raise exception 'avora_contact_unavailable';
  end if;
  if (select count (*) from private.connection_attempts
      where user_id = v_uid and kind = 'group' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'avora_group_connection_daily_limit';
  end if;
  perform private.note_connection_attempt (v_uid, 'group');

  v_conv := private.open_verification (v_uid, p_user_id, p_group_id);
  perform private.post_invite_message (v_conv, v_uid, v_message, true);
  return v_conv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_meeting_note(p_decision_id uuid)
 RETURNS meeting_note_details
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_note public.group_decisions%rowtype;
  v_row public.meeting_note_details%rowtype;
begin
  perform private.assert_feature('meeting_notes');
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_note from public.group_decisions where id = p_decision_id for update;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_note.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_note.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  insert into public.meeting_note_details (decision_id, meeting_started_at)
  values (p_decision_id, now())
  on conflict (decision_id)
    do update set meeting_started_at = coalesce(public.meeting_note_details.meeting_started_at, now());

  select * into v_row from public.meeting_note_details where decision_id = p_decision_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_pin_connection(p_pin text, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_pin text := upper (regexp_replace (btrim (coalesce (p_pin, '')), '\s', '', 'g'));
  v_message text;
  v_other uuid;
  v_conv uuid;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  -- Checked before anything is looked up or counted: says nothing about the PIN.
  v_message := private.invite_message_or_raise (p_message);
  if not exists (select 1 from public.user_pins where user_id = v_uid and pin is not null) then
    raise exception 'avora_pin_required';
  end if;
  -- Counted before the lookup, so a miss costs the same as a hit.
  perform private.note_connection_attempt (v_uid, 'pin');

  if v_pin not like 'A-%' then v_pin := 'A-' || v_pin; end if;
  select up.user_id into v_other from public.user_pins up where up.pin = v_pin;

  if v_other = v_uid then raise exception 'avora_pin_self'; end if;
  -- Not found / no PIN / blocked all return NULL — never an exception — so the attempt row
  -- above survives (20260928100500).
  if v_other is null or private.is_blocked_between (v_uid, v_other) then
    return null;
  end if;

  if private.are_connected (v_uid, v_other) then
    v_conv := private.direct_for_connected (v_uid, v_other);
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.live_verification_between (v_uid, v_other);
  if v_conv is not null then
    perform private.post_invite_message (v_conv, v_uid, v_message, false);
    return v_conv;
  end if;

  v_conv := private.open_verification (v_uid, v_other, null);
  perform private.post_invite_message (v_conv, v_uid, v_message, true);
  return v_conv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.storage_sweep_batch(p_limit integer DEFAULT 500)
 RETURNS TABLE(bucket text, path text, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.storage_delete_queue (bucket, path, reason)
  select 'chat-attachments', o.name, 'orphan'
  from storage.objects o
  where o.bucket_id = 'chat-attachments'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.message_attachments a where a.storage_path = o.name)
    and not (
      o.name like '%/thumb-320.webp'
      and exists (
        select 1 from public.message_attachments a
        where a.storage_path like regexp_replace(o.name, '/thumb-320\.webp$', '/') || '%'
      )
    )
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
  on conflict do nothing;
  return query
    select q.bucket, q.path, q.reason from private.storage_delete_queue q
    order by q.queued_at limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $function$;

CREATE OR REPLACE FUNCTION public.storage_sweep_done(p_bucket text, p_paths text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n integer;
begin
  delete from private.storage_delete_queue q where q.bucket = p_bucket and q.path = any(p_paths);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_feedback(p_kind text, p_body text, p_page text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_device text DEFAULT NULL::text, p_screen text DEFAULT NULL::text, p_locale text DEFAULT NULL::text, p_attachment_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_obj storage.objects%rowtype;
begin
  perform private.assert_feature('feedback');
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.rate_take(v_uid, 'feedback', 10, interval '10 minutes');
  if p_attachment_path is not null then
    if p_attachment_path not like (v_uid::text || '/%') or p_attachment_path like '%..%' then
      raise exception 'avora_attachment_path_invalid';
    end if;
    select * into v_obj from storage.objects o where o.bucket_id = 'feedback-shots' and o.name = p_attachment_path;
    if v_obj.id is null or v_obj.owner_id is distinct from v_uid::text then raise exception 'avora_attachment_path_invalid'; end if;
    if coalesce((v_obj.metadata ->> 'size')::bigint, 0) > 5242880 then raise exception 'avora_attachment_too_large'; end if;
    if coalesce(v_obj.metadata ->> 'mimetype', '') not like 'image/%' then raise exception 'avora_attachment_blocked'; end if;
  end if;
  insert into public.feedback (user_id, kind, body, page, app_version, device, screen, locale, attachment_path, source)
  values (v_uid, p_kind, btrim(p_body), left(p_page, 300), left(p_app_version, 60), left(p_device, 300), left(p_screen, 40), left(p_locale, 20), p_attachment_path, 'app')
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_public_feedback(p_kind text, p_body text, p_email text DEFAULT NULL::text, p_trap text DEFAULT NULL::text, p_page text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_device text DEFAULT NULL::text, p_screen text DEFAULT NULL::text, p_locale text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(btrim(p_trap), '') <> '' then return true; end if;
  perform private.rate_take('00000000-0000-0000-0000-000000000000'::uuid, 'public_feedback', 30, interval '1 minute');
  insert into public.feedback (user_id, kind, body, email, page, app_version, device, screen, locale, source)
  values (auth.uid(), p_kind, btrim(p_body), nullif(btrim(lower(p_email)), ''), left(p_page, 300), left(p_app_version, 60), left(p_device, 300), left(p_screen, 40), left(p_locale, 20), 'web');
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.suggest_contact_cards(p_context text, p_query text DEFAULT ''::text)
 RETURNS TABLE(user_id uuid, name text, pin text, has_pin boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null or p_context = 'journal' then raise exception 'avora_context_not_allowed'; end if;
  return query
  select f.other, coalesce(p.display_name, 'Người dùng Avora'), up.pin, up.pin is not null
  from (select case when uc.user_low = v_user then uc.user_high else uc.user_low end as other
        from public.user_connections uc where uc.status = 'active' and (uc.user_low = v_user or uc.user_high = v_user)) f
  left join public.profiles p on p.id = f.other
  left join public.user_pins up on up.user_id = f.other
  where not private.is_conversation_participant(v_conv, f.other)
    and not private.is_blocked_between(v_user, f.other)
    and (v_q = '' or lower(coalesce(p.display_name, '')) like '%' || v_q || '%')
  order by (up.pin is null), p.display_name limit 20;
end $function$;

CREATE OR REPLACE FUNCTION public.suggest_mentions(p_context text, p_query text DEFAULT ''::text)
 RETURNS TABLE(kind text, id uuid, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null then raise exception 'avora_context_not_allowed'; end if;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  if v_type = 'direct' then return; end if;
  if v_type = 'personal' then
    return query select 'contact'::text, ct.id, ct.name from public.contact ct
      where ct.owner_user_id = v_user and (v_q = '' or lower(ct.name) like '%' || v_q || '%')
      order by ct.updated_at desc limit 20;
    return;
  end if;
  return query select 'user'::text, cp.user_id, coalesce(p.display_name, 'Thành viên')
    from public.conversation_participants cp left join public.profiles p on p.id = cp.user_id
    where cp.conversation_id = v_conv and cp.user_id <> v_user and not private.is_blocked_between(v_user, cp.user_id)
      and (v_q = '' or lower(coalesce(p.display_name, '')) like '%' || v_q || '%')
    order by p.display_name limit 20;
end $function$;

CREATE OR REPLACE FUNCTION public.suggest_refs(p_context text, p_kind text DEFAULT 'all'::text, p_query text DEFAULT ''::text)
 RETURNS TABLE(kind text, id uuid, label text, detail text, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_conv uuid; v_type text; v_q text := lower(coalesce(p_query, ''));
begin
  perform private.assert_session_allowed();
  v_conv := private.context_conversation(p_context, v_user);
  if v_conv is null then raise exception 'avora_context_not_allowed'; end if;
  select c.type into v_type from public.conversations c where c.id = v_conv;
  return query
  select * from (
    select 'file'::text as kind, a.id, a.file_name as label, a.kind as detail, a.created_at as at
      from public.message_attachments a join public.messages m on m.id = a.message_id
      where p_kind in ('all', 'file') and a.conversation_id = v_conv and m.deleted_at is null and m.trashed_at is null
        and (v_q = '' or lower(a.file_name) like '%' || v_q || '%')
    union all
    select 'record', r.id, r.title, t.name, r.updated_at
      from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
      left join public.projects pr on pr.id = t.project_id
      where p_kind in ('all', 'record') and r.deleted_at is null and t.deleted_at is null
        and (case when v_type = 'personal' then t.owner_user_id = v_user and t.conversation_id is null and t.project_id is null
                  else t.conversation_id = v_conv or pr.conversation_id = v_conv end)
        and (v_q = '' or lower(r.title) like '%' || v_q || '%')
    union all
    select 'note', n.id, coalesce(nullif(n.title, ''), 'Ghi chép'), null, n.updated_at
      from public.notes n
      where p_kind in ('all', 'note') and v_type = 'personal' and n.owner_user_id = v_user and n.deleted_at is null
        and (v_q = '' or lower(coalesce(n.title, '')) like '%' || v_q || '%')
  ) s order by s.at desc limit 20;
end $function$;

CREATE OR REPLACE FUNCTION public.suggested_meeting_attendees(p_conversation_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select
    cp.user_id
  from
    public.conversation_participants cp
  where
    cp.conversation_id = p_conversation_id
    and private.is_conversation_participant (p_conversation_id, auth.uid ());
$function$;

CREATE OR REPLACE FUNCTION public.suggestion_travel_flags()
 RETURNS TABLE(suggestion_id uuid, travel_arranged boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select s.id, exists (select 1 from public.task_travel_plans tp where tp.task_id = s.accepted_task_id)
  from public.task_suggestions s
  where s.status = 'accepted'
    and s.accepted_task_id is not null
    and s.proposed_requires_presence
    and (s.proposer_id = auth.uid () or s.assignee_id = auth.uid ())
    and private.is_conversation_participant (s.conversation_id, auth.uid ());
$function$;

CREATE OR REPLACE FUNCTION public.sync_account_state_on_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.recompute_account_state(new.id);
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.sync_account_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recompute_account_state(old.account_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recompute_account_state(new.account_id);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.task_deadline_instant(p_date date, p_time time without time zone, p_tz text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ((p_date + coalesce(p_time, time '23:59:59'))::timestamp)
         at time zone coalesce(nullif(btrim(p_tz), ''), 'Asia/Ho_Chi_Minh');
$function$;

CREATE OR REPLACE FUNCTION public.task_recipient_ids(p_conversation_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select private.assert_session_allowed();

  select cp.user_id
  from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id
    and private.is_conversation_participant (p_conversation_id, auth.uid ())
    and (cp.user_id = auth.uid () or not private.is_blocked_between (cp.user_id, auth.uid ()));
$function$;

CREATE OR REPLACE FUNCTION public.task_record_of(p_task_id uuid)
 RETURNS TABLE(record_id uuid, record_title text, table_id uuid, table_name text, path text, can_edit boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_record uuid;
begin
  if v_uid is null or not private.session_allowed() or not private.can_view_task(p_task_id, v_uid) then return; end if;
  v_record := private.current_task_record(p_task_id);
  if v_record is null then return; end if;
  return query
    select r.id, r.title, b.id, b.name, private.record_path(r.id),
           private.can_link_task(p_task_id, v_uid) and private.think_hub_record_editable(r.id, v_uid)
    from public.think_hub_record r join public.think_hub_table b on b.id = r.table_id
    where r.id = v_record and r.deleted_at is null and private.think_hub_table_visible(b.id, v_uid);
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_archived_records(p_table_id uuid)
 RETURNS SETOF think_hub_record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  return query select r.* from public.think_hub_record r
    where r.table_id = p_table_id and r.deleted_at is null and r.archived_at is not null order by r.archived_at desc;
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_cleanup_apply(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_item jsonb; v_kind text; v_table uuid;
  v_archived_tables uuid[] := '{}'; v_archived_records uuid[] := '{}'; v_trashed uuid[] := '{}';
  v_ids uuid[];
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'avora_cleanup_bad_items'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_kind := v_item ->> 'kind';
    begin v_table := (v_item ->> 'table_id')::uuid; exception when others then raise exception 'avora_cleanup_bad_items'; end;
    if not private.cleanup_own_board(v_table, v_user) then raise exception 'avora_cleanup_not_allowed'; end if;
    if v_kind = 'dusty_board' then
      if exists (select 1 from public.think_hub_board_opened o where o.user_id = v_user and o.board_key = v_table::text and o.opened_at >= now() - interval '90 days')
         or exists (select 1 from public.think_hub_table t where t.id = v_table and t.created_at >= now() - interval '90 days') then
        raise exception 'avora_cleanup_not_allowed';
      end if;
      update public.think_hub_table set archived_at = now(), archived_by = v_user where id = v_table;
      v_archived_tables := v_archived_tables || v_table;
    elsif v_kind = 'done_records' then
      with done as (
        update public.think_hub_record r set archived_at = now()
        from public.think_hub_table t
        where t.id = r.table_id and r.table_id = v_table and r.deleted_at is null and r.archived_at is null
          and r.updated_at < now() - interval '90 days' and private.record_is_done(t.status_options, r.status)
        returning r.id)
      select coalesce(array_agg(id), '{}') into v_ids from done;
      v_archived_records := v_archived_records || v_ids;
    elsif v_kind = 'empty_board' then
      if exists (select 1 from public.think_hub_record r where r.table_id = v_table and r.deleted_at is null)
         or exists (select 1 from public.think_hub_table t where t.id = v_table and t.created_at >= now() - interval '7 days') then
        raise exception 'avora_cleanup_not_allowed';
      end if;
      perform public.delete_think_hub_table(v_table);
      v_trashed := v_trashed || v_table;
    else
      raise exception 'avora_cleanup_bad_items';
    end if;
  end loop;
  return jsonb_build_object('count', cardinality(v_archived_tables) + cardinality(v_trashed) + case when cardinality(v_archived_records) > 0 then 1 else 0 end,
    'archived_tables', to_jsonb(v_archived_tables), 'archived_records', to_jsonb(v_archived_records), 'trashed_tables', to_jsonb(v_trashed));
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_cleanup_suggestions()
 RETURNS TABLE(kind text, table_id uuid, table_name text, item_count integer, last_touch timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  return query
  with own as (
    select t.* from public.think_hub_table t
    where t.owner_user_id = v_user and private.cleanup_own_board(t.id, v_user)
  ),
  opened as (
    select o.board_key, max(o.opened_at) as at from public.think_hub_board_opened o where o.user_id = v_user group by o.board_key
  ),
  live as (
    select r.table_id, count(*)::integer as n from public.think_hub_record r join own on own.id = r.table_id
    where r.deleted_at is null and r.archived_at is null group by r.table_id
  )
  select 'dusty_board'::text, own.id, own.name, coalesce(live.n, 0), coalesce(op.at, own.created_at)
  from own left join opened op on op.board_key = own.id::text left join live on live.table_id = own.id
  where coalesce(op.at, own.created_at) < now() - interval '90 days' and coalesce(live.n, 0) > 0
  union all
  select 'done_records', own.id, own.name, count(*)::integer, max(r.updated_at)
  from own join public.think_hub_record r on r.table_id = own.id
  where r.deleted_at is null and r.archived_at is null and r.updated_at < now() - interval '90 days'
    and private.record_is_done(own.status_options, r.status)
  group by own.id, own.name
  union all
  select 'empty_board', own.id, own.name, 0, own.created_at
  from own left join live on live.table_id = own.id
  where coalesce(live.n, 0) = 0 and own.created_at < now() - interval '7 days'
    and not exists (select 1 from public.think_hub_record r where r.table_id = own.id and r.deleted_at is null);
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_open_questions()
 RETURNS TABLE(table_id uuid, empty_cells integer, has_conclusion boolean, others_changed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  return query
  select t.id,
    coalesce((select sum((select count(*) from jsonb_array_elements(t.column_defs) c
                          where coalesce(c ->> 'system', 'false') <> 'true' and c ? 'id'
                            and coalesce(r.extension_fields ->> (c ->> 'id'), '') = ''))::integer
              from public.think_hub_record r where r.table_id = t.id and r.deleted_at is null and r.archived_at is null), 0),
    exists (select 1 from public.think_hub_conclusions k where k.table_id = t.id),
    (select max(l.created_at) from public.think_hub_change_log l where l.table_id = t.id and l.actor_id <> v_user)
  from public.think_hub_table t
  where t.deleted_at is null and t.archived_at is null and private.think_hub_table_visible(t.id, v_user);
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_room_stats(p_since date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_out jsonb;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_since is null or p_since < current_date - 180 or p_since > current_date + 1 then raise exception 'avora_activity_bad_day'; end if;

  with boards as (
    select t.id, t.name, coalesce(t.lifecycle, 'waiting') as lifecycle
    from public.think_hub_table t
    where t.deleted_at is null and t.archived_at is null and coalesce(t.lifecycle, 'waiting') <> 'archived'
      and t.kind is distinct from 'bookshelf' and t.parent_record_id is null
      and private.think_hub_table_visible(t.id, v_user)
  ),
  recs as (
    select r.id, r.table_id, r.created_at from public.think_hub_record r join boards b on b.id = r.table_id where r.deleted_at is null and r.archived_at is null
  ),
  linked as (
    select rt.task_id from public.think_hub_record_tasks rt join recs on recs.id = rt.record_id
    union
    select pt.task_id from public.project_tasks pt join recs on recs.id = pt.record_id
  ),
  open_tasks as (
    select distinct k.id from public.tasks k join linked l on l.task_id = k.id
    where k.status <> 'done' and (k.creator_id = v_user or k.assignee_id = v_user)
      and not (k.creator_id = v_user and coalesce(k.deleted_by_creator, false))
  ),
  act as (
    select a.kind, a.item_key, sum(a.opens)::int as opens, sum(a.active_seconds)::int as seconds, max(a.day) as last_day
    from public.activity_daily a where a.user_id = v_user and a.day >= p_since group by a.kind, a.item_key
  ),
  board_act as (
    select act.*, b.name from act left join boards b on b.id::text = act.item_key
    where act.kind = 'board' and (b.id is not null or act.item_key !~ '^[0-9a-f]{8}-')
  ),
  book_act as (
    select act.*, r.title as name from act join public.think_hub_record r on r.id::text = act.item_key
    where act.kind = 'book' and r.owner_user_id = v_user and r.deleted_at is null
  ),
  counts as (select table_id, count(*)::int as n from recs group by table_id)
  select jsonb_build_object(
    'boards_by_status', jsonb_build_object(
      'waiting', (select count(*) from boards where lifecycle = 'waiting'),
      'thinking', (select count(*) from boards where lifecycle = 'thinking'),
      'concluded', (select count(*) from boards where lifecycle = 'concluded')),
    'records_total', (select count(*) from recs),
    'records_new', (select count(*) from recs where created_at >= p_since::timestamptz),
    'open_tasks', (select count(*) from open_tasks),
    'top_items', coalesce((select jsonb_agg(x order by x.value desc, x.name) from (
        select b.id::text as board_key, b.name, c.n as value from boards b join counts c on c.table_id = b.id order by c.n desc, b.name limit 3) x), '[]'::jsonb),
    'top_opens', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, opens as value from board_act where opens > 0 order by opens desc, item_key limit 3) x), '[]'::jsonb),
    'top_time', coalesce((select jsonb_agg(x order by x.value desc) from (
        select item_key as board_key, name, seconds as value from board_act where seconds > 0 order by seconds desc, item_key limit 3) x), '[]'::jsonb),
    'viewed', coalesce((select jsonb_agg(x order by x.last_day desc, x.seconds desc) from (
        select 'board' as kind, item_key, name, opens, seconds, last_day from board_act
        union all
        select 'book', item_key, name, opens, seconds, last_day from book_act) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.think_hub_tree(p_root_table_id uuid)
 RETURNS TABLE(node_kind text, node_id uuid, parent_id uuid, title text, depth integer, sort_order integer, done integer, total integer, own_total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_root public.think_hub_table%rowtype;
  v_project public.projects%rowtype;
  v_parent uuid;
  v_guard integer := 0;
begin
  if v_uid is null or not private.session_allowed() then return; end if;
  select b.* into v_root from public.think_hub_table b where b.id = p_root_table_id and b.deleted_at is null;
  if v_root.id is null or not private.think_hub_table_visible(v_root.id, v_uid) then return; end if;

  if v_root.project_id is not null then
    select pr.* into v_project from public.projects pr where pr.id = v_root.project_id and pr.deleted_at is null;
  end if;
  -- Not a project: the root is the top board this one grew from (a sub-board opens inside its whole tree).
  if v_project.id is null then
    loop
      v_parent := (select r.table_id from public.think_hub_record r where r.id = v_root.parent_record_id);
      exit when v_parent is null or v_guard > 8 or not private.think_hub_table_visible(v_parent, v_uid);
      select b.* into v_root from public.think_hub_table b where b.id = v_parent and b.deleted_at is null;
      exit when v_root.id is null;
      v_guard := v_guard + 1;
    end loop;
  end if;

  return query
  with recursive tabs as (
    select b.id, b.parent_record_id, b.name, b.position, b.created_at, 1 as lvl
    from public.think_hub_table b
    where b.deleted_at is null and b.archived_at is null
      and case when v_project.id is not null then b.project_id = v_project.id and b.parent_record_id is null
               else b.id = v_root.id end
      and private.think_hub_table_visible(b.id, v_uid)
    union all
    select s.id, s.parent_record_id, s.name, s.position, s.created_at, t.lvl + 1
    from tabs t
    join public.think_hub_record r on r.table_id = t.id and r.deleted_at is null and r.archived_at is null
    join public.think_hub_table s on s.parent_record_id = r.id and s.deleted_at is null and s.archived_at is null
    where t.lvl < 8 and private.think_hub_table_visible(s.id, v_uid)
  ),
  recs as (
    select r.id, r.table_id, r.title, r.created_at, t.lvl
    from public.think_hub_record r
    join tabs t on t.id = r.table_id
    where r.deleted_at is null and r.archived_at is null
  ),
  links as (
    select rt.record_id, rt.task_id from public.think_hub_record_tasks rt join recs on recs.id = rt.record_id
    union
    select pt.record_id, pt.task_id from public.project_tasks pt join recs on recs.id = pt.record_id
  ),
  live as (
    select l.record_id, t.id as task_id, (t.status in ('done', 'done_pending_review')) as is_done
    from links l
    join public.tasks t on t.id = l.task_id
    where t.pending_decision_id is null and t.status <> 'skipped'
      and not coalesce(t.deleted_by_creator, false) and not coalesce(t.deleted_by_peer, false)
      and private.can_view_task(t.id, v_uid)
  ),
  own as (
    select live.record_id, count(*) filter (where live.is_done)::integer as done, count(*)::integer as total
    from live group by live.record_id
  ),
  -- Every Hạng mục with each Hạng mục above it (itself included), through the sub-boards between them.
  rec_anc as (
    select recs.id as rec, recs.id as anc from recs
    union all
    select a.rec, pr.id
    from rec_anc a
    join recs ar on ar.id = a.anc
    join tabs tb on tb.id = ar.table_id
    join recs pr on pr.id = tb.parent_record_id
  ),
  rec_sum as (
    select a.anc as rec, coalesce(sum(o.done), 0)::integer as done, coalesce(sum(o.total), 0)::integer as total
    from rec_anc a left join own o on o.record_id = a.rec
    group by a.anc
  ),
  tab_sum as (
    select ar.table_id, coalesce(sum(o.done), 0)::integer as done, coalesce(sum(o.total), 0)::integer as total
    from rec_anc a
    join recs ar on ar.id = a.anc
    left join own o on o.record_id = a.rec
    group by ar.table_id
  ),
  unlinked as (
    select t.id, (t.status in ('done', 'done_pending_review')) as is_done
    from public.tasks t
    where (v_project.id is not null or v_root.conversation_id is not null)
      and t.pending_decision_id is null and t.status <> 'skipped' and t.type <> 'personal'
      and not coalesce(t.deleted_by_creator, false) and not coalesce(t.deleted_by_peer, false)
      and case when v_project.id is not null
               then exists (select 1 from public.project_tasks pt where pt.task_id = t.id and pt.project_id = v_project.id)
               else t.conversation_id = v_root.conversation_id end
      and not exists (select 1 from public.think_hub_record_tasks rt where rt.task_id = t.id)
      and not exists (select 1 from public.project_tasks pt where pt.task_id = t.id and pt.record_id is not null)
      and private.can_view_task(t.id, v_uid)
  ),
  un_sum as (
    select count(*) filter (where unlinked.is_done)::integer as done, count(*)::integer as total from unlinked
  )
  select case when tb.lvl = 1 and v_project.id is not null then 'project' else 'table' end, tb.id,
         tb.parent_record_id,
         case when tb.lvl = 1 and v_project.id is not null then v_project.title else tb.name end,
         (tb.lvl - 1) * 2,
         (row_number() over (partition by tb.parent_record_id order by tb.position, tb.created_at, tb.id))::integer,
         coalesce(ts.done, 0) + case when tb.lvl = 1 then (select u.done from un_sum u) else 0 end,
         coalesce(ts.total, 0) + case when tb.lvl = 1 then (select u.total from un_sum u) else 0 end,
         0
  from tabs tb left join tab_sum ts on ts.table_id = tb.id
  union all
  select 'record'::text, r.id, r.table_id, r.title, (r.lvl - 1) * 2 + 1,
         (row_number() over (partition by r.table_id order by r.created_at, r.id))::integer,
         coalesce(rs.done, 0), coalesce(rs.total, 0), coalesce(o.total, 0)
  from recs r left join rec_sum rs on rs.rec = r.id left join own o on o.record_id = r.id
  union all
  select 'unlinked'::text, v_root.id, v_root.id, 'Việc chưa gắn Hạng mục',
         1, 1000000, u.done, u.total, u.total
  from un_sum u
  where v_project.id is not null or v_root.conversation_id is not null;
end $function$;

CREATE OR REPLACE FUNCTION public.toggle_record_star(p_record_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_table uuid;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select table_id into v_table from think_hub_record where id = p_record_id and deleted_at is null;
  if not found or not private.think_hub_table_visible(v_table, v_user) then
    raise exception 'avora_think_hub_record_not_yours';
  end if;
  delete from think_hub_record_stars where user_id = v_user and record_id = p_record_id;
  if found then return false; end if;
  insert into think_hub_record_stars (user_id, record_id) values (v_user, p_record_id);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_conversation_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  new.conversation_id := old.conversation_id;
  if coalesce(current_setting('avora.owner_transfer', true), '') <> old.conversation_id::text then
    new.owner_id := old.owner_id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_task_flags_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_task_list_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.conversation_id := old.conversation_id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership(target_conversation_id uuid, new_owner_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_conv uuid := target_conversation_id;
  v_new uuid := new_owner_user_id;
  v_role text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = v_uid and cp.role = 'owner'
  ) then
    raise exception 'Only current owner can transfer ownership';
  end if;

  select cp.role into v_role from public.conversation_participants cp
  where cp.conversation_id = v_conv and cp.user_id = v_new;

  if v_role is null or v_role not in ('admin','member') then
    raise exception 'Target must be an existing admin or member of this group';
  end if;

  -- Step down first: two owners can never coexist, not even for one statement.
  update public.conversation_participants
    set role = 'member' where conversation_id = v_conv and user_id = v_uid;

  update public.conversation_participants
    set role = 'owner' where conversation_id = v_conv and user_id = v_new;

  -- The sidecar must not keep pointing at yesterday's owner.
  perform set_config('avora.owner_transfer', v_conv::text, true);
  update public.conversation_groups
    set owner_id = v_new where conversation_id = v_conv;
  perform set_config('avora.owner_transfer', '', true);
end $function$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.user_blocks where blocker_id = v_uid and blocked_id = p_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_contact_link_change(p_change_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'undo', null, null, null, p_change_id);
end $function$;

CREATE OR REPLACE FUNCTION public.undo_contact_merge(p_merge_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_log private.contact_merge_log%rowtype; v_drop public.contact%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_log from private.contact_merge_log where id = p_merge_id and owner_user_id = v_uid and undone_at is null for update;
  if v_log.id is null then raise exception 'avora_contact_merge_gone'; end if;
  v_drop := jsonb_populate_record(null::public.contact, v_log.dropped);
  insert into public.contact select v_drop.*;
  update public.contact_channel set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'channels') x) and owner_user_id = v_uid;
  delete from public.contact_channel where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'added') x) and owner_user_id = v_uid;
  update public.crm_opportunity set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'opportunities') x);
  update public.transactions set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'transactions') x) and user_id = v_uid;
  update public.contact_invite set contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'invites') x);
  update public.contact set employer_contact_id = v_drop.id where id in (select (x)::uuid from jsonb_array_elements_text(v_log.moved -> 'staff') x) and owner_user_id = v_uid;
  if (v_log.moved -> 'filled') ? 'phone' then update public.contact set phone = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'email' then update public.contact set email = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'note' then update public.contact set note = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  if (v_log.moved -> 'filled') ? 'date_of_birth' then update public.contact set date_of_birth = null where id = v_log.keep_id and owner_user_id = v_uid; end if;
  update private.contact_merge_log set undone_at = now() where id = v_log.id;
  return v_drop.id;
end $function$;

CREATE OR REPLACE FUNCTION public.unlink_contact(p_contact_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform private.assert_feature('contact_link');
  perform private.assert_session_allowed();
  return private.contact_link_change(auth.uid(), 'unlink', p_contact_id, null, null, null);
end $function$;

CREATE OR REPLACE FUNCTION public.unlink_task_from_record(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_previous uuid;
  v_title text;
begin
  if v_uid is null or not private.session_allowed() then
    raise exception 'avora_not_allowed' using errcode = '42501';
  end if;
  if not private.can_link_task(p_task_id, v_uid) then
    raise exception 'avora_task_not_editable' using errcode = '42501';
  end if;
  v_previous := private.current_task_record(p_task_id);
  if v_previous is null then return; end if;
  if not private.think_hub_record_editable(v_previous, v_uid) then
    raise exception 'avora_record_not_editable' using errcode = '42501';
  end if;
  select t.title into v_title from public.tasks t where t.id = p_task_id;
  delete from public.think_hub_record_tasks where task_id = p_task_id;
  update public.project_tasks set record_id = null where task_id = p_task_id;
  perform private.log_task_link(v_previous, 'task_unlink', v_title, v_uid);
end $function$;

CREATE OR REPLACE FUNCTION public.unlog_habit(p_habit uuid, p_local_date date, p_window integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits; v_n integer;
begin
  perform private.assert_feature('habits');
  v := private.habit_owned(p_habit, v_uid);
  -- Bỏ đánh dấu chỉ trong ngày (dung sai múi giờ: hôm qua → ngày mai theo giờ máy chủ).
  if not private.habit_date_ok(p_local_date) then raise exception 'avora_habit_date' using errcode = '22023'; end if;
  delete from public.habit_logs where habit_id = p_habit and local_date = p_local_date and window_index = p_window and status = 'done';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $function$;

CREATE OR REPLACE FUNCTION public.update_contact(p_contact_id uuid, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_relationship_tag text DEFAULT NULL::text, p_employer_contact_id uuid DEFAULT NULL::uuid, p_tax_code text DEFAULT NULL::text, p_business_address text DEFAULT NULL::text, p_representative_name text DEFAULT NULL::text, p_representative_phone text DEFAULT NULL::text, p_representative_email text DEFAULT NULL::text, p_industry text DEFAULT NULL::text)
 RETURNS contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing    contact%ROWTYPE;
  v_result      contact%ROWTYPE;
  v_employer    contact%ROWTYPE;
  v_name   text := nullif(btrim(p_name), '');
  v_phone  text := nullif(btrim(p_phone), '');
  v_email  text := nullif(btrim(p_email), '');
  v_tax    text := nullif(btrim(p_tax_code), '');
  v_rep    text := nullif(btrim(p_representative_name), '');
  v_rep_ph text := nullif(btrim(p_representative_phone), '');
  v_rep_em text := nullif(btrim(p_representative_email), '');
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT * INTO v_existing FROM contact WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy liên hệ này';
  END IF;
  IF v_existing.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ liên hệ mới được sửa liên hệ này';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Tên liên hệ không được để trống';
  END IF;

  IF v_existing.contact_type = 'individual' THEN
    IF v_phone IS NULL AND v_email IS NULL THEN
      RAISE EXCEPTION 'Liên hệ cá nhân cần ít nhất số điện thoại hoặc email';
    END IF;

    -- Nơi làm việc phải là doanh nghiệp của CHÍNH người này. Trigger đã chặn
    -- việc trỏ sang contact không phải business, nhưng không chặn trỏ sang
    -- doanh nghiệp của người khác — id đoán được thì phải chặn ở đây.
    IF p_employer_contact_id IS NOT NULL THEN
      SELECT * INTO v_employer FROM contact WHERE id = p_employer_contact_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy doanh nghiệp này';
      END IF;
      IF v_employer.owner_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Chỉ chọn được doanh nghiệp trong danh bạ của bạn';
      END IF;
      IF v_employer.contact_type <> 'business' THEN
        RAISE EXCEPTION 'Nơi làm việc phải là một liên hệ doanh nghiệp';
      END IF;
      IF v_employer.id = v_existing.id THEN
        RAISE EXCEPTION 'Một liên hệ không thể làm việc cho chính nó';
      END IF;
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

  -- contact_type, owner_user_id, linked_user_id KHÔNG nằm trong SET: loại không
  -- đổi được, chủ sở hữu không chuyển được, và liên kết tài khoản chỉ do
  -- accept_invite đặt — không phải thứ một form sửa tay được.
  UPDATE contact SET
    name                 = v_name,
    phone                = v_phone,
    email                = v_email,
    note                 = p_note,
    date_of_birth        = CASE WHEN v_existing.contact_type = 'individual' THEN p_date_of_birth ELSE date_of_birth END,
    relationship_tag     = CASE WHEN v_existing.contact_type = 'individual' THEN p_relationship_tag ELSE relationship_tag END,
    employer_contact_id  = CASE WHEN v_existing.contact_type = 'individual' THEN p_employer_contact_id ELSE employer_contact_id END,
    tax_code             = CASE WHEN v_existing.contact_type = 'business' THEN v_tax ELSE tax_code END,
    business_address     = CASE WHEN v_existing.contact_type = 'business' THEN p_business_address ELSE business_address END,
    representative_name  = CASE WHEN v_existing.contact_type = 'business' THEN v_rep ELSE representative_name END,
    representative_phone = CASE WHEN v_existing.contact_type = 'business' THEN v_rep_ph ELSE representative_phone END,
    representative_email = CASE WHEN v_existing.contact_type = 'business' THEN v_rep_em ELSE representative_email END,
    industry             = CASE WHEN v_existing.contact_type = 'business' THEN p_industry ELSE industry END
  WHERE id = p_contact_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_habit(p_id uuid, p_name text, p_kind text, p_target_minutes integer, p_weekdays integer[], p_windows jsonb, p_reminders_on boolean, p_version integer, p_when_away text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v public.habits;
begin
  perform private.assert_feature('habits');
  v := private.habit_owned(p_id, v_uid);
  if p_version is not null and p_version < v.version then raise exception 'avora_habit_conflict' using errcode = '40001'; end if;
  update public.habits set
    name = btrim(p_name), kind = p_kind, target_minutes = case when p_kind = 'timed' then p_target_minutes end,
    weekdays = coalesce((select array_agg(distinct d order by d) from unnest(p_weekdays) d), '{}'),
    windows = private.habit_windows_clean(p_windows), reminders_on = coalesce(p_reminders_on, true),
    when_away = case when p_when_away in ('keep', 'stop') then p_when_away else v.when_away end,
    version = v.version + 1, updated_at = now()
  where id = p_id;
  return v.version + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.update_meeting_note_draft(p_decision_id uuid, p_title text, p_body text)
 RETURNS group_decisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.group_decisions%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_title = '' then raise exception 'avora_decision_title_blank'; end if;

  select * into v_row from public.group_decisions where id = p_decision_id;
  if not found then raise exception 'avora_decision_not_found'; end if;
  if v_row.kind <> 'meeting_note' then raise exception 'avora_decision_bad_kind'; end if;
  if v_row.status <> 'draft' then raise exception 'avora_decision_settled_immutable'; end if;
  if not private.can_edit_meeting_note (p_decision_id, v_uid) then
    raise exception 'avora_decision_not_yours';
  end if;

  update public.group_decisions
    set title = left (v_title, 200), body = left (v_body, 5000)
    where id = p_decision_id;

  select * into v_row from public.group_decisions where id = p_decision_id;
  return v_row;
end
$function$;

CREATE OR REPLACE FUNCTION public.update_opportunity_stage(p_opportunity_id uuid, p_stage text)
 RETURNS crm_opportunity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row crm_opportunity%ROWTYPE;
BEGIN
  perform private.assert_session_allowed();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  IF p_stage NOT IN ('lead', 'tiem_nang', 'dang_cham_soc', 'doi_tac', 'khong_thanh') THEN
    RAISE EXCEPTION 'Giai đoạn không hợp lệ';
  END IF;

  SELECT * INTO v_row FROM crm_opportunity WHERE id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy cơ hội này';
  END IF;
  IF v_row.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Chỉ chủ cơ hội mới được đổi giai đoạn';
  END IF;

  UPDATE crm_opportunity SET stage = p_stage
  WHERE id = p_opportunity_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_scheduled_message(p_id uuid, p_content text, p_send_at timestamp with time zone)
 RETURNS scheduled_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.scheduled_messages;
  v_text text := btrim(coalesce(p_content, ''));
begin
  perform private.assert_session_allowed();
  select * into v_row from public.scheduled_messages where id = p_id and sender_id = v_uid for update;
  if not found then raise exception 'avora_schedule_missing'; end if;
  if v_row.status not in ('pending', 'failed') then raise exception 'avora_schedule_not_pending'; end if;
  perform private.schedule_guard(v_row.conversation_id, v_uid, p_send_at, p_id);
  if v_text = '' then raise exception 'avora_schedule_empty'; end if;
  if char_length(v_text) > 4000 then raise exception 'avora_message_too_long'; end if;
  update public.scheduled_messages
    set content = v_text, send_at = p_send_at, status = 'pending', fail_reason = null, updated_at = now()
    where id = p_id returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shared_task_details(p_task_id uuid, p_title text, p_description text, p_deadline date, p_deadline_time time without time zone DEFAULT NULL::time without time zone, p_deadline_tz text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_row public.tasks%rowtype;
  v_title text := btrim(p_title);
  v_description text := btrim(coalesce(p_description, ''));
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id
    and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant (v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-39 Phần 3 · D3: work that came from an accepted suggestion belongs to the person who
  -- accepted it. The proposer still reads it, but rewording it is no longer theirs.
  if private.task_owned_by_assignee (p_task_id) and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;

  -- A bystander in a group can read the task but was never party to it, so it is not theirs
  -- to reword. Only the person who asked and the person carrying it may edit.
  if v_uid <> v_row.creator_id
    and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if v_title = '' then
    raise exception 'avora_task_title_blank';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'avora_task_title_max_len';
  end if;
  if char_length(v_description) > 2000 then
    raise exception 'avora_task_description_max_len';
  end if;
  if p_deadline is null then
    raise exception 'avora_task_deadline_required';
  end if;

  update
    public.tasks
  set
    title = v_title,
    description = v_description,
    deadline_date = p_deadline,
    deadline_time = p_deadline_time,
    deadline_tz = coalesce(p_deadline_tz, deadline_tz),
    updated_at = now()
  where
    id = p_task_id;

  select
    * into v_row
  from
    public.tasks
  where
    id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shared_task_plan(p_task_id uuid, p_is_milestone boolean DEFAULT NULL::boolean, p_progress_percent integer DEFAULT NULL::integer, p_clear_progress boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row
  from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then
    raise exception 'avora_task_not_found';
  end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  -- AVORA-39 Phần 3 · D3: see update_shared_task_details.
  if private.task_owned_by_assignee (p_task_id) and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;

  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;

  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if p_progress_percent is not null
     and (p_progress_percent < 0 or p_progress_percent > 100) then
    raise exception 'avora_task_progress_range';
  end if;

  update public.tasks
  set
    is_milestone = coalesce(p_is_milestone, is_milestone),
    -- Null means "leave it alone" so one field can be set without disturbing the other;
    -- erasing an estimate is a separate, explicit request.
    progress_percent = case
      when p_clear_progress then null
      else coalesce(p_progress_percent, progress_percent)
    end,
    updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_shared_task_schedule(p_task_id uuid, p_estimated_duration_minutes integer, p_requires_presence boolean, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_location text, p_travel_duration_minutes integer, p_reminder_offset_minutes integer DEFAULT 0)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_presence boolean := coalesce(p_requires_presence, false);
  v_owned boolean;
  v_travel integer := case when coalesce(p_requires_presence, false) then p_travel_duration_minutes end;
  v_offset integer := greatest(coalesce(p_reminder_offset_minutes, 0), 0);
  v_departure timestamptz;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared');
  if not found then raise exception 'avora_task_not_found'; end if;

  if not private.is_conversation_participant(v_row.conversation_id, v_uid) then
    raise exception 'avora_not_a_participant';
  end if;

  v_owned := private.task_owned_by_assignee (p_task_id);
  if v_owned and not public.is_task_assignee (v_row, v_uid) then
    raise exception 'avora_task_owned_by_assignee';
  end if;
  if v_uid <> v_row.creator_id and not public.is_task_assignee(v_row, v_uid) then
    raise exception 'avora_task_not_party';
  end if;
  if v_row.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'avora_task_edit_closed';
  end if;

  if (v_presence or p_end_at is not null or v_location is not null) and p_start_at is null then
    raise exception 'avora_event_needs_start';
  end if;

  if v_travel is not null and p_start_at is not null then
    v_departure := p_start_at - make_interval(mins => v_travel + v_offset);
  end if;

  update public.tasks
  set
    estimated_duration_minutes = p_estimated_duration_minutes,
    requires_presence = v_presence,
    start_at = p_start_at,
    end_at = p_end_at,
    location = v_location,
    -- An owned task keeps travel out of the shared row: only its assignee may know it.
    travel_duration_minutes = case when v_owned then null else v_travel end,
    departure_reminder_at = case when v_owned then null else v_departure end,
    updated_at = now()
  where id = p_task_id;

  if v_owned then
    if v_travel is null then
      delete from public.task_travel_plans where task_id = p_task_id;
    else
      insert into public.task_travel_plans (task_id, user_id, travel_duration_minutes, reminder_offset_minutes, departure_reminder_at, updated_at)
      values (p_task_id, v_uid, v_travel, v_offset, v_departure, now())
      on conflict (task_id) do update
        set travel_duration_minutes = excluded.travel_duration_minutes,
            reminder_offset_minutes = excluded.reminder_offset_minutes,
            departure_reminder_at = excluded.departure_reminder_at,
            updated_at = now();
    end if;
  end if;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_think_hub_record(p_record_id uuid, p_patch jsonb)
 RETURNS think_hub_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row  think_hub_record%ROWTYPE;
  v_key  text;
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
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.urgent_status(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_state record;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.is_conversation_participant(p_conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  select * into v_state from private.urgent_state(v_uid, p_conversation_id);
  return jsonb_build_object('used_today', v_state.used_today, 'locked_until', v_state.locked_until);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_change_code(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new) then raise exception 'avora_vault_code_format'; end if;
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_old) or extensions.crypt(p_old, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_secrets set code_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where user_id = v_uid;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  -- Other sessions that were open lose their unlock; this one stays in.
  delete from private.vault_unlocks where user_id = v_uid and session_id is distinct from private.vault_session_id();
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'change');
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_change_passphrase(p_wrapped text, p_salt text, p_params jsonb, p_proof text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if coalesce((p_params ->> 'm')::int, 0) < 32768 or length(coalesce(p_proof, '')) < 40 then raise exception 'avora_vault_ring_invalid'; end if;
  update public.vault_keyring set mk_wrapped_pass = p_wrapped, salt_pass = p_salt, kdf_params = p_params, updated_at = now() where user_id = v_uid;
  update private.vault_proofs set pass_proof_hash = extensions.crypt(p_proof, extensions.gen_salt('bf', 8)) where user_id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_confirm_reset(p_email_code text, p_new_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if private.vault_encrypted(auth.uid()) then raise exception 'avora_vault_encrypted_use_passphrase'; end if;
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  select * into v_row from private.vault_reset_codes
    where user_id = v_uid and used_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not private.vault_code_ok(p_email_code) or extensions.crypt(p_email_code, v_row.code_hash) <> v_row.code_hash then
    update private.vault_reset_codes set attempts = attempts + 1,
      used_at = case when attempts + 1 >= 5 then now() else null end
    where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', case when v_row.attempts + 1 >= 5 then 'expired' else 'wrong' end);
  end if;
  update private.vault_reset_codes set used_at = now() where id = v_row.id;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update set code_hash = excluded.code_hash, updated_at = now();
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  delete from private.vault_unlocks where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'reset');
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_keyring_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vault_keyring%rowtype;
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from public.vault_keyring where user_id = auth.uid();
  if v.user_id is null then return null; end if;
  return to_jsonb(v) - 'user_id';
end $function$;

CREATE OR REPLACE FUNCTION public.vault_lock()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then return; end if;
  delete from private.vault_unlocks where user_id = auth.uid() and session_id = private.vault_session_id();
end $function$;

CREATE OR REPLACE FUNCTION public.vault_prove(p_kind text, p_proof text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.vault_proof_rate(v_uid);
  select case when p_kind = 'pass' then pass_proof_hash when p_kind = 'rec' then rec_proof_hash end into v_hash
  from private.vault_proofs where user_id = v_uid;
  if v_hash is null or extensions.crypt(coalesce(p_proof, ''), v_hash) <> v_hash then
    -- AVORA-102 · A0.2: only a wrong proof counts toward the 5-in-15-minutes wait.
    insert into private.vault_proof_attempts (user_id) values (v_uid);
    return false;
  end if;
  delete from private.vault_proof_attempts where user_id = v_uid and at > now() - interval '15 minutes';
  if private.vault_session_id() is not null then
    insert into private.vault_pass_sessions (session_id, user_id) values (private.vault_session_id(), v_uid) on conflict (session_id) do update set proved_at = now();
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_purge_item(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_unlocked();
  if not exists (select 1 from public.vault_items where id = p_id and owner_user_id = v_uid and deleted_at is not null) then
    raise exception 'avora_vault_item_missing';
  end if;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'vault-files' and name like v_uid::text || '/' || p_id::text || '/%';
  delete from public.vault_items where id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_register_device_share(p_device_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_me public.account_devices%rowtype := private.current_device(); v_share bytea := extensions.gen_random_bytes(32);
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if v_me.id is null or v_me.device_id <> p_device_id then raise exception 'avora_device_unbound'; end if;
  insert into private.vault_device_shares (user_id, device_id, share) values (v_uid, p_device_id, v_share)
  on conflict (user_id, device_id) do update set share = excluded.share, created_at = now();
  return encode(v_share, 'base64');
end $function$;

CREATE OR REPLACE FUNCTION public.vault_request_reset()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_email text; v_code text;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then raise exception 'avora_vault_no_email'; end if;
  if (select count(*) from private.vault_reset_codes where user_id = v_uid and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_vault_reset_rate';
  end if;
  update private.vault_reset_codes set used_at = now() where user_id = v_uid and used_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.vault_reset_codes (user_id, code_hash, expires_at)
  values (v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes');
  perform private.vault_send_mail(jsonb_build_object('kind', 'reset_code', 'email', v_email, 'code', v_code));
  return jsonb_build_object('ok', true, 'expires_in_minutes', 10);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_reset_code_by_passphrase(p_new_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set code_hash = excluded.code_hash;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_reset_everything(p_password text, p_email_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.check_password(v_uid, p_password) then raise exception 'avora_device_password'; end if;
  select * into v_row from private.vault_reset_codes where user_id = v_uid and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if v_row.id is null or extensions.crypt(coalesce(p_email_code, ''), v_row.code_hash) <> v_row.code_hash then
    if v_row.id is not null then update private.vault_reset_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() end where id = v_row.id; end if;
    raise exception 'avora_device_code';
  end if;
  update private.vault_reset_codes set used_at = now() where id = v_row.id;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'vault-files' and (storage.foldername(name))[1] = v_uid::text;
  delete from public.vault_items where owner_user_id = v_uid;
  delete from public.vault_keyring where user_id = v_uid;
  delete from private.vault_proofs where user_id = v_uid;
  delete from private.vault_device_shares where user_id = v_uid;
  delete from private.vault_pass_sessions where user_id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_rotate_recovery(p_wrapped text, p_salt text, p_check text, p_proof text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if not exists (select 1 from private.vault_pass_sessions where session_id = private.vault_session_id() and user_id = v_uid and proved_at > now() - interval '30 minutes') then
    raise exception 'avora_vault_pass_required';
  end if;
  if length(coalesce(p_proof, '')) < 40 then raise exception 'avora_vault_ring_invalid'; end if;
  update public.vault_keyring set mk_wrapped_rec = p_wrapped, salt_rec = p_salt, rec_check = p_check, kit_confirmed_at = now(), updated_at = now() where user_id = v_uid;
  update private.vault_proofs set rec_proof_hash = extensions.crypt(p_proof, extensions.gen_salt('bf', 8)) where user_id = v_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_set_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do nothing;
  if not found then raise exception 'avora_vault_code_exists'; end if;
  perform private.vault_open_session(v_uid);
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_setup(p_ring jsonb, p_pass_proof text, p_rec_proof text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if exists (select 1 from public.vault_keyring where user_id = v_uid) then raise exception 'avora_vault_ring_exists'; end if;
  if coalesce(p_ring ->> 'mk_wrapped_pass', '') = '' or coalesce(p_ring ->> 'mk_wrapped_rec', '') = ''
     or jsonb_typeof(p_ring -> 'section_keys') <> 'object' or jsonb_typeof(p_ring -> 'kdf_params') <> 'object'
     or coalesce((p_ring -> 'kdf_params' ->> 'm')::int, 0) < 32768 or length(coalesce(p_pass_proof, '')) < 40 or length(coalesce(p_rec_proof, '')) < 40 then
    raise exception 'avora_vault_ring_invalid';
  end if;
  -- The kit was asked back (3 words) before this call: a keyring never exists without a confirmed kit.
  insert into public.vault_keyring (user_id, mk_wrapped_pass, salt_pass, kdf_params, mk_wrapped_rec, salt_rec, rec_check, section_keys, key_version, kit_confirmed_at)
  values (v_uid, p_ring ->> 'mk_wrapped_pass', p_ring ->> 'salt_pass', p_ring -> 'kdf_params', p_ring ->> 'mk_wrapped_rec', p_ring ->> 'salt_rec',
          p_ring ->> 'rec_check', p_ring -> 'section_keys', coalesce((p_ring ->> 'key_version')::int, 1), now());
  insert into private.vault_proofs (user_id, pass_proof_hash, rec_proof_hash)
  values (v_uid, extensions.crypt(p_pass_proof, extensions.gen_salt('bf', 8)), extensions.crypt(p_rec_proof, extensions.gen_salt('bf', 8)));
  if private.vault_session_id() is not null then
    insert into private.vault_pass_sessions (session_id, user_id) values (private.vault_session_id(), v_uid) on conflict (session_id) do update set proved_at = now();
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.vault_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_exp timestamptz; v_failed integer; v_me public.account_devices%rowtype := private.current_device();
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select expires_at into v_exp from private.vault_unlocks where user_id = v_uid and session_id = private.vault_session_id() and expires_at > now();
  select failed_count into v_failed from private.vault_attempts where user_id = v_uid;
  return jsonb_build_object(
    'has_code', exists (select 1 from private.vault_secrets where user_id = v_uid),
    'has_data', exists (select 1 from public.accounts where user_id = v_uid) or exists (select 1 from public.transactions where user_id = v_uid),
    'unlocked', v_exp is not null,
    'expires_at', v_exp,
    'locked_until', private.vault_wait_until(v_uid),
    'remaining', 5 - coalesce(v_failed, 0),
    'has_keyring', private.vault_encrypted(v_uid),
    'device_share', v_me.id is not null and exists (select 1 from private.vault_device_shares s where s.user_id = v_uid and s.device_id = v_me.device_id),
    -- AVORA-102 · A1.3: whether this session is tied to a device at all (unbound ≠ a stranger).
    'device_bound', v_me.id is not null,
    'has_main_device', exists (select 1 from public.account_devices d where d.user_id = v_uid and d.rank in (1, 2) and d.revoked_at is null),
    'device_allowed', private.vault_device_allowed(v_uid));
end $function$;

CREATE OR REPLACE FUNCTION public.vault_touch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'pg_temp'
AS $function$
declare v_exp timestamptz;
begin
  perform private.assert_session_allowed();
  update private.vault_unlocks set expires_at = now() + interval '5 minutes'
  where user_id = auth.uid() and session_id = private.vault_session_id() and expires_at > now()
  returning expires_at into v_exp;
  return jsonb_build_object('unlocked', v_exp is not null, 'expires_at', v_exp);
end $function$;

CREATE OR REPLACE FUNCTION public.vault_unlock(p_code text, p_device_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz; v_me public.account_devices%rowtype := private.current_device(); v_share bytea;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  perform private.assert_session_allowed();
  perform private.vault_assert_device_allowed();
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_code) or extensions.crypt(p_code, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  if p_device_id is not null and v_me.id is not null and v_me.device_id = p_device_id then
    select share into v_share from private.vault_device_shares where user_id = v_uid and device_id = p_device_id;
  end if;
  return jsonb_build_object('ok', true, 'share', case when v_share is null then null else encode(v_share, 'base64') end);
end $function$;

CREATE OR REPLACE FUNCTION public.verify_account_password(p_password text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'extensions', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from private.password_checks where checked_at < now() - interval '1 day';
  if (select count(*) from private.password_checks where user_id = v_uid and checked_at > now() - interval '15 minutes') >= 5 then
    raise exception 'avora_password_check_rate';
  end if;
  insert into private.password_checks (user_id) values (v_uid);
  select encrypted_password into v_hash from auth.users where id = v_uid;
  return coalesce(v_hash, '') <> '' and length(coalesce(p_password, '')) between 1 and 200
    and extensions.crypt(p_password, v_hash) = v_hash;
end $function$;

CREATE OR REPLACE FUNCTION public.vote_shared_proposal(p_proposal_id uuid, p_vote text, p_reason text DEFAULT NULL::text)
 RETURNS shared_proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v shared_proposals%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if p_vote not in ('agree', 'disagree') then raise exception 'avora_proposal_vote_invalid'; end if;
  select * into v from shared_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_missing'; end if;
  if v.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  if not private.is_conversation_participant(v.conversation_id, v_uid) then raise exception 'avora_not_a_participant'; end if;
  if not exists (select 1 from shared_proposal_votes where proposal_id = v.id and user_id = v_uid) then
    raise exception 'avora_proposal_not_stakeholder';
  end if;
  if p_vote = 'disagree' and v_reason is null then raise exception 'avora_proposal_reason_required'; end if;
  if char_length(coalesce(v_reason, '')) > 300 then raise exception 'avora_proposal_reason_too_long'; end if;

  update shared_proposal_votes set vote = p_vote, reason = v_reason, voted_at = now()
  where proposal_id = v.id and user_id = v_uid;

  if p_vote = 'disagree' then
    update shared_proposals set status = 'rejected', resolved_at = now() where id = v.id returning * into v;
    perform private.post_system_line(v.conversation_id, v_uid, 'proposal_rejected',
      format('Cần trao đổi — %s không đồng ý %s: "%s"', private.public_name(v_uid),
        private.proposal_words(v.action, v.target_type, v.target_name), v_reason));
    return v;
  end if;
  perform private.settle_proposal(v.id, v_uid);
  select * into v from shared_proposals where id = v.id;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.withdraw_shared_proposal(p_proposal_id uuid)
 RETURNS shared_proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v shared_proposals%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from shared_proposals where id = p_proposal_id for update;
  if not found then raise exception 'avora_proposal_missing'; end if;
  if v.proposed_by <> v_uid then raise exception 'avora_proposal_not_proposer'; end if;
  if v.status = 'withdrawn' then return v; end if;
  if v.status <> 'open' then raise exception 'avora_proposal_closed'; end if;
  update shared_proposals set status = 'withdrawn', resolved_at = now() where id = v.id returning * into v;
  perform private.post_system_line(v.conversation_id, v_uid, 'proposal_withdrawn',
    format('%s đã rút lại đề nghị %s.', private.public_name(v_uid), private.proposal_words(v.action, v.target_type, v.target_name)));
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.withdraw_task_invitation(p_participant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.task_participants p
   using public.tasks t
   where p.id = p_participant_id and t.id = p.task_id and t.creator_id = auth.uid();
  if not found then raise exception 'avora_invitation_not_yours'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_task_suggestion(p_suggestion_id uuid)
 RETURNS task_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_s public.task_suggestions%rowtype;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_s from public.task_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'avora_suggestion_not_found'; end if;

  -- Withdrawing is the proposer's own way out of an unanswered request. It is deliberately
  -- distinct from skipping: taking your own question back says nothing about how the other
  -- person would have answered it, and must never look like a refusal on their behalf.
  if v_s.proposer_id <> v_uid then raise exception 'avora_task_not_proposer'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_s.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  if v_s.status = 'withdrawn' then return v_s; end if;
  if v_s.status <> 'pending' then raise exception 'avora_suggestion_already_answered'; end if;

  update public.task_suggestions
  set status = 'withdrawn', resolved_at = now()
  where id = p_suggestion_id
  returning * into v_s;

  return v_s;
end;
$function$;

