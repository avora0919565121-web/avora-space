-- AVORA-81 · PHẦN 2 (AVORA-79) · Bàn nghĩ · ghim sách · Đọc yên tĩnh · tựa sách tiếng Việt.
set search_path = '';

-- ---------------------------------------------------------------- Bàn nghĩ: mine only, at most 5
create table if not exists public.think_hub_desk (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  table_id uuid not null references public.think_hub_table(id) on delete cascade,
  placed_at timestamptz not null default now(),
  primary key (user_id, table_id)
);
create index if not exists think_hub_desk_table_idx on public.think_hub_desk (table_id);
alter table public.think_hub_desk enable row level security;
drop policy if exists think_hub_desk_own_select on public.think_hub_desk;
drop policy if exists avora_session_allowed on public.think_hub_desk;
create policy think_hub_desk_own_select on public.think_hub_desk for select to authenticated using (user_id = (select auth.uid()));
create policy avora_session_allowed on public.think_hub_desk as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.think_hub_desk from public, anon, authenticated;
grant select on public.think_hub_desk to authenticated;

create or replace function public.place_on_desk(p_table_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not private.think_hub_table_visible(p_table_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  if exists (select 1 from public.think_hub_desk where user_id = v_user and table_id = p_table_id) then
    return (select count(*) from public.think_hub_desk where user_id = v_user);
  end if;
  -- One person at a time: a second tab cannot slip a sixth one in.
  perform pg_advisory_xact_lock(hashtextextended('avora_desk:' || v_user::text, 0));
  select count(*) into v_count from public.think_hub_desk where user_id = v_user;
  if v_count >= 5 then raise exception 'avora_desk_full'; end if;
  insert into public.think_hub_desk (user_id, table_id) values (v_user, p_table_id);
  return v_count + 1;
end $$;

-- Putting down: my own private board goes back to Đang chờ; a shared board only leaves my desk.
create or replace function public.remove_from_desk(p_table_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_table public.think_hub_table;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  delete from public.think_hub_desk where user_id = v_user and table_id = p_table_id;
  select * into v_table from public.think_hub_table where id = p_table_id;
  if v_table.id is not null and v_table.owner_user_id = v_user and v_table.conversation_id is null and v_table.project_id is null
     and v_table.lifecycle = 'thinking' then
    update public.think_hub_table set lifecycle = 'waiting' where id = p_table_id;
  end if;
end $$;
revoke all on function public.place_on_desk(uuid) from public, anon;
revoke all on function public.remove_from_desk(uuid) from public, anon;
grant execute on function public.place_on_desk(uuid) to authenticated;
grant execute on function public.remove_from_desk(uuid) to authenticated;

-- ---------------------------------------------------------------- pinned books: at most 3
alter table public.book_reading_state add column if not exists pinned_at timestamptz;

create or replace function public.set_book_pin(p_record_id uuid, p_pinned boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_at timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if not exists (
    select 1 from public.think_hub_record r join public.think_hub_table t on t.id = r.table_id
    where r.id = p_record_id and r.owner_user_id = v_user and t.kind = 'bookshelf' and r.deleted_at is null) then
    raise exception 'avora_book_not_yours';
  end if;
  if not p_pinned then
    update public.book_reading_state set pinned_at = null where user_id = v_user and record_id = p_record_id;
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('avora_pin:' || v_user::text, 0));
  if (select count(*) from public.book_reading_state where user_id = v_user and pinned_at is not null and record_id <> p_record_id) >= 3 then
    raise exception 'avora_pin_full';
  end if;
  insert into public.book_reading_state (user_id, record_id, locator, percent, updated_at, pinned_at)
  values (v_user, p_record_id, 'c0:p0', 0, now() - interval '100 years', now())
  on conflict (user_id, record_id) do update set pinned_at = coalesce(public.book_reading_state.pinned_at, now())
  returning pinned_at into v_at;
  return v_at;
end $$;
revoke all on function public.set_book_pin(uuid, boolean) from public, anon;
grant execute on function public.set_book_pin(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- Đọc yên tĩnh (3 h at most)
alter table public.profiles add column if not exists quiet_reading_until timestamptz;
grant select (quiet_reading_until) on public.profiles to authenticated;

create or replace function public.set_quiet_reading(p_on boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_until timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  v_until := case when p_on then now() + interval '3 hours' else null end;
  update public.profiles set quiet_reading_until = v_until where id = v_user;
  if not p_on then
    -- Held pushes go out now — the sender's one combined notification per conversation (send-push groups them).
    update public.push_outbox set send_after = now() where user_id = v_user and status = 'pending' and send_after > now();
  end if;
  return v_until;
end $$;
revoke all on function public.set_quiet_reading(boolean) from public, anon;
grant execute on function public.set_quiet_reading(boolean) to authenticated;

-- Messages still arrive; their push waits until Đọc yên tĩnh ends (at most 3 hours).
create or replace function private.enqueue_message_push() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_surface text; v_pending boolean;
begin
  if new.system_kind is not null or new.deleted_at is not null then return null; end if;
  v_surface := private.push_surface(new.conversation_id);
  if v_surface is null then return null; end if;
  select verification_status = 'pending' into v_pending from conversations where id = new.conversation_id;
  insert into push_outbox (user_id, kind, conversation_id, message_id, send_after)
  select cp.user_id, case when coalesce(v_pending, false) then 'friend_request' else 'message' end,
         new.conversation_id, new.id,
         greatest(now() + interval '20 seconds', coalesce((select p.quiet_reading_until from profiles p where p.id = cp.user_id and p.quiet_reading_until > now()), now()))
  from conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id
    and exists (select 1 from push_subscriptions s where s.user_id = cp.user_id)
    and not private.is_blocked_between(cp.user_id, new.sender_id)
    and not private.push_mute_blocks(cp.user_id, v_surface, new.conversation_id,
          exists (select 1 from family_relations f where f.user_id = cp.user_id and f.related_user_id = new.sender_id),
          cp.user_id = any (coalesce(new.mentioned_user_ids, '{}')),
          new.is_urgent);
  return null;
exception when others then
  raise warning 'avora_push_enqueue_failed';
  return null;
end $function$;

-- ---------------------------------------------------------------- C7 · Vietnamese titles
alter table public.book_catalog add column if not exists title_vi text;
alter table public.book_catalog add column if not exists title_vi_kind text;
alter table public.book_catalog drop constraint if exists book_catalog_title_vi_kind;
alter table public.book_catalog add constraint book_catalog_title_vi_kind check (title_vi_kind is null or title_vi_kind in ('xuat_ban', 'tam_dich'));

create or replace function private.book_catalog_fold() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := private.fold_search(new.title || ' ' || coalesce(new.title_vi, '') || ' ' || coalesce(new.authors, ''));
  new.updated_at := now();
  return new;
end $$;
