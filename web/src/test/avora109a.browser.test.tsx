import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-109 · A — Khoá Kết nối: che đúng phần tử, ẩn huy hiệu, mã sai chờ, tự khoá khi rời. No network. */
const state = vi.hoisted(() => ({ signedOut: 0, pushShowContent: false }));
vi.mock("@/integrations/supabase/client", () => {
  const proxy = (rows: unknown): unknown =>
    new Proxy({}, { get: (_t, key) => (key === "then" ? Promise.resolve({ data: rows, error: null }).then.bind(Promise.resolve({ data: rows, error: null })) : () => proxy(rows)) });
  return { supabase: { from: () => proxy(null), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "lock-user" }, signOut: async () => { state.signedOut += 1; } }),
}));
vi.mock("@/lib/use-settings", () => ({
  useProfileSettings: () => ({ data: { pushShowContent: state.pushShowContent } }),
  useSettingsActions: () => ({ setPushPrefs: { mutate: () => { state.pushShowContent = false; } } }),
}));
vi.mock("@/lib/use-conversations", () => ({ useTotalUnread: () => 7 }));
vi.mock("@/lib/use-tasks", () => ({ useTasks: () => ({ data: [] }) }));
vi.mock("@/lib/use-finance", () => ({ useTransactions: () => ({ data: [] }) }));

import { ChatLockButton } from "@/components/chat-lock/ChatLockButton";
import { ChatLockGate } from "@/components/chat-lock/ChatLockGate";
import { ChatLockSettings } from "@/components/chat-lock/ChatLockSettings";
import { ConfirmHost } from "@/components/ConfirmHost";
import { clearChatLock, writeConfig, writeLocked, saveCode } from "@/lib/chat-lock";
import { ChatLockProvider } from "@/lib/use-chat-lock";
import { useNavBadges } from "@/lib/use-nav-badges";

const OUT = "../../../docs/screens/2026-10-12";
const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));

function Badge() {
  const badges = useNavBadges();
  return <span data-tab-badge="">{badges["/tin-nhan"].count}</span>;
}

function FakeConnect() {
  return (
    <div data-fake-connect="">
      <ChatLockButton />
      <p data-row-name="">Lan Anh</p>
      <p data-row-preview="">Mai mình gặp nhé</p>
      <span data-row-time="">14:32</span>
      <span data-row-unread="">3</span>
    </div>
  );
}

function Frame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  document.documentElement.classList.toggle("dark", dark);
  return (
    <QueryClientProvider client={client}>
      <ChatLockProvider>
        <div className="paper flex h-[100dvh] flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border p-2 text-[13px]">Kết nối <Badge /></div>
          {children}
        </div>
        <ConfirmHost />
      </ChatLockProvider>
    </QueryClientProvider>
  );
}

const q = (selector: string): HTMLElement | null => document.querySelector(selector);

async function typeInto(selector: string, text: string): Promise<void> {
  const input = q(selector) as HTMLInputElement;
  await userEvent.click(input);
  await userEvent.fill(input, text);
}

beforeEach(async () => {
  await clearChatLock(null);
  state.signedOut = 0;
  state.pushShowContent = false;
});

