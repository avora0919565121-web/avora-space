import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  centsToDecimalString,
  isObligationStatus,
  toCents,
  type Account,
  type AccountType,
  type Category,
  type CategoryScope,
  type ObligationType,
  type RecurringFrequency,
  type Transaction,
  type TransactionType,
} from "@/lib/finance";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];

export const financeKeys = {
  all: ["finance"] as const,
  accounts: ["finance", "accounts"] as const,
  categories: ["finance", "categories"] as const,
  transactions: ["finance", "transactions"] as const,
};

const RECEIPT_BUCKET = "receipts";

/** Maps Postgres and PostgREST failures on the finance tables to short Vietnamese sentences. */
export function toVietnameseFinanceError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("avora_account_name_required")) return "Tên tài khoản là bắt buộc.";
  if (normalized.includes("avora_account_name_max_len")) return "Tên tài khoản quá dài.";
  if (normalized.includes("avora_account_person_required"))
    return "Hãy ghi tên người đang giữ số tiền này.";
  if (normalized.includes("avora_account_currency_unsupported"))
    return "AVORA chưa hỗ trợ loại tiền này.";
  if (normalized.includes("avora_account_currency_locked"))
    return "Tài khoản đã có giao dịch nên không đổi được loại tiền.";
  if (normalized.includes("avora_currency_rate_missing"))
    return "Chưa có tỷ giá cho loại tiền này.";
  if (normalized.includes("avora_account_currency_mismatch"))
    return "Phase 4A chỉ hỗ trợ một loại tiền tệ. Hãy dùng cùng loại tiền với các tài khoản hiện có.";

  if (normalized.includes("avora_txn_amount_positive")) return "Số tiền phải lớn hơn 0.";
  if (normalized.includes("avora_txn_date_required")) return "Ngày giao dịch là bắt buộc.";
  if (normalized.includes("avora_txn_date_future")) return "Ngày giao dịch không thể ở tương lai.";
  if (normalized.includes("avora_txn_account_not_yours")) return "Tài khoản này không thuộc về bạn.";
  if (normalized.includes("avora_txn_account_closed")) return "Tài khoản này đã đóng, không ghi thêm được.";
  if (normalized.includes("avora_txn_category_not_yours")) return "Danh mục này không thuộc về bạn.";
  if (normalized.includes("avora_txn_category_removed")) return "Danh mục này đã bị xoá.";
  if (normalized.includes("avora_txn_category_type_mismatch"))
    return "Danh mục không khớp với loại giao dịch (thu hay chi).";
  if (normalized.includes("avora_txn_description_max_len")) return "Diễn giải quá dài.";
  if (normalized.includes("avora_txn_purpose_max_len")) return "Mục đích kinh doanh quá dài.";
  if (normalized.includes("avora_txn_category_required")) return "Hãy chọn danh mục.";

  if (normalized.includes("avora_txn_due_date_required")) return "Hãy chọn ngày đến hạn.";
  if (normalized.includes("avora_txn_contact_required"))
    return "Hãy chọn người vay hoặc người cho vay.";
  if (normalized.includes("avora_txn_contact_not_yours")) return "Liên hệ này không thuộc về bạn.";
  if (normalized.includes("avora_txn_type_not_obligation"))
    return "Loại giao dịch này không phải khoản vay hay thuế.";
  if (normalized.includes("avora_txn_not_an_obligation"))
    return "Chỉ khoản vay, cho vay hoặc thuế mới ghi nhận thanh toán.";
  if (normalized.includes("avora_txn_settle_over")) return "Số tiền trả vượt quá phần còn lại.";
  if (normalized.includes("avora_txn_settle_positive")) return "Số tiền trả phải lớn hơn 0.";
  if (normalized.includes("avora_txn_tax_period_invalid"))
    return "Kỳ thuế kết thúc trước khi bắt đầu.";
  if (normalized.includes("avora_txn_not_yours")) return "Khoản này không thuộc về bạn.";
  if (normalized.includes("avora_txn_voided"))
    return "Khoản này đã được đánh dấu nhầm nên không ghi thêm được.";

  if (normalized.includes("avora_category_name_required")) return "Tên danh mục là bắt buộc.";
  if (normalized.includes("avora_category_name_max_len")) return "Tên danh mục quá dài.";
  if (normalized.includes("avora_category_color_invalid")) return "Màu danh mục không hợp lệ.";
  if (normalized.includes("avora_category_in_use"))
    return "Danh mục này đã có giao dịch nên chỉ có thể ẩn đi, không xoá hẳn.";

  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";

  if (code === "23505" && normalized.includes("accounts_user_name_uniq"))
    return "Bạn đã có một tài khoản trùng tên.";
  if (code === "23505" && normalized.includes("categories_user_name_uniq")) return "Danh mục này đã có rồi.";
  if (code === "23505") return "Dữ liệu này đã tồn tại.";
  if (code === "23503") return "Không tìm thấy tài khoản hoặc danh mục liên quan.";
  if (code === "23514") return "Giá trị không hợp lệ. Hãy kiểm tra lại số tiền.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với dữ liệu này.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[finance] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseFinanceError(code, message));
}

