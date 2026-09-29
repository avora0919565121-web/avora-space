-- Đợt gộp 2 · Phần D.
--   D2  Tài chính: removed_at = "Xoá" (Thùng rác), separate from deleted_at (account "đóng" /
--       transaction "đánh dấu nhầm"). No direct DELETE for authenticated; "Xoá vĩnh viễn" only by
--       RPC with the name typed back, never for business_related rows.
--   D4  No dead ends: an assignee may bin a shared task that can no longer move; pending suggestions
--       that can no longer be answered close themselves with a reason.
--   D5  A contact may be created with only a name from the finance person picker (needs_details).

-- ================================================================== D2
alter table public.accounts add column if not exists removed_at timestamptz;
alter table public.transactions
  add column if not exists removed_at timestamptz,
  add column if not exists removed_with_account boolean not null default false;
grant select (removed_at) on public.accounts to authenticated;
grant select (removed_at, removed_with_account) on public.transactions to authenticated;

revoke delete on public.accounts from authenticated;
revoke delete on public.transactions from authenticated;
drop policy if exists accounts_delete_own on public.accounts;
drop policy if exists transactions_delete_own on public.transactions;

-- A binned transaction counts nowhere, like a voided one.
create or replace function public.recompute_account_state(p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_opening numeric(14,2);
  v_first date;
  v_created date;
begin
  select opening_balance, created_at::date into v_opening, v_created
  from public.accounts where id = p_account_id;
  if not found then return; end if;

  update public.accounts a
  set balance = v_opening + coalesce((
        select sum(private.transaction_signed_amount(t.type, t.amount))
        from public.transactions t
        where t.account_id = a.id and t.deleted_at is null and t.removed_at is null
      ), 0)
  where a.id = p_account_id;

  delete from public.account_balance_history where account_id = p_account_id;

  select min(transaction_date) into v_first
  from public.transactions where account_id = p_account_id and deleted_at is null and removed_at is null;

  insert into public.account_balance_history (account_id, balance_date, balance)
  values (p_account_id, least(v_created, coalesce(v_first, v_created) - 1), v_opening);

  insert into public.account_balance_history (account_id, balance_date, balance)
  select p_account_id, x.d,
         v_opening + sum(x.delta) over (order by x.d rows between unbounded preceding and current row)
  from (
    select t.transaction_date as d,
           sum(private.transaction_signed_amount(t.type, t.amount)) as delta
    from public.transactions t
    where t.account_id = p_account_id and t.deleted_at is null and t.removed_at is null
    group by t.transaction_date
  ) x
  on conflict (account_id, balance_date) do update set balance = excluded.balance;
end $function$;

-- A row in the bin is frozen until it is restored.
create or replace function private.freeze_removed_finance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.removed_at is not null and new.removed_at is not null then
    raise exception 'avora_finance_in_trash';
  end if;
  return new;
end $$;
drop trigger if exists accounts_freeze_removed on public.accounts;
create trigger accounts_freeze_removed before update on public.accounts for each row execute function private.freeze_removed_finance();
drop trigger if exists transactions_freeze_removed on public.transactions;
create trigger transactions_freeze_removed before update on public.transactions for each row execute function private.freeze_removed_finance();

create or replace function public.remove_account(p_account_id uuid, p_with_transactions boolean)
returns public.accounts language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row accounts%rowtype; v_live int;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from accounts where id = p_account_id and user_id = v_user and removed_at is null for update;
  if not found then raise exception 'avora_account_not_yours'; end if;
  select count(*) into v_live from transactions where account_id = p_account_id and removed_at is null;

  if v_live > 0 and not coalesce(p_with_transactions, false) then
    -- "Giữ lại giao dịch, chỉ đóng tài khoản".
    update accounts set deleted_at = coalesce(deleted_at, now()) where id = p_account_id returning * into v_row;
    return v_row;
  end if;
  update transactions set removed_at = now(), removed_with_account = true
  where account_id = p_account_id and removed_at is null;
  update accounts set removed_at = now() where id = p_account_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.restore_account(p_account_id uuid)
returns public.accounts language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update accounts set removed_at = null where id = p_account_id and user_id = v_user and removed_at is not null returning * into v_row;
  if not found then raise exception 'avora_account_not_yours'; end if;
  update transactions set removed_at = null, removed_with_account = false
  where account_id = p_account_id and removed_with_account;
  perform public.recompute_account_state(p_account_id);
  select * into v_row from accounts where id = p_account_id;
  return v_row;
end $$;

create or replace function public.remove_transaction(p_transaction_id uuid)
returns public.transactions language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update transactions set removed_at = now(), removed_with_account = false
  where id = p_transaction_id and user_id = v_user and removed_at is null returning * into v_row;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  return v_row;
end $$;

create or replace function public.restore_transaction(p_transaction_id uuid)
returns public.transactions language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if exists (select 1 from accounts where id = v_row.account_id and removed_at is not null) then
    raise exception 'avora_txn_account_in_trash';
  end if;
  update transactions set removed_at = null, removed_with_account = false where id = p_transaction_id returning * into v_row;
  return v_row;
end $$;

-- What has to be typed back to purge a transaction: its description, or "XOÁ" when it has none.
create or replace function private.transaction_confirm_word(p_description text)
returns text language sql immutable as $$ select coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'XOÁ') $$;

