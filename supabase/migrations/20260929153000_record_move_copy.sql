-- Đợt gộp 2 · C11 — Di chuyển / Sao chép Hạng mục sang Bảng khác (ADR-031 luật scope).
-- One planner decides everything (preview, move, copy all read it), so the rules exist once:
--   · the fixed columns travel as they are;
--   · a status the target does not have becomes the target's first status (said in the preview);
--   · an extra column travels when the target has one with the same name and type, otherwise its
--     value is written at the end of Ghi chú as "Tên cột: giá trị" — nothing is ever dropped;
--   · moving keeps the Hạng mục's id, so task links and ★ stars go with it; leaving a project
--     unhooks project_tasks.record_id (warned first); entering a project unhooks the non-project links.
--   · a Hạng mục with a live sub-table cannot move (copy can, without the sub-table);
--   · shared → anywhere else only when it is entirely the mover's: they made it, nobody else edited
--     it, no task belongs to someone else. Otherwise: copy.

alter table public.think_hub_record add column if not exists moved_from jsonb;
alter table public.think_hub_record drop constraint if exists think_hub_record_moved_from_shape;
alter table public.think_hub_record add constraint think_hub_record_moved_from_shape
  check (moved_from is null or jsonb_typeof(moved_from) = 'object');
grant select (moved_from) on public.think_hub_record to authenticated;

-- A Hạng mục may change table only inside the move function.
CREATE OR REPLACE FUNCTION private.validate_think_hub_record()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

-- The statuses a table offers, as [{key,label}]; tables without their own use the four defaults.
create or replace function private.table_statuses(p_status_options jsonb)
returns jsonb language sql immutable as $$
  select coalesce(p_status_options,
    '[{"key":"moi","label":"Mới"},{"key":"dang_lam","label":"Đang làm"},{"key":"cho_phan_hoi","label":"Chờ phản hồi"},{"key":"xong","label":"Xong","done":true}]'::jsonb)
$$;

create or replace function private.status_label_in(p_status_options jsonb, p_status text)
returns text language sql immutable as $$
  select coalesce(
    (select o->>'label' from jsonb_array_elements(private.table_statuses(p_status_options)) o where o->>'key' = p_status limit 1),
    (select o->>'label' from jsonb_array_elements(private.table_statuses(null)) o where o->>'key' = p_status limit 1),
    p_status)
$$;

create or replace function private.scope_name(p_conversation uuid, p_project uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_project is not null then coalesce((select title from projects where id = p_project), 'Dự án')
    when p_conversation is null then 'Của tôi'
    else coalesce((select name from conversation_groups where conversation_id = p_conversation),
                  (select 'Cuộc 1-1' from conversations where id = p_conversation and type = 'direct'), 'Cuộc trò chuyện')
  end
$$;

-- Everything the move/copy will do, and whether it may. Raises only for "not yours / missing".
create or replace function private.plan_record_transfer(p_record_id uuid, p_target_table_id uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
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
end $$;

revoke all on function private.table_statuses(jsonb) from public, anon, authenticated;
revoke all on function private.status_label_in(jsonb, text) from public, anon, authenticated;
revoke all on function private.scope_name(uuid, uuid) from public, anon, authenticated;
revoke all on function private.plan_record_transfer(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.notes_with(p_notes text, p_lines text[])
returns text language sql immutable as $$
  select nullif(btrim(concat_ws(E'\n\n', nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(array_to_string(p_lines, E'\n'), ''))), '')
$$;

create or replace function public.preview_think_hub_record_transfer(p_record_id uuid, p_target_table_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  v := private.plan_record_transfer(p_record_id, p_target_table_id, auth.uid());
  return v - 'extension_fields' - 'status_to_key';
end $$;

create or replace function public.move_think_hub_record(p_record_id uuid, p_target_table_id uuid, p_append_unmatched_to_notes boolean)
returns public.think_hub_record language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v jsonb; r think_hub_record%rowtype; src think_hub_table%rowtype; dst think_hub_table%rowtype;
  v_lines text[];
begin
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
end $$;

create or replace function public.copy_think_hub_record(p_record_id uuid, p_target_table_id uuid)
returns public.think_hub_record language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v jsonb; r think_hub_record%rowtype; src think_hub_table%rowtype; dst think_hub_table%rowtype;
  v_lines text[]; v_new think_hub_record%rowtype;
begin
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
end $$;

-- A sub-table left in the bin under a Hạng mục that has since moved stays in its old scope: it can
-- no longer be brought back under that Hạng mục (it would carry one room's notes into another).
create or replace function private.sub_table_scope_matches(p_table_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select t.conversation_id is not distinct from p.conversation_id and t.project_id is not distinct from p.project_id
    from think_hub_table t join think_hub_record r on r.id = t.parent_record_id join think_hub_table p on p.id = r.table_id
    where t.id = p_table_id), true)
$$;
revoke all on function private.sub_table_scope_matches(uuid) from public, anon, authenticated;

create or replace function private.block_orphan_sub_restore()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.deleted_at is not null and new.deleted_at is null and new.parent_record_id is not null
     and not private.sub_table_scope_matches(new.id) then
    raise exception 'avora_think_hub_table_out_of_scope';
  end if;
  return new;
end $$;
drop trigger if exists trg_think_hub_table_orphan_restore on public.think_hub_table;
create trigger trg_think_hub_table_orphan_restore before update of deleted_at on public.think_hub_table
  for each row execute function private.block_orphan_sub_restore();

revoke all on function public.preview_think_hub_record_transfer(uuid, uuid) from public, anon;
revoke all on function public.move_think_hub_record(uuid, uuid, boolean) from public, anon;
revoke all on function public.copy_think_hub_record(uuid, uuid) from public, anon;
grant execute on function public.preview_think_hub_record_transfer(uuid, uuid) to authenticated;
grant execute on function public.move_think_hub_record(uuid, uuid, boolean) to authenticated;
grant execute on function public.copy_think_hub_record(uuid, uuid) to authenticated;
