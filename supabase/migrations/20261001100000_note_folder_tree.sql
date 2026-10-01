-- AVORA-52 · A: Ghi chép folders become a tree of at most three levels (ADR-035).
-- The rules live here, not in the client: same owner, never under a system folder, no cycles,
-- no deeper than three levels — including when a folder with its own children is moved.

alter table public.note_folders
  add column if not exists parent_id uuid references public.note_folders(id) on delete cascade;

create index if not exists note_folders_parent_idx on public.note_folders (parent_id);

create or replace function private.note_folder_tree_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
end $$;

revoke all on function private.note_folder_tree_guard() from public, anon, authenticated;

drop trigger if exists note_folder_tree_guard on public.note_folders;
create trigger note_folder_tree_guard
  before insert or update of parent_id, owner_user_id, is_system on public.note_folders
  for each row execute function private.note_folder_tree_guard();
