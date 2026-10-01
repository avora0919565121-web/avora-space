-- AVORA-61 · D/E: four new column kinds, safe type changes, soft-deleted columns with a
-- per-board bin (30 days, values kept), and files attached to a cell.

-- ---------------------------------------------------------------- the per-board column bin
alter table public.think_hub_table add column if not exists column_trash jsonb not null default '[]'::jsonb;
alter table public.think_hub_table drop constraint if exists think_hub_table_column_trash_shape;
alter table public.think_hub_table add constraint think_hub_table_column_trash_shape check (jsonb_typeof(column_trash) = 'array');
revoke all (column_trash) on public.think_hub_table from anon;
grant select (column_trash) on public.think_hub_table to authenticated;

-- ---------------------------------------------------------------- add a column: 8 kinds
create or replace function public.add_think_hub_column(p_table_id uuid, p_label text, p_type text, p_options text[] default null::text[])
 returns think_hub_table
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user    uuid := auth.uid();
  v_label   text;
  v_options jsonb;
  v_id      text;
  v_def     jsonb;
  v_row     think_hub_table%rowtype;
begin
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

-- ---------------------------------------------------------------- change a column's kind, only when safe
create or replace function public.change_think_hub_column_type(p_table_id uuid, p_column_id text, p_type text)
 returns think_hub_table
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  update think_hub_table
  set column_defs = (
    select jsonb_agg(case when d->>'id' = p_column_id then (d - 'options') || jsonb_build_object('type', p_type) else d end order by ord)
    from jsonb_array_elements(v_row.column_defs) with ordinality as e(d, ord)
  )
  where id = p_table_id
  returning * into v_row;
  return v_row;
end;
$function$;

-- ---------------------------------------------------------------- soft-delete a column into the board's bin
create or replace function public.delete_think_hub_column(p_table_id uuid, p_column_id text)
 returns think_hub_table
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  return v_row;
end;
$function$;

-- ---------------------------------------------------------------- restore a column with its values
create or replace function public.restore_think_hub_column(p_table_id uuid, p_column_id text)
 returns think_hub_table
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user  uuid := auth.uid();
  v_row   think_hub_table%rowtype;
  v_entry jsonb;
  v_key   text;
begin
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

