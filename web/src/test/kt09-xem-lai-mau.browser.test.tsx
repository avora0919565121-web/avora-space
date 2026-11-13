import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

/*
 * KT-09 (CEO): "Ẩn mẫu" ở Két sắt xong không còn đường xem lại. Giờ mỗi ngăn đã ẩn có dòng nhỏ
 * "Xem lại mẫu"; Tài chính có "Xem lại mẫu" sau khi ẩn sổ mẫu; Cài đặt có "Hiện lại các mẫu".
 * useGuidance thật, máy chủ giả giữ bảng dismissed_guidance.
 */
type Fake = { rows: string[]; deleted: string[]; fail: boolean };
const fake: Fake = { rows: [], deleted: [], fail: false };
(globalThis as { __fakeKt09m?: Fake }).__fakeKt09m = fake;

vi.mock("@/integrations/supabase/client", () => {
  const s = (): Fake => (globalThis as unknown as { __fakeKt09m: Fake }).__fakeKt09m;
  const from = () => ({
    select: () => Promise.resolve(s().fail ? { data: null, error: { code: "500", message: "down" } } : { data: s().rows.map((guidance_key) => ({ guidance_key })), error: null }),
    upsert: (row: { guidance_key: string }) => {
      if (!s().rows.includes(row.guidance_key)) s().rows.push(row.guidance_key);
      return Promise.resolve({ error: null });
    },
    delete: () => {
      const filter: Record<string, string> = {};
      const chain = {
        eq: (column: string, value: string) => {
          filter[column] = value;
          if (column === "guidance_key") {
            s().rows = s().rows.filter((key) => key !== value);
            s().deleted.push(value);
            return Promise.resolve({ error: null });
          }
          return chain;
        },
      };
      return chain;
    },
  });
  return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-kt09" } }) }));
vi.mock("@/components/vault/VaultGate", () => ({ VaultGate: () => <div data-stub-gate="">Bàn phím đặt mã</div> }));

const { VaultSampleList } = await import("@/components/vault/VaultSamples");
const { VaultNoCode } = await import("@/components/vault/VaultNoCode");
const { FinanceHeader, FinancePage } = await import("@/components/finance/primitives");
const { useRestoreSamples } = await import("@/lib/use-samples");

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  fake.rows = [];
  fake.deleted = [];
  fake.fail = false;
  await page.viewport(390, 844);
});

for (const section of ["passwords", "certificates", "documents", "assets"] as const) {
  test(`KT-09 · ngăn ${section}: Ẩn mẫu → còn dòng "Xem lại mẫu" → bấm thì mẫu hiện lại`, async () => {
    const screen = await render(<Frame><VaultSampleList section={section} /></Frame>);
    await vi.waitFor(() => expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4));
    await userEvent.click(screen.getByRole("button", { name: "Ẩn mẫu" }));
    await vi.waitFor(() => expect(document.querySelector(`[data-vault-samples-restore="${section}"]`)).not.toBeNull());
    expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(0);
    await vi.waitFor(() => expect(fake.rows).toContain(`sample_hidden_${section}`));
    await userEvent.click(screen.getByRole("button", { name: "Xem lại mẫu" }));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4));
    expect(fake.deleted).toEqual([`sample_hidden_${section}`]);
    // Still read-only: no "Chép" on a sample.
    expect(screen.getByRole("button", { name: "Chép" }).query()).toBeNull();
  });
}

test("KT-09 · ngăn Tài sản trên điện thoại (ảnh CEO): đã ẩn mẫu vẫn có đường quay lại dưới thẻ Đặt mã", async () => {
  fake.rows = ["sample_hidden_assets"];
  const screen = await render(<Frame><VaultNoCode compartment="tai-san" /></Frame>);
  await vi.waitFor(() => expect(document.querySelector('[data-vault-no-code="phone"]')).not.toBeNull());
  const restore = screen.getByRole("button", { name: "Xem lại mẫu" });
  await expect.element(restore).toBeVisible();
  await userEvent.click(restore);
  await vi.waitFor(() => expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4));
});

test("KT-09 · lỗi tải danh sách đã ẩn: không hiện mẫu, cũng không hiện \"Xem lại mẫu\"", async () => {
  fake.fail = true;
  await render(<Frame><VaultSampleList section="documents" /></Frame>);
  await new Promise((done) => setTimeout(done, 400));
  expect(document.querySelector("[data-vault-samples]")).toBeNull();
  expect(document.querySelector("[data-vault-samples-restore]")).toBeNull();
});

test("KT-09 · Tài chính: đã ẩn sổ mẫu thì có \"Xem lại mẫu\"", async () => {
  const restoreSample = vi.fn();
  const screen = await render(
    <Frame>
      <FinancePage book={{ isSample: false, canShowSample: false, setBook: vi.fn(), hideSample: vi.fn(), canRestoreSample: true, restoreSample }}>
        <FinanceHeader subtitle="Thu chi cá nhân" />
      </FinancePage>
    </Frame>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Xem lại mẫu" }));
  expect(restoreSample).toHaveBeenCalled();
  expect(document.querySelector("[data-finance-book]")).toBeNull();
});

function RestoreAll() {
  const restore = useRestoreSamples();
  return <button type="button" onClick={() => void restore()}>Hiện lại các mẫu</button>;
}

test("KT-09 · Cài đặt › Hiện lại các mẫu: bật lại mẫu của mọi ngăn và sổ mẫu", async () => {
  fake.rows = ["sample_hidden_finance", "sample_hidden_passwords", "sample_hidden_certificates", "sample_hidden_documents", "sample_hidden_assets", "plan_plus_hold"];
  const screen = await render(
    <Frame>
      <RestoreAll />
      <VaultSampleList section="assets" />
    </Frame>,
  );
  await vi.waitFor(() => expect(document.querySelector('[data-vault-samples-restore="assets"]')).not.toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Hiện lại các mẫu" }));
  await vi.waitFor(() => expect(fake.rows).toEqual(["plan_plus_hold"]));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4));
});
