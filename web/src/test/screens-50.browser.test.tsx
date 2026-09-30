import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

/* Screenshots for the AVORA-50 report, drawn with fixed fake data (no account, no network). */
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const done = Promise.resolve({ data: [], error: null });
  const handler: ProxyHandler<object> = {
    get: (_target, key) => (key === "then" ? done.then.bind(done) : () => new Proxy(chain, handler)),
  };
  const proxy = new Proxy(chain, handler);
  return { supabase: { from: () => proxy, rpc: () => proxy, storage: { from: () => proxy }, channel: () => proxy, removeChannel: () => undefined } };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    session: null,
    isLoading: false,
    isRecovering: false,
    signIn: async () => undefined,
    signUp: async () => undefined,
    resendConfirmation: async () => undefined,
    requestPasswordReset: async () => undefined,
  }),
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ isLive: true, setReadingConversation: () => undefined }) }));

import Auth from "@/pages/Auth";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { cn } from "@/lib/utils";

const OUT = "../../../docs/screens/2026-09-30";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dang-nhap"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function inView(element: Element, height: number): void {
  const rect = element.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(height);
}

test("A · màn đăng nhập, máy tính", async () => {
  await page.viewport(1280, 800);
  const screen = await render(
    <Frame>
      <Auth />
    </Frame>,
  );
  const motto = screen.getByRole("heading", { name: "Clarity - Inner Space - My Space" });
  await expect.element(motto).toBeInTheDocument();
  expect(motto.element().getAttribute("translate")).toBe("no");
  expect(motto.element().getAttribute("lang")).toBe("en");
  expect(document.body.textContent ?? "").not.toContain("Chỉ bạn và người bạn đang trò chuyện");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.screenshot({ path: `${OUT}/50-A-dang-nhap-may-tinh.png` });
});

test("A · màn đăng nhập, 360px", async () => {
  await page.viewport(360, 780);
  const screen = await render(
    <Frame>
      <Auth />
    </Frame>,
  );
  await expect.element(screen.getByText("Avora Space", { exact: true })).toBeInTheDocument();
  // The columns rise in; wait until they have landed.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.screenshot({ path: `${OUT}/50-A-dang-nhap-360.png` });
});

test("50.C1 · cửa sổ thấp 700px: tiêu đề và nút cuối luôn thấy (vỏ hộp dài dùng chung)", async () => {
  await page.viewport(1280, 700);
  const screen = await render(
    <Frame>
      <Dialog open>
        <DialogContent className={cn(longDialogContentClass, "max-w-lg")}>
          <LongDialogHeader>
            <DialogTitle className="text-[19px] font-semibold">Sửa Hạng mục</DialogTitle>
            <DialogDescription className="mt-1 text-[14px] text-muted-foreground">Sửa gì lưu nấy.</DialogDescription>
          </LongDialogHeader>
          <LongDialogBody className="space-y-3">
            {Array.from({ length: 24 }, (_, i) => (
              <p key={i} className="rounded-md border border-border px-3 py-3 text-[14px]">Ô {i + 1}</p>
            ))}
          </LongDialogBody>
          <LongDialogFooter>
            <button type="button" className="h-10 rounded-md px-4">Để sau</button>
            <button type="button" className="h-10 rounded-md bg-primary px-4 text-primary-foreground">Lưu</button>
          </LongDialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>,
  );
  inView(screen.getByRole("heading", { name: "Sửa Hạng mục" }).element(), 700);
  inView(screen.getByRole("button", { name: "Lưu" }).element(), 700);
  await page.screenshot({ path: `${OUT}/50-C1-hop-dai-700.png` });
});

test("50.C1 · ScheduleMessageDialog ở 700px", async () => {
  await page.viewport(1280, 700);
  const screen = await render(
    <Frame>
      <ScheduleMessageDialog open onOpenChange={() => undefined} content={"Nhắc cả nhà mang bản vẽ.\n".repeat(6)} onSubmit={() => undefined} isWorking={false} />
    </Frame>,
  );
  inView(screen.getByRole("button", { name: "Huỷ" }).element(), 700);
  await page.screenshot({ path: `${OUT}/50-C1-hen-gio-700.png` });
});

test("50.C2 · điện thoại: TaskComposer mở Sự kiện + Ghi chú, nút tạo không bị đẩy khỏi màn", async () => {
  await page.viewport(390, 700);
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const screen = await render(
    <Frame>
      <TaskComposer
        open
        onOpenChange={() => undefined}
        place="personal"
        initial={{ title: "Họp dự án sửa mái", description: "Ghi chú dài\n".repeat(20), startAt: "2026-10-02T09:00", endAt: "2026-10-02T10:00", location: "Nhà thờ" }}
        onCreateMine={async () => undefined}
      />
    </Frame>,
  );
  const submit = screen.getByRole("button", { name: /Tạo|Lưu/ }).last();
  await expect.element(submit).toBeInTheDocument();
  // The sheet slides up for 500ms; measure once it has landed.
  await new Promise((resolve) => setTimeout(resolve, 800));
  inView(submit.element(), 700);
  await page.screenshot({ path: `${OUT}/50-C2-task-composer-dien-thoai.png` });
});
