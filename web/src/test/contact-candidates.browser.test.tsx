import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { CandidatePreview } from "@/components/contacts/CandidatePreview";
import {
  buildCandidateRows,
  summarizeCandidates,
  type CandidateChoice,
  type CandidateRow,
  type ImportedContactCandidate,
  type TypeDecision,
} from "@/lib/contact-candidates";
import { buildChannelIndex, type ContactChannel } from "@/lib/contact-channels";
import type { Contact } from "@/lib/contacts";

const ME = "u-me";

function person(over: Partial<Contact> & { id: string; name: string }): Contact {
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
    ...over,
  };
}

function candidate(
  over: Partial<ImportedContactCandidate> & { name: string },
): ImportedContactCandidate {
  return { phones: [], emails: [], suggestedType: null, source: "import_device", ...over };
}

/**
 * The preview with its own state, the way the dialog wires it.
 *
 * `picked`, `choices` and `decisions` live here rather than being asserted through props so the
 * tests exercise what a person actually does: tick, toggle, type, choose.
 */
function Harness({
  candidates,
  contacts = [],
  channels = [],
  onRows,
}: {
  candidates: ImportedContactCandidate[];
  contacts?: Contact[];
  channels?: ContactChannel[];
  onRows?: (rows: CandidateRow[], picked: Set<string>, decisions: Record<string, TypeDecision>) => void;
}) {
  const index = buildChannelIndex(contacts, channels);
  // Real origins, as both sources supply: "Dòng 4" from a file, "Danh bạ 2" from the phone.
  const rows = buildCandidateRows(
    candidates,
    index,
    candidates.map((_entry, position) => `Danh bạ ${position + 1}`),
  );

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, CandidateChoice>>({});
  const [decisions, setDecisions] = useState<Record<string, TypeDecision>>({});

  onRows?.(rows, picked, decisions);

  return (
    <div style={{ width: 660, padding: 16 }}>
      <CandidatePreview
        rows={rows}
        picked={picked}
        choices={choices}
        decisions={decisions}
        counts={summarizeCandidates(rows, decisions)}
        onToggle={(key) =>
          setPicked((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onToggleAll={() => setPicked(new Set(rows.map((row) => row.key)))}
        onChoice={(key, choice) => setChoices((current) => ({ ...current, [key]: choice }))}
        onDecision={(key, decision) => setDecisions((current) => ({ ...current, [key]: decision }))}
      />
    </div>
  );
}

test("nothing is ticked when the table first appears", async () => {
  let picked = new Set<string>();
  const screen = await render(
    <Harness
      candidates={[candidate({ name: "Chị Hoa", phones: ["0912345678"] })]}
      onRows={(_rows, current) => {
        picked = current;
      }}
    />,
  );

  await expect.element(screen.getByText("Chị Hoa")).toBeInTheDocument();
  await expect.element(screen.getByText("Danh bạ 1")).toBeInTheDocument();
  expect(picked.size).toBe(0);
});

test("a second number is named as a spare rather than hidden", async () => {
  const screen = await render(
    <Harness
      candidates={[
        candidate({ name: "Chị Hoa", phones: ["0912345678", "0987000111"], emails: ["a@e.com"] }),
      ]}
    />,
  );

  await expect.element(screen.getByText(/0912345678/)).toBeInTheDocument();
  await expect.element(screen.getByText(/\+ 1 kênh phụ/)).toBeInTheDocument();
  // The rule is stated where the consequence is, not left to be discovered on the review screen.
  await expect.element(screen.getByText(/Số đầu tiên được dùng làm kênh chính/)).toBeInTheDocument();
});

test("a match says who it collided with and on which value", async () => {
  const screen = await render(
    <Harness
      candidates={[candidate({ name: "Hoa", phones: ["+84 912 345 678"] })]}
      contacts={[person({ id: "c1", name: "Chị Hoa", phone: "0912345678" })]}
    />,
  );

  await expect.element(screen.getByText(/Trùng số điện thoại/)).toBeInTheDocument();
  await expect.element(screen.getByText("Chị Hoa")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Bỏ qua" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

/** The whole reason the channel table exists: a second number identifies its owner too. */
test("a match is found through a channel that is not the primary one", async () => {
  const screen = await render(
    <Harness
      candidates={[candidate({ name: "Hoa", phones: ["0900111222"] })]}
      contacts={[person({ id: "c1", name: "Chị Hoa", phone: "0912345678" })]}
      channels={[
        {
          id: "ch1",
          contactId: "c1",
          ownerUserId: ME,
          kind: "phone",
          value: "0900111222",
          valueNormalized: "0900111222",
          label: null,
          source: "import_csv",
          needsReview: false,
          createdAt: "2026-09-02T00:00:00Z",
          updatedAt: "2026-09-02T00:00:00Z",
        },
      ]}
    />,
  );

  await expect.element(screen.getByText(/Trùng số điện thoại/)).toBeInTheDocument();
  await expect.element(screen.getByText("Chị Hoa")).toBeInTheDocument();
});

/** A file states its own type, so the question is never put twice. */
test("a row whose type the source stated is not asked about", async () => {
  const screen = await render(
    <Harness
      candidates={[
        candidate({
          name: "Người",
          phones: ["0912345678"],
          suggestedType: "individual",
          source: "import_csv",
        }),
      ]}
    />,
  );

  await expect.element(screen.getByText("Cá nhân")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Đây là liên hệ doanh nghiệp?");
});

test("a phone book row is asked, and the toggle opens the two fields a company needs", async () => {
  const screen = await render(
    <Harness candidates={[candidate({ name: "An Phát", phones: ["02838220011"] })]} />,
  );

  // Off by default: a person is the ordinary case.
  await expect.element(screen.getByText("Cá nhân", { exact: true })).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Mã số thuế");

  await userEvent.click(screen.getByRole("switch"));

  await expect.element(screen.getByText("Doanh nghiệp", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByLabelText(/Mã số thuế/)).toBeInTheDocument();
  await expect.element(screen.getByLabelText(/Người đại diện/)).toBeInTheDocument();
});

test("a company cannot be ticked until its required fields are filled", async () => {
  const screen = await render(
    <Harness candidates={[candidate({ name: "An Phát", phones: ["02838220011"] })]} />,
  );

  await userEvent.click(screen.getByRole("switch"));

  // The checkbox is gone, not merely disabled — a disabled one invites a click that does nothing.
  await expect.element(screen.getByText(/Điền mã số thuế/)).toBeInTheDocument();
  expect(screen.container.querySelector('[role="checkbox"]')).toBeNull();

  await userEvent.fill(screen.getByLabelText(/Mã số thuế/), "0301234567");
  await expect.element(screen.getByText(/Điền tên người đại diện/)).toBeInTheDocument();

  await userEvent.fill(screen.getByLabelText(/Người đại diện/), "Chị Bích");
  await expect.element(screen.getByRole("checkbox")).toBeInTheDocument();
});

/** Pouring a person's details into a company row would produce nonsense. */
test("merging is not offered across the two kinds of contact", async () => {
  const screen = await render(
    <Harness
      candidates={[candidate({ name: "Ai đó", phones: ["02838220011"] })]}
      contacts={[
        person({
          id: "b1",
          name: "Công ty A",
          contactType: "business",
          taxCode: "0301234567",
          phone: "02838220011",
        }),
      ]}
    />,
  );

  await expect.element(screen.getByText(/Trùng số điện thoại/)).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Vẫn tạo mới" })).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Gộp");
});

test("the count line separates what is ready from what still needs filling in", async () => {
  const screen = await render(
    <Harness
      candidates={[
        candidate({ name: "Sẵn sàng", phones: ["0912345678"] }),
        candidate({ name: "An Phát", phones: ["02838220011"] }),
      ]}
    />,
  );

  await expect.element(screen.getByText("2 liên hệ sẵn sàng")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("switch").last());

  await expect.element(screen.getByText("1 liên hệ sẵn sàng")).toBeInTheDocument();
  await expect.element(screen.getByText("1 cần điền thêm")).toBeInTheDocument();
});

test("an entry with no way to reach it never reaches the table", async () => {
  const screen = await render(
    <Harness
      candidates={[
        candidate({ name: "Chị Hoa", phones: ["0912345678"] }),
        candidate({ name: "Không Số" }),
      ]}
    />,
  );

  await expect.element(screen.getByText("Chị Hoa")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Không Số");
  // The dropped entry takes its origin line with it rather than leaving a blank row.
  expect(screen.container.textContent).not.toContain("Danh bạ 2");
});
