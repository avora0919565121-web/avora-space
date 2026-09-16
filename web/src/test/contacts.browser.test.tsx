import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { BusinessFields, IndividualFields } from "@/components/contacts/ContactForms";
import { EmployerPicker } from "@/components/contacts/EmployerPicker";
import {
  EMPTY_BUSINESS_DRAFT,
  EMPTY_INDIVIDUAL_DRAFT,
  type BusinessDraft,
  type Contact,
  type IndividualDraft,
} from "@/lib/contacts";
import { useState } from "react";

const ME = "u-me";

function person(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: ME,
    contactType: "individual",
    phone: null,
    email: null,
    note: null,
    linkedUserId: null,
    employerContactId: null,
    dateOfBirth: null,
    relationshipTag: null,
    taxCode: null,
    businessAddress: null,
    representativeName: null,
    representativePhone: null,
    representativeEmail: null,
    industry: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function company(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return person({ ...overrides, contactType: "business", taxCode: overrides.taxCode ?? "0101234567" });
}

function IndividualHarness({ onDraft }: { onDraft?: (draft: IndividualDraft) => void }) {
  const [draft, setDraft] = useState<IndividualDraft>(EMPTY_INDIVIDUAL_DRAFT);
  return (
    <div style={{ width: 560, padding: 16 }}>
      <IndividualFields
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          onDraft?.(next);
        }}
      />
    </div>
  );
}

function BusinessHarness() {
  const [draft, setDraft] = useState<BusinessDraft>(EMPTY_BUSINESS_DRAFT);
  return (
    <div style={{ width: 560, padding: 16 }}>
      <BusinessFields draft={draft} onChange={setDraft} />
    </div>
  );
}

function PickerHarness({
  contacts,
  initial = null,
  excludeId = null,
}: {
  contacts: Contact[];
  initial?: string | null;
  excludeId?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div style={{ width: 460, padding: 16 }}>
      <EmployerPicker contacts={contacts} value={value} onChange={setValue} excludeId={excludeId} />
      <p data-testid="value">{value ?? "none"}</p>
    </div>
  );
}

test("a person is asked for a name and the two ways to reach them", async () => {
  const screen = await render(<IndividualHarness />);

  await expect.element(screen.getByLabelText(/^Tên/)).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Điện thoại")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Email")).toBeInTheDocument();
  await expect.element(screen.getByText("Cần ít nhất một trong hai.")).toBeInTheDocument();
});

/**
 * The asterisk is decoration and is marked as such, so the requirement reaches a screen reader
 * as the word "bắt buộc" rather than as a character read out as "stjerne"/"stjärna"/"asterisk".
 */
test("the required mark is readable by a screen reader, not only visible", async () => {
  const screen = await render(<IndividualHarness />);
  await expect.element(screen.getByLabelText("Tên* (bắt buộc)")).toBeInTheDocument();
});

test("a person's birthday and relationship are offered but never demanded", async () => {
  const screen = await render(<IndividualHarness />);

  await expect.element(screen.getByLabelText("Ngày sinh")).toBeInTheDocument();
  const relationship = screen.getByLabelText("Quan hệ");
  await expect.element(relationship).toBeInTheDocument();
  // Suggestions, not a fixed list: the label is only ever read by the person who wrote it.
  expect(relationship.element().getAttribute("list")).toBe("contact-relationship-suggestions");
});

test("typing into the form reports the draft as it is built", async () => {
  const seen: IndividualDraft[] = [];
  const screen = await render(<IndividualHarness onDraft={(draft) => seen.push(draft)} />);

  await userEvent.fill(screen.getByLabelText(/^Tên/), "Trần Thị Hoa");
  await userEvent.fill(screen.getByLabelText("Điện thoại"), "0912345678");

  expect(seen[seen.length - 1].name).toBe("Trần Thị Hoa");
  expect(seen[seen.length - 1].phone).toBe("0912345678");
});

/** On creation the employer picker is absent: a company may not exist yet to pick. */
test("a brand-new person is not asked who they work for", async () => {
  const screen = await render(<IndividualHarness />);
  expect(screen.container.querySelector("#employer-search")).toBeNull();
});

test("a company is asked for its tax code and its representative", async () => {
  const screen = await render(<BusinessHarness />);

  await expect.element(screen.getByLabelText("Tên công ty* (bắt buộc)")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Mã số thuế* (bắt buộc)")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Họ tên* (bắt buộc)")).toBeInTheDocument();
  // "Người đại diện" also appears inside the four-channel rule below, so the heading is
  // matched exactly rather than by substring.
  await expect.element(screen.getByText("Người đại diện", { exact: true })).toBeInTheDocument();
});

test("a company's four channels are drawn as one visible block with one rule", async () => {
  const screen = await render(<BusinessHarness />);

  await expect.element(screen.getByLabelText("Điện thoại công ty")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Email công ty")).toBeInTheDocument();
  await expect
    .element(screen.getByText(/Cần ít nhất một số điện thoại hoặc email/))
    .toBeInTheDocument();
});

test("a company is never asked for a birthday or a relationship", async () => {
  const screen = await render(<BusinessHarness />);
  expect(screen.container.querySelector("#individual-dob")).toBeNull();
  expect(screen.container.querySelector("#individual-relationship")).toBeNull();
});

test("the employer picker offers companies and records the one chosen", async () => {
  const screen = await render(
    <PickerHarness
      contacts={[
        company({ id: "b1", name: "Công ty An Phát" }),
        person({ id: "p1", name: "Người Thường" }),
      ]}
    />,
  );

  await userEvent.click(screen.getByLabelText("Làm việc cho"));
  await userEvent.click(screen.getByRole("button", { name: /An Phát/ }));

  await expect.element(screen.getByTestId("value")).toHaveTextContent("b1");
});

test("the picker never offers a person as a place of work", async () => {
  const screen = await render(
    <PickerHarness
      contacts={[company({ id: "b1", name: "Acme" }), person({ id: "p1", name: "Người Thường" })]}
    />,
  );

  await userEvent.click(screen.getByLabelText("Làm việc cho"));
  await expect.element(screen.getByRole("button", { name: /Acme/ })).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Người Thường");
});

test("a chosen employer can be taken back off", async () => {
  const screen = await render(
    <PickerHarness contacts={[company({ id: "b1", name: "Acme" })]} initial="b1" />,
  );

  await expect.element(screen.getByText("Acme")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bỏ Acme khỏi nơi làm việc" }));

  await expect.element(screen.getByTestId("value")).toHaveTextContent("none");
});

test("with no companies in the book the field says so instead of opening an empty list", async () => {
  const screen = await render(<PickerHarness contacts={[person({ id: "p1", name: "A" })]} />);

  const input = screen.getByLabelText("Làm việc cho");
  await expect.element(input).toBeDisabled();
  await expect.element(input).toHaveAttribute("placeholder", "Chưa có liên hệ doanh nghiệp nào");
});

test("a company is never offered as its own employer", async () => {
  const screen = await render(
    <PickerHarness
      contacts={[company({ id: "b1", name: "Acme" }), company({ id: "b2", name: "Beta" })]}
      excludeId="b1"
    />,
  );

  await userEvent.click(screen.getByLabelText("Làm việc cho"));
  await expect.element(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Acme");
});

test("a search matching no company says so rather than showing a blank list", async () => {
  const screen = await render(<PickerHarness contacts={[company({ id: "b1", name: "Acme" })]} />);

  await userEvent.fill(screen.getByLabelText("Làm việc cho"), "zzzz");
  await expect.element(screen.getByText("Không có doanh nghiệp nào khớp.")).toBeInTheDocument();
});
