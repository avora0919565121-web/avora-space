import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * KT-05 · sửa báo cáo QA-02 (Rà soát độ chỉn chu) — phần trên màn. Không có mạng: Supabase giả trả rỗng.
 */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === "then") {
            const done = Promise.resolve({ data: [], error: null, count: 0 });
            return done.then.bind(done);
          }
          if (key === "single" || key === "maybeSingle") {
            return () => {
              const one: unknown = new Proxy({}, { get: (_x, k) => (k === "then" ? ((r: (v: unknown) => void) => r({ data: { id: "new-1" }, error: null })) : () => one) });
              return one;
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => builder(),
      channel: () => builder(),
      removeChannel: () => undefined,
      removeAllChannels: () => undefined,
      storage: { from: () => builder() },
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isProfileLoading: false, isLoading: false }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { ConfirmHost } from "@/components/ConfirmHost";
import { PlusMenuButton } from "@/components/PlusMenuButton";
import { AccountDialog } from "@/components/finance/dialogs";
import { selectChevron, selectClass } from "@/components/finance/primitives";
import { PlanPlusButton } from "@/components/think-hub/PlanPlusButton";
import { TaskCard } from "@/components/tasks/TaskCard";
import { Toaster } from "@/components/ui/sonner";

const WAIT = { timeout: 5_000, interval: 50 } as const;

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/nhiem-vu"]}>
        {children}
        <Toaster />
        <ConfirmHost />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  await page.viewport(390, 844);
});

test("CC-01 · nút + của Đọc, Ghi chép, Két sắt bấm được và làm đúng việc", async () => {
  const onAddBook = vi.fn();
  const onWrite = vi.fn();
  const onVault = vi.fn();
  await render(
    <Frame>
      <div data-case="book"><PlanPlusButton canAddRecord={false} onNewRecord={() => undefined} onNewTable={() => undefined} onAddBook={onAddBook} /></div>
      <div data-case="write"><PlanPlusButton canAddRecord={false} onNewRecord={() => undefined} onNewTable={() => undefined} onWrite={onWrite} /></div>
      <div data-case="vault"><PlusMenuButton label="Thêm giao dịch" onTap={onVault} entries={[]} /></div>
    </Frame>,
  );
  for (const [name, label, fn] of [["book", "Thêm sách", onAddBook], ["write", "Viết ghi chép", onWrite], ["vault", "Thêm giao dịch", onVault]] as const) {
    const button = document.querySelector<HTMLButtonElement>(`[data-case="${name}"] [data-plus-button]`);
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-label")).toBe(label);
    await userEvent.click(button as HTMLElement);
    expect(fn).toHaveBeenCalledTimes(1);
  }
});

test("CC-04 · toast nằm trên thanh dưới của điện thoại", async () => {
  // The phone's tab bar is on screen (ToolBelt marks <html>).
  document.documentElement.setAttribute("data-tool-belt", "");
  await render(<Frame><div /></Frame>);
  toast.success("Đã ghi khoản chi.");
  await vi.waitFor(() => expect(document.querySelector("[data-sonner-toast]")).not.toBeNull(), WAIT);
  await settle(500);
  const rect = (document.querySelector("[data-sonner-toast]") as HTMLElement).getBoundingClientRect();
  // Thanh dưới: 52px + viền 1px + đệm đáy ≥ 10px → toast phải kết thúc trên 844 − 63.
  expect(rect.bottom).toBeLessThanOrEqual(844 - 63);
  toast.dismiss();
  document.documentElement.removeAttribute("data-tool-belt");
});

test("CC-06 · ô chọn giữ nền thẻ, không xám của trình duyệt", async () => {
  await render(
    <Frame>
      <input data-probe="input" className="h-10 w-full rounded-md border border-border bg-card" />
      <select data-probe="select" className={selectClass} style={{ backgroundImage: selectChevron }}><option>Ăn uống</option></select>
    </Frame>,
  );
  const select = getComputedStyle(document.querySelector('[data-probe="select"]') as HTMLElement).backgroundColor;
  const input = getComputedStyle(document.querySelector('[data-probe="input"]') as HTMLElement).backgroundColor;
  expect(select).not.toBe("rgb(239, 239, 239)");
  expect(select).toBe(input);
});

