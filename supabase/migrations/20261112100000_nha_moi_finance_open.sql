-- Nhà mới (VMT 12/11) · Két sắt không ép đặt mã.
-- "Két sắt là sở hữu cá nhân: nhắc đặt mã thì được, ép đặt mã là sai."
--
-- Before: Tài chính (accounts, transactions, categories, receipts) was readable only inside an unlocked
-- Két sắt session, and a session needs a code — so a newcomer had to set a code before writing one
-- expense. Now:
--   · no Két sắt code yet  → Tài chính is open to its owner, like any other room of the house;
--   · a code has been set  → exactly as before (RLS + every finance RPC ask for the open session).
-- Giấy tờ / Mật khẩu / Chứng chỉ / Tài sản (vault_items, vault_files) do NOT change: they are end-to-end
-- encrypted with keys that come from the code, so the code is asked when the first one is put away.

create or replace function private.vault_has_code(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select exists (select 1 from private.vault_secrets s where s.user_id = p_uid)
$$;
revoke all on function private.vault_has_code(uuid) from public, anon, authenticated;

-- RLS predicate for Tài chính only: the owner's Két sắt is open, or it has no code yet.
create or replace function private.finance_is_open()
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select private.vault_is_unlocked() or not private.vault_has_code(auth.uid())
$$;
revoke all on function private.finance_is_open() from public, anon;
grant execute on function private.finance_is_open() to authenticated;

-- Every finance RPC (and the two vault-item RPCs) starts with this. Without a code there is no session to
-- slide forward and nothing encrypted to guard: vault_items keep their strict RLS (vault_is_unlocked), so
-- no vault item can exist or be read without a code.
create or replace function private.vault_assert_unlocked()
returns void
language plpgsql
security definer
set search_path = private, pg_temp
as $$
begin
  if auth.uid() is not null and not private.vault_has_code(auth.uid()) then return; end if;
  update private.vault_unlocks set expires_at = now() + interval '5 minutes'
  where user_id = auth.uid() and session_id = private.vault_session_id() and expires_at > now();
  if not found then raise exception 'avora_vault_locked'; end if;
end $$;
revoke all on function private.vault_assert_unlocked() from public, anon;
grant execute on function private.vault_assert_unlocked() to authenticated;

alter policy accounts_select_own on public.accounts using (user_id = (select auth.uid()) and private.finance_is_open());
alter policy accounts_insert_own on public.accounts with check (user_id = (select auth.uid()) and private.finance_is_open());
alter policy accounts_update_own on public.accounts using (user_id = (select auth.uid()) and private.finance_is_open())
  with check (user_id = (select auth.uid()) and private.finance_is_open());
alter policy transactions_select_own on public.transactions using (user_id = (select auth.uid()) and private.finance_is_open());
alter policy transactions_insert_own on public.transactions with check (user_id = (select auth.uid()) and private.finance_is_open());
alter policy transactions_update_own on public.transactions using (user_id = (select auth.uid()) and private.finance_is_open())
  with check (user_id = (select auth.uid()) and private.finance_is_open());
alter policy balance_history_select_own on public.account_balance_history using (
  private.finance_is_open() and exists (select 1 from public.accounts a where a.id = account_balance_history.account_id and a.user_id = (select auth.uid())));
alter policy categories_select_own on public.categories using (user_id = (select auth.uid()) and private.finance_is_open());
alter policy categories_insert_own_custom on public.categories with check (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.finance_is_open());
alter policy categories_update_own_custom on public.categories using (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.finance_is_open())
  with check (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.finance_is_open());
alter policy categories_delete_own_custom on public.categories using (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.finance_is_open());

alter policy receipts_read_own on storage.objects using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.finance_is_open());
alter policy receipts_write_own on storage.objects with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.finance_is_open());
alter policy receipts_delete_own on storage.objects using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.finance_is_open());
