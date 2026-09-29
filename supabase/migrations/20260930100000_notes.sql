-- AVORA-44 · B/C — Ghi chép: bài tự viết, xếp theo thư mục một cấp. Riêng tư: chỉ chủ đọc/ghi.
-- Không có đường nào đưa tin nhắn vào đây (quyết định 2): không cột nguồn, không liên kết ngược.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Accent-free, lower-case text for search (ADR-032). A pure text function, so it lives in public:
-- a SECURITY INVOKER search must be able to call it, and the private schema stays closed.
create or replace function public.f_unaccent(p text)
returns text language sql immutable parallel safe strict set search_path = extensions, pg_temp as $$
  select lower(replace(replace(extensions.unaccent('extensions.unaccent'::regdictionary, p), 'đ', 'd'), 'Đ', 'D'))
$$;
revoke all on function public.f_unaccent(text) from public, anon;
grant execute on function public.f_unaccent(text) to authenticated;

-- ------------------------------------------------------------------ folders
create table if not exists public.note_folders (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  is_system boolean not null default false,
  system_key text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint note_folders_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint note_folders_system_key check ((is_system and system_key = 'reading') or (not is_system and system_key is null))
);
create unique index if not exists note_folders_one_system on public.note_folders (owner_user_id, system_key) where system_key is not null;
create index if not exists note_folders_owner_idx on public.note_folders (owner_user_id, position);

-- ------------------------------------------------------------------ notes
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  folder_id uuid references public.note_folders(id) on delete set null,
  title text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  search_text text not null default '',
  tags text[] not null default '{}',
  pinned_at timestamptz,
  book_record_id uuid references public.think_hub_record(id) on delete set null,
  book_title text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_blocks_array check (jsonb_typeof(blocks) = 'array'),
  constraint notes_blocks_size check (pg_column_size(blocks) <= 1048576),
  constraint notes_title_len check (char_length(title) <= 200),
  constraint notes_tags_count check (coalesce(array_length(tags, 1), 0) <= 30)
);
create index if not exists notes_owner_idx on public.notes (owner_user_id, folder_id, updated_at desc);
create index if not exists notes_book_idx on public.notes (book_record_id) where book_record_id is not null;
create index if not exists notes_search_trgm on public.notes using gin (search_text extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ attachments
create table if not exists public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  duration_seconds numeric,
  anchor_block_id text,
  created_at timestamptz not null default now(),
  constraint note_attachments_kind check (kind in ('image', 'file', 'voice')),
  constraint note_attachments_size check (byte_size > 0 and byte_size <= 26214400),
  constraint note_attachments_duration check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 1800)),
  constraint note_attachments_name check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  constraint note_attachments_path_owner check (split_part(storage_path, '/', 1) = owner_user_id::text)
);
create index if not exists note_attachments_note_idx on public.note_attachments (note_id);

-- ------------------------------------------------------------------ search text (server-maintained)
create or replace function private.note_plain_text(p_blocks jsonb)
returns text language sql immutable as $$
  select coalesce(string_agg(b->>'text', E'\n' order by ord), '')
  from jsonb_array_elements(case when jsonb_typeof(p_blocks) = 'array' then p_blocks else '[]'::jsonb end) with ordinality as t(b, ord)
$$;

create or replace function private.notes_before_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
drop trigger if exists notes_before_write on public.notes;
create trigger notes_before_write before insert or update of title, blocks, tags, folder_id, book_record_id on public.notes
  for each row execute function private.notes_before_write();

create or replace function private.note_attachments_touch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update notes set title = title where id = coalesce(new.note_id, old.note_id);
  return null;
end $$;
drop trigger if exists note_attachments_touch on public.note_attachments;
create trigger note_attachments_touch after insert or delete on public.note_attachments
  for each row execute function private.note_attachments_touch();

