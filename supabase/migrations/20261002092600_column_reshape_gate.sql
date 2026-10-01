-- AVORA-61 · E: allow the two reshaping RPCs (and only them) past the column-immutability rule.

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
