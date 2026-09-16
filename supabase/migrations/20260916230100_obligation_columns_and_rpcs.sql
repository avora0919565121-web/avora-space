-- AVORA — Finance v3 giai đoạn 1 (phần 2): cột, ràng buộc theo loại, RPC.
--
-- Bốn loại nghĩa vụ (vay / cho_vay / thue_ca_nhan / thue_kinh_doanh) sống chung bảng
-- transactions với thu/chi. Không tạo bảng song song.
--
-- Hai điều chỉnh bắt buộc mà spec không lường trước, phát hiện khi dò schema thật:
--   1. enforce_transaction_essentials ép applies_to = type. category_scope chỉ có
--      income|expense nên KHÔNG hạng mục nào hợp lệ với 4 loại mới → không insert nổi.
--      Nghĩa vụ là khoản mục bảng cân đối, không phải dòng lãi/lỗ, nên nó mang
--      category_id NULL và ràng buộc hạng mục chỉ còn áp cho thu/chi.
--   2. recompute_account_state cộng income, trừ MỌI loại khác. Nếu để nguyên, tiền vay
--      nhận về sẽ bị trừ khỏi số dư. Dấu giờ khai báo theo từng loại.

-- ---------------------------------------------------------------- cột

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contact(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'hoan_thanh',
  ADD COLUMN IF NOT EXISTS amount_settled numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_period_start date,
  ADD COLUMN IF NOT EXISTS tax_period_end date;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('ke_hoach', 'den_han', 'hoan_thanh_mot_phan', 'hoan_thanh', 'qua_han'));

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_settled_range;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_settled_range
  CHECK (amount_settled >= 0 AND amount_settled <= amount);

-- Hạng mục: bắt buộc với thu/chi, và phải vắng mặt ở nghĩa vụ. Một khoản vay lọt vào
-- hạng mục chi tiêu sẽ hiện ra trong báo cáo chi tiêu như thể đã tiêu mất.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_by_type;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_by_type
  CHECK (
    (type IN ('income', 'expense') AND category_id IS NOT NULL)
    OR (type NOT IN ('income', 'expense') AND category_id IS NULL)
  );

ALTER TABLE public.transactions ALTER COLUMN category_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_contact_idx
  ON public.transactions (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_due_idx
  ON public.transactions (user_id, due_date) WHERE due_date IS NOT NULL;

-- Quyền theo CỘT: bảng này cấp quyền từng cột một, nên cột mới không tự thừa hưởng.
GRANT SELECT (contact_id, due_date, status, amount_settled, tax_period_start, tax_period_end)
  ON public.transactions TO authenticated;

-- ---------------------------------------------------------------- dấu theo loại

/**
 * Một khoản đóng góp bao nhiêu vào số dư tài khoản.
 * Vay: tiền về tay (+). Cho vay: tiền rời đi (−). Thuế: tiền phải nộp (−).
 */
CREATE OR REPLACE FUNCTION private.transaction_signed_amount(
  p_type public.transaction_type,
  p_amount numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE p_type
           WHEN 'income'  THEN p_amount
           WHEN 'vay'     THEN p_amount
           ELSE -p_amount
         END;
$$;

REVOKE EXECUTE ON FUNCTION private.transaction_signed_amount(public.transaction_type, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.transaction_signed_amount(public.transaction_type, numeric) TO authenticated;

/**
 * Trạng thái của một nghĩa vụ, suy ra từ sự thật chứ không phải do client khai.
 * Quá hạn xếp trên trả-một-phần: trả được một nửa mà đã quá ngày thì việc cần làm
 * vẫn là "quá hạn"; phần đã trả vẫn đọc được ở amount_settled.
 *
 * Đây là hàm DUY NHẤT quyết định trạng thái — không có đường nào đặt status bằng tay.
 */
CREATE OR REPLACE FUNCTION private.obligation_status(
  p_due_date date,
  p_amount numeric,
  p_settled numeric,
  p_today date
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
           WHEN p_settled >= p_amount THEN 'hoan_thanh'
           WHEN p_due_date < p_today  THEN 'qua_han'
           WHEN p_settled > 0         THEN 'hoan_thanh_mot_phan'
           WHEN p_due_date = p_today  THEN 'den_han'
           ELSE 'ke_hoach'
         END;
$$;

REVOKE EXECUTE ON FUNCTION private.obligation_status(date, numeric, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.obligation_status(date, numeric, numeric, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.recompute_account_state(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        where t.account_id = a.id and t.deleted_at is null
      ), 0)
  where a.id = p_account_id;

  delete from public.account_balance_history where account_id = p_account_id;

  select min(transaction_date) into v_first
  from public.transactions where account_id = p_account_id and deleted_at is null;

  insert into public.account_balance_history (account_id, balance_date, balance)
  values (p_account_id, least(v_created, coalesce(v_first, v_created) - 1), v_opening);

  insert into public.account_balance_history (account_id, balance_date, balance)
  select p_account_id, x.d,
         v_opening + sum(x.delta) over (order by x.d rows between unbounded preceding and current row)
  from (
    select t.transaction_date as d,
           sum(private.transaction_signed_amount(t.type, t.amount)) as delta
    from public.transactions t
    where t.account_id = p_account_id and t.deleted_at is null
    group by t.transaction_date
  ) x
  on conflict (account_id, balance_date) do update set balance = excluded.balance;
end $function$;

-- ---------------------------------------------------------------- ràng buộc theo loại

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
  if new.transaction_date > current_date then
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

-- ---------------------------------------------------------------- RPC

/**
 * Ghi một khoản nghĩa vụ. Đường cũ của thu/chi (insert thẳng qua PostgREST) không đổi.
 * user_id luôn lấy từ auth.uid(), không nhận từ client.
 */
CREATE OR REPLACE FUNCTION public.create_obligation_transaction(
  p_type public.transaction_type,
  p_account_id uuid,
  p_amount numeric,
  p_due_date date,
  p_contact_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_transaction_date date DEFAULT NULL,
  p_tax_period_start date DEFAULT NULL,
  p_tax_period_end date DEFAULT NULL,
  p_business_related boolean DEFAULT false
) RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
begin
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

REVOKE EXECUTE ON FUNCTION public.create_obligation_transaction(
  public.transaction_type, uuid, numeric, date, uuid, text, date, date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_obligation_transaction(
  public.transaction_type, uuid, numeric, date, uuid, text, date, date, date, boolean) TO authenticated;

/**
 * Trả một phần (hoặc nốt) một khoản nghĩa vụ. `amount` gốc không bao giờ bị sửa —
 * mất giá trị ban đầu là mất lịch sử. p_amount là số trả THÊM lần này.
 */
CREATE OR REPLACE FUNCTION public.settle_transaction(
  p_transaction_id uuid,
  p_amount numeric
) RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.transactions%rowtype;
  v_next numeric(14,2);
begin
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

REVOKE EXECUTE ON FUNCTION public.settle_transaction(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_transaction(uuid, numeric) TO authenticated;
