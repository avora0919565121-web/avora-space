-- AVORA-103 · KHỐI 3A — Nguồn sách chính trực · Open Library (chỉ sách công cộng) · Bìa sách · Bìa của tôi.
-- • book_catalog: nguồn `openlibrary`; cột author_died, ia_id, ia_file, pd_status, access, cover_path, cover_checked_at.
--   pd_status = 'ok' chỉ khi mọi tác giả / dịch giả mất > 70 năm (VN + EU). Không rõ → 'unknown' (chờ VMT soát).
--   access = 'borrow': Open Library còn bản quyền — chỉ có link, không đọc, không tải.
-- • search_book_catalog chỉ trả sách 'ok' và sách 'borrow' (để mở link).
-- • bucket book-covers (công khai, chỉ WebP bìa sách công cộng, chỉ Edge ghi) · bucket my-book-covers (riêng từng người).
-- • book_my_covers + set_my_book_cover / clear_my_book_cover: bìa tự chụp, chỉ chủ thấy.
-- • book_fetch_slot(): mọi lần gọi nguồn ngoài cách nhau ≥ 1 giây (cả khi nhiều Edge chạy cùng lúc).
-- • cron avora_book_covers: tải bìa bù, chậm (mỗi phút một lượt nhỏ).

-- ------------------------------------------------------------ catalogue columns
alter table public.book_catalog drop constraint if exists book_catalog_source_check;
alter table public.book_catalog add constraint book_catalog_source_check check (source in ('gutenberg', 'wikisource', 'openlibrary'));
alter table public.book_catalog add column if not exists author_died int;
alter table public.book_catalog add column if not exists ia_id text;
alter table public.book_catalog add column if not exists ia_file text;
alter table public.book_catalog add column if not exists pd_status text not null default 'unknown';
alter table public.book_catalog add column if not exists access text not null default 'read';
alter table public.book_catalog add column if not exists cover_path text;
alter table public.book_catalog add column if not exists cover_checked_at timestamptz;
alter table public.book_catalog drop constraint if exists book_catalog_pd_status;
alter table public.book_catalog add constraint book_catalog_pd_status check (pd_status in ('ok', 'recent', 'unknown'));
alter table public.book_catalog drop constraint if exists book_catalog_access;
alter table public.book_catalog add constraint book_catalog_access check (access in ('read', 'borrow'));
alter table public.book_catalog drop constraint if exists book_catalog_openlibrary_shape;
alter table public.book_catalog add constraint book_catalog_openlibrary_shape check (
  source <> 'openlibrary' or (
    source_id ~ '^OL[0-9]{1,10}M$'
    and (access = 'borrow' or (ia_id ~ '^[A-Za-z0-9._-]{1,100}$' and ia_file ~ '^[A-Za-z0-9._-]{1,140}_djvu\.txt$'))
  )
);
alter table public.book_catalog drop constraint if exists book_catalog_cover_path;
alter table public.book_catalog add constraint book_catalog_cover_path check (cover_path is null or cover_path ~ '^(gutenberg|openlibrary)/[A-Za-z0-9]{1,20}\.webp$');
create index if not exists book_catalog_cover_todo on public.book_catalog (source, source_id) where cover_checked_at is null and pd_status = 'ok' and source <> 'wikisource';

-- Wikisource: the eight pages checked one by one (death years for the record).
update public.book_catalog set pd_status = 'ok', author_died = d.died
from (values
  ('Bình Ngô đại cáo', 1442), ('Chinh phụ ngâm', 1748), ('Cung oán ngâm khúc (bản phổ biến)', 1798), ('Gia huấn ca', 1442),
  ('Lục Vân Tiên (bản Quốc ngữ 2082 câu)', 1888), ('Nam quốc sơn hà', 1105), ('Truyện Kiều', 1820),
  -- 1925 translation published by the British and Foreign Bible Society team (a collective work):
  -- protected 75 years from publication in Viet Nam, 70 in the EU → public since 2000. Listed for VMT review.
  ('Kinh Thánh Cựu Ước và Tân Ước 1925', null)
) as d(id, died)
where source = 'wikisource' and source_id = d.id;

-- ------------------------------------------------------------ search: only what may be read (and borrow links)
create or replace function public.search_book_catalog(p_query text, p_category text default null, p_source text default null, p_limit int default 30)
returns setof public.book_catalog
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := btrim(private.fold_search(p_query));
begin
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
end $$;
revoke all on function public.search_book_catalog(text, text, text, int) from public, anon;
grant execute on function public.search_book_catalog(text, text, text, int) to authenticated;

