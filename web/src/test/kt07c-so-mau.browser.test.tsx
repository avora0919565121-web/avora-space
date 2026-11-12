import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const state = vi.hoisted(() => ({ dismissed: [] as string[] }));
vi.mock("@/lib/use-task-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-task-flags")>("@/lib/use-task-flags");
  return { ...actual, useGuidance: () => ({ shouldShow: (key: string) => !state.dismissed.includes(key), dismiss: (key: string) => state.dismissed.push(key) }) };
});
vi.mock("@/components/vault/VaultGate", () => ({ VaultGate: () => <div data-stub-gate="">Bàn phím đặt mã</div> }));

const { VaultSampleList } = await import("@/components/vault/VaultSamples");
const { VaultNoCode } = await import("@/components/vault/VaultNoCode");
const { FinanceHeader, FinancePage } = await import("@/components/finance/primitives");

afterEach(async () => {
  state.dismissed = [];
  await page.viewport(414, 896);
});

test("KT-07c · mẫu ngăn Mật khẩu: 4 mục có chip Mẫu, chỉ xem, không có Chép; Ẩn mẫu ghi cờ", async () => {
  const screen = await render(<VaultSampleList section="passwords" />);
  expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4);
  await userEvent.click(screen.getByRole("button", { name: /Wi-Fi nhà \(mẫu\)/ }));
  await expect.element(screen.getByText("WiFi-Nha-Toi (mẫu)")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("mẫu-wifi-không-dùng");
  expect(screen.getByRole("button", { name: "Chép" }).query()).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Hiện" }));
  expect(document.body.textContent).toContain("mẫu-wifi-không-dùng");
  await userEvent.click(screen.getByRole("button", { name: "Ẩn mẫu" }));
  expect(state.dismissed).toEqual(["sample_hidden_passwords"]);
});

test("KT-07c · đã ẩn mẫu thì không hiện", async () => {
  state.dismissed = ["sample_hidden_assets"];
  await render(<VaultSampleList section="assets" />);
  expect(document.querySelector("[data-vault-samples]")).toBeNull();
});

test("KT-07c · sổ mẫu Tài chính chỉ xem: không bấm được gì để ghi, có dải 'Mẫu' sau dòng đầu trang, Ẩn sổ mẫu", async () => {
  const book = { isSample: true, canShowSample: true, setBook: vi.fn(), hideSample: vi.fn() };
  const edit = vi.fn();
  const screen = await render(
    <MemoryRouter>
      <FinancePage book={book}>
        <FinanceHeader subtitle="Thu chi cá nhân" />
        <button type="button" onClick={edit}>Sửa giao dịch</button>
      </FinancePage>
    </MemoryRouter>,
  );
  (screen.getByRole("button", { name: "Sửa giao dịch" }).element() as HTMLButtonElement).click();
  expect(edit).not.toHaveBeenCalled();
  expect(getComputedStyle(screen.getByRole("button", { name: "Sửa giao dịch" }).element()).pointerEvents).toBe("none");
  await expect.element(screen.getByText(/Không phải dữ liệu của bạn, không cộng vào số thật/)).toBeInTheDocument();
  // After the header's own line, never between the strips.
  const subtitle = document.querySelector("[data-finance-subtitle]") as HTMLElement;
  const bar = document.querySelector("[data-finance-book]") as HTMLElement;
  expect(subtitle.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "Sổ của tôi" }));
  expect(book.setBook).toHaveBeenCalledWith("mine");
  await userEvent.click(screen.getByRole("button", { name: "Ẩn sổ mẫu" }));
  expect(book.hideSample).toHaveBeenCalled();
});

test("KT-07c · ngăn chưa có mã · máy tính: bàn phím bên trái, mẫu bên phải", async () => {
  await page.viewport(1440, 900);
  await render(<VaultNoCode compartment="tai-san" />);
  await vi.waitFor(() => expect(document.querySelector('[data-vault-no-code="desk"]')).not.toBeNull());
  const pad = (document.querySelector("[data-vault-pad]") as HTMLElement).getBoundingClientRect();
  const samples = (document.querySelector("[data-vault-samples-side]") as HTMLElement).getBoundingClientRect();
  expect(pad.left).toBeLessThan(samples.left);
  expect(pad.right).toBeLessThanOrEqual(samples.left);
  expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4);
});

test("KT-07c · ngăn chưa có mã · điện thoại: lời mời đặt mã, chạm thì bàn phím trượt lên dạng tấm", async () => {
  await page.viewport(390, 844);
  const screen = await render(<VaultNoCode compartment="mat-khau" />);
  await vi.waitFor(() => expect(document.querySelector('[data-vault-no-code="phone"]')).not.toBeNull());
  expect(document.querySelector("[data-stub-gate]")).toBeNull();
  expect(document.querySelectorAll("[data-vault-sample]")).toHaveLength(4);
  await userEvent.click(screen.getByRole("button", { name: /Đặt mã để cất mật khẩu thật/ }));
  await vi.waitFor(() => expect(document.querySelector("[data-vault-pad-sheet] [data-stub-gate]")).not.toBeNull());
});
