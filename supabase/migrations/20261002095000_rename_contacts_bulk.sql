-- AVORA-63 · B: apply the names a person ticked in "Sửa tên", in one call. Only their own
-- contacts; returns each row's previous name so "Hoàn tác" can put every one back.
create or replace function public.rename_contacts_bulk(p_changes jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    -- Someone else's contact is skipped silently: it does not exist for this caller.
    select name into v_old from contact where id = v_id and owner_user_id = v_user for update;
    if not found then continue; end if;
    if v_old = v_name then continue; end if;
    update contact set name = v_name where id = v_id and owner_user_id = v_user;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'previous', v_old, 'name', v_name));
  end loop;
  return v_out;
end;
$function$;
revoke all on function public.rename_contacts_bulk(jsonb) from public, anon;
grant execute on function public.rename_contacts_bulk(jsonb) to authenticated;