// ---------------------------------------------------------------- mappers

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    openingBalanceCents: toCents(row.opening_balance),
    balanceCents: toCents(row.balance),
    currency: row.currency,
    otherPersonName: row.other_person_name,
    accountNumber: row.account_number,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    origin: row.type,
    appliesTo: row.applies_to,
    color: row.color,
    slug: row.slug,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    type: row.type,
    amountCents: toCents(row.amount),
    currency: row.currency ?? "USD",
    amountInBaseCents: row.amount_in_base_currency === null ? null : toCents(row.amount_in_base_currency),
    baseCurrency: row.base_currency,
    conversionRate: row.conversion_rate === null ? null : Number(row.conversion_rate),
    description: row.description,
    date: row.transaction_date,
    businessRelated: row.business_related,
    businessPurpose: row.business_purpose,
    receiptPath: row.receipt_url,
    isRecurring: row.is_recurring,
    recurringFrequency: row.recurring_frequency,
    recurringLabel: row.recurring_label,
    contactId: row.contact_id,
    dueDate: row.due_date,
    status: isObligationStatus(row.status) ? row.status : "hoan_thanh",
    settledCents: toCents(row.amount_settled),
    taxPeriodStart: row.tax_period_start,
    taxPeriodEnd: row.tax_period_end,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

// ---------------------------------------------------------------- accounts

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("deleted_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toAccount);
}

export type AccountDraft = {
  name: string;
  type: AccountType;
  openingBalanceCents: number;
  currency: string;
  otherPersonName: string | null;
  accountNumber: string | null;
  tags: string[];
};

export async function createAccount(userId: string, draft: AccountDraft): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: userId,
      name: draft.name,
      type: draft.type,
      opening_balance: draft.openingBalanceCents / 100,
      currency: draft.currency,
      other_person_name: draft.otherPersonName,
      account_number: draft.accountNumber,
      tags: draft.tags,
    })
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toAccount(data);
}

export async function updateAccount(accountId: string, draft: AccountDraft): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .update({
      name: draft.name,
      type: draft.type,
      opening_balance: draft.openingBalanceCents / 100,
      currency: draft.currency,
      other_person_name: draft.otherPersonName,
      account_number: draft.accountNumber,
      tags: draft.tags,
    })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toAccount(data);
}

/** Closing an account hides it from balances; its transactions stay in every report. */
export async function setAccountClosed(accountId: string, closed: boolean): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: closed ? new Date().toISOString() : null })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toAccount(data);
}

// ---------------------------------------------------------------- categories

/** Seeds the 18 defaults on first use and returns the whole vocabulary. Idempotent. */
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.rpc("ensure_default_categories");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toCategory);
}

export type CategoryDraft = {
  name: string;
  appliesTo: CategoryScope;
  color: string;
};

export async function createCategory(userId: string, draft: CategoryDraft): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      name: draft.name,
      type: "custom",
      applies_to: draft.appliesTo,
      color: draft.color,
      sort_order: 1000,
    })
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toCategory(data);
}

export async function updateCategory(categoryId: string, draft: CategoryDraft): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .update({ name: draft.name, applies_to: draft.appliesTo, color: draft.color })
    .eq("id", categoryId)
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toCategory(data);
}

/**
 * Removes a custom category outright when nothing references it, and retires it otherwise —
 * history must keep reading back exactly as it was entered.
 */
