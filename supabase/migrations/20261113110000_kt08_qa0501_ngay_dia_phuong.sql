-- KT-08 · QA05-01 (Nặng): từ 00:00 đến 06:59 giờ VN không ghi được khoản thu/chi "hôm nay".
--
-- Nguyên nhân: public.enforce_transaction_essentials() so `transaction_date > current_date`; current_date
-- của máy chủ theo UTC (00:00–06:59 VN vẫn là hôm qua theo UTC), còn app gửi ngày theo lịch người dùng.
--
-- Cách sửa (chọn cách an toàn hơn "cho lệch +1 ngày"):
--   "Tương lai" = sau ngày HÔM NAY THEO MÚI GIỜ HỒ SƠ của chính người ghi (profiles.timezone, mặc định
--   Asia/Ho_Chi_Minh; trống / không hợp lệ thì dùng Asia/Ho_Chi_Minh). Lý do:
--   * Đúng một nguồn ngày như phần còn lại của app (112-E · LOI-03: múi giờ hồ sơ là nguồn DUY NHẤT của
--     "hôm nay"); web cũng đổi `finance.todayIso()` sang múi giờ hồ sơ để hai bên cùng một lịch.
--   * "+1 ngày so với UTC" sẽ cho người ở VN ghi trước NGÀY MAI suốt 07:00–23:59 mỗi ngày (mở lỗ chứ
--     không vá), và vẫn sai với múi giờ khác.
--   * Không bao giờ chặt hơn trước: múi giờ hồ sơ không hợp lệ → về Asia/Ho_Chi_Minh.
--
-- Ví "Tiền mặt" của lần ghi đầu: trước đây web tạo ví rồi mới ghi; ghi bị chặn thì ví vẫn còn. Nay
-- public.record_first_expense() tạo ví + ghi khoản chi trong CÙNG một giao dịch (SECURITY INVOKER: mọi RLS,
-- cổng phiên, khoá Két sắt và trigger sẵn có vẫn áp). Ghi lỗi → không có ví.
-- Áp lại được (idempotent).

create or replace function private.local_day(p_zone text, p_at timestamptz)
returns date language plpgsql stable set search_path = '' as $$
begin
  return (p_at at time zone coalesce(nullif(btrim(p_zone), ''), 'Asia/Ho_Chi_Minh'))::date;
exception when others then
  return (p_at at time zone 'Asia/Ho_Chi_Minh')::date;
end $$;

