import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * 111-B — an toàn nội dung. A fake server records every RPC; the real dialog, gate, ops page and
 * sign-up form run against it.
 */
type Call = { name: string; args: Record<string, unknown> | undefined };
type Fake = { calls: Call[]; gate: unknown; reports: unknown[]; terms: unknown[]; amOps: boolean };
const fake: Fake = { calls: [], gate: null, reports: [], terms: [], amOps: true };
(globalThis as { __fake111b?: Fake }).__fake111b = fake;

vi.mock("@/integrations/supabase/client", () => {
  const state = (): Fake => (globalThis as unknown as { __fake111b: Fake }).__fake111b;
  const builder = (rows: unknown): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const done = Promise.resolve({ data: rows, error: null, count: 0 });
            return done.then.bind(done);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: () => builder([]),
      rpc: (name: string, args?: Record<string, unknown>) => {
        const s = state();
        s.calls.push({ name, args });
        if (name === "my_account_gate") return Promise.resolve({ data: s.gate, error: null });
        if (name === "am_i_ops") return Promise.resolve({ data: s.amOps, error: null });
        if (name === "ops_list_reports") return Promise.resolve({ data: s.reports, error: null });
        if (name === "ops_blocked_terms") return Promise.resolve({ data: s.terms, error: null });
        if (name === "report_user") return Promise.resolve({ data: "r1", error: null });
        if (name === "list_my_blocks") return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => builder([]),
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});

const ME = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";
const PEER = "ce09d234-af48-49a5-96f2-b2456ae4e5b0";
const auth = { meta: {} as Record<string, unknown> };
(globalThis as { __auth111b?: typeof auth }).__auth111b = auth;
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d", email: "me@probe.invalid", user_metadata: (globalThis as unknown as { __auth111b: typeof auth }).__auth111b.meta },
    session: null,
    profile: null,
    isLoading: false,
    isRecovering: false,
    signOut: async () => undefined,
    signIn: async () => ({ ok: true }),
    signUp: async () => ({ ok: true }),
    resendConfirmation: async () => ({ ok: true }),
    requestPasswordReset: async () => ({ ok: true }),
    sendEmailOtp: async () => ({ ok: true }),
    verifyEmailOtp: async () => ({ ok: true }),
  }),
  useDisplayName: () => "Thiện Võ",
}));

import { ReportDialog, type ReportTarget } from "@/components/chat/ReportDialog";
import { SafetyGate } from "@/components/SafetyGate";
import Auth from "@/pages/Auth";
import OpsReports from "@/pages/OpsReports";

const OUT = "../../.test-output/screens/111b";
const WAIT = { timeout: 6_000, interval: 50 } as const;

