-- AVORA-89 · 1.5 — when *I* last opened a Bảng (not when anyone last edited it). Mine only.
set search_path = '';

create table if not exists public.think_hub_board_opened (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- a think_hub_table id (uuid text) or a view-board key (`assigned`, `cashflow`…)
  board_key text not null check (char_length(board_key) between 1 and 64),
  opened_at timestamptz not null default now(),
  primary key (user_id, board_key)
);
alter table public.think_hub_board_opened enable row level security;
drop policy if exists think_hub_board_opened_own_select on public.think_hub_board_opened;
drop policy if exists avora_session_allowed on public.think_hub_board_opened;
create policy think_hub_board_opened_own_select on public.think_hub_board_opened for select to authenticated using (user_id = (select auth.uid()));
create policy avora_session_allowed on public.think_hub_board_opened as restrictive for all to public
  using ((select private.session_allowed())) with check ((select private.session_allowed()));
revoke all on public.think_hub_board_opened from public, anon, authenticated;
grant select on public.think_hub_board_opened to authenticated;

-- At most one write per board per 10 minutes; a board I cannot see is refused.
create or replace function public.mark_board_opened(p_board_key text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid; v_at timestamptz;
begin
  perform private.assert_session_allowed();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  if p_board_key is null or char_length(p_board_key) not between 1 and 64 then raise exception 'avora_bad_board'; end if;
  if p_board_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := p_board_key::uuid;
    if not private.think_hub_table_visible(v_id, v_user) then raise exception 'avora_think_hub_table_not_yours'; end if;
  elsif p_board_key not in ('opportunities','decisions','memorable_days','my_projects','assigned_by_me','cashflow','summary','loans','payment_calendar','expiring_docs','assets') then
    raise exception 'avora_bad_board';
  end if;
  insert into public.think_hub_board_opened as o (user_id, board_key, opened_at)
  values (v_user, p_board_key, now())
  on conflict (user_id, board_key) do update set opened_at = excluded.opened_at
    where o.opened_at < now() - interval '10 minutes'
  returning opened_at into v_at;
  if v_at is null then select opened_at into v_at from public.think_hub_board_opened where user_id = v_user and board_key = p_board_key; end if;
  return v_at;
end $$;
revoke all on function public.mark_board_opened(text) from public, anon;
grant execute on function public.mark_board_opened(text) to authenticated;
