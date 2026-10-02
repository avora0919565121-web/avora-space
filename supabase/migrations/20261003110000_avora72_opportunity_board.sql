-- AVORA-72 (ADR-045): `Danh bạ | Danh sách cơ hội` — the first synced board.
-- Three layers, one owner each, nothing copied back and forth:
--   contact (read live) · crm_opportunity (title, stage, value, next step) · think_hub_record (own columns, sub-tables, ★, tasks).
-- One board per account, always there. Every opportunity ↔ exactly one Hạng mục.

alter table public.crm_opportunity
  add column if not exists next_action_date date,
  add column if not exists next_action_note text check (next_action_note is null or char_length(next_action_note) <= 200),
  add column if not exists last_contact_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists contact_snapshot jsonb;
create index if not exists crm_opportunity_conversation_idx on public.crm_opportunity (conversation_id) where conversation_id is not null;

-- Deleting a contact no longer wipes its opportunities: they go to the trash first (Luật 6).
alter table public.crm_opportunity alter column contact_id drop not null;
alter table public.crm_opportunity drop constraint if exists crm_opportunity_contact_id_fkey;
alter table public.crm_opportunity add constraint crm_opportunity_contact_id_fkey foreign key (contact_id) references public.contact(id) on delete set null;

alter table public.think_hub_table
  add column if not exists sync_source text check (sync_source is null or sync_source = 'contact_opportunities'),
  add column if not exists hidden_in_list boolean not null default false,
  add column if not exists sync_hidden text[] not null default '{}';
create unique index if not exists think_hub_table_one_sync_board on public.think_hub_table (owner_user_id) where sync_source = 'contact_opportunities';

alter table public.think_hub_record add column if not exists opportunity_id uuid references public.crm_opportunity(id) on delete set null;
create unique index if not exists think_hub_record_opportunity_uniq on public.think_hub_record (opportunity_id) where opportunity_id is not null;

create or replace function private.opportunity_board_purpose() returns text
language sql immutable set search_path = '' as $$ select 'Ai đang là cơ hội, đang ở giai đoạn nào, bước tiếp theo là gì?'::text $$;

