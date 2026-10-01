-- AVORA-51 · Khoá Két sắt (ADR-034). Khoá truy cập, không phải mã hoá: dữ liệu Két sắt vẫn lưu như cũ,
-- nhưng mọi đọc / ghi (RLS, 10 RPC SECURITY DEFINER, bucket receipts) đòi một lần mở khoá còn hạn
-- gắn với đúng phiên đăng nhập (auth.jwt()->>'session_id'). Mã Két sắt 6 số, băm bcrypt, không ai đọc được.
--   · private.vault_secrets / vault_unlocks / vault_attempts / vault_reset_codes — không GRANT gì cho client.
--   · Nhập sai 5 lần → chờ 5′, rồi 15′, rồi 1 giờ (đếm ở server). Mã đặt lại qua email: 6 số, 10′, dùng 1 lần, 3 lần / giờ.
--   · Đặt lại / đổi mã → thông báo đẩy loại 'security' (không bị Tắt thông báo chặn) + email báo động (Edge Function vault-mail).
--   · Việc nhắc khoản vay không còn mang số tiền trong tên (sửa cả việc cũ).
-- crm_opportunity (Cơ hội) cố ý để ngoài khoá (duyệt Bước dừng 30/09).

-- ------------------------------------------------------------------ tables (private, nothing granted)
create table if not exists private.vault_secrets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists private.vault_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  unlocked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id)
);
create table if not exists private.vault_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  failed_count integer not null default 0,
  lock_level integer not null default 0,
  locked_until timestamptz
);
create table if not exists private.vault_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists vault_reset_codes_user on private.vault_reset_codes (user_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['vault_secrets', 'vault_unlocks', 'vault_attempts', 'vault_reset_codes'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ helpers
create or replace function private.vault_session_id()
returns uuid language sql stable set search_path = pg_temp as $$
  select case when coalesce(auth.jwt()->>'session_id', '') ~ '^[0-9a-fA-F-]{36}$' then (auth.jwt()->>'session_id')::uuid end
$$;
revoke all on function private.vault_session_id() from public, anon, authenticated;

-- RLS predicate: right person, right session, still within its 5 minutes.
create or replace function private.vault_is_unlocked()
returns boolean language sql stable security definer set search_path = private, pg_temp as $$
  select exists (
    select 1 from private.vault_unlocks u
    where u.user_id = auth.uid() and u.session_id = private.vault_session_id() and u.expires_at > now()
  )
$$;
revoke all on function private.vault_is_unlocked() from public, anon;
grant execute on function private.vault_is_unlocked() to authenticated;

-- Every Két sắt RPC starts here: raises when locked, otherwise slides the 5 minutes forward.
create or replace function private.vault_assert_unlocked()
returns void language plpgsql security definer set search_path = private, pg_temp as $$
begin
  update private.vault_unlocks set expires_at = now() + interval '5 minutes'
  where user_id = auth.uid() and session_id = private.vault_session_id() and expires_at > now();
  if not found then raise exception 'avora_vault_locked'; end if;
end $$;
revoke all on function private.vault_assert_unlocked() from public, anon;
grant execute on function private.vault_assert_unlocked() to authenticated;

create or replace function private.vault_open_session(p_user uuid)
returns void language plpgsql security definer set search_path = private, pg_temp as $$
declare v_sid uuid := private.vault_session_id();
begin
  if v_sid is null then raise exception 'avora_vault_no_session'; end if;
  delete from private.vault_unlocks where user_id = p_user and expires_at <= now();
  insert into private.vault_unlocks (user_id, session_id, expires_at) values (p_user, v_sid, now() + interval '5 minutes')
  on conflict (user_id, session_id) do update set unlocked_at = now(), expires_at = excluded.expires_at;
end $$;
revoke all on function private.vault_open_session(uuid) from public, anon, authenticated;

create or replace function private.vault_code_ok(p_code text)
returns boolean language sql immutable set search_path = pg_temp as $$
  select coalesce(p_code, '') ~ '^[0-9]{6}$'
$$;
revoke all on function private.vault_code_ok(text) from public, anon, authenticated;

-- Hands a mail to the vault-mail Edge Function (pg_net sends only after commit).
create or replace function private.vault_send_mail(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'avora_push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://myrubjdysllgucgafqjy.supabase.co/functions/v1/vault-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avora-cron', v_secret),
    body := p_body,
    timeout_milliseconds := 15000
  );
end $$;
revoke all on function private.vault_send_mail(jsonb) from public, anon, authenticated;

-- Alarm on reset / change: a push to every signed-in device that took notifications, plus an email.
create or replace function private.vault_alarm(p_user uuid, p_kind text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tz text; v_when text; v_text text; v_email text;
begin
  select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from profiles where id = p_user;
  v_when := to_char(now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'), 'HH24:MI DD/MM/YYYY');
  v_text := format('Mã Két sắt vừa được %s lúc %s. Không phải bạn? Đổi mật khẩu tài khoản ngay.',
    case when p_kind = 'reset' then 'đặt lại' else 'đổi' end, v_when);
  insert into push_outbox (user_id, kind, payload) values (p_user, 'security', jsonb_build_object('text', v_text));
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    perform private.vault_send_mail(jsonb_build_object('kind', 'alarm', 'action', p_kind, 'email', v_email, 'when', v_when));
  end if;
end $$;
revoke all on function private.vault_alarm(uuid, text) from public, anon, authenticated;

-- One wrong code: 5 in a row → wait 5′, then 15′, then 1 hour each time.
create or replace function private.vault_register_failure(p_user uuid)
returns jsonb language plpgsql security definer set search_path = private, pg_temp as $$
declare v_row private.vault_attempts%rowtype;
begin
  insert into private.vault_attempts (user_id) values (p_user) on conflict (user_id) do nothing;
  update private.vault_attempts set failed_count = failed_count + 1 where user_id = p_user returning * into v_row;
  if v_row.failed_count >= 5 then
    update private.vault_attempts set failed_count = 0, lock_level = lock_level + 1,
      locked_until = now() + case when lock_level = 0 then interval '5 minutes' when lock_level = 1 then interval '15 minutes' else interval '1 hour' end
    where user_id = p_user returning * into v_row;
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_row.locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'remaining', 5 - v_row.failed_count, 'locked_until', null);
end $$;
revoke all on function private.vault_register_failure(uuid) from public, anon, authenticated;

create or replace function private.vault_wait_until(p_user uuid)
returns timestamptz language sql stable security definer set search_path = private, pg_temp as $$
  select locked_until from private.vault_attempts where user_id = p_user and locked_until > now()
$$;
revoke all on function private.vault_wait_until(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ RPC
create or replace function public.vault_status()
returns jsonb language plpgsql stable security definer set search_path = private, pg_temp as $$
declare v_uid uuid := auth.uid(); v_exp timestamptz; v_failed integer;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select expires_at into v_exp from private.vault_unlocks
    where user_id = v_uid and session_id = private.vault_session_id() and expires_at > now();
  select failed_count into v_failed from private.vault_attempts where user_id = v_uid;
  return jsonb_build_object(
    'has_code', exists (select 1 from private.vault_secrets where user_id = v_uid),
    'unlocked', v_exp is not null,
    'expires_at', v_exp,
    'locked_until', private.vault_wait_until(v_uid),
    'remaining', 5 - coalesce(v_failed, 0));
end $$;

create or replace function public.vault_set_code(p_code text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_code) then raise exception 'avora_vault_code_format'; end if;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do nothing;
  if not found then raise exception 'avora_vault_code_exists'; end if;
  perform private.vault_open_session(v_uid);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vault_unlock(p_code text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_code) or extensions.crypt(p_code, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vault_lock()
returns void language plpgsql security definer set search_path = private, pg_temp as $$
begin
  if auth.uid() is null then return; end if;
  delete from private.vault_unlocks where user_id = auth.uid() and session_id = private.vault_session_id();
end $$;

create or replace function public.vault_touch()
returns jsonb language plpgsql security definer set search_path = private, pg_temp as $$
declare v_exp timestamptz;
begin
  update private.vault_unlocks set expires_at = now() + interval '5 minutes'
  where user_id = auth.uid() and session_id = private.vault_session_id() and expires_at > now()
  returning expires_at into v_exp;
  return jsonb_build_object('unlocked', v_exp is not null, 'expires_at', v_exp);
end $$;

create or replace function public.vault_change_code(p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_hash text; v_wait timestamptz;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new) then raise exception 'avora_vault_code_format'; end if;
  v_wait := private.vault_wait_until(v_uid);
  if v_wait is not null then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'remaining', 0, 'locked_until', v_wait);
  end if;
  select code_hash into v_hash from private.vault_secrets where user_id = v_uid;
  if v_hash is null then raise exception 'avora_vault_no_code'; end if;
  if not private.vault_code_ok(p_old) or extensions.crypt(p_old, v_hash) <> v_hash then
    return private.vault_register_failure(v_uid);
  end if;
  update private.vault_secrets set code_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where user_id = v_uid;
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  -- Other sessions that were open lose their unlock; this one stays in.
  delete from private.vault_unlocks where user_id = v_uid and session_id is distinct from private.vault_session_id();
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'change');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vault_request_reset()
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_email text; v_code text;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then raise exception 'avora_vault_no_email'; end if;
  if (select count(*) from private.vault_reset_codes where user_id = v_uid and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'avora_vault_reset_rate';
  end if;
  update private.vault_reset_codes set used_at = now() where user_id = v_uid and used_at is null;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.vault_reset_codes (user_id, code_hash, expires_at)
  values (v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes');
  perform private.vault_send_mail(jsonb_build_object('kind', 'reset_code', 'email', v_email, 'code', v_code));
  return jsonb_build_object('ok', true, 'expires_in_minutes', 10);
end $$;

create or replace function public.vault_confirm_reset(p_email_code text, p_new_code text)
returns jsonb language plpgsql security definer set search_path = private, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_row private.vault_reset_codes%rowtype;
begin
  if v_uid is null then raise exception 'avora_not_signed_in'; end if;
  if not private.vault_code_ok(p_new_code) then raise exception 'avora_vault_code_format'; end if;
  select * into v_row from private.vault_reset_codes
    where user_id = v_uid and used_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not private.vault_code_ok(p_email_code) or extensions.crypt(p_email_code, v_row.code_hash) <> v_row.code_hash then
    update private.vault_reset_codes set attempts = attempts + 1,
      used_at = case when attempts + 1 >= 5 then now() else null end
    where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', case when v_row.attempts + 1 >= 5 then 'expired' else 'wrong' end);
  end if;
  update private.vault_reset_codes set used_at = now() where id = v_row.id;
  insert into private.vault_secrets (user_id, code_hash) values (v_uid, extensions.crypt(p_new_code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update set code_hash = excluded.code_hash, updated_at = now();
  update private.vault_attempts set failed_count = 0, lock_level = 0, locked_until = null where user_id = v_uid;
  delete from private.vault_unlocks where user_id = v_uid;
  perform private.vault_open_session(v_uid);
  perform private.vault_alarm(v_uid, 'reset');
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['vault_status()', 'vault_set_code(text)', 'vault_unlock(text)', 'vault_lock()', 'vault_touch()',
    'vault_change_code(text, text)', 'vault_request_reset()', 'vault_confirm_reset(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------------ RLS of every Két sắt table
alter policy accounts_select_own on public.accounts using (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy accounts_insert_own on public.accounts with check (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy accounts_update_own on public.accounts using (user_id = (select auth.uid()) and private.vault_is_unlocked())
  with check (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy transactions_select_own on public.transactions using (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy transactions_insert_own on public.transactions with check (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy transactions_update_own on public.transactions using (user_id = (select auth.uid()) and private.vault_is_unlocked())
  with check (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy balance_history_select_own on public.account_balance_history using (
  private.vault_is_unlocked() and exists (select 1 from public.accounts a where a.id = account_balance_history.account_id and a.user_id = (select auth.uid())));
alter policy categories_select_own on public.categories using (user_id = (select auth.uid()) and private.vault_is_unlocked());
alter policy categories_insert_own_custom on public.categories with check (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.vault_is_unlocked());
alter policy categories_update_own_custom on public.categories using (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.vault_is_unlocked())
  with check (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.vault_is_unlocked());
alter policy categories_delete_own_custom on public.categories using (user_id = (select auth.uid()) and type = 'custom'::category_origin and private.vault_is_unlocked());

alter policy receipts_read_own on storage.objects using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.vault_is_unlocked());
alter policy receipts_write_own on storage.objects with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.vault_is_unlocked());
alter policy receipts_delete_own on storage.objects using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and private.vault_is_unlocked());

-- Internal recomputes are no longer callable from the app (they only run from a checked RPC or a trigger).
revoke execute on function public.recompute_account_state(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_transaction_base_amounts(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ security pushes
alter table public.push_outbox drop constraint if exists push_outbox_kind;
alter table public.push_outbox add constraint push_outbox_kind check (kind in ('message', 'friend_request', 'reminder', 'security'));

-- ------------------------------------------------------------------ loan reminders: no amount in the task name
update public.tasks
set title = regexp_replace(title, '\s+—\s.*$', ''),
    description = case when position(E'\n' in description) > 0
      then regexp_replace(title, '\s+—\s.*$', '') || substr(description, position(E'\n' in description))
      else regexp_replace(description, '\s+—\s.*$', '') end
where source_transaction_id is not null and title like 'Đến hạn:%' and title ~ '\s—\s';

-- ------------------------------------------------------------------ the 10 Két sắt RPCs check the lock themselves
CREATE OR REPLACE FUNCTION public.create_obligation_reminder_task(p_transaction_id uuid, p_title text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid ();
  v_txn public.transactions%rowtype;
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+—\s.*$', '')), 200);
  v_existing uuid;
  v_id uuid;
begin
  perform private.vault_assert_unlocked();
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
$function$;

CREATE OR REPLACE FUNCTION public.create_obligation_transaction(p_type transaction_type, p_account_id uuid, p_amount numeric, p_due_date date, p_contact_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_transaction_date date DEFAULT NULL::date, p_tax_period_start date DEFAULT NULL::date, p_tax_period_end date DEFAULT NULL::date, p_business_related boolean DEFAULT false)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
begin
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;
  if p_type not in ('vay', 'cho_vay', 'thue_ca_nhan', 'thue_kinh_doanh') then
    raise exception 'avora_txn_type_not_obligation';
  end if;
  if p_account_id is null then
    raise exception 'avora_txn_account_required';
  end if;
  if p_due_date is null then
    raise exception 'avora_txn_due_date_required';
  end if;
  if p_type in ('vay', 'cho_vay') and p_contact_id is null then
    raise exception 'avora_txn_contact_required';
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, type, amount, transaction_date,
    description, business_related, contact_id, due_date, status,
    amount_settled, tax_period_start, tax_period_end
  ) values (
    v_user, p_account_id, null, p_type, p_amount,
    coalesce(p_transaction_date, current_date),
    p_description, coalesce(p_business_related, false),
    case when p_type in ('vay', 'cho_vay') then p_contact_id else null end,
    p_due_date,
    case when p_due_date <= current_date then 'den_han' else 'ke_hoach' end,
    0, p_tax_period_start, p_tax_period_end
  ) returning * into v_row;

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_default_categories()
 RETURNS SETOF categories
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user uuid := auth.uid();
begin
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;
  perform public.seed_finance_categories(v_user);
  return query
    select * from public.categories
    where user_id = v_user and deleted_at is null
    order by applies_to, sort_order, lower(name);
end $function$;

CREATE OR REPLACE FUNCTION public.purge_account(p_account_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  perform private.vault_assert_unlocked();
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
end $function$;

CREATE OR REPLACE FUNCTION public.purge_transaction(p_transaction_id uuid, p_confirm text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if v_row.business_related then raise exception 'avora_finance_business_no_purge'; end if;
  if btrim(coalesce(p_confirm, '')) <> private.transaction_confirm_word(v_row.description) then
    raise exception 'avora_confirm_name_mismatch';
  end if;
  delete from transactions where id = p_transaction_id;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_account(p_account_id uuid, p_with_transactions boolean)
 RETURNS accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype; v_live int;
begin
  perform private.vault_assert_unlocked();
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
end $function$;

CREATE OR REPLACE FUNCTION public.restore_account(p_account_id uuid)
 RETURNS accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row accounts%rowtype;
begin
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update accounts set removed_at = null where id = p_account_id and user_id = v_user and removed_at is not null returning * into v_row;
  if not found then raise exception 'avora_account_not_yours'; end if;
  update transactions set removed_at = null, removed_with_account = false
  where account_id = p_account_id and removed_with_account;
  perform public.recompute_account_state(p_account_id);
  select * into v_row from accounts where id = p_account_id;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_transaction(p_transaction_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  update transactions set removed_at = now(), removed_with_account = false
  where id = p_transaction_id and user_id = v_user and removed_at is null returning * into v_row;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_transaction(p_transaction_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid := auth.uid(); v_row transactions%rowtype;
begin
  perform private.vault_assert_unlocked();
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  select * into v_row from transactions where id = p_transaction_id and user_id = v_user and removed_at is not null for update;
  if not found then raise exception 'avora_txn_not_yours'; end if;
  if exists (select 1 from accounts where id = v_row.account_id and removed_at is not null) then
    raise exception 'avora_txn_account_in_trash';
  end if;
  update transactions set removed_at = null, removed_with_account = false where id = p_transaction_id returning * into v_row;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.settle_transaction(p_transaction_id uuid, p_amount numeric)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
  v_next numeric(14,2);
begin
  perform private.vault_assert_unlocked();
  if v_user is null then
    raise exception 'avora_not_signed_in';
  end if;

  select * into v_row from public.transactions
  where id = p_transaction_id and user_id = v_user;
  if not found then
    raise exception 'avora_txn_not_yours';
  end if;
  if v_row.type in ('income', 'expense') then
    raise exception 'avora_txn_not_an_obligation';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'avora_txn_voided';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'avora_txn_settle_positive';
  end if;

  v_next := round(v_row.amount_settled + p_amount, 2);
  if v_next > v_row.amount then
    raise exception 'avora_txn_settle_over';
  end if;

  -- Chỉ ghi số đã trả; trạng thái do trigger tính lại từ chính con số đó.
  update public.transactions t
  set amount_settled = v_next
  where t.id = p_transaction_id
  returning * into v_row;

  return v_row;
end $function$;
CREATE OR REPLACE FUNCTION public.push_claim_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_out jsonb := '[]'::jsonb; g record; v_title text; v_body text; v_count integer; v_last messages%rowtype;
  v_read timestamptz; v_show boolean; v_tz text; v_task tasks%rowtype; v_subs jsonb; v_url text; v_ids uuid[];
  v_mention boolean;
begin
  perform private.enqueue_due_reminders();
  -- Rows a crashed run left half-sent go back in the queue; old rows are cleared (7 days).
  update push_outbox set status = 'pending' where status = 'sending' and sent_at is null and created_at < now() - interval '5 minutes';
  delete from push_outbox where created_at < now() - interval '7 days';

  -- Messages and friend requests: one notification per (person, conversation), replacing the last (tag).
  for g in
    select o.user_id, o.conversation_id, o.kind, array_agg(o.id) ids, max(o.created_at) newest
    from push_outbox o
    where o.status = 'pending' and o.kind in ('message', 'friend_request')
    group by o.user_id, o.conversation_id, o.kind
    having min(o.send_after) <= now()
    limit 200
  loop
    update push_outbox set status = 'sending' where id = any (g.ids);
    select last_read_at into v_read from conversation_read_marks where conversation_id = g.conversation_id and user_id = g.user_id;
    select count(*) into v_count from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
        and m.created_at > coalesce(v_read, '-infinity'::timestamptz);
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_count = 0 or v_subs is null or not exists (select 1 from conversation_participants where conversation_id = g.conversation_id and user_id = g.user_id) then
      -- Already read in the app (or nothing left to say): no push.
      update push_outbox set status = 'skipped', sent_at = now() where id = any (g.ids);
      continue;
    end if;
    select m.* into v_last from messages m
      where m.conversation_id = g.conversation_id and m.sender_id <> g.user_id and m.system_kind is null and m.deleted_at is null
      order by m.created_at desc limit 1;
    select push_show_content into v_show from profiles where id = g.user_id;
    v_mention := g.user_id = any (coalesce(v_last.mentioned_user_ids, '{}'));
    if g.kind = 'friend_request' then
      v_title := 'AVORA';
      v_body := 'Có người muốn kết bạn';
    else
      v_title := coalesce((select name from conversation_groups where conversation_id = g.conversation_id), private.push_display_name(v_last.sender_id));
      if coalesce(v_show, false) then
        v_body := case
          when btrim(v_last.content) <> '' then left(btrim(v_last.content), 80)
          when exists (select 1 from message_attachments a where a.message_id = v_last.id and a.kind = 'image') then '[Ảnh]'
          else '[Tệp]' end;
        if v_count > 1 then v_body := format('(%s) %s', v_count, v_body); end if;
      elsif exists (select 1 from push_outbox o join messages m on m.id = o.message_id
                    where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')))
            and exists (select 1 from conversations where id = g.conversation_id and type = 'group') then
        -- Being named is what matters most: said first, the count after.
        v_body := format('%s nhắc đến bạn', private.push_display_name(
          (select m.sender_id from push_outbox o join messages m on m.id = o.message_id
           where o.id = any (g.ids) and g.user_id = any (coalesce(m.mentioned_user_ids, '{}')) order by m.created_at desc limit 1)))
          || case when v_count > 1 then format(' · %s tin nhắn mới', v_count) else '' end;
      elsif v_count > 1 then
        v_body := format('%s tin nhắn mới', v_count);
      else
        v_body := 'Tin nhắn mới';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', to_jsonb(g.ids), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', v_title, 'body', v_body, 'tag', g.conversation_id::text,
        'url', '/tin-nhan/' || g.conversation_id)));
  end loop;

  -- Reminders: one each.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'reminder' and o.send_after <= now() order by o.created_at limit 200
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    select push_show_content, coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_show, v_tz from profiles where id = g.user_id;
    v_task := null;
    if g.task_id is not null then select * into v_task from tasks where id = g.task_id; end if;
    if v_subs is null or (g.task_id is not null and (v_task.id is null or v_task.status in ('done', 'skipped'))) then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_body := case when (g.payload->>'go') = 'true' then 'Đến giờ đi: ' else 'Đến giờ: ' end
      || to_char(((g.payload->>'at')::timestamptz) at time zone v_tz, 'HH24:MI');
    if coalesce(v_show, false) then
      v_body := v_body || ' · ' || left(coalesce(v_task.title, g.payload->>'title', ''), 80);
    end if;
    v_url := case when g.task_id is not null then '/nhiem-vu?muc=viec&mo=' || g.task_id
                  else '/ke-hoach?bang=' || (g.payload->>'table_id') || '&hang-muc=' || (g.payload->>'record_id') end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'Nhắc việc', 'body', v_body, 'tag', 'nhac:' || coalesce(g.task_id::text, g.payload->>'record_id'), 'url', v_url)));
  end loop;
  -- AVORA-51 · security alarms (Két sắt code reset / changed): always sent, no mute applies.
  for g in
    select o.* from push_outbox o where o.status = 'pending' and o.kind = 'security' and o.send_after <= now() order by o.created_at limit 200
  loop
    update push_outbox set status = 'sending' where id = g.id;
    select * into v_subs from (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from push_subscriptions s where s.user_id = g.user_id) x;
    if v_subs is null then
      update push_outbox set status = 'skipped', sent_at = now() where id = g.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ids', jsonb_build_array(g.id), 'subscriptions', v_subs,
      'notification', jsonb_build_object('title', 'AVORA · Két sắt', 'body', coalesce(g.payload->>'text', 'Mã Két sắt vừa thay đổi.'), 'tag', 'ket-sat:' || g.id, 'url', '/ket-sat')));
  end loop;
  return v_out;
end $function$;
revoke all on function public.push_claim_batch() from public, anon, authenticated;
grant execute on function public.push_claim_batch() to service_role;
