import { readFileSync } from "node:fs";
import { join } from "node:path";

import { twMerge } from "tailwind-merge";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { selectClass } from "@/components/finance/primitives";
import { amountForValidation, amountPlaceholder, amountShown, amountTyped, missingLine as moneyMissingLine } from "@/lib/contact-picker";
import { validateAmount, validateOpeningBalance } from "@/lib/finance";
import { missingLine } from "@/lib/task-composer";
import { createdTaskHome } from "@/lib/task-hub";
import { isStartSettled } from "@/lib/welcome";

/*
 * KT-05 · sửa báo cáo QA-02 (Rà soát độ chỉn chu) — phần thuần và phần đọc mã nguồn, mỗi khối một mã.
 */
const src = (path: string): string => readFileSync(join(__dirname, "..", path), "utf8");

describe("CC-01 · nút + không có menu là nút thường, không bị vô hiệu", () => {
  it("PlusMenuButton không còn gắn `disabled` lên trigger khi không có menu", () => {
    const code = src("components/PlusMenuButton.tsx");
    expect(code).not.toMatch(/DropdownMenuTrigger asChild disabled/);
    expect(code).toMatch(/hasMenu \? \(/);
  });
});

describe("CC-02 · Avora Space chờ biết thẻ Bắt đầu rồi mới vẽ các khối dưới", () => {
  const known = { conversations: true, tasks: true, pin: true, habits: true };
  it("đủ cả bốn → đã biết", () => {
    expect(isStartSettled(known, [])).toBe(true);
  });
  it("thiếu tin nhắn, nhiệm vụ hay PIN → chưa biết", () => {
    expect(isStartSettled({ ...known, conversations: false }, [])).toBe(false);
    expect(isStartSettled({ ...known, tasks: false }, [])).toBe(false);
    expect(isStartSettled({ ...known, pin: false }, [])).toBe(false);
  });
  it("Thói quen chỉ phải chờ khi người dùng đã chọn bước đó", () => {
    expect(isStartSettled({ ...known, habits: false }, [])).toBe(true);
    expect(isStartSettled({ ...known, habits: false }, ["self"])).toBe(false);
  });
});

describe("CC-04 · toast và tấm hỏi máy chính nằm trên thanh dưới", () => {
  it("có biến --above-tool-belt, Toaster và tấm hỏi đều dùng", () => {
    expect(src("index.css")).toMatch(/html\[data-tool-belt\]:not\(\[data-covers-tool-belt\]\) \{\n\s+--above-tool-belt: calc\(61px \+ max\(env\(safe-area-inset-bottom\), 10px\)\)/);
    expect(src("components/nav/ToolBelt.tsx")).toContain('setAttribute("data-tool-belt", "")');
    expect(src("components/ui/sonner.tsx")).toMatch(/mobileOffset=\{\{ bottom: "var\(--above-tool-belt\)" \}\}/);
    expect(src("components/DeviceSecurity.tsx")).toMatch(/bottom-\[var\(--above-tool-belt\)\]/);
  });
});

describe("CC-05 · việc vừa tạo đi đâu", () => {
  const today = "2026-11-12";
  it("đang ở Hôm nay, hạn ngày mai → Sắp tới, có ngày", () => {
    expect(createdTaskHome({ deadline: "2026-11-13", startAt: null, myDay: false }, "my_day", today)).toEqual({
      section: "upcoming",
      label: "Sắp tới",
      text: "Đã thêm vào Sắp tới · T6 13/11",
    });
  });
  it("hạn hôm nay hoặc đã đặt vào Hôm nay → hiện ngay ở Hôm nay, không cần nói thêm", () => {
    expect(createdTaskHome({ deadline: today, startAt: null, myDay: false }, "my_day", today)).toBeNull();
    expect(createdTaskHome({ deadline: "2026-11-20", startAt: null, myDay: true }, "my_day", today)).toBeNull();
  });
  it("xa hơn 7 ngày → Tất cả; đang ở Tất cả hay Lịch → không cần nói", () => {
    expect(createdTaskHome({ deadline: "2026-12-20", startAt: null, myDay: false }, "my_day", today)?.text).toBe("Đã thêm vào Tất cả · CN 20/12");
    expect(createdTaskHome({ deadline: "2026-12-20", startAt: null, myDay: false }, "tasks", today)).toBeNull();
    expect(createdTaskHome({ deadline: "2026-12-20", startAt: null, myDay: false }, "calendar", today)).toBeNull();
  });
  it("Giao dịch: dòng vừa ghi được soi sáng (spotlight theo data-entry-id)", () => {
    const code = src("pages/FinanceTransactions.tsx");
    expect(code).toMatch(/spotlight\("data-entry-id", saved\.id/);
    expect(code).toMatch(/data-entry-id=\{entry\.id\}/);
  });
});

describe("CC-06 · ô chọn giữ nền bg-card", () => {
  it("twMerge không còn xoá bg-card", () => {
    expect(twMerge(selectClass).split(" ")).toContain("bg-card");
    expect(twMerge(`${selectClass} mt-1.5`).split(" ")).toContain("bg-card");
  });
  it("Tuỳ chọn chung dùng cùng selectClass", () => {
    expect(src("pages/SettingsPreferences.tsx")).toMatch(/cn\(selectClass/);
  });
});

describe("CC-07 · ô Báo cáo không tràn thẻ", () => {
  it("lưới có grid-cols-1 và min-w-0 cho ô con", () => {
    expect(src("pages/FinanceReports.tsx")).toMatch(/grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2 lg:grid-cols-4 \[&>\*\]:min-w-0/);
  });
});

describe("CC-08 · 'Còn thiếu…' chỉ sau khi người dùng đã bắt đầu", () => {
  it("biểu mẫu vừa mở → không nói gì; đã bắt đầu → nói", () => {
    expect(missingLine(["tên việc"], false)).toBeNull();
    expect(missingLine(["tên việc"], true)).toBe("Còn thiếu: tên việc");
    expect(moneyMissingLine(["Số tiền"], false)).toBeNull();
    expect(moneyMissingLine(["Số tiền"])).toBe("Còn thiếu: Số tiền");
  });
});

describe("CC-11 · logo sáng cho giao diện tối", () => {
  it("có file logo mới (đổi tên, không ghi đè) và Đăng nhập dùng nó khi tối", () => {
    expect(() => readFileSync(join(__dirname, "..", "..", "public", "avora-logo-full-v2-dark.png"))).not.toThrow();
    expect(src("pages/Auth.tsx")).toMatch(/avora-logo-full-v2-dark\.png[\s\S]*dark:block/);
  });
});

describe("CC-17 · lời chữ", () => {
  it("b · VND hiện 45.000 khi gõ, vẫn lưu số trơn; gợi ý 0", () => {
    expect(amountShown("45000", "VND")).toBe("45.000");
    expect(amountShown("45000.00", "VND")).toBe("45.000");
    expect(amountTyped("45.0001", "VND")).toBe("450001");
    expect(amountTyped("-1.500", "VND", true)).toBe("-1500");
    expect(amountTyped("-1.500", "VND")).toBe("1500");
    expect(validateAmount(amountTyped("45.000", "VND")).cents).toBe(4_500_000);
    expect(validateOpeningBalance(amountTyped("-1.500", "VND", true)).cents).toBe(-150_000);
    expect(amountPlaceholder("VND")).toBe("0");
    expect(amountPlaceholder("USD")).toBe("0.00");
    expect(amountShown("12.5", "USD")).toBe("12.5");
    expect(amountForValidation("45.000", "VND")).toBe("45000");
  });
  it("c · ngày cập nhật chính sách theo kiểu Việt", () => {
    expect(src("components/PolicyView.tsx")).toMatch(/Cập nhật lần cuối: \{viDate\(POLICY_VERSION\)\}/);
  });
  it("d · tiêu đề Đặt lại mật khẩu không có dấu chấm", () => {
    expect(src("pages/ResetPassword.tsx")).not.toMatch(/Đặt lại mật khẩu\.\n/);
  });
  it("e · giữ đúng chữ menu iOS trong ngoặc", () => {
    expect(src("components/DeviceSecurity.tsx")).toContain("(Chia sẻ › “Thêm vào MH chính”)");
  });
  it("f · chip Chỉ tôi dùng biểu tượng một người", () => {
    expect(src("components/tasks/TaskCard.tsx")).toMatch(/<User className="h-4 w-4" strokeWidth=\{1\.8\} aria-hidden="true" \/>\} label="Chỉ tôi"/);
  });
  it("g · điện thoại 'Chạm', máy tính 'Bấm'", () => {
    const code = src("components/tasks/TaskHubSectionView.tsx");
    expect(code).toContain('<span className="md:hidden">Chạm</span>');
    expect(code).toContain('<span className="hidden md:inline">Bấm</span>');
  });
  it("h · mỗi con số nói đơn vị", () => {
    expect(src("components/habits/HabitsSection.tsx")).toContain("Hôm nay · {tallyText(summary)} thói quen");
    expect(src("components/habits/HabitRow.tsx")).toContain("Hôm nay {tallyText(day)} lần · Tuần này {tallyText(week)} ngày");
  });
  it("i · Danh sách bảng", () => {
    expect(src("components/projects/ProjectList.tsx")).toContain('label="Danh sách bảng"');
  });
  it("j · một tên Tạo nhiệm vụ từ tấm nhanh tới thẻ đầy đủ", () => {
    expect(src("components/tasks/TaskCard.tsx")).not.toContain('backLabel="Nhiệm vụ mới"');
  });
  it("k · Nhật ký trống ấm hơn", () => {
    expect(src("pages/Messages.tsx")).toContain("Nhật ký còn trống. Bạn viết một dòng về hôm nay nhé — chỉ mình bạn đọc.");
  });
  it("a · Giao dịch trống nói đúng chỗ biểu mẫu", () => {
    expect(src("pages/FinanceTransactions.tsx")).toContain('isSideBySide ? "bên cạnh" : "phía trên"');
  });
});

describe("CC-21 · nút + ở Thói quen nói đúng việc nó làm", () => {
  it("nhãn theo tab con", () => {
    expect(src("pages/Tasks.tsx")).toContain('label={hubSection.id === "habits" ? "Tạo thói quen" : "Thêm nhiệm vụ"}');
  });
});

describe("CC-23 · chân hộp Tài khoản mới dính đáy", () => {
  it("nút Huỷ / Tạo tài khoản ở thanh dính", () => {
    expect(src("components/finance/dialogs.tsx")).toMatch(/data-dialog-footer="" className="sticky -bottom-6/);
  });
});
