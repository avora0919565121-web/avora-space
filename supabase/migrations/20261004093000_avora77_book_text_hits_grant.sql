-- AVORA-81 · PHẦN 0 · 77.13 probe found that the book-text Edge Function could neither count nor record hits:
-- this project does not grant table privileges to service_role by default, so the 30-per-hour limit never fired.
-- Only service_role touches this table (authenticated / anon stay revoked).
set search_path = '';

grant select, insert, delete on public.book_text_hits to service_role;
