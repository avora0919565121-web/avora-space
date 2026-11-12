import { addMonths, monthKey, todayIso, type Account, type Category, type Transaction, type TransactionType } from "@/lib/finance";

/**
 * KT-07c (CEO 12/11 · 17, SP-04 §2): "Ba tháng của một gia đình" — the sample book of Tài chính,
 * static inside the app. It is never written to the database, so it can never be added to real
 * figures, reports, exports or reminders. Every screen reads it through the same pure functions as
 * a real book (`buildLedger`, `spendingTrend`, …), so every chart has a shape. Dates are worked out
 * from `today` each time, so the book is always "the last three months" and never in the future.
 *
 * No sample contact is created: "Minh (mẫu)" / "anh Hai (mẫu)" are only words on the sample rows.
 */

const CAT: readonly [string, string, "income" | "expense", string, number][] = [
  ["salary", "Lương", "income", "#3F8F6B", 10],
  ["freelance", "Làm tự do", "income", "#C98A3E", 40],
  ["other_income", "Thu nhập khác", "income", "#6B635A", 60],
  ["groceries", "Tạp hoá", "expense", "#E0603C", 10],
  ["dining", "Ăn uống", "expense", "#D68A6F", 20],
  ["transport", "Đi lại", "expense", "#5B7B8A", 30],
  ["healthcare", "Y tế", "expense", "#C0492A", 40],
  ["education", "Giáo dục", "expense", "#7D8A4F", 50],
  ["giving", "Từ thiện", "expense", "#6FA98B", 70],
  ["business", "Kinh doanh", "expense", "#C98A3E", 100],
  ["personal", "Cá nhân", "expense", "#A8926F", 110],
  ["utilities", "Điện nước", "expense", "#4E6E7D", 115],
  ["occasions", "Hiếu hỉ", "expense", "#8C6A4A", 118],
];

const ACCOUNTS: readonly [string, string, Account["type"], number, string | null][] = [
  ["cash", "Ví tiền mặt", "cash", 3_000_000, null],
  ["bank", "Tài khoản ngân hàng", "checking", 10_000_000, null],
  ["card", "Thẻ tín dụng", "credit_card", 0, null],
  ["saving", "Sổ tiết kiệm 6 tháng", "savings", 50_000_000, null],
  ["fund", "Chứng chỉ quỹ", "investment", 15_000_000, null],
  ["mom", "Tiền mẹ giữ hộ", "other_person_holding", 10_000_000, "Mẹ (mẫu)"],
];

/** [description, type, category, account, day of month, M−2, M−1, M, business, recurring] */
const ROWS: readonly [string, "income" | "expense", string, string, number, number, number, number, boolean, boolean][] = [
  ["Lương tháng", "income", "salary", "bank", 5, 18_000_000, 18_000_000, 18_000_000, false, true],
  ["Bán bánh cuối tuần", "income", "freelance", "cash", 20, 2_400_000, 2_800_000, 3_100_000, true, false],
  ["Lãi tiết kiệm", "income", "other_income", "saving", 25, 210_000, 210_000, 210_000, false, false],
  ["Nguyên liệu làm bánh", "expense", "business", "cash", 18, 900_000, 1_000_000, 1_100_000, true, false],
  ["Đi chợ nửa đầu tháng (chuyển khoản QR)", "expense", "groceries", "bank", 7, 2_300_000, 2_500_000, 2_100_000, false, false],
  ["Đi chợ nửa cuối tháng", "expense", "groceries", "bank", 21, 2_300_000, 2_600_000, 2_200_000, false, false],
  ["Ăn tối cả nhà", "expense", "dining", "card", 14, 1_200_000, 1_800_000, 900_000, false, false],
  ["Tiền điện", "expense", "utilities", "bank", 10, 850_000, 1_020_000, 920_000, false, true],
  ["Tiền nước", "expense", "utilities", "bank", 10, 200_000, 210_000, 200_000, false, true],
  ["Xăng xe", "expense", "transport", "cash", 3, 600_000, 650_000, 600_000, false, false],
  ["Học phí của con", "expense", "education", "bank", 6, 2_500_000, 2_500_000, 2_500_000, false, true],
  ["Khám bệnh, thuốc", "expense", "healthcare", "cash", 16, 0, 850_000, 400_000, false, false],
  ["Mừng cưới / phúng viếng", "expense", "occasions", "cash", 12, 500_000, 1_000_000, 0, false, false],
  ["Góp quỹ thiện nguyện", "expense", "giving", "bank", 8, 1_100_000, 1_100_000, 1_100_000, false, true],
  ["Mua sắm cá nhân", "expense", "personal", "card", 22, 0, 1_500_000, 650_000, false, false],
];

