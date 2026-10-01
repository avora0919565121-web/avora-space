-- AVORA-52 · A: deleting a folder takes its sub-folders with it; every note inside the whole
-- subtree goes to Chưa xếp (or to Thùng rác when asked). Never a system folder.
create or replace function public.delete_note_folder(p_folder_id uuid, p_trash_notes boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v note_folders%rowtype; v_n integer; v_ids uuid[];
begin
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
end $$;

revoke all on function public.delete_note_folder(uuid, boolean) from public, anon;
grant execute on function public.delete_note_folder(uuid, boolean) to authenticated;