create or replace function private.note_attachment_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from notes n where n.id = new.note_id and n.owner_user_id = new.owner_user_id) then
    raise exception 'avora_note_not_yours';
  end if;
  return new;
end $$;
drop trigger if exists note_attachment_owner on public.note_attachments;
create trigger note_attachment_owner before insert on public.note_attachments
  for each row execute function private.note_attachment_owner();

-- The system folder may not be renamed or removed.
create or replace function private.note_folder_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
drop trigger if exists note_folder_guard on public.note_folders;
create trigger note_folder_guard before update or delete on public.note_folders
  for each row execute function private.note_folder_guard();

-- ------------------------------------------------------------------ RLS: owner only
alter table public.note_folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_attachments enable row level security;
revoke all on public.note_folders, public.notes, public.note_attachments from anon, authenticated;
grant select, insert, update, delete on public.note_folders to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, delete on public.note_attachments to authenticated;
revoke truncate on public.note_folders, public.notes, public.note_attachments from authenticated, anon, public;

drop policy if exists note_folders_own on public.note_folders;
create policy note_folders_own on public.note_folders for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()) and not is_system);
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
drop policy if exists note_attachments_own on public.note_attachments;
create policy note_attachments_own on public.note_attachments for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

-- ------------------------------------------------------------------ the reading folder, made on first use
create or replace function public.ensure_reading_folder()
returns public.note_folders language plpgsql security definer set search_path = public, pg_temp as $$
declare v note_folders%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select * into v from note_folders where owner_user_id = v_uid and system_key = 'reading';
  if found then return v; end if;
  insert into note_folders (owner_user_id, name, is_system, system_key, position)
  values (v_uid, 'Ghi chép đọc sách', true, 'reading', 100000)
  on conflict (owner_user_id, system_key) where system_key is not null do nothing
  returning * into v;
  if v.id is null then select * into v from note_folders where owner_user_id = v_uid and system_key = 'reading'; end if;
  return v;
end $$;
revoke all on function public.ensure_reading_folder() from public, anon;
grant execute on function public.ensure_reading_folder() to authenticated;

-- Deleting a folder: its notes go to "Chưa xếp" or to the bin, as the person chose.
create or replace function public.delete_note_folder(p_folder_id uuid, p_trash_notes boolean)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v note_folders%rowtype; v_n integer;
begin
  select * into v from note_folders where id = p_folder_id and owner_user_id = auth.uid() for update;
  if not found then raise exception 'avora_note_folder_missing'; end if;
  if v.is_system then raise exception 'avora_note_folder_system'; end if;
  if coalesce(p_trash_notes, false) then
    update notes set deleted_at = now(), folder_id = null where folder_id = v.id and deleted_at is null;
  else
    update notes set folder_id = null where folder_id = v.id;
  end if;
  get diagnostics v_n = row_count;
  delete from note_folders where id = v.id;
  return v_n;
end $$;
revoke all on function public.delete_note_folder(uuid, boolean) from public, anon;
grant execute on function public.delete_note_folder(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ bin: 30 days
create or replace function private.purge_note_trash()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from notes where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.purge_note_trash() from public, anon, authenticated;

create or replace function private.sweep_dead_ends()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.close_dead_suggestions();
  begin perform private.purge_journal_trash(); exception when others then raise warning 'avora_journal_purge_failed'; end;
  begin perform private.purge_note_trash(); exception when others then raise warning 'avora_note_purge_failed'; end;
end $$;
revoke all on function private.sweep_dead_ends() from public, anon, authenticated;

-- ------------------------------------------------------------------ storage: note-files, the owner's folder only
insert into storage.buckets (id, name, public, file_size_limit)
values ('note-files', 'note-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists note_files_read_own on storage.objects;
create policy note_files_read_own on storage.objects for select to authenticated
  using (bucket_id = 'note-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists note_files_write_own on storage.objects;
create policy note_files_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'note-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists note_files_delete_own on storage.objects;
create policy note_files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'note-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