test("lần đầu: Khoá mở thiết lập 2 bước → mã 4 số → khoá luôn; che tên, bản xem trước, giờ, số chưa đọc; huy hiệu tab ẩn", async () => {
  await page.viewport(390, 844);
  await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await settle();
  expect(q("[data-tab-badge]")?.textContent).toBe("7");
  await userEvent.click(q("[data-chat-lock-button]") as HTMLElement);
  await expect.poll(() => q("[data-chat-lock-setup]")).not.toBeNull();
  expect(q("[data-chat-lock-truth]")?.textContent).toContain("chỉ che Kết nối trên máy này");
  expect(q("[data-chat-lock-truth]")?.textContent ?? "").not.toMatch(/mã ho[áa]/i);
  await settle(600);
  await page.screenshot({ path: `${OUT}/109A-thiet-lap-390x844.png` });
  await userEvent.click(q('[data-chat-lock-method="code"]') as HTMLElement);
  await typeInto("[data-chat-lock-new-code]", "2468");
  await typeInto("[data-chat-lock-new-code-again]", "2468");
  await userEvent.click(q("[data-chat-lock-save]") as HTMLElement);
  await expect.poll(() => q("[data-chat-lock-screen]"), { timeout: 10_000 }).not.toBeNull();
  for (const sel of ["[data-row-name]", "[data-row-preview]", "[data-row-time]", "[data-row-unread]", "[data-fake-connect]"]) expect(q(sel)).toBeNull();
  expect(document.body.textContent).not.toContain("Lan Anh");
  expect(q("[data-tab-badge]")?.textContent).toBe("0");
  await settle(400);
  await page.screenshot({ path: `${OUT}/109A-dang-khoa-390x844.png` });

  await typeInto("[data-chat-lock-code-input]", "2468");
  await userEvent.click(q("[data-chat-unlock-submit]") as HTMLElement);
  await expect.poll(() => q("[data-row-name]"), { timeout: 10_000 }).not.toBeNull();
  expect(q("[data-tab-badge]")?.textContent).toBe("7");
}, 40_000);

test("khởi động lại: 'Chỉ khi tôi bấm nút' mở bình thường; 'Sau 5 phút' luôn hỏi", async () => {
  writeConfig("lock-user", { method: "code", autoLock: "manual", credentialId: null });
  const a = await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await settle();
  expect(q("[data-row-name]")).not.toBeNull();
  await a.unmount();
  writeConfig("lock-user", { method: "code", autoLock: "5", credentialId: null });
  await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await settle();
  expect(q("[data-chat-lock-screen]")).not.toBeNull();
  expect(q("[data-row-name]")).toBeNull();
});

test("'Khi tôi rời app': rời trang là khoá", async () => {
  writeConfig("lock-user", { method: "code", autoLock: "leave", credentialId: null });
  writeLocked("lock-user", false);
  await saveCode("lock-user", "1357", 1000);
  await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  // A fresh start with "leave" asks first; open it, then leave.
  await expect.poll(() => q("[data-chat-lock-screen]")).not.toBeNull();
  await typeInto("[data-chat-lock-code-input]", "1357");
  await userEvent.click(q("[data-chat-unlock-submit]") as HTMLElement);
  await expect.poll(() => q("[data-row-name]")).not.toBeNull();
  window.dispatchEvent(new Event("pagehide"));
  await expect.poll(() => q("[data-chat-lock-screen]")).not.toBeNull();
});

test("Cài đặt: Tắt khoá phải mở bằng cách hiện tại trước; quên mã → Đăng xuất để đặt lại", async () => {
  writeConfig("lock-user", { method: "code", autoLock: "manual", credentialId: null });
  await saveCode("lock-user", "1357", 1000);
  writeLocked("lock-user", true);
  await render(
    <Frame>
      <div className="p-4"><ChatLockSettings /></div>
      <ChatLockGate><FakeConnect /></ChatLockGate>
    </Frame>,
  );
  await settle();
  expect(q("[data-chat-lock-status]")?.textContent).toContain("mã số");
  await userEvent.click(q("[data-chat-lock-off]") as HTMLElement);
  await expect.poll(() => q("[data-chat-lock-confirm]")).not.toBeNull();
  const confirmInput = q("[data-chat-lock-confirm] [data-chat-lock-code-input]") as HTMLInputElement;
  await userEvent.fill(confirmInput, "1357");
  await userEvent.click(q("[data-chat-lock-confirm] [data-chat-unlock-submit]") as HTMLElement);
  await expect.poll(() => q("[data-chat-lock-status]")?.textContent ?? "").toContain("Đang tắt");
  expect(q("[data-row-name]")).not.toBeNull();
});

