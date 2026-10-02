-- AVORA-71 · E (ADR-044): a name I give someone, seen by me only. The other person never knows.
create table if not exists public.user_aliases (
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  alias          text not null,
  updated_at     timestamptz not null default now(),
  primary key (owner_user_id, target_user_id),
  constraint user_aliases_len check (char_length(btrim(alias)) between 1 and 40),
  constraint user_aliases_not_self check (owner_user_id <> target_user_id)
);
create index if not exists user_aliases_target_idx on public.user_aliases (target_user_id);

alter table public.user_aliases enable row level security;
revoke all on public.user_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.user_aliases to authenticated;

drop policy if exists user_aliases_own_select on public.user_aliases;
create policy user_aliases_own_select on public.user_aliases for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists user_aliases_own_insert on public.user_aliases;
create policy user_aliases_own_insert on public.user_aliases for insert to authenticated
  with check (owner_user_id = (select auth.uid()));
drop policy if exists user_aliases_own_update on public.user_aliases;
create policy user_aliases_own_update on public.user_aliases for update to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
drop policy if exists user_aliases_own_delete on public.user_aliases;
create policy user_aliases_own_delete on public.user_aliases for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- Never part of anyone's realtime feed.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'user_aliases') then
    alter publication supabase_realtime drop table public.user_aliases;
  end if;
end $$;