create or replace function public.purge_transaction(p_transaction_id uuid, p_confirm text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if v_row.business_related then raise exception 'avora_finance_business_no_purge'; end if;
  if btrim(coalesce(p_confirm, '')) <> private.transaction_confirm_word(v_row.description) then
    raise exception 'avora_confirm_name_mismatch';
  end if;
  delete from transactions where id = p_transaction_id;
end $$;

create or replace function public.purge_account(p_account_id uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from accounts where id = p_account_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_account_not_yours'; end if;
  if exists (select 1 from transactions where account_id = p_account_id and business_related) then
    raise exception 'avora_finance_business_no_purge';
  end if;
  if exists (select 1 from transactions where account_id = p_account_id and removed_at is null) then
    raise exception 'avora_account_has_live_transactions';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_row.name) then raise exception 'avora_confirm_name_mismatch'; end if;
  delete from transactions where account_id = p_account_id;
  delete from accounts where id = p_account_id;
end $$;

revoke all on function private.transaction_confirm_word(text) from public, anon, authenticated;
revoke all on function public.remove_account(uuid, boolean) from public, anon;
revoke all on function public.restore_account(uuid) from public, anon;
revoke all on function public.remove_transaction(uuid) from public, anon;
revoke all on function public.restore_transaction(uuid) from public, anon;
revoke all on function public.purge_transaction(uuid, text) from public, anon;
revoke all on function public.purge_account(uuid, text) from public, anon;
grant execute on function public.remove_account(uuid, boolean) to authenticated;
grant execute on function public.restore_account(uuid) to authenticated;
grant execute on function public.remove_transaction(uuid) to authenticated;
grant execute on function public.restore_transaction(uuid) to authenticated;
grant execute on function public.purge_transaction(uuid, text) to authenticated;
grant execute on function public.purge_account(uuid, text) to authenticated;

-- ================================================================== D4 tasks
-- Why a shared task can no longer move for this person, or null while it still can.
create or replace function private.task_closed_reason(p_task public.tasks, p_user uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_conv conversations%rowtype; v_project projects%rowtype;
begin
  if p_task.type not in ('1-1-shared', 'group-shared') then return null; end if;
  if p_task.status = 'done' then return 'done'; end if;
  if p_task.status = 'skipped' then return 'skipped'; end if;
  if p_task.deleted_by_creator then return 'creator_deleted'; end if;
  select * into v_conv from conversations where id = p_task.conversation_id;
  if not found or not private.conversation_is_live(p_task.conversation_id) then return 'conversation_deleted'; end if;
  if not private.is_conversation_participant(p_task.conversation_id, p_task.creator_id) then return 'creator_left'; end if;
  if private.is_blocked_between(p_task.creator_id, p_user) then return 'blocked'; end if;
  if v_conv.type = 'direct' and not private.are_connected(p_task.creator_id, p_user) then return 'disconnected'; end if;
  select pr.* into v_project from project_tasks pt join projects pr on pr.id = pt.project_id where pt.task_id = p_task.id limit 1;
  if found and (v_project.deleted_at is not null or v_project.status <> 'active') then return 'project_closed'; end if;
  return null;
end $$;
revoke all on function private.task_closed_reason(public.tasks, uuid) from public, anon, authenticated;

-- What the viewer's own list shows for their shared tasks: the closed ones and why.
create or replace function public.list_my_closed_shared_tasks()
returns table (task_id uuid, reason text) language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, private.task_closed_reason(t, auth.uid())
  from tasks t
  where t.type in ('1-1-shared', 'group-shared')
    and public.is_task_assignee(t, auth.uid()) and t.creator_id <> auth.uid()
    and not t.deleted_by_peer
    and private.is_conversation_participant(t.conversation_id, auth.uid())
    and private.task_closed_reason(t, auth.uid()) is not null
$$;
revoke all on function public.list_my_closed_shared_tasks() from public, anon;
grant execute on function public.list_my_closed_shared_tasks() to authenticated;

create or replace function public.delete_shared_task(p_task_id uuid)
returns public.tasks language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.tasks%rowtype;
  v_is_creator boolean;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_row from public.tasks
  where id = p_task_id and type in ('1-1-shared', 'group-shared')
  for update;
  if not found then raise exception 'avora_task_not_found'; end if;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_row.conversation_id and user_id = v_uid
  ) then
    raise exception 'avora_not_a_participant';
  end if;

  v_is_creator := v_uid = v_row.creator_id;

  if (not v_is_creator) and (not public.is_task_assignee(v_row, v_uid)) then
    raise exception 'avora_task_not_assignee';
  end if;

  -- The person doing the work cannot make open work disappear — but work that can no longer move
  -- (done, skipped, the requester gone / blocked / disconnected, the room or project closed) is
  -- theirs to clear (Đợt gộp 2 · D4: no dead ends).
  if (not v_is_creator) and private.task_closed_reason(v_row, v_uid) is null then
    raise exception 'avora_task_assignee_delete_requires_done';
  end if;

  if v_is_creator and v_row.status = 'pending_confirmation' then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  if (v_is_creator and v_row.deleted_by_peer) or ((not v_is_creator) and v_row.deleted_by_creator) then
    delete from public.tasks where id = p_task_id;
    v_row.deleted_by_creator := true;
    v_row.deleted_by_peer := true;
    return v_row;
  end if;

  if (v_is_creator and v_row.deleted_by_creator) or ((not v_is_creator) and v_row.deleted_by_peer) then
    return v_row;
  end if;

  update public.tasks
  set deleted_by_creator = (case when v_is_creator then true else deleted_by_creator end),
      deleted_by_peer = (case when v_is_creator then deleted_by_peer else true end),
      updated_at = now()
  where id = p_task_id;

  select * into v_row from public.tasks where id = p_task_id;
  return v_row;
end;
$function$;

-- ================================================================== D4 suggestions
alter table public.task_suggestions add column if not exists close_reason text;
alter table public.task_suggestions drop constraint if exists task_suggestions_close_reason_check;
alter table public.task_suggestions add constraint task_suggestions_close_reason_check check (
  close_reason is null or close_reason in ('disconnected', 'blocked', 'proposer_left', 'assignee_left',
    'conversation_deleted', 'record_gone', 'project_closed', 'stale'));
grant select (close_reason) on public.task_suggestions to authenticated;

create or replace function private.suggestion_dead_reason(s public.task_suggestions)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_type text; v_table uuid;
begin
  if s.status <> 'pending' then return null; end if;
  if not private.conversation_is_live(s.conversation_id) then return 'conversation_deleted'; end if;
  if not private.is_conversation_participant(s.conversation_id, s.proposer_id) then return 'proposer_left'; end if;
  if not private.is_conversation_participant(s.conversation_id, s.assignee_id) then return 'assignee_left'; end if;
  if private.is_blocked_between(s.proposer_id, s.assignee_id) then return 'blocked'; end if;
  select type into v_type from conversations where id = s.conversation_id;
  if v_type = 'direct' and not private.are_connected(s.proposer_id, s.assignee_id) then return 'disconnected'; end if;
  if s.proposed_record_id is not null then
    select table_id into v_table from think_hub_record where id = s.proposed_record_id and deleted_at is null;
    if v_table is null or exists (select 1 from think_hub_table where id = v_table and deleted_at is not null)
       or private.think_hub_table_archived(v_table) then
      return 'record_gone';
    end if;
  end if;
  if s.proposed_project_id is not null and not private.project_is_open(s.proposed_project_id) then return 'project_closed'; end if;
  if s.created_at < now() - interval '30 days' then return 'stale'; end if;
  return null;
end $$;
revoke all on function private.suggestion_dead_reason(public.task_suggestions) from public, anon, authenticated;

create or replace function private.close_dead_suggestions()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  with dead as (
    select s.id, private.suggestion_dead_reason(s) as reason from task_suggestions s where s.status = 'pending'
  )
  update task_suggestions s set status = 'withdrawn', resolved_at = now(), close_reason = dead.reason
  from dead where dead.id = s.id and dead.reason is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.close_dead_suggestions() from public, anon, authenticated;

create or replace function private.close_dead_suggestions_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.close_dead_suggestions();
  return null;
end $$;

drop trigger if exists user_blocks_close_suggestions on public.user_blocks;
create trigger user_blocks_close_suggestions after insert on public.user_blocks
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists user_connections_close_suggestions on public.user_connections;
create trigger user_connections_close_suggestions after update on public.user_connections
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists participants_close_suggestions on public.conversation_participants;
create trigger participants_close_suggestions after delete on public.conversation_participants
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists conversations_close_suggestions on public.conversations;
create trigger conversations_close_suggestions after update of deleted_at on public.conversations
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists projects_close_suggestions on public.projects;
create trigger projects_close_suggestions after update of status, deleted_at on public.projects
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists think_hub_table_close_suggestions on public.think_hub_table;
create trigger think_hub_table_close_suggestions after update of deleted_at, archived_at on public.think_hub_table
  for each statement execute function private.close_dead_suggestions_trigger();
drop trigger if exists think_hub_record_close_suggestions on public.think_hub_record;
create trigger think_hub_record_close_suggestions after update of deleted_at on public.think_hub_record
  for each statement execute function private.close_dead_suggestions_trigger();

-- The hourly sweep also catches the 30-day ones.
create or replace function private.sweep_dead_ends()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.close_dead_suggestions();
end $$;
revoke all on function private.sweep_dead_ends() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'avora_sweep_dead_ends') then perform cron.unschedule('avora_sweep_dead_ends'); end if;
  perform cron.schedule('avora_sweep_dead_ends', '17 * * * *', 'select private.sweep_dead_ends()');
