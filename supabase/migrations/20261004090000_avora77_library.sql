-- AVORA-77 (ADR-047 · ADR-048): Kế hoạch as a six-shelf library, and a bookshelf you can read in.
--   think_hub_table.thinking_type / lifecycle · think_hub_conclusions · set_board_conclusion / set_board_lifecycle /
--   set_board_thinking_type · book_catalog (+ search) · book_reading_state (+ save) · book_text_hits ·
--   Storage `public-domain-books`.
-- Lifecycle only measures how far the thinking has gone. Only the person marks it; Avora never infers it.

-- ---------------------------------------------------------------- columns on the board
alter table public.think_hub_table
  add column if not exists thinking_type text,
  add column if not exists lifecycle text not null default 'waiting';
alter table public.think_hub_table drop constraint if exists think_hub_table_thinking_type_check;
alter table public.think_hub_table add constraint think_hub_table_thinking_type_check
  check (thinking_type is null or thinking_type in ('track', 'progress', 'breakdown', 'weigh', 'learn'));
alter table public.think_hub_table drop constraint if exists think_hub_table_lifecycle_check;
alter table public.think_hub_table add constraint think_hub_table_lifecycle_check
  check (lifecycle in ('waiting', 'thinking', 'concluded', 'archived'));
-- The table is read column by column (AVORA-62); new columns must be granted or `select *` fails.
grant select (thinking_type, lifecycle) on public.think_hub_table to authenticated;
revoke all (thinking_type, lifecycle) on public.think_hub_table from anon;

-- Backfill without touching updated_at ("sửa X ngày trước" must stay true).
alter table public.think_hub_table disable trigger trg_think_hub_table_touch_updated_at;
update public.think_hub_table t set thinking_type = tpl.thinking_type
  from public.think_hub_template tpl
  where tpl.key = t.source_template_key and t.thinking_type is null and tpl.thinking_type is not null;
update public.think_hub_table set lifecycle = 'archived' where archived_at is not null and lifecycle <> 'archived';
alter table public.think_hub_table enable trigger trg_think_hub_table_touch_updated_at;

-- One source for "archived": archived_at. lifecycle follows it, never the other way round.
create or replace function private.think_hub_table_lifecycle_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function private.think_hub_table_lifecycle_sync() from public, anon, authenticated;
drop trigger if exists trg_think_hub_table_lifecycle_sync on public.think_hub_table;
create trigger trg_think_hub_table_lifecycle_sync before insert or update on public.think_hub_table
  for each row execute function private.think_hub_table_lifecycle_sync();