export const SAMPLE_PREFIX = "sample:";

export function isSampleId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SAMPLE_PREFIX);
}

function dayIn(month: string, day: number): string {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(year, m, 0).getDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

export type SampleBook = { accounts: Account[]; categories: Category[]; transactions: Transaction[] };

export function buildSampleBook(today: string = todayIso(), currency: string = "VND"): SampleBook {
  const thisMonth = monthKey(today);
  const months = [addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth];
  const created = `${months[0]}-01T00:00:00.000Z`;

  const categories: Category[] = CAT.map(([slug, name, scope, color, sort]) => ({
    id: `${SAMPLE_PREFIX}cat.${slug}`, name, origin: "predefined", appliesTo: scope, color, slug, sortOrder: sort, deletedAt: null,
  }));

  const transactions: Transaction[] = [];
  const tx = (id: string, type: TransactionType, account: string, cents: number, date: string, description: string, extra: Partial<Transaction> = {}): void => {
    transactions.push({
      id: `${SAMPLE_PREFIX}tx.${id}`,
      accountId: `${SAMPLE_PREFIX}acc.${account}`,
      categoryId: null,
      type,
      amountCents: cents * 100,
      currency,
      amountInBaseCents: cents * 100,
      baseCurrency: currency,
      conversionRate: 1,
      description,
      date,
      businessRelated: false,
      businessPurpose: null,
      receiptPath: null,
      isRecurring: false,
      recurringFrequency: null,
      recurringLabel: null,
      contactId: null,
      dueDate: null,
      status: "hoan_thanh",
      settledCents: 0,
      taxPeriodStart: null,
      taxPeriodEnd: null,
      createdAt: created,
      deletedAt: null,
      ...extra,
    });
  };

  ROWS.forEach(([description, type, category, account, day, ...rest], row) => {
    const [a, b, c, business, recurring] = rest as [number, number, number, boolean, boolean];
    [a, b, c].forEach((amount, index) => {
      if (amount === 0) return;
      const month = months[index];
      let date = dayIn(month, day);
      // This month: never a day in the future — a row past today takes today.
      if (date > today) date = today;
      tx(`${row}.${index}`, type, account, amount, date, `${description} (mẫu)`, {
        categoryId: `${SAMPLE_PREFIX}cat.${category}`,
        businessRelated: business,
        businessPurpose: business ? "Bán bánh cuối tuần" : null,
        isRecurring: recurring,
        recurringFrequency: recurring ? "monthly" : null,
        recurringLabel: recurring ? description : null,
      });
    });
  });

  // Vay · Cho vay · Thuế (SP-04 §2.4): names live only on these rows — no contact is created.
  tx("vay", "vay", "bank", 10_000_000, dayIn(months[0], 8), "Vay anh Hai (mẫu) sửa bếp", { dueDate: shiftDays(today, 60), status: "hoan_thanh_mot_phan", settledCents: 4_000_000 * 100 });
  tx("chovay", "cho_vay", "bank", 3_000_000, dayIn(months[1], 12), "Cho Minh (mẫu) mượn sửa xe", { dueDate: shiftDays(today, 30), status: "hoan_thanh_mot_phan", settledCents: 1_000_000 * 100 });
  tx("thue", "thue_ca_nhan", "bank", 1_200_000, shiftDays(today, -3), "Thuế TNCN quyết toán (mẫu)", { dueDate: shiftDays(today, 5), status: "den_han", settledCents: 0 });

  const accounts: Account[] = ACCOUNTS.map(([key, name, type, opening, other]) => {
    const id = `${SAMPLE_PREFIX}acc.${key}`;
    const moved = transactions
      .filter((entry) => entry.accountId === id)
      .reduce((sum, entry) => {
        if (entry.type === "income" || entry.type === "vay") return sum + entry.amountCents;
        if (entry.type === "expense" || entry.type === "cho_vay") return sum - entry.amountCents;
        return sum;
      }, 0);
    return {
      id, name, type, openingBalanceCents: opening * 100, balanceCents: opening * 100 + moved, currency,
      otherPersonName: other, accountNumber: null, tags: [], createdAt: created, deletedAt: null,
    };
  });

  return { accounts, categories, transactions };
}
