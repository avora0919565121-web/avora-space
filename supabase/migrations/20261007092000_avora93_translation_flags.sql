-- AVORA-93 · PHẦN 3 · 0 (ADR-060) — switches only VMT flips (service role / migration), read by any signed-in app.
-- translation_paid_enabled: false — Avora pays for no translation. chapter_mt_engines: [] — no whole-chapter machine
-- translation until VMT approves an engine's quality ('chrome_translator' | 'bergamot').
set search_path = '';

create table if not exists public.app_config (
  key text primary key check (key ~ '^[a-z_]{3,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
drop policy if exists avora_session_allowed on public.app_config;
create policy app_config_read on public.app_config for select to authenticated using (true);
create policy avora_session_allowed on public.app_config as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.app_config from public, anon, authenticated;
grant select on public.app_config to authenticated;

insert into public.app_config (key, value) values
  ('translation_paid_enabled', 'false'::jsonb),
  ('chapter_mt_engines', '[]'::jsonb)
on conflict (key) do nothing;

-- Same work in two languages (2.4b): a Gutenberg original ↔ a public-domain Vietnamese translation on Wikisource.
create table if not exists public.book_edition_link (
  source text not null check (source in ('gutenberg', 'wikisource')),
  source_id text not null check (char_length(source_id) between 1 and 300),
  work_key text not null check (char_length(work_key) between 1 and 80),
  language text not null check (char_length(language) between 2 and 8),
  translator text,
  translator_died integer check (translator_died is null or translator_died < 1976),
  chapter_map jsonb,
  primary key (source, source_id)
);
create index if not exists book_edition_link_work on public.book_edition_link (work_key);
alter table public.book_edition_link enable row level security;
drop policy if exists book_edition_link_read on public.book_edition_link;
drop policy if exists avora_session_allowed on public.book_edition_link;
create policy book_edition_link_read on public.book_edition_link for select to authenticated using (true);
create policy avora_session_allowed on public.book_edition_link as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.book_edition_link from public, anon, authenticated;
grant select on public.book_edition_link to authenticated;