test("CC-08 · mở Tạo nhiệm vụ: con trỏ ở ô tên việc, chưa trách 'Còn thiếu'", async () => {
  await render(
    <Frame>
      <TaskCard open onOpenChange={() => undefined} place="personal" onCreateMine={async () => ({ id: "t-new" })} />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.activeElement?.id).toBe("task-card-title"), WAIT);
  expect(document.body.textContent).not.toContain("Còn thiếu");
  await userEvent.type(document.getElementById("task-card-title") as HTMLElement, "Gọi thợ");
  // Đã bắt đầu → nói rõ còn thiếu gì.
  await vi.waitFor(() => expect(document.body.textContent).toContain("Còn thiếu: ngày diễn ra"), WAIT);
});

test("CC-19 · máy tính: Esc đóng lịch trước; có chữ rồi thì hỏi trước khi bỏ", async () => {
  await page.viewport(1280, 800);
  const onOpenChange = vi.fn();
  await render(
    <Frame>
      <TaskCard open onOpenChange={onOpenChange} place="personal" onCreateMine={async () => ({ id: "t-new" })} />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector('[data-task-card="create"]')).not.toBeNull(), WAIT);
  await userEvent.click(document.querySelector('[aria-label^="Ngày diễn ra"]') as HTMLElement);
  await vi.waitFor(() => expect(document.querySelector("[data-card-day]")).not.toBeNull(), WAIT);
  await userEvent.keyboard("{Escape}");
  await settle();
  expect(document.querySelector("[data-card-day]")).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);

  await userEvent.type(document.getElementById("task-card-title") as HTMLElement, "Viết dở");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Bỏ nhiệm vụ đang viết?"), WAIT);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  await userEvent.click(page.getByRole("button", { name: "Viết tiếp" }));
  await settle();
  expect((document.getElementById("task-card-title") as HTMLTextAreaElement).value).toBe("Viết dở");
});

test("CC-05 · tạo việc không thuộc tab đang xem: toast nói nơi việc nằm và có Xem", async () => {
  const onView = vi.fn();
  function Host() {
    const [open, setOpen] = useState<boolean>(true);
    return (
      <TaskCard
        open={open}
        onOpenChange={setOpen}
        place="personal"
        initial={{ deadline: "2099-01-02" }}
        onCreateMine={async () => ({ id: "t-new" })}
        createdToast={() => ({ text: "Đã thêm vào Tất cả · T6 02/01", onView })}
      />
    );
  }
  await render(
    <Frame>
      <Host />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.getElementById("task-card-title")).not.toBeNull(), WAIT);
  await userEvent.type(document.getElementById("task-card-title") as HTMLElement, "Gọi thợ sửa máy lạnh");
  await userEvent.click(document.querySelector("[data-card-submit]") as HTMLElement);
  await vi.waitFor(() => expect(document.querySelector("[data-sonner-toast]")?.textContent).toContain("Đã thêm vào Tất cả · T6 02/01"), WAIT);
  await userEvent.click(page.getByRole("button", { name: "Xem" }));
  expect(onView).toHaveBeenCalledTimes(1);
  toast.dismiss();
});

test("CC-23 · Tài khoản mới trên điện thoại thấp: Huỷ / Tạo tài khoản nằm trọn trong màn", async () => {
  await page.viewport(390, 600);
  await render(
    <Frame>
      <AccountDialog open onOpenChange={() => undefined} accounts={[]} editing={null} />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector("[data-dialog-footer]")).not.toBeNull(), WAIT);
  await settle(400);
  const footer = (document.querySelector("[data-dialog-footer]") as HTMLElement).getBoundingClientRect();
  expect(footer.bottom).toBeLessThanOrEqual(600);
  expect(footer.top).toBeGreaterThan(0);
  const create = page.getByRole("button", { name: "Tạo tài khoản" }).element().getBoundingClientRect();
  expect(create.bottom).toBeLessThanOrEqual(600);
});

test("CC-17b · ô số tiền VND: gợi ý 0, gõ ra 45.000", async () => {
  await render(
    <Frame>
      <AccountDialog open onOpenChange={() => undefined} accounts={[]} editing={null} />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.getElementById("acc-opening")).not.toBeNull(), WAIT);
  const currency = document.getElementById("acc-currency") as HTMLSelectElement;
  await userEvent.selectOptions(currency, "VND");
  const box = document.getElementById("acc-opening") as HTMLInputElement;
  expect(box.placeholder).toBe("0");
  await userEvent.type(box, "45000");
  expect(box.value).toBe("45.000");
});