test("quên mã: Đăng xuất để đặt lại xoá khoá trên máy và đăng xuất", async () => {
  writeConfig("lock-user", { method: "code", autoLock: "manual", credentialId: null });
  writeLocked("lock-user", true);
  await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await expect.poll(() => q("[data-chat-lock-reset]")).not.toBeNull();
  await userEvent.click(q("[data-chat-lock-reset]") as HTMLElement);
  const confirm = await expect.poll(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Đăng xuất") ?? null).not.toBeNull();
  void confirm;
  await userEvent.click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Đăng xuất") as HTMLElement);
  await expect.poll(() => state.signedOut).toBe(1);
  expect(window.localStorage.getItem("avora.chat-lock:lock-user")).toBeNull();
});

test("bật xong khi thông báo đang hiện nội dung: gợi ý tắt một lần, một chạm", async () => {
  state.pushShowContent = true;
  await page.viewport(390, 844);
  await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await userEvent.click(q("[data-chat-lock-button]") as HTMLElement);
  await userEvent.click(q('[data-chat-lock-method="code"]') as HTMLElement);
  await typeInto("[data-chat-lock-new-code]", "2468");
  await typeInto("[data-chat-lock-new-code-again]", "2468");
  await userEvent.click(q("[data-chat-lock-save]") as HTMLElement);
  await expect.poll(() => q("[data-chat-lock-hint-off]"), { timeout: 10_000 }).not.toBeNull();
  await userEvent.click(q("[data-chat-lock-hint-off]") as HTMLElement);
  expect(state.pushShowContent).toBe(false);
  await expect.poll(() => q("[data-chat-lock-screen]")).not.toBeNull();
  expect(window.localStorage.getItem("avora.chat-lock-hint:lock-user")).toBe("1");
}, 30_000);

test("ảnh: màn khoá 390 / 844 / 1280 · tối", async () => {
  writeConfig("lock-user", { method: "code", autoLock: "manual", credentialId: null });
  writeLocked("lock-user", true);
  for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
    await page.viewport(w, h);
    const view = await render(<Frame dark><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
    await settle(300);
    expect(q("[data-chat-lock-screen]")).not.toBeNull();
    await page.screenshot({ path: `${OUT}/109A-dang-khoa-toi-${w}x${h}.png` });
    await view.unmount();
  }
  document.documentElement.classList.remove("dark");
});

// Runs last: its 1-second wait ticker keeps React's act queue busy for whatever renders after it.
test("mã sai: báo sai; đến lần thứ 5 phải chờ 1 phút (lưu trên máy, tải lại vẫn chờ)", async () => {
  await page.viewport(390, 844);
  writeConfig("lock-user", { method: "code", autoLock: "manual", credentialId: null });
  await saveCode("lock-user", "1357", 1000);
  writeLocked("lock-user", true);
  const view = await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await expect.poll(() => q("[data-chat-lock-screen]")).not.toBeNull();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await expect.poll(() => (q("[data-chat-lock-code-input]") as HTMLInputElement | null)?.disabled).toBe(false);
    await typeInto("[data-chat-lock-code-input]", "0000");
    await userEvent.click(q("[data-chat-unlock-submit]") as HTMLElement);
    if (attempt < 5) await expect.poll(() => q('[role="alert"]')?.textContent ?? "").toContain("Mã chưa đúng");
  }
  await expect.poll(() => q("[data-chat-lock-wait]")?.textContent ?? "").toMatch(/Thử lại sau (60 giây|1 phút)/);
  expect((q("[data-chat-lock-code-input]") as HTMLInputElement).disabled).toBe(true);
  await view.unmount();
  const again = await render(<Frame><ChatLockGate><FakeConnect /></ChatLockGate></Frame>);
  await expect.poll(() => q("[data-chat-lock-wait]")).not.toBeNull();
  expect(q("[data-row-name]")).toBeNull();
  await again.unmount();
}, 30_000);
