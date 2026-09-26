-- AVORA 32 / Nhóm E (OPEN-009) — "Tạo việc nhắc" from an obligation that has a due date.
--
-- Only a suggestion: nothing is created until the owner presses the button. The task is a personal task,
-- titled "Đến hạn: [Tên khoản] — [số tiền]", due on the obligation's due date (today if that has passed).
-- tasks.source_transaction_id links it to the obligation. When the obligation is fully settled the task is
-- marked done automatically; the owner can reopen it by hand like any task (settling is not re-run on it).

alter table public.tasks
  add column if not exists source_transaction_id uuid references public.transactions (id) on delete set null;

create index if not exists tasks_source_transaction_idx on public.tasks (source_transaction_id)
  where source_transaction_id is not null;

-- Only the function below sets it.
revoke insert (source_transaction_id), update (source_transaction_id) on public.tasks from authenticated, anon;

create or replace function public.create_obligation_reminder_task (p_transaction_id uuid, p_title text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid ();
  v_txn public.transactions%rowtype;
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;

  select * into v_txn from public.transactions where id = p_transaction_id and user_id = v_uid;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if v_txn.type in ('income', 'expense') then raise exception 'avora_txn_not_an_obligation'; end if;
  if v_txn.deleted_at is not null then raise exception 'avora_txn_voided'; end if;
  if v_txn.due_date is null then raise exception 'avora_txn_due_date_required'; end if;
  if v_txn.amount_settled >= v_txn.amount then raise exception 'avora_txn_already_settled'; end if;
  if v_title = '' or v_title not like 'Đến hạn:%' then raise exception 'avora_reminder_bad_title'; end if;

  -- Pressing it twice gives the same task.
  select id into v_existing from public.tasks
  where source_transaction_id = p_transaction_id and creator_id = v_uid
  order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.tasks (type, creator_id, title, description, status, deadline_date, source_transaction_id)
  values ('personal', v_uid, v_title,
    v_title || E'\nTạo từ Két sắt. Việc tự hoàn tất khi khoản này được tất toán.',
    'confirmed', greatest(v_txn.due_date, current_date), p_transaction_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_obligation_reminder_task (uuid, text) from public, anon;
grant execute on function public.create_obligation_reminder_task (uuid, text) to authenticated;

-- Fully settled → the reminder is done. Fires only on the obligation's own change, so a task reopened by hand
-- stays open.
create or replace function public.complete_obligation_reminder ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if new.amount_settled >= new.amount and old.amount_settled < old.amount then
    update public.tasks
      set status = 'done', done_at = now()
      where source_transaction_id = new.id
        and creator_id = new.user_id
        and type = 'personal'
        and status <> 'done';
  end if;
  return null;
end;
$$;

revoke execute on function public.complete_obligation_reminder () from public, anon, authenticated;

drop trigger if exists transactions_complete_reminder on public.transactions;
create trigger transactions_complete_reminder
  after update of amount_settled on public.transactions
  for each row execute function public.complete_obligation_reminder ();