function Frame({ children, path = "/" }: { children: ReactNode; path?: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Suspense fallback={null}>{children}</Suspense>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const callsOf = (name: string): Call[] => fake.calls.filter((call) => call.name === name);

beforeEach(async () => {
  fake.calls = [];
  fake.gate = null;
  fake.reports = [];
  fake.terms = [];
  fake.amOps = true;
  auth.meta = {};
  await page.viewport(390, 844);
});

function Report({ target }: { target: ReportTarget }) {
  const [open, setOpen] = useState<boolean>(true);
  return <ReportDialog target={target} open={open} onOpenChange={setOpen} />;
}

test("111-B · báo cáo tệp trong tin: chọn tệp → p_target_kind=file, rồi Đã nhận báo cáo + Chặn luôn", async () => {
  await render(
    <Frame>
      <Report
        target={{
          userId: PEER,
          name: "Lan Anh",
          conversationId: "c1",
          message: { id: "m1", content: "xem cái này" },
          files: [{ id: "f1", name: "hop-dong.pdf" }],
        }}
      />
    </Frame>,
  );
  await expect.element(page.getByRole("dialog", { name: "Báo cáo tin nhắn" })).toBeVisible();
  await page.getByRole("radio", { name: "Tệp: hop-dong.pdf" }).click();
  await page.getByRole("radio", { name: "Nội dung khiêu dâm" }).click();
  await page.screenshot({ path: `${OUT}/bao-cao-tep-390x844.png` });
  await page.getByRole("button", { name: "Gửi báo cáo" }).click();
  await vi.waitFor(() => expect(callsOf("report_user")).toHaveLength(1), WAIT);
  expect(callsOf("report_user")[0].args).toMatchObject({
    p_user_id: PEER,
    p_reason: "sexual",
    p_target_kind: "file",
    p_file_id: "f1",
    p_include_message: false,
    p_also_block: false,
  });
  await expect.element(page.getByRole("dialog", { name: "Đã nhận báo cáo" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/da-nhan-bao-cao-390x844.png` });
  await page.getByRole("button", { name: "Chặn Lan Anh" }).click();
  await vi.waitFor(() => expect(callsOf("block_user")[0]?.args).toEqual({ p_user_id: PEER }), WAIT);
  await expect.element(page.getByText("Đã chặn Lan Anh.")).toBeVisible();
});

test("111-B · báo cáo nhóm: không gắn người, gửi p_group_id; xác nhận không có nút chặn", async () => {
  await render(
    <Frame>
      <Report target={{ kind: "group", userId: null, name: "Lớp 12A", conversationId: "g1", groupId: "g1", message: null }} />
    </Frame>,
  );
  await expect.element(page.getByRole("dialog", { name: "Báo cáo nhóm Lớp 12A" })).toBeVisible();
  await page.getByRole("radio", { name: "Liên quan đến an toàn trẻ em" }).click();
  await page.getByRole("button", { name: "Gửi báo cáo" }).click();
  await vi.waitFor(() => expect(callsOf("report_user")).toHaveLength(1), WAIT);
  const args = callsOf("report_user")[0].args ?? {};
  expect(args).toMatchObject({ p_reason: "minor_safety", p_target_kind: "group", p_group_id: "g1", p_also_block: false });
  expect(args.p_user_id).toBeUndefined();
  await expect.element(page.getByRole("dialog", { name: "Đã nhận báo cáo" })).toBeVisible();
  expect(document.querySelector("[data-report-received]")?.textContent ?? "").not.toMatch(/Chặn/);
});

test("111-B · tài khoản bị khoá chỉ thấy màn hạn chế (ngày hết hạn, email hỗ trợ, xoá tài khoản)", async () => {
  fake.gate = { suspendedUntil: "2026-11-20T03:00:00Z", termsVersion: "2026-11-10", termsAccepted: true, notices: [] };
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await expect.element(page.getByTestId("account-suspended")).toBeVisible();
  expect(document.body.textContent).toMatch(/Tài khoản đang bị hạn chế đến .*20\/11\/2026/);
  expect(document.body.textContent).toContain("support@avorachat.com");
  expect(document.body.textContent).not.toContain("Nội dung ứng dụng");
  await expect.element(page.getByRole("button", { name: "Xoá tài khoản" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/tai-khoan-bi-khoa-390x844.png` });
});

test("111-B · khoá vĩnh viễn nói rõ là vĩnh viễn", async () => {
  fake.gate = { suspendedUntil: "infinity", termsVersion: "2026-11-10", termsAccepted: true, notices: [] };
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await expect.element(page.getByText("Tài khoản của bạn đã bị khoá vĩnh viễn vì vi phạm Quy tắc cộng đồng.")).toBeVisible();
});

test("111-B · tài khoản cũ: hộp đồng ý không chọn sẵn; Không đồng ý → chỉ còn xem lại / xoá; đồng ý → accept_terms", async () => {
  fake.gate = { suspendedUntil: null, termsVersion: "2026-11-10", termsAccepted: false, notices: [] };
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await expect.element(page.getByTestId("terms-prompt")).toBeVisible();
  const agree = page.getByRole("button", { name: "Đồng ý và tiếp tục" });
  await expect.element(agree).toBeDisabled();
  await page.screenshot({ path: `${OUT}/dong-y-dieu-khoan-390x844.png` });
  await page.getByRole("button", { name: "Không đồng ý" }).click();
  await expect.element(page.getByTestId("terms-declined")).toBeVisible();
  expect(document.body.textContent).not.toContain("Nội dung ứng dụng");
  await page.screenshot({ path: `${OUT}/khong-dong-y-390x844.png` });
  await page.getByRole("button", { name: "Xem lại Điều khoản" }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Đồng ý và tiếp tục" }).click();
  await vi.waitFor(() => expect(callsOf("accept_terms")[0]?.args).toEqual({ p_version: "2026-11-10" }), WAIT);
});

test("111-B · vừa đăng ký với đúng phiên bản: ghi nhận im lặng, không hỏi lại", async () => {
  auth.meta = { terms_version: "2026-11-10" };
  fake.gate = { suspendedUntil: null, termsVersion: "2026-11-10", termsAccepted: false, notices: [] };
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await vi.waitFor(() => expect(callsOf("accept_terms")).toHaveLength(1), WAIT);
  expect(document.querySelector("[data-testid=terms-prompt]")).toBeNull();
  await expect.element(page.getByText("Nội dung ứng dụng")).toBeVisible();
});

test("111-B · thông báo 'Báo cáo của bạn đã được xem xét' hiện một lần, Đã hiểu → ack", async () => {
  fake.gate = { suspendedUntil: null, termsVersion: "2026-11-10", termsAccepted: true, notices: [{ id: "n1", kind: "report_reviewed", createdAt: "2026-11-10T00:00:00Z" }] };
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await expect.element(page.getByRole("dialog", { name: "Báo cáo của bạn đã được xem xét" })).toBeVisible();
  await page.getByRole("button", { name: "Đã hiểu" }).click();
  await vi.waitFor(() => expect(callsOf("ack_account_notice")[0]?.args).toEqual({ p_id: "n1" }), WAIT);
  expect(document.querySelector("[data-testid=account-notice]")).toBeNull();
});

test("111-B · máy chủ chưa có cổng (trả null) → ứng dụng đi qua bình thường", async () => {
  await render(
    <Frame>
      <SafetyGate>
        <p>Nội dung ứng dụng</p>
      </SafetyGate>
    </Frame>,
  );
  await vi.waitFor(() => expect(callsOf("my_account_gate")).toHaveLength(1), WAIT);
  await expect.element(page.getByText("Nội dung ứng dụng")).toBeVisible();
});

test("111-B · đăng ký: ô đồng ý không chọn sẵn, nút Tạo tài khoản chờ tới khi tích; có link Chính sách / Điều khoản / Hỗ trợ", async () => {
  await render(
    <Frame path="/dang-nhap?mode=dang-ky">
      <Auth />
    </Frame>,
  );
  const box = page.getByRole("checkbox", { name: "Đồng ý Điều khoản sử dụng và Quy tắc cộng đồng" });
  await expect.element(box).not.toBeChecked();
  const submit = document.querySelector<HTMLButtonElement>("form button[type=submit]");
  expect(submit?.disabled).toBe(true);
  await box.click();
  await vi.waitFor(() => expect(submit?.disabled).toBe(false), WAIT);
  const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-auth-links] a")].map((a) => [a.textContent, a.getAttribute("href")]);
  expect(links).toEqual([
    ["Chính sách bảo mật", "/chinh-sach#bao-mat"],
    ["Điều khoản", "/chinh-sach#dieu-khoan"],
    ["Hỗ trợ", "mailto:support@avorachat.com"],
  ]);
  await page.screenshot({ path: `${OUT}/dang-ky-dong-y-390x844.png` });
});

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

test("111-B · /quan-tri/bao-cao: an toàn trẻ em nổi bật, quá 24 giờ đỏ, Khoá tạm gửi số ngày", async () => {
  fake.reports = [
    { id: "r-minor", kind: "message", reason: "minor_safety", note: null, content: "tin bị báo cáo", status: "open", action: null, createdAt: hoursAgo(2), handledAt: null, reportedUserId: PEER, reportedName: "Người A", groupName: null, priorCount: 2, suspendedUntil: null },
    { id: "r-old", kind: "user", reason: "scam", note: "xin tiền", content: null, status: "open", action: null, createdAt: hoursAgo(30), handledAt: null, reportedUserId: ME, reportedName: "Người B", groupName: null, priorCount: 1, suspendedUntil: null },
    { id: "r-group", kind: "group", reason: "harassment", note: null, content: null, status: "open", action: null, createdAt: hoursAgo(1), handledAt: null, reportedUserId: null, reportedName: null, groupName: "Lớp 12A", priorCount: 0, suspendedUntil: null },
  ];
  fake.terms = [{ id: 1, term: "lừa đảo", locale: "vi", severity: "high" }];
  await render(
    <Frame>
      <OpsReports />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelectorAll("[data-ops-report]")).toHaveLength(3), WAIT);
  const minor = document.querySelector<HTMLElement>("[data-ops-report=r-minor]");
  expect(minor?.className).toContain("border-destructive");
  expect(document.querySelector("[data-ops-report=r-old] [data-age-old]")?.textContent).toBe("1 ngày");
  expect(document.querySelector("[data-ops-report=r-minor] [data-age-old]")).toBeNull();
  // A group report has no single person: only Bỏ qua.
  expect(document.querySelector("[data-ops-report=r-group]")?.textContent).not.toMatch(/Khoá|Cảnh cáo/);
  await page.screenshot({ path: `${OUT}/quan-tri-bao-cao-390x844.png` });
  await page.viewport(1280, 800);
  await page.screenshot({ path: `${OUT}/quan-tri-bao-cao-1280x800.png` });

  const old = page.elementLocator(document.querySelector("[data-ops-report=r-old]") as HTMLElement);
  await old.getByRole("combobox", { name: "Số ngày khoá" }).selectOptions("30");
  await old.getByRole("button", { name: "Khoá tạm" }).click();
  await vi.waitFor(() => expect(callsOf("ops_handle_report")[0]?.args).toEqual({ p_report_id: "r-old", p_action: "suspend_temp", p_days: 30 }), WAIT);
});

test("111-B · /quan-tri/bao-cao từ chối người ngoài nhóm vận hành", async () => {
  fake.amOps = false;
  await render(
    <Frame>
      <OpsReports />
    </Frame>,
  );
  await expect.element(page.getByText("Trang này chỉ dành cho nhóm vận hành Avora.")).toBeVisible();
  expect(callsOf("ops_list_reports")).toHaveLength(0);
});