end $$;

-- ================================================================== D5 contacts
alter table public.contact add column if not exists needs_details boolean not null default false;
grant select (needs_details) on public.contact to authenticated;

create or replace function private.contact_details_filled()
returns trigger language plpgsql as $$
begin
  if new.needs_details and (nullif(btrim(coalesce(new.phone, '')), '') is not null or nullif(btrim(coalesce(new.email, '')), '') is not null) then
    new.needs_details := false;
  end if;
  return new;
end $$;
drop trigger if exists contact_details_filled on public.contact;
create trigger contact_details_filled before insert or update on public.contact
  for each row execute function private.contact_details_filled();

-- "＋ Thêm … vào Danh bạ" from a finance person picker: a name is enough; phone/email optional.
create or replace function public.create_contact_quick(p_name text, p_phone text default null, p_email text default null)
returns public.contact language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_row contact%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if v_name is null then raise exception 'avora_contact_name_required'; end if;
  if char_length(v_name) > 120 then raise exception 'avora_contact_name_too_long'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'avora_contact_email_invalid'; end if;
  insert into contact (owner_user_id, contact_type, name, phone, email, needs_details)
  values (v_uid, 'individual', v_name, v_phone, v_email, v_phone is null and v_email is null)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.create_contact_quick(text, text, text) from public, anon;
grant execute on function public.create_contact_quick(text, text, text) to authenticated;