/** The board of one account, created when missing. */
create or replace function private.ensure_opportunity_board(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.think_hub_table where owner_user_id = p_user and sync_source = 'contact_opportunities' and deleted_at is null;
  if v_id is not null then return v_id; end if;
  perform set_config('avora.sync_board', 'on', true);
  insert into public.think_hub_table (owner_user_id, name, purpose, column_defs, status_options, title_label, default_view, sync_source, position)
  values (p_user, 'Danh bạ | Danh sách cơ hội', private.opportunity_board_purpose(), '[]'::jsonb,
    '[{"key":"lead","label":"Mới ghi nhận"},{"key":"tiem_nang","label":"Tiềm năng"},{"key":"dang_cham_soc","label":"Đang chăm sóc"},{"key":"doi_tac","label":"Đối tác","done":true},{"key":"khong_thanh","label":"Không thành"}]'::jsonb,
    'Tiêu đề', 'table', 'contact_opportunities', -1)
  returning id into v_id;
  perform set_config('avora.sync_board', 'off', true);
  return v_id;
end $$;
revoke execute on function private.ensure_opportunity_board(uuid) from public;

create or replace function public.opportunity_board() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  return private.ensure_opportunity_board(auth.uid());
end $$;

-- The board is not deleted, archived, moved, renamed or re-purposed — on the server, not only in the UI (Luật 2).
create or replace function private.guard_sync_board() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.sync_source is not null and auth.uid() is not null then raise exception 'avora_sync_board_locked'; end if;
    return old;
  end if;
  if old.sync_source is null or coalesce(current_setting('avora.sync_board', true), '') = 'on' then return new; end if;
  if new.name is distinct from old.name or new.purpose is distinct from old.purpose or new.deleted_at is distinct from old.deleted_at
     or new.archived_at is distinct from old.archived_at or new.conversation_id is distinct from old.conversation_id
     or new.sync_source is distinct from old.sync_source or new.status_options is distinct from old.status_options then
    raise exception 'avora_sync_board_locked';
  end if;
  return new;
end $$;
revoke execute on function private.guard_sync_board() from public;
drop trigger if exists trg_think_hub_table_sync_guard on public.think_hub_table;
create trigger trg_think_hub_table_sync_guard before update or delete on public.think_hub_table for each row execute function private.guard_sync_board();

-- Opportunity → Hạng mục (create · rename · stage · remove · restore).
create or replace function private.opportunity_to_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_board uuid;
begin
  if coalesce(current_setting('avora.opp_sync', true), '') = 'on' then return new; end if;
  perform set_config('avora.opp_sync', 'on', true);
  if tg_op = 'INSERT' then
    v_board := private.ensure_opportunity_board(new.owner_user_id);
    insert into public.think_hub_record (table_id, owner_user_id, title, status, opportunity_id)
    values (v_board, new.owner_user_id, new.title, new.stage, new.id);
  else
    update public.think_hub_record set
      title = new.title, status = new.stage,
      deleted_at = case when new.removed_at is not null and old.removed_at is null then now()
                        when new.removed_at is null and old.removed_at is not null then null else deleted_at end
    where opportunity_id = new.id;
  end if;
  perform set_config('avora.opp_sync', 'off', true);
  return new;
end $$;
revoke execute on function private.opportunity_to_record() from public;
drop trigger if exists trg_crm_opportunity_to_record on public.crm_opportunity;
create trigger trg_crm_opportunity_to_record after insert or update of title, stage, removed_at on public.crm_opportunity for each row execute function private.opportunity_to_record();

-- Hạng mục → opportunity: editing the title / stage on the board edits the opportunity; deleting the row = `Bỏ cơ hội`.
create or replace function private.record_to_opportunity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opportunity_id is null or coalesce(current_setting('avora.opp_sync', true), '') = 'on' then return new; end if;
  if new.title is distinct from old.title or new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
    if new.status not in ('lead', 'tiem_nang', 'dang_cham_soc', 'doi_tac', 'khong_thanh') then raise exception 'avora_opportunity_stage'; end if;
    if old.deleted_at is not null and new.deleted_at is null
       and (select contact_id from public.crm_opportunity where id = new.opportunity_id) is null then
      raise exception 'avora_opportunity_contact_gone';
    end if;
    perform set_config('avora.opp_sync', 'on', true);
    update public.crm_opportunity set title = new.title, stage = new.status,
      removed_at = case when new.deleted_at is not null then coalesce(removed_at, now()) else null end
    where id = new.opportunity_id;
    perform set_config('avora.opp_sync', 'off', true);
  end if;
  return new;
end $$;
revoke execute on function private.record_to_opportunity() from public;
drop trigger if exists trg_think_hub_record_to_opportunity on public.think_hub_record;
create trigger trg_think_hub_record_to_opportunity before update on public.think_hub_record for each row execute function private.record_to_opportunity();

-- A synced Hạng mục is never hard-deleted by a person (only `Bỏ cơ hội`), and never added by hand.
create or replace function private.guard_opportunity_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.opportunity_id is not null and auth.uid() is not null then raise exception 'avora_opportunity_row_locked'; end if;
    return old;
  end if;
  if coalesce(current_setting('avora.opp_sync', true), '') <> 'on'
     and exists (select 1 from public.think_hub_table where id = new.table_id and sync_source is not null) then
    raise exception 'avora_opportunity_use_new';
  end if;
  return new;
end $$;
revoke execute on function private.guard_opportunity_record() from public;
drop trigger if exists trg_think_hub_record_opportunity_guard on public.think_hub_record;
create trigger trg_think_hub_record_opportunity_guard before insert or delete on public.think_hub_record for each row execute function private.guard_opportunity_record();

-- Deleting a contact: its opportunities go to the trash first, with the name kept for the trash row.
create or replace function private.contact_removed_opportunities() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crm_opportunity set removed_at = coalesce(removed_at, now()),
    contact_snapshot = jsonb_build_object('name', old.name)
  where contact_id = old.id;
  return old;
end $$;
revoke execute on function private.contact_removed_opportunities() from public;
drop trigger if exists trg_contact_removed_opportunities on public.contact;
create trigger trg_contact_removed_opportunities before delete on public.contact for each row execute function private.contact_removed_opportunities();

-- An opportunity keeps its contact while it lives (unchanged rule); after the contact is gone it may only stay removed.
create or replace function private.validate_crm_opportunity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if new.contact_id is null then
    if tg_op = 'UPDATE' and new.removed_at is not null then return new; end if;
    raise exception 'Không tìm thấy liên hệ này';
  end if;
  select owner_user_id into v_owner from public.contact where id = new.contact_id;
  if v_owner is null then raise exception 'Không tìm thấy liên hệ này'; end if;
  if v_owner <> new.owner_user_id then raise exception 'Cơ hội phải gắn với liên hệ của chính bạn'; end if;
  if btrim(coalesce(new.title, '')) = '' then raise exception 'Cơ hội cần một tiêu đề'; end if;
  return new;
end $$;

-- `Liên lạc gần nhất`: the owner's own message in the linked conversation.
create or replace function private.touch_opportunity_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crm_opportunity set last_contact_at = new.created_at
  where conversation_id = new.conversation_id and owner_user_id = new.sender_id and removed_at is null
    and (last_contact_at is null or last_contact_at < new.created_at);
  return new;
end $$;
revoke execute on function private.touch_opportunity_contact() from public;
drop trigger if exists messages_touch_opportunity on public.messages;
create trigger messages_touch_opportunity after insert on public.messages for each row execute function private.touch_opportunity_contact();

/** `Ẩn khỏi danh sách` and the synced columns the owner folded away — the only things a person changes on the board itself. */
create or replace function public.set_opportunity_board_view(p_hidden_in_list boolean, p_sync_hidden text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session_allowed();
  if auth.uid() is null then raise exception 'avora_not_signed_in'; end if;
  update public.think_hub_table set hidden_in_list = coalesce(p_hidden_in_list, hidden_in_list),
    sync_hidden = coalesce((select array_agg(distinct c) from unnest(p_sync_hidden) c
      where c in ('phone','email','company','type','representative','industry','address','tax_code','relationship','contact_note','value','next','last_contact','place','tasks','contact')), sync_hidden)
  where owner_user_id = auth.uid() and sync_source = 'contact_opportunities';
end $$;

do $$ declare f text; begin
  foreach f in array array['public.opportunity_board()', 'public.set_opportunity_board_view(boolean, text[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- New accounts get the board at sign-up.
do $$ declare v_src text; begin
  select prosrc into v_src from pg_proc where oid = 'public.handle_new_user()'::regprocedure;
  if v_src not like '%ensure_opportunity_board%' then
    execute replace(pg_get_functiondef('public.handle_new_user()'::regprocedure), v_src,
      replace(v_src, 'perform public.ensure_personal_journal(new.id);', E'perform public.ensure_personal_journal(new.id);\n  perform private.ensure_opportunity_board(new.id);'));
  end if;
end $$;

-- Backfill: a board for every account; every opportunity becomes a Hạng mục.
do $$ declare r record; v_board uuid; begin
  for r in select id from auth.users loop perform private.ensure_opportunity_board(r.id); end loop;
  perform set_config('avora.opp_sync', 'on', true);
  for r in select o.* from public.crm_opportunity o where not exists (select 1 from public.think_hub_record h where h.opportunity_id = o.id) loop
    v_board := private.ensure_opportunity_board(r.owner_user_id);
    insert into public.think_hub_record (table_id, owner_user_id, title, status, opportunity_id, deleted_at)
    values (v_board, r.owner_user_id, r.title, r.stage, r.id, r.removed_at);
  end loop;
  perform set_config('avora.opp_sync', 'off', true);
end $$;