create or replace function private.txn_date_is_future(p_user uuid, p_date date, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_date > private.local_day((select p.timezone from public.profiles p where p.id = p_user), p_at)
$$;

revoke all on function private.local_day(text, timestamptz) from public;
revoke all on function private.txn_date_is_future(uuid, date, timestamptz) from public;
grant execute on function private.local_day(text, timestamptz) to authenticated, service_role;
grant execute on function private.txn_date_is_future(uuid, date, timestamptz) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_transaction_essentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_account public.accounts%rowtype;
  v_category public.categories%rowtype;
  v_contact public.contact%rowtype;
  v_is_obligation boolean := new.type not in ('income', 'expense');
begin
  if new.amount is null or new.amount <= 0 then
    raise exception 'avora_txn_amount_positive';
  end if;

  if new.transaction_date is null then
    raise exception 'avora_txn_date_required';
  end if;
  -- KT-08 · QA05-01: "hôm nay" là ngày theo múi giờ hồ sơ của người dùng, không phải ngày UTC của máy chủ.
  if private.txn_date_is_future(new.user_id, new.transaction_date, now()) then
    raise exception 'avora_txn_date_future';
  end if;

  select * into v_account from public.accounts where id = new.account_id;
  if not found or v_account.user_id <> new.user_id then
    raise exception 'avora_txn_account_not_yours';
  end if;
  if v_account.deleted_at is not null and (tg_op = 'INSERT' or old.account_id <> new.account_id) then
    raise exception 'avora_txn_account_closed';
  end if;

  -- Thu/chi: hạng mục bắt buộc và phải khớp loại — y hệt trước.
  if not v_is_obligation then
    if new.category_id is null then
      raise exception 'avora_txn_category_required';
    end if;
    select * into v_category from public.categories where id = new.category_id;
    if not found or v_category.user_id <> new.user_id then
      raise exception 'avora_txn_category_not_yours';
    end if;
    if v_category.deleted_at is not null and (tg_op = 'INSERT' or old.category_id is distinct from new.category_id) then
      raise exception 'avora_txn_category_removed';
    end if;
    if v_category.applies_to::text <> new.type::text then
      raise exception 'avora_txn_category_type_mismatch';
    end if;
  else
    new.category_id := null;
  end if;

  -- Nghĩa vụ: phải có ngày đến hạn; vay/cho vay phải có đối tượng.
  if v_is_obligation then
    if new.due_date is null then
      raise exception 'avora_txn_due_date_required';
    end if;
    if new.type in ('vay', 'cho_vay') and new.contact_id is null then
      raise exception 'avora_txn_contact_required';
    end if;
    -- Trạng thái luôn được tính lại, không bao giờ nhận từ client: mặc định của cột là
    -- 'hoan_thanh' (đúng cho thu/chi), để nguyên thì một khoản vay mới sẽ hiện là đã trả xong.
    new.status := private.obligation_status(new.due_date, new.amount, new.amount_settled, current_date);
  else
    -- Thu/chi không có vòng đời: đã xảy ra rồi.
    new.contact_id := null;
    new.due_date := null;
    new.tax_period_start := null;
    new.tax_period_end := null;
    new.status := 'hoan_thanh';
    new.amount_settled := 0;
  end if;

  -- Đối tượng phải là liên hệ của chính người ghi sổ.
  if new.contact_id is not null then
    select * into v_contact from public.contact where id = new.contact_id;
    if not found or v_contact.owner_user_id <> new.user_id then
      raise exception 'avora_txn_contact_not_yours';
    end if;
  end if;

  if new.tax_period_start is not null and new.tax_period_end is not null
     and new.tax_period_start > new.tax_period_end then
    raise exception 'avora_txn_tax_period_invalid';
  end if;

  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.business_purpose := nullif(btrim(coalesce(new.business_purpose, '')), '');
  new.recurring_label := nullif(btrim(coalesce(new.recurring_label, '')), '');

  if not new.business_related then
    new.business_purpose := null;
  end if;
  if not new.is_recurring then
    new.recurring_frequency := null;
    new.recurring_label := null;
  end if;

  if new.description is not null and length(new.description) > 500 then
    raise exception 'avora_txn_description_max_len';
  end if;
  if new.business_purpose is not null and length(new.business_purpose) > 300 then
    raise exception 'avora_txn_purpose_max_len';
  end if;

  return new;
end $function$;

-- Ghi khoản chi đầu tiên: tạo ví "Tiền mặt" (nếu chưa có ví mở nào) và ghi khoản chi cùng một giao dịch.
create or replace function public.record_first_expense(
  p_category_id uuid,
  p_amount numeric,
  p_date date,
  p_description text default null,
  p_currency text default 'VND',
  p_wallet_name text default 'Tiền mặt'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_txn public.transactions%rowtype;
  v_created boolean := false;
begin
  if v_user is null then raise exception 'avora_not_signed_in'; end if;
  -- Có ví tiền mặt đang mở thì ghi vào đó; không thì tài khoản mở đầu tiên không phải nợ (như web).
  select a.* into v_account from public.accounts a
   where a.user_id = v_user and a.deleted_at is null and a.type::text = 'cash'
   order by a.created_at limit 1;
  if not found then
    insert into public.accounts (user_id, name, type, opening_balance, currency)
    values (v_user, coalesce(nullif(btrim(p_wallet_name), ''), 'Tiền mặt'), 'cash', 0, coalesce(nullif(btrim(p_currency), ''), 'VND'))
    returning * into v_account;
    v_created := true;
  end if;
  insert into public.transactions (user_id, account_id, category_id, type, amount, transaction_date, description)
  values (v_user, v_account.id, p_category_id, 'expense', p_amount, p_date, nullif(btrim(p_description), ''))
  returning * into v_txn;
  return jsonb_build_object('account', to_jsonb(v_account), 'transaction', to_jsonb(v_txn), 'created_wallet', v_created);
end $$;

revoke all on function public.record_first_expense(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.record_first_expense(uuid, numeric, date, text, text, text) to authenticated;
