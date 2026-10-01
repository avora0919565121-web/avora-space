-- Advisor after AVORA-61–63: functions that only touch the caller's own rows run as the caller
-- (RLS decides), and the new foreign keys get covering indexes.

-- think_hub_table_seen: a person writes only their own row.
drop policy if exists think_hub_table_seen_own_write on public.think_hub_table_seen;
create policy think_hub_table_seen_own_write on public.think_hub_table_seen for insert to authenticated
  with check (user_id = (select auth.uid()) and private.think_hub_table_visible(table_id, (select auth.uid())));
drop policy if exists think_hub_table_seen_own_update on public.think_hub_table_seen;
create policy think_hub_table_seen_own_update on public.think_hub_table_seen for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant insert (user_id, table_id, seen_at), update (seen_at) on public.think_hub_table_seen to authenticated;

create or replace function public.mark_think_hub_table_seen(p_table_id uuid)
 returns timestamptz
 language plpgsql
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
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

-- think_hub_nudges: the recipient may only mark their own line seen.
drop policy if exists think_hub_nudges_own_seen on public.think_hub_nudges;
create policy think_hub_nudges_own_seen on public.think_hub_nudges for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant update (seen_at) on public.think_hub_nudges to authenticated;

create or replace function public.dismiss_think_hub_nudge(p_id uuid)
 returns void
 language sql
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
  update think_hub_nudges set seen_at = now() where id = p_id and user_id = auth.uid();
$function$;

-- rename_contacts_bulk: contact_update_own + the existing UPDATE(name) grant already say who may.
create or replace function public.rename_contacts_bulk(p_changes jsonb)
 returns jsonb
 language plpgsql
 security invoker
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
    select name into v_old from contact where id = v_id and owner_user_id = v_user for update;
    if not found or v_old = v_name then continue; end if;
    update contact set name = v_name where id = v_id and owner_user_id = v_user;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'previous', v_old, 'name', v_name));
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.mark_think_hub_table_seen(uuid) from public, anon;
revoke all on function public.dismiss_think_hub_nudge(uuid) from public, anon;
revoke all on function public.rename_contacts_bulk(jsonb) from public, anon;
grant execute on function public.mark_think_hub_table_seen(uuid) to authenticated;
grant execute on function public.dismiss_think_hub_nudge(uuid) to authenticated;
grant execute on function public.rename_contacts_bulk(jsonb) to authenticated;

-- Covering indexes for the new foreign keys.
create index if not exists think_hub_announcements_actor_idx on public.think_hub_announcements (actor_id);
create index if not exists think_hub_announcements_conversation_idx on public.think_hub_announcements (conversation_id);
create index if not exists think_hub_cell_files_uploader_idx on public.think_hub_cell_files (uploaded_by);
create index if not exists think_hub_change_log_actor_idx on public.think_hub_change_log (actor_id);
create index if not exists think_hub_change_log_record_idx on public.think_hub_change_log (record_id);
create index if not exists think_hub_change_log_owner_idx on public.think_hub_change_log (record_owner_id);
create index if not exists think_hub_nudges_actor_idx on public.think_hub_nudges (actor_id);
create index if not exists think_hub_nudges_record_idx on public.think_hub_nudges (record_id);
create index if not exists think_hub_nudges_table_idx on public.think_hub_nudges (table_id);
create index if not exists think_hub_table_seen_table_idx on public.think_hub_table_seen (table_id);
