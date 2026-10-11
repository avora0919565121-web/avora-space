-- AVORA-100 · S.2 §4.4 C (KHỐI 3B) — Sách tranh tiếng Việt giấy phép mở.
--
-- Terms read 11/10/2026:
-- • Global Digital Library (content.digitallibrary.io): an official content API "to support reuse of
--   content from the GDL on other platforms", no credentials, every item marked with its Creative
--   Commons licence, and an official EPUB per book (`/wp-json/epub-generator/v1/book/{id}`).
--   → imported: only `CC-BY-4.0` / `CC-BY-SA-4.0` Vietnamese books (NC licences left out).
-- • StoryWeaver: CC BY 4.0, but its download needs a signed-in account (no open download API) —
--   stopped there; StoryWeaver books that GDL republishes under CC BY come through GDL, credited
--   to their original publisher.
--
-- source = 'gdl', source_id = GDL post id (link `https://content.digitallibrary.io/?p={id}`);
-- `credits` keeps everything the attribution needs: author · illustrator · translator · publisher ·
-- source · licence + link (shown on the first page and the book's page), and the EPUB id.

alter table public.book_catalog drop constraint if exists book_catalog_source_check;
alter table public.book_catalog add constraint book_catalog_source_check check (source in ('gutenberg', 'wikisource', 'openlibrary', 'gdl', 'storyweaver'));
alter table public.book_catalog drop constraint if exists book_catalog_cover_path;
alter table public.book_catalog add constraint book_catalog_cover_path check (cover_path is null or cover_path ~ '^(gutenberg|openlibrary|gdl)/[A-Za-z0-9]{1,20}\.webp$');

alter table public.book_catalog add column if not exists credits jsonb null;
alter table public.book_catalog drop constraint if exists book_catalog_open_licence;
alter table public.book_catalog add constraint book_catalog_open_licence check (
  source not in ('gdl', 'storyweaver') or (
    credits ->> 'license' in ('CC-BY-4.0', 'CC-BY-SA-4.0')
    and jsonb_typeof(credits -> 'epub_id') = 'string'
    and source_id ~ '^[0-9]{1,9}$'
  )
);

-- Pictures of open-licence picture books, copied once from the EPUB (the browser never asks GDL).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('picture-books', 'picture-books', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;