-- ---------------------------------------------------------------- files in a cell
create table if not exists public.think_hub_cell_files (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  record_id uuid not null references public.think_hub_record(id) on delete cascade,
  column_key text not null check (char_length(column_key) between 1 and 80),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null default 'application/octet-stream' check (char_length(mime_type) <= 255),
  byte_size bigint not null check (byte_size >= 0 and byte_size <= 26214400),
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists think_hub_cell_files_record_idx on public.think_hub_cell_files (record_id, column_key);
create index if not exists think_hub_cell_files_table_idx on public.think_hub_cell_files (table_id);
alter table public.think_hub_cell_files enable row level security;

create or replace function private.think_hub_cell_file_insertable(p_table_id uuid, p_record_id uuid, p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select p_user is not null
    and private.think_hub_table_visible(p_table_id, p_user)
    and exists (select 1 from think_hub_table t where t.id = p_table_id and t.deleted_at is null and t.archived_at is null)
    and exists (select 1 from think_hub_record r where r.id = p_record_id and r.table_id = p_table_id and r.deleted_at is null)
$function$;

create or replace function private.think_hub_cell_file_deletable(p_table_id uuid, p_uploader uuid, p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- The person who attached it, or the board's owner. Nobody else.
  select p_user is not null and private.think_hub_table_visible(p_table_id, p_user)
    and (p_uploader = p_user or exists (select 1 from think_hub_table t where t.id = p_table_id and t.owner_user_id = p_user))
$function$;

revoke all on function private.think_hub_cell_file_insertable(uuid, uuid, uuid) from public, anon;
revoke all on function private.think_hub_cell_file_deletable(uuid, uuid, uuid) from public, anon;
grant execute on function private.think_hub_cell_file_insertable(uuid, uuid, uuid) to authenticated;
grant execute on function private.think_hub_cell_file_deletable(uuid, uuid, uuid) to authenticated;

drop policy if exists think_hub_cell_files_select on public.think_hub_cell_files;
create policy think_hub_cell_files_select on public.think_hub_cell_files for select to authenticated
  using (private.think_hub_table_visible(table_id, (select auth.uid())));
drop policy if exists think_hub_cell_files_insert on public.think_hub_cell_files;
create policy think_hub_cell_files_insert on public.think_hub_cell_files for insert to authenticated
  with check (uploaded_by = (select auth.uid())
    and storage_path like (table_id::text || '/' || record_id::text || '/%')
    and private.think_hub_cell_file_insertable(table_id, record_id, (select auth.uid())));
drop policy if exists think_hub_cell_files_delete on public.think_hub_cell_files;
create policy think_hub_cell_files_delete on public.think_hub_cell_files for delete to authenticated
  using (private.think_hub_cell_file_deletable(table_id, uploaded_by, (select auth.uid())));

revoke all on public.think_hub_cell_files from public, anon, authenticated;
grant select, insert, delete on public.think_hub_cell_files to authenticated;

-- Storage: one private bucket, path = <table_id>/<record_id>/<uuid>-<name>, same cap as chat files.
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-files', 'board-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

create or replace function private.board_file_table(p_name text)
 returns uuid
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$function$;
create or replace function private.board_file_record(p_name text)
 returns uuid
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 2)::uuid end
$function$;
create or replace function private.board_file_uploader(p_name text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select uploaded_by from think_hub_cell_files where storage_path = p_name
$function$;
revoke all on function private.board_file_table(text) from public, anon;
revoke all on function private.board_file_record(text) from public, anon;
revoke all on function private.board_file_uploader(text) from public, anon;
grant execute on function private.board_file_table(text) to authenticated;
grant execute on function private.board_file_record(text) to authenticated;
grant execute on function private.board_file_uploader(text) to authenticated;

drop policy if exists board_files_read on storage.objects;
create policy board_files_read on storage.objects for select to authenticated
  using (bucket_id = 'board-files' and private.think_hub_table_visible(private.board_file_table(name), (select auth.uid())));
drop policy if exists board_files_write on storage.objects;
create policy board_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'board-files'
    and private.think_hub_cell_file_insertable(private.board_file_table(name), private.board_file_record(name), (select auth.uid())));
drop policy if exists board_files_delete on storage.objects;
create policy board_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board-files'
    and private.think_hub_cell_file_deletable(private.board_file_table(name),
      coalesce(private.board_file_uploader(name), (select auth.uid())), (select auth.uid())));

-- ---------------------------------------------------------------- a member asks the owner to delete a column
alter table public.messages drop constraint if exists messages_system_kind_check;
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%system_kind%project_deleted%';
  if v_name is not null then execute format('alter table public.messages drop constraint %I', v_name); end if;
end $$;
alter table public.messages add constraint messages_system_kind_check check (system_kind is null or system_kind = any (array[
  'project_deleted', 'proposal_opened', 'proposal_approved', 'proposal_rejected', 'proposal_expired', 'proposal_withdrawn',
  'shared_restored', 'recall_expired', 'member_added',
  'column_delete_requested', 'board_update', 'board_created'
]));

create or replace function public.request_think_hub_column_delete(p_table_id uuid, p_column_id text, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row    think_hub_table%rowtype;
  v_def    jsonb;
  v_conv   uuid;
begin
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

revoke all on function public.change_think_hub_column_type(uuid, text, text) from public, anon;
revoke all on function public.delete_think_hub_column(uuid, text) from public, anon;
revoke all on function public.restore_think_hub_column(uuid, text) from public, anon;
revoke all on function public.request_think_hub_column_delete(uuid, text, text) from public, anon;
revoke all on function public.add_think_hub_column(uuid, text, text, text[]) from public, anon;
grant execute on function public.change_think_hub_column_type(uuid, text, text) to authenticated;
grant execute on function public.delete_think_hub_column(uuid, text) to authenticated;
grant execute on function public.restore_think_hub_column(uuid, text) to authenticated;
grant execute on function public.request_think_hub_column_delete(uuid, text, text) to authenticated;
grant execute on function public.add_think_hub_column(uuid, text, text, text[]) to authenticated;