/** Covers, rights and titles of the books on a shelf, by reference — one call for a whole shelf. */
drop function if exists public.book_catalog_covers(text[]);
create or replace function public.book_catalog_covers(p_refs text[])
returns table (source text, source_id text, title text, title_vi text, language text, cover_path text, cover_checked boolean, pd_status text, access text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  if coalesce(array_length(p_refs, 1), 0) > 200 then raise exception 'avora_too_many'; end if;
  return query
    select c.source, c.source_id, c.title, c.title_vi, c.language, c.cover_path, c.cover_checked_at is not null, c.pd_status, c.access
    from public.book_catalog c
    where (c.source, c.source_id) in (select split_part(r, ':', 1), substr(r, strpos(r, ':') + 1) from unnest(coalesce(p_refs, '{}'::text[])) r);
end $$;
revoke all on function public.book_catalog_covers(text[]) from public, anon;
grant execute on function public.book_catalog_covers(text[]) to authenticated;

-- ------------------------------------------------------------ ≥ 1 second between calls to an outside source
create table if not exists private.book_fetch_clock (id int primary key check (id = 1), next_at timestamptz not null);
insert into private.book_fetch_clock (id, next_at) values (1, now()) on conflict (id) do nothing;
revoke all on private.book_fetch_clock from public, anon, authenticated;

/** Reserves the next outside-call slot: returns how many ms the caller waits before calling. */
create or replace function public.book_fetch_slot()
returns int language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  update private.book_fetch_clock set next_at = greatest(next_at, clock_timestamp()) + interval '1 second'
  where id = 1 returning next_at - interval '1 second' into v_at;
  return greatest(0, ceil(extract(epoch from (v_at - clock_timestamp())) * 1000))::int;
end $$;
revoke all on function public.book_fetch_slot() from public, anon, authenticated;
grant execute on function public.book_fetch_slot() to service_role;

-- book-text and book-cover share the per-person hourly budget table; a kind tells them apart.
alter table public.book_text_hits add column if not exists kind text not null default 'text';
alter table public.book_text_hits drop constraint if exists book_text_hits_kind;
alter table public.book_text_hits add constraint book_text_hits_kind check (kind in ('text', 'cover'));

-- ------------------------------------------------------------ bucket: public-domain covers (public read, Edge writes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-covers', 'book-covers', true, 204800, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 204800, allowed_mime_types = array['image/webp'];
-- No storage.objects policy: nobody lists or writes it through the API; the public URL serves single files.

-- ------------------------------------------------------------ my own cover photo (only I see it)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('my-book-covers', 'my-book-covers', false, 512000, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 512000, allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists my_book_covers_read on storage.objects;
create policy my_book_covers_read on storage.objects for select to authenticated
  using (bucket_id = 'my-book-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists my_book_covers_write on storage.objects;
create policy my_book_covers_write on storage.objects for insert to authenticated
  with check (bucket_id = 'my-book-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists my_book_covers_delete on storage.objects;
create policy my_book_covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'my-book-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.book_my_covers (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.think_hub_record(id) on delete cascade,
  path text not null check (char_length(path) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
create index if not exists book_my_covers_record_idx on public.book_my_covers (record_id);
alter table public.book_my_covers enable row level security;
drop policy if exists book_my_covers_own on public.book_my_covers;
create policy book_my_covers_own on public.book_my_covers for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists avora_session_allowed on public.book_my_covers;
create policy avora_session_allowed on public.book_my_covers as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.book_my_covers from public, anon, authenticated;
grant select on public.book_my_covers to authenticated;

/** Keeps my photo as the cover of a book on a board I can see. The file must already be in my folder. */
create or replace function public.set_my_book_cover(p_record uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.set_my_book_cover(uuid, text) from public, anon;
grant execute on function public.set_my_book_cover(uuid, text) to authenticated;

/** Back to the ordinary cover. Returns the old file name so the app can delete it. */
create or replace function public.clear_my_book_cover(p_record uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_path text;
begin
  perform private.assert_session_allowed();
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.book_my_covers where user_id = v_uid and record_id = p_record returning path into v_path;
  return v_path;
end $$;
revoke all on function public.clear_my_book_cover(uuid) from public, anon;
grant execute on function public.clear_my_book_cover(uuid) to authenticated;

-- ------------------------------------------------------------ slow cover backfill: one small round a minute
create or replace function private.call_book_covers()
returns void language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function private.call_book_covers() from public, anon, authenticated;

select cron.unschedule('avora_book_covers') where exists (select 1 from cron.job where jobname = 'avora_book_covers');
select cron.schedule('avora_book_covers', '* * * * *', 'select private.call_book_covers()');

-- book-cover (service role) reads the catalogue; it writes the two cover columns only through set_book_cover().
grant select on public.book_catalog to service_role;

/** Records the outcome of fetching one cover (path, or null = none / blank). Service role only. */
create or replace function public.set_book_cover(p_source text, p_source_id text, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_path is not null and p_path <> p_source || '/' || p_source_id || '.webp' then raise exception 'avora_bad_path'; end if;
  update public.book_catalog set cover_path = p_path, cover_checked_at = now() where source = p_source and source_id = p_source_id;
end $$;
revoke all on function public.set_book_cover(text, text, text) from public, anon, authenticated;
grant execute on function public.set_book_cover(text, text, text) to service_role;