-- ---------------------------------------------------------------- who may edit the board's head
/** Visible, live, not archived, not a system board, editable (`Cùng sửa` or owner), project still open. */
create or replace function private.can_edit_board_head(p_table uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null
    and private.think_hub_table_visible(p_table, p_user)
    and exists (
      select 1 from public.think_hub_table t
      where t.id = p_table and t.deleted_at is null and t.sync_source is null
        and t.kind is distinct from 'bookshelf'
        and (t.share_mode = 'edit' or t.owner_user_id = p_user)
        and (t.project_id is null or private.project_is_open(t.project_id)))
    and not private.think_hub_table_archived(p_table)
$$;
revoke all on function private.can_edit_board_head(uuid, uuid) from public, anon;
grant execute on function private.can_edit_board_head(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the change log learns "the board's head changed"
alter table public.think_hub_change_log drop constraint if exists think_hub_change_log_kind_check;
alter table public.think_hub_change_log add constraint think_hub_change_log_kind_check
  check (kind in ('record_add', 'record_edit', 'record_delete', 'column_add', 'column_edit', 'column_delete', 'board_edit'));

create or replace function private.board_change_summary(p_ids uuid[])
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'added', count(*) filter (where kind = 'record_add'),
    'cells', coalesce(sum(cells) filter (where kind = 'record_edit'), 0),
    'deleted', count(*) filter (where kind = 'record_delete'),
    'columns', count(*) filter (where kind like 'column_%'),
    'board', count(*) filter (where kind = 'board_edit'),
    'total', count(*) filter (where kind <> 'record_edit') + coalesce(sum(cells) filter (where kind = 'record_edit'), 0))
  from think_hub_change_log where id = any (p_ids)
$function$;
revoke all on function private.board_change_summary(uuid[]) from public, anon;

create or replace function private.board_summary_words(p jsonb)
 returns text language sql immutable set search_path to 'pg_temp'
as $function$
  select coalesce(nullif(array_to_string(array_remove(array[
    case when (p->>'added')::int > 0 then format('Thêm %s Hạng mục', p->>'added') end,
    case when (p->>'cells')::int > 0 then format('Sửa %s ô', p->>'cells') end,
    case when (p->>'deleted')::int > 0 then format('Xoá %s Hạng mục', p->>'deleted') end,
    case when (p->>'columns')::int > 0 then format('Đổi %s cột', p->>'columns') end,
    case when coalesce((p->>'board')::int, 0) > 0 then 'Cập nhật kết luận / trạng thái' end
  ], null), ' · '), ''), 'Không có thay đổi mới')
$function$;
revoke all on function private.board_summary_words(jsonb) from public, anon;

-- ---------------------------------------------------------------- conclusions (append-only)
create table if not exists public.think_hub_conclusions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists think_hub_conclusions_table_idx on public.think_hub_conclusions (table_id, created_at desc);
alter table public.think_hub_conclusions enable row level security;
drop policy if exists think_hub_conclusions_select on public.think_hub_conclusions;
create policy think_hub_conclusions_select on public.think_hub_conclusions for select to authenticated
  using (private.think_hub_table_visible(table_id, (select auth.uid())));
drop policy if exists avora_session_allowed on public.think_hub_conclusions;
create policy avora_session_allowed on public.think_hub_conclusions as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.think_hub_conclusions from public, anon, authenticated;
grant select on public.think_hub_conclusions to authenticated;

create or replace function public.set_board_conclusion(p_table_id uuid, p_body text)
returns public.think_hub_conclusions
language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.set_board_conclusion(uuid, text) from public, anon;
grant execute on function public.set_board_conclusion(uuid, text) to authenticated;

create or replace function public.set_board_lifecycle(p_table_id uuid, p_lifecycle text)
returns text
language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.set_board_lifecycle(uuid, text) from public, anon;
grant execute on function public.set_board_lifecycle(uuid, text) to authenticated;

create or replace function public.set_board_thinking_type(p_table_id uuid, p_type text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_type is not null and p_type not in ('track', 'progress', 'breakdown', 'weigh', 'learn') then raise exception 'avora_thinking_type_value'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if not private.can_edit_board_head(p_table_id, v_user) then raise exception 'avora_think_hub_view_only'; end if;
  update public.think_hub_table set thinking_type = p_type where id = p_table_id;
  return p_type;
end $$;
revoke all on function public.set_board_thinking_type(uuid, text) from public, anon;
grant execute on function public.set_board_thinking_type(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the open library's catalogue
create or replace function private.fold_search(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(translate(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')), 'đĐ', 'dD'), '\s+', ' ', 'g'))
$$;
revoke all on function private.fold_search(text) from public, anon;
grant execute on function private.fold_search(text) to authenticated, service_role;

create table if not exists public.book_catalog (
  source text not null check (source in ('gutenberg', 'wikisource')),
  source_id text not null check (char_length(source_id) between 1 and 300),
  title text not null,
  authors text,
  language text not null check (language in ('en', 'vi', 'fr')),
  category text not null default 'khac' check (category in ('van_hoc', 'triet_hoc', 'kinh_thanh', 'lich_su', 'khoa_hoc', 'kinh_te', 'tho', 'thieu_nhi', 'khac')),
  epub_url text,
  search_text text not null default '',
  updated_at timestamptz not null default now(),
  primary key (source, source_id)
);
create or replace function private.book_catalog_fold() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := private.fold_search(new.title || ' ' || coalesce(new.authors, ''));
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.book_catalog_fold() from public, anon, authenticated;
drop trigger if exists trg_book_catalog_fold on public.book_catalog;
create trigger trg_book_catalog_fold before insert or update on public.book_catalog for each row execute function private.book_catalog_fold();
create index if not exists book_catalog_search_trgm on public.book_catalog using gin (search_text extensions.gin_trgm_ops);
create index if not exists book_catalog_category_idx on public.book_catalog (category, language);
alter table public.book_catalog enable row level security;
drop policy if exists book_catalog_read on public.book_catalog;
create policy book_catalog_read on public.book_catalog for select to authenticated using (true);
drop policy if exists avora_session_allowed on public.book_catalog;
create policy avora_session_allowed on public.book_catalog as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.book_catalog from public, anon, authenticated;
grant select on public.book_catalog to authenticated;

/** Accent-free search over title + author, optionally one Avora category / language. */
create or replace function public.search_book_catalog(p_query text, p_category text default null, p_source text default null, p_limit int default 30)
returns setof public.book_catalog
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := btrim(private.fold_search(p_query));
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  return query
    select c.* from public.book_catalog c
    where (v_q = '' or c.search_text like '%' || v_q || '%')
      and (p_category is null or c.category = p_category)
      and (p_source is null or c.source = p_source)
    -- Wikisource first (Vietnamese), then titles that start with the words, then Gutenberg's early
    -- numbers (its long-standing classics) before later ones.
    order by (c.source = 'wikisource') desc,
             case when v_q <> '' and private.fold_search(c.title) like v_q || '%' then 0 else 1 end,
             case when c.source = 'gutenberg' then c.source_id::int else 0 end,
             c.title
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end $$;
revoke all on function public.search_book_catalog(text, text, text, int) from public, anon;
grant execute on function public.search_book_catalog(text, text, text, int) to authenticated;

-- ---------------------------------------------------------------- where each person is in each book
create table if not exists public.book_reading_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.think_hub_record(id) on delete cascade,
  locator text not null check (char_length(locator) <= 200),
  percent numeric(5,2) not null check (percent between 0 and 100),
  device_label text check (device_label is null or char_length(device_label) <= 60),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
alter table public.book_reading_state enable row level security;
drop policy if exists book_reading_state_own on public.book_reading_state;
create policy book_reading_state_own on public.book_reading_state for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists avora_session_allowed on public.book_reading_state;
create policy avora_session_allowed on public.book_reading_state as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.book_reading_state from public, anon, authenticated;
grant select on public.book_reading_state to authenticated;

/** Saves a place in a book of my own shelf. A position recorded offline earlier never overwrites a newer one. */
create or replace function public.save_reading_state(p_record_id uuid, p_locator text, p_percent numeric, p_device_label text, p_at timestamptz default null)
returns public.book_reading_state
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_at timestamptz := least(coalesce(p_at, now()), now()); v_row public.book_reading_state;
begin
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
end $$;
revoke all on function public.save_reading_state(uuid, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.save_reading_state(uuid, text, numeric, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------- book-text: 30 calls per person per hour
create table if not exists public.book_text_hits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists book_text_hits_user_idx on public.book_text_hits (user_id, at desc);
alter table public.book_text_hits enable row level security;
drop policy if exists avora_session_allowed on public.book_text_hits;
create policy avora_session_allowed on public.book_text_hits as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.book_text_hits from public, anon, authenticated;

-- ---------------------------------------------------------------- Storage: cleaned public-domain books only
insert into storage.buckets (id, name, public) values ('public-domain-books', 'public-domain-books', false)
on conflict (id) do nothing;
drop policy if exists public_domain_books_read on storage.objects;
create policy public_domain_books_read on storage.objects for select to authenticated
  using (bucket_id = 'public-domain-books');
-- No insert / update / delete policy: only the Edge Function (service role) writes here.