export async function deleteCategory(categoryId: string): Promise<{ retired: boolean }> {
  const { count, error: countError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  if (countError) throw fail(countError.code, countError.message);

  if ((count ?? 0) > 0) {
    const { error } = await supabase
      .from("categories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", categoryId);
    if (error) throw fail(error.code, error.message);
    return { retired: true };
  }

  const { error } = await supabase.from("categories").delete().eq("id", categoryId);
  if (error) throw fail(error.code, error.message);
  return { retired: false };
}

// ---------------------------------------------------------------- transactions

export async function fetchTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toTransaction);
}

export type TransactionInput = {
  type: TransactionType;
  accountId: string;
  categoryId: string;
  amountCents: number;
  date: string;
  description: string | null;
  businessRelated: boolean;
  businessPurpose: string | null;
  receiptPath: string | null;
  isRecurring: boolean;
  recurringFrequency: RecurringFrequency | null;
  recurringLabel: string | null;
};

export async function createTransaction(userId: string, input: TransactionInput): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      account_id: input.accountId,
      category_id: input.categoryId,
      type: input.type,
      amount: input.amountCents / 100,
      transaction_date: input.date,
      description: input.description,
      business_related: input.businessRelated,
      business_purpose: input.businessPurpose,
      receipt_url: input.receiptPath,
      is_recurring: input.isRecurring,
      recurring_frequency: input.isRecurring ? input.recurringFrequency : null,
      recurring_label: input.isRecurring ? input.recurringLabel : null,
    })
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toTransaction(data);
}

export async function updateTransaction(transactionId: string, input: TransactionInput): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .update({
      account_id: input.accountId,
      category_id: input.categoryId,
      type: input.type,
      amount: input.amountCents / 100,
      transaction_date: input.date,
      description: input.description,
      business_related: input.businessRelated,
      business_purpose: input.businessPurpose,
      receipt_url: input.receiptPath,
      is_recurring: input.isRecurring,
      recurring_frequency: input.isRecurring ? input.recurringFrequency : null,
      recurring_label: input.isRecurring ? input.recurringLabel : null,
    })
    .eq("id", transactionId)
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toTransaction(data);
}

export type ObligationInput = {
  type: ObligationType;
  accountId: string;
  amountCents: number;
  dueDate: string;
  contactId: string | null;
  description: string | null;
  taxPeriodStart: string | null;
  taxPeriodEnd: string | null;
  businessRelated: boolean;
};

/**
 * Records a borrowing, a loan out, or a tax bill. Goes through an RPC rather than a plain
 * insert because which fields are required depends on the type, and because the row's owner
 * must come from the session rather than from the browser.
 */
export async function createObligation(input: ObligationInput): Promise<Transaction> {
  const { data, error } = await supabase
    .rpc("create_obligation_transaction", {
      p_type: input.type,
      p_account_id: input.accountId,
      p_amount: Number(centsToDecimalString(input.amountCents)),
      p_due_date: input.dueDate,
      p_contact_id: input.contactId,
      p_description: input.description,
      p_tax_period_start: input.taxPeriodStart,
      p_tax_period_end: input.taxPeriodEnd,
      p_business_related: input.businessRelated,
    })
    .single();
  if (error) throw fail(error.code, error.message);
  return toTransaction(data as TransactionRow);
}

/**
 * Records a payment against an obligation. The original amount is never rewritten — losing
 * it would lose the history of what was actually agreed.
 */
export async function settleObligation(transactionId: string, amountCents: number): Promise<Transaction> {
  const { data, error } = await supabase
    .rpc("settle_transaction", {
      p_transaction_id: transactionId,
      p_amount: Number(centsToDecimalString(amountCents)),
    })
    .single();
  if (error) throw fail(error.code, error.message);
  return toTransaction(data as TransactionRow);
}

/**
 * Marking an entry as an error keeps the row and takes it out of every total. Nothing is
 * erased: a ledger that can quietly lose a line cannot be audited.
 */
export async function setTransactionVoided(transactionId: string, voided: boolean): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .update({ deleted_at: voided ? new Date().toISOString() : null })
    .eq("id", transactionId)
    .select("*")
    .single();
  if (error) throw fail(error.code, error.message);
  return toTransaction(data);
}

// ---------------------------------------------------------------- receipts

/** Uploads to `{userId}/{uuid}.{ext}` — the folder is what storage RLS checks. */
export async function uploadReceipt(userId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "bin";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw fail(undefined, error.message);
  return path;
}

export async function receiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 600);
  if (error) {
    console.error(`[finance] receipt url: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

export async function removeReceipt(path: string): Promise<void> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) console.error(`[finance] receipt remove: ${error.message}`);
}
