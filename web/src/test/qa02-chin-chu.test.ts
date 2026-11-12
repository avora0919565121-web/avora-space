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

/* ------------------------------------------------------------------ Đợt 2 */

import { CHIP_ON, CHIP_ON_PLAIN, chipTone } from "@/lib/chip";
import { emptyPaneCopy } from "@/lib/chat-cache";
import { chunkFaultCopy, isChunkLoadError, roomNameOf } from "@/lib/lazy-retry";
import { subPageTitle } from "@/lib/navigation";
import { COMPOSER_OFFLINE, COMPOSER_SLOW_MS } from "@/lib/task-composer";
import { TYPE } from "@/lib/type-scale";

describe("CC-03 · Thư phòng vẽ khung trước, mỗi phần giữ chỗ riêng", () => {
  it("khi chờ dữ liệu bảng: vẫn có tiêu đề + dải Đọc · Ghi chép · Kế hoạch; Ghi chép vẽ thật", () => {
    const code = src("pages/ThinkHub.tsx");
    expect(code).toMatch(/data-room-pending=""[\s\S]{0,200}<HubTitle title="Thư phòng" \/>[\s\S]{0,120}<StudyStrip/);
    expect(code).toMatch(/data-room-pending[\s\S]*studyPart === "ghi" \? \([\s\S]{0,200}<DiaryShelf \/>/);
  });
  it("Thời gian đọc giữ chỗ khi đang tải, không còn trả null rồi chen vào", () => {
    expect(src("components/library/RoomStats.tsx")).toContain('data-reading-time-pending=""');
  });
});

describe("CC-09 · mất mạng mở phòng chưa tải: nói đúng nguyên nhân", () => {
  it("nhận ra lỗi tải đoạn mã", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/ThinkHub.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError("x")).toBe(false);
  });
  it("lời theo phòng và theo mạng", () => {
    expect(roomNameOf("/ke-hoach")).toBe("Thư phòng");
    expect(roomNameOf("/ket-sat/giao-dich")).toBe("Két sắt");
    expect(chunkFaultCopy("/ke-hoach", false)).toEqual({ title: "Cần có mạng để mở Thư phòng lần đầu", body: "AVORA sẽ tự mở lại khi có mạng." });
    expect(chunkFaultCopy("/ket-sat", true).title).toBe("Chưa tải được Két sắt");
  });
  it("mọi trang lười tải trong App dùng lazyRetry (thử lại được sau khi có mạng)", () => {
    const app = src("App.tsx");
    expect(app).not.toMatch(/= lazy\(/);
    expect(app).toMatch(/const ThinkHub = lazyRetry\(/);
    expect(app).toMatch(/const Vault = lazyRetry\(/);
  });
});

describe("CC-10 · Nhiệm vụ khi mất mạng; Kết nối có dải Ngoại tuyến", () => {
  it("báo ngay khi ngoại tuyến, báo chậm sau 5 giây", () => {
    expect(COMPOSER_OFFLINE).toContain("ngoại tuyến");
    expect(COMPOSER_SLOW_MS).toBe(5000);
  });
  it("dải Ngoại tuyến chỉ nhường chỗ trong một cuộc trò chuyện đang mở", () => {
    expect(src("components/OfflineNotice.tsx")).toContain("/^\\/tin-nhan\\/[^/]+/.test(location.pathname)");
  });
});

describe("CC-12 · Liên hệ dùng khung trang chung", () => {
  it("thanh trên: ‹ Kết nối · Liên hệ", () => {
    expect(subPageTitle("/lien-he")).toBe("Liên hệ");
    expect(subPageTitle("/lien-he/abc")).toBeNull();
    expect(subPageTitle("/nhiem-vu")).toBeNull();
  });
  it("HubTitle + nút + trên thanh; chip một dòng", () => {
    const code = src("pages/Contacts.tsx");
    expect(code).toContain('<HubTitle\n        title="Liên hệ"');
    expect(code).toContain('<PlusMenuButton label="Thêm liên hệ"');
    expect(code).toContain('data-contact-groups="" className="flex gap-1 overflow-x-auto whitespace-nowrap');
    expect(code).not.toContain("Liên hệ của riêng bạn");
  });
});

describe("CC-13 · một kiểu chip được chọn", () => {
  it("token chung là nền cam nhạt, chữ cam, viền cam", () => {
    expect(CHIP_ON).toBe("border-personal bg-personal-soft text-personal-soft-foreground");
    expect(CHIP_ON_PLAIN).toBe("bg-personal-soft text-personal-soft-foreground");
    expect(chipTone(false)).toContain("border-border");
  });
  it("không còn chip chọn đen đặc / cam đặc ở các chỗ báo cáo nêu", () => {
    for (const file of [
      "components/KeepsakeSheet.tsx",
      "components/think-hub/overview/OverviewToggle.tsx",
      "components/think-hub/OpportunityBoard.tsx",
      "components/tasks/CalendarPeekSheet.tsx",
      "components/library/BookshelfPanel.tsx",
      "components/library/ChildrenShelf.tsx",
      "components/feedback/FeedbackForm.tsx",
      "components/finance/dialogs.tsx",
      "components/vault/VaultSetup.tsx",
      "components/vault/VaultCompartment.tsx",
      "components/habits/HabitEditor.tsx",
      "components/PolicyView.tsx",
      "components/chat/DiaryViews.tsx",
      "pages/Contacts.tsx",
    ]) {
      const code = src(file);
      expect(code, file).not.toMatch(/\? "(border-foreground )?bg-foreground text-background"/);
      expect(code, file).not.toMatch(/\? "border-primary bg-primary text-primary-foreground"/);
      expect(code, file).not.toMatch(/\? "bg-accent\/70 text-accent-foreground"/);
    }
  });
});

describe("CC-14 · bậc chữ tiêu đề", () => {
  it("nhãn nhóm chữ hoa một kiểu (12px, giãn 0.1em)", () => {
    expect(TYPE.groupLabel).toBe("text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground");
    expect(src("pages/SettingsStorage.tsx")).not.toContain("text-[11px] font-semibold uppercase");
    expect(src("components/library/RoomStats.tsx")).not.toContain("text-[11.5px] font-semibold uppercase");
  });
  it("Panel dùng TYPE.blockTitle; Báo cáo 17px; Chính sách trong Cài đặt là H2", () => {
    expect(src("components/finance/primitives.tsx")).toContain("<h2 className={cn(TYPE.blockTitle, \"tracking-tight\")}>{title}</h2>");
    expect(src("pages/FinanceReports.tsx")).not.toContain("text-[18px]");
    expect(src("components/PolicyView.tsx")).toMatch(/<h2 className="hidden text-\[22px\][^"]*">Chính sách<\/h2>/);
  });
});

describe("CC-15 · trạng thái trống chung", () => {
  it("1-1, Nhóm, Nhật ký, Nhiệm vụ, Liên hệ dùng EmptyState", () => {
    const messages = src("pages/Messages.tsx");
    expect(messages).toContain("Chưa có ai ở đây. Bạn kết bạn với người thân qua PIN hoặc QR để bắt đầu trò chuyện.");
    expect(messages).toContain("Gia đình, nhóm bạn hay đội làm việc — bạn tạo một nhóm để mọi người cùng trò chuyện.");
    expect(messages).toContain("<EmptyState icon={NotebookPen}>");
    expect(src("components/tasks/TaskHubSectionView.tsx")).toContain('label: "Thêm việc đầu tiên"');
    expect(src("pages/Contacts.tsx")).toContain("<SharedEmptyState");
  });
});

describe("CC-16 · Dự án dùng biểu tượng nét", () => {
  it("không còn emoji 💬 📊 🗑️", () => {
    const code = src("components/projects/ProjectList.tsx");
    expect(code).not.toMatch(/💬|📊|🗑/);
    expect(code).toContain("icon={MessagesSquare}");
    expect(code).toContain("icon={Table2}");
  });
});

describe("CC-18 · vùng chạm 44px, hình giữ nguyên", () => {
  it("nút thanh trên, lịch nổi, chip nhỏ, Viết lời bình, Tắt trong…", () => {
    expect(src("index.css")).toMatch(/\[data-mobile-top-row\] \.icon-btn::before,[\s\S]{0,200}inset: -4px;/);
    expect(src("index.css")).toMatch(/\.hit-44::before \{[\s\S]{0,80}inset: -7px -2px;/);
    expect(src("components/QuickActionBubble.tsx")).toContain("before:-inset-[4px]");
    expect(src("components/space/ThoughtNote.tsx")).toContain("before:-inset-y-[13px]");
    expect(src("components/chat/MuteSettingsCard.tsx")).toContain("press hit-44");
    expect(src("components/calendar/DateRangeField.tsx")).toContain("press hit-44");
  });
});

describe("CC-20 · cột phải Kết nối theo tab", () => {
  it("Nhật ký không nói 'Chọn một người để trò chuyện'", () => {
    expect(emptyPaneCopy("journal")).toEqual({ title: "Nhật ký của bạn", body: "Chọn Nhật ký, Sổ ghi chép hoặc File ở bên trái.", action: null });
    expect(emptyPaneCopy("direct").action).toBe("chat");
    expect(emptyPaneCopy("group").action).toBe("group");
    expect(emptyPaneCopy("projects").title).toBe("Chọn một dự án");
  });
});

describe("CC-22 · Cài đặt dùng khung xương thay vòng quay", () => {
  it("Tuỳ chọn chung và Dung lượng không còn Loader2", () => {
    expect(src("pages/SettingsPreferences.tsx")).not.toContain("Loader2");
    expect(src("pages/SettingsStorage.tsx")).not.toContain("Loader2");
    expect(src("pages/SettingsPreferences.tsx")).toContain('data-settings-skeleton=""');
    expect(src("pages/SettingsStorage.tsx")).toContain('data-storage-skeleton=""');
  });
});
