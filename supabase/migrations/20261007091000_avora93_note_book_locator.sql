-- AVORA-93 · PHẦN 2 · 3.3 — where in the book a note was taken (chapter:block), so kệ 5 can open that passage.
set search_path = '';
alter table public.notes add column if not exists book_locator text check (book_locator is null or book_locator ~ '^[0-9]{1,5}:[0-9]{1,6}$');
