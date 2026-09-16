import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "@/lib/contact-import";
import type { Contact, IndividualDraft, InviteMethod } from "@/lib/contacts";

const state = vi.hoisted(() => ({
  contacts: [] as Contact[],
  created: [] as { type: string; name: string }[],
  saved: [] as { contactId: string; draft: unknown }[],
  invited: [] as { contactId: string; method: string }[],
  channels: [] as {
    contactId: string;
    kind: string;
    value: string;
    source: string;
    label: string | null;
    needsReview: boolean;
  }[],
  createError: null as string | null,
  navigated: [] as string[],
  nextId: 0,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

vi.mock("@/lib/use-contacts", () => ({
  useContacts: () => ({ data: state.contacts, isPending: false, isError: false }),
  useContactActions: () => ({
    addIndividual: async (draft: IndividualDraft) => {
      if (state.createError !== null) throw new Error(state.createError);
      state.created.push({ type: "individual", name: draft.name });
      state.nextId += 1;
      return {
        ...blank(`new-${state.nextId}`, draft.name),
        phone: draft.phone.length > 0 ? draft.phone : null,
        email: draft.email.length > 0 ? draft.email : null,
      };
    },
    addBusiness: async (draft: { name: string }) => {
      if (state.createError !== null) throw new Error(state.createError);
      state.created.push({ type: "business", name: draft.name });
      state.nextId += 1;
      return { ...blank(`new-${state.nextId}`, draft.name), contactType: "business" as const };
    },
    saveIndividual: async (contactId: string, draft: IndividualDraft) => {
      state.saved.push({ contactId, draft });
      return { ...blank(contactId, draft.name) };
    },
    saveBusiness: async (contactId: string, draft: { name: string }) => {
      state.saved.push({ contactId, draft });
      return { ...blank(contactId, draft.name), contactType: "business" as const };
    },
    invite: async (contactId: string, method: InviteMethod) => {
      state.invited.push({ contactId, method });
      return "tok";
    },
    isWorking: false,
  }),
}));

// The channel table is reached through these two calls only: one to read what the book already
// holds, one to file a value that did not fit on the contact row.
vi.mock("@/lib/contact-channels", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/contact-channels")>("@/lib/contact-channels");
  return {
    ...actual,
    fetchContactChannels: async () => [],
    addContactChannel: async (input: {
      contactId: string;
      kind: string;
      value: string;
      source?: string;
      label?: string | null;
      needsReview?: boolean;
    }) => {
      state.channels.push({
        contactId: input.contactId,
        kind: input.kind,
        value: input.value,
        source: input.source ?? "manual",
        label: input.label ?? null,
        needsReview: input.needsReview ?? false,
      });
      return { id: `ch-${state.channels.length}` };
    },
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      state.navigated.push(to);
    },
  };
});

const { ImportContactsDialog } = await import("@/components/contacts/ImportContactsDialog");
const { CHANNEL_REVIEW_ROUTE } = await import("@/lib/navigation");

function blank(id: string, name: string): Contact {
  return {
    id,
    ownerUserId: "u-me",
    contactType: "individual",
    name,
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
  };
}

const HEADER = IMPORT_COLUMNS.join(",");

function line(cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>): string {
  return IMPORT_COLUMNS.map((column) => cells[column] ?? "").join(",");
}

/** A chosen file, as the file input would hand it over. */
function csvFile(...lines: string[]): File {
  return new File([lines.join("\r\n")], "lien-he.csv", { type: "text/csv" });
}

/**
 * A phone book export, as a phone would hand it over.
 *
 * Given the MIME type iOS sends, to hold the reader to choosing by extension: the same file
 * arrives as `text/vcard`, `text/x-vcard` or nothing at all depending on the device.
 */
function vcardFile(...cards: string[][]): File {
  const text = cards
    .map((lines) => ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD"].join("\r\n"))
    .join("\r\n");
  return new File([text], "Danh bạ.vcf", { type: "text/vcard" });
}

async function openDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportContactsDialog open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Choosing a file and landing on the preview table.
 *
 * The visible button is matched by its exact label: the hidden file input is itself exposed as
 * a button named "Chọn file liên hệ", so a loose match finds two elements.
 */
async function upload(screen: Awaited<ReturnType<typeof openDialog>>, file: File) {
  await userEvent.click(screen.getByRole("button", { name: "Chọn file .csv, .xlsx hoặc .vcf" }));
  // The dialog is portalled to the body, so the input is looked up there rather than in the
  // render container, which holds only the mount point.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  await userEvent.upload(input, file);
}

beforeEach(() => {
  state.contacts = [];
  state.created = [];
  state.saved = [];
  state.invited = [];
  state.channels = [];
  state.createError = null;
  state.navigated = [];
  state.nextId = 0;
});

test("the first step offers the template before asking for a file", async () => {
  const screen = await openDialog();

  await expect.element(screen.getByRole("button", { name: "Tải file mẫu" })).toBeInTheDocument();
  await expect.element(screen.getByText(/Xoá 2 dòng đó trước khi nhập/)).toBeInTheDocument();
});

/**
 * Absent rather than greyed out. This browser has no phone book, and a disabled button would
 * pose a question it cannot answer — the file route below works everywhere.
 */
test("the phone book route is left out where the browser has none", async () => {
  const screen = await openDialog();

  await expect.element(screen.getByRole("button", { name: "Tải file mẫu" })).toBeInTheDocument();
  expect(screen.container.ownerDocument.body.textContent).not.toContain("Chọn từ danh bạ máy");
});

test("a file lands in a preview that counts what it found", async () => {
  const screen = await openDialog();

  await upload(
    screen,
    csvFile(
      HEADER,
      line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" }),
      line({ ten: "Không loại" }),
    ),
  );

  await expect.element(screen.getByText("1 liên hệ sẵn sàng")).toBeInTheDocument();
  // The line that could not be read is still accounted for, so nothing vanishes silently.
  await expect.element(screen.getByText(/1 dòng trong file bị thiếu trường bắt buộc/)).toBeInTheDocument();
});

/** Nothing is written without a deliberate tick, so the button starts out unusable. */
test("nothing is ticked to begin with and the import button is disabled", async () => {
  const screen = await openDialog();

  await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" })));

  const importButton = screen.getByRole("button", { name: /^Nhập 0 liên hệ/ });
  await expect.element(importButton).toBeDisabled();
  expect(document.querySelectorAll('[role="checkbox"][data-state="checked"]')).toHaveLength(0);
});

test("ticking a row makes the button say how many will be written", async () => {
  const screen = await openDialog();

  await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" })));
  await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));

  await expect.element(screen.getByRole("button", { name: "Nhập 1 liên hệ đã chọn" })).toBeEnabled();
});

/**
 * A file that does not use our column names is no longer refused.
 *
 * It used to be: "thiếu cột loai hoặc ten", which asked somebody to go and rename their
 * columns to ours. Now the same file is asked about instead — and "ho_ten" is recognised as
 * the name by itself, while "so_dt" is a word nobody can interpret and stays blank.
 */
test("a file without our column names is asked about rather than refused", async () => {
  const screen = await openDialog();

  await upload(screen, csvFile("ho_ten,so_dt", "Anh,0912345678"));

  await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();
  await expect.element(screen.getByLabelText(/^Tên/)).toBeInTheDocument();
  expect(document.querySelector<HTMLSelectElement>("#map-ten")?.value).toBe("ho_ten");
  expect(document.querySelector<HTMLSelectElement>("#map-dien_thoai")?.value).toBe("");
});

test("a file past the row limit says so instead of starting", async () => {
  const screen = await openDialog();

  const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_unused, index) =>
    line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
  );
  await upload(screen, csvFile(HEADER, ...body));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(`vượt giới hạn ${MAX_IMPORT_ROWS}`);
});

test("each row is written as the type its own column named", async () => {
  const screen = await openDialog();

  await upload(
    screen,
    csvFile(
      HEADER,
      line({ loai: "ca_nhan", ten: "Người Thường", dien_thoai: "0912345678" }),
      line({
        loai: "doanh_nghiep",
        ten: "Công ty An Phát",
        ma_so_thue: "0301234567",
        nguoi_dai_dien: "Chị Bích",
        email: "c@example.com",
      }),
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Nhập 2 liên hệ/ }));

  await expect.element(screen.getByText(/Đã nhập 2 liên hệ mới/)).toBeInTheDocument();
  expect(state.created).toEqual([
    { type: "individual", name: "Người Thường" },
    { type: "business", name: "Công ty An Phát" },
  ]);
  // A file that states its own type is never asked about it again.
  expect(state.navigated).toEqual([]);
});

describe("a row carrying two numbers", () => {
  async function importBoth() {
    const screen = await openDialog();
    await upload(
      screen,
      csvFile(
        HEADER,
        line({
          loai: "ca_nhan",
          ten: "Chị Hoa",
          dien_thoai: "0912345678",
          dien_thoai_2: "0987000111",
        }),
      ),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));
    return screen;
  }

  it("says which number becomes the main one before anything is written", async () => {
    const screen = await openDialog();
    await upload(
      screen,
      csvFile(
        HEADER,
        line({
          loai: "ca_nhan",
          ten: "Chị Hoa",
          dien_thoai: "0912345678",
          dien_thoai_2: "0987000111",
        }),
      ),
    );

    await expect.element(screen.getByText(/\+ 1 kênh phụ/)).toBeInTheDocument();
    await expect
      .element(screen.getByText(/Số đầu tiên được dùng làm kênh chính/))
      .toBeInTheDocument();
  });

  /** The first of each kind goes on the contact row; everything after it is a channel. */
  it("keeps the first number on the contact and files the second as a channel", async () => {
    await importBoth();

    expect(state.created).toEqual([{ type: "individual", name: "Chị Hoa" }]);
    expect(state.channels).toEqual([
      {
        contactId: "new-1",
        kind: "phone",
        value: "0987000111",
        source: "import_csv",
        // A spreadsheet has no notion of what to call a number, so nothing is suggested.
        label: null,
        needsReview: true,
      },
    ]);
  });

  /**
   * Two of a kind is the one thing an import cannot settle by itself, so the flow ends by
   * handing the question over rather than leaving it to be discovered later.
   */
  it("ends by pointing at the numbers a person still has to choose between", async () => {
    const screen = await importBoth();

    await userEvent.click(screen.getByRole("button", { name: "Để sau" }));

    await expect.element(screen.getByText(/1 liên hệ cần bạn xem lại/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Xem lại ngay/ }));
    expect(state.navigated).toEqual([CHANNEL_REVIEW_ROUTE]);
  });
});

/** With nothing left open, the same slot says so and goes back to the book. */
test("a clean import ends on a plain confirmation instead of a question", async () => {
  const screen = await openDialog();

  await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" })));
  await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));
  await userEvent.click(screen.getByRole("button", { name: "Để sau" }));

  await expect.element(screen.getByText(/không còn gì phải xem lại/)).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Quay lại Liên hệ" })).toBeInTheDocument();
  expect(state.channels).toEqual([]);
});

describe("a row that matches someone already in the book", () => {
  beforeEach(() => {
    state.contacts = [{ ...blank("c1", "Chị Hoa"), phone: "0912345678" }];
  });

  test("is flagged with the name it collides with and defaults to being skipped", async () => {
    const screen = await openDialog();

    await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Hoa Mới", dien_thoai: "+84 912 345 678" })));

    await expect.element(screen.getByText(/Trùng số điện thoại/)).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Bỏ qua" })).toHaveAttribute("aria-pressed", "true");
  });

  test("offers all three ways out", async () => {
    const screen = await openDialog();

    await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Hoa Mới", dien_thoai: "0912345678" })));

    await expect.element(screen.getByRole("button", { name: "Gộp" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Bỏ qua" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Vẫn tạo mới" })).toBeInTheDocument();
  });

  test("writes nothing when left on skip, even though it was ticked", async () => {
    const screen = await openDialog();

    await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Hoa Mới", dien_thoai: "0912345678" })));
    await userEvent.click(screen.getByRole("checkbox", { name: /Hoa Mới/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Không có liên hệ nào được nhập");
    expect(state.created).toEqual([]);
    expect(state.saved).toEqual([]);
    expect(state.channels).toEqual([]);
  });

  test("fills the gaps in the existing contact when merge is chosen", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      csvFile(HEADER, line({ loai: "ca_nhan", ten: "Hoa Mới", dien_thoai: "0912345678", email: "hoa@example.com" })),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Hoa Mới/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gộp" }));
    await expect.element(screen.getByText(/không ghi đè cái đã có/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([]);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({
      contactId: "c1",
      // The name and phone already there survive; only the missing email is filled in.
      draft: { name: "Chị Hoa", phone: "0912345678", email: "hoa@example.com" },
    });
  });

  /**
   * Every value is offered to the channel call, which keeps only what is neither the primary
   * channel nor already stored — that is how a merge can add a number without overwriting one.
   */
  test("hands the merged contact's numbers to the one place that can compare them", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      csvFile(
        HEADER,
        line({
          loai: "ca_nhan",
          ten: "Hoa Mới",
          dien_thoai: "0912345678",
          dien_thoai_2: "0987000111",
        }),
      ),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Hoa Mới/ }));
    await userEvent.click(screen.getByRole("button", { name: "Gộp" }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.channels.map((entry) => entry.value)).toEqual(["0912345678", "0987000111"]);
    expect(state.channels.every((entry) => entry.contactId === "c1")).toBe(true);
  });

  test("writes a second contact when create is chosen instead", async () => {
    const screen = await openDialog();

    await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Hoa Mới", dien_thoai: "0912345678" })));
    await userEvent.click(screen.getByRole("checkbox", { name: /Hoa Mới/ }));
    await userEvent.click(screen.getByRole("button", { name: "Vẫn tạo mới" }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([{ type: "individual", name: "Hoa Mới" }]);
    expect(state.saved).toEqual([]);
  });
});

describe("inviting the people just imported", () => {
  async function importTwoPeople() {
    const screen = await openDialog();
    await upload(
      screen,
      csvFile(
        HEADER,
        line({ loai: "ca_nhan", ten: "Chị Email", email: "chi@example.com" }),
        line({ loai: "ca_nhan", ten: "Anh Phone", dien_thoai: "0912345678" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 2 liên hệ/ }));
    return screen;
  }

  test("everyone new is ticked, ready to be sent", async () => {
    const screen = await importTwoPeople();

    await expect.element(screen.getByText(/2 người chưa dùng AVORA/)).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Gửi lời mời cho 2 người" })).toBeEnabled();
  });

  /** The same rule the RPC enforces: a channel with no address is never drawn. */
  test("each person is offered only the channel they have an address for", async () => {
    const screen = await importTwoPeople();

    await expect.element(screen.getByRole("button", { name: "Email" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Tin nhắn" })).toBeInTheDocument();
    // Two people, one channel each — not two buttons apiece.
    expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(2);
  });

  test("sends each invitation by the channel that person's row was offered", async () => {
    const screen = await importTwoPeople();

    await userEvent.click(screen.getByRole("button", { name: /Gửi lời mời cho 2 người/ }));

    expect(state.invited).toEqual([
      { contactId: "new-1", method: "email" },
      { contactId: "new-2", method: "sms" },
    ]);
  });

  test("someone unticked is left alone", async () => {
    const screen = await importTwoPeople();

    await userEvent.click(screen.getByRole("checkbox", { name: "Mời Anh Phone" }));
    await userEvent.click(screen.getByRole("button", { name: /Gửi lời mời cho 1 người/ }));

    expect(state.invited).toEqual([{ contactId: "new-1", method: "email" }]);
  });

  test("inviting can be left for later without sending anything", async () => {
    const screen = await importTwoPeople();

    await userEvent.click(screen.getByRole("button", { name: "Để sau" }));

    expect(state.invited).toEqual([]);
  });
});

/** A refusal on one line is attributed to that line; the rest of the file still goes in. */
test("a row the server refuses is reported by where it came from", async () => {
  const screen = await openDialog();

  state.createError = "Liên hệ cần có tên.";
  await upload(screen, csvFile(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" })));
  await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Liên hệ cần có tên.");
});

/**
 * The phone book file route.
 *
 * This is the only bulk import an iPhone owner can perform — Safari has no contacts picker —
 * so these run the same dialog, the same preview and the same writing code as the spreadsheet.
 */
describe("importing a phone book file", () => {
  test("the first step says a .vcf is accepted without the template", async () => {
    const screen = await openDialog();

    await expect
      .element(screen.getByText(/xuất từ iPhone hay Android/))
      .toBeInTheDocument();
  });

  test("reads every card in the file, not only the first", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile(
        ["FN:Nguyễn Văn An", "TEL;type=CELL:0912345678"],
        ["FN:Trần Thị Bích", "TEL;type=CELL:0987000111"],
        ["FN:Lê Văn C", "EMAIL:c@example.com"],
      ),
    );

    await expect.element(screen.getByText("3 liên hệ sẵn sàng")).toBeInTheDocument();
  });

  /** The requirement that matters most: a second number must not be thrown away. */
  test("keeps every number on a card, not just the first", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile([
        "FN:Nhiều Số",
        "TEL;type=CELL:0912345678",
        "TEL;type=WORK:02838220011",
        "EMAIL;type=WORK:work@example.com",
        "EMAIL;type=HOME:home@example.com",
      ]),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Nhiều Số/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    // First of each kind becomes the contact's own field; the rest are filed as channels.
    expect(state.channels.map((entry) => entry.value)).toEqual([
      "02838220011",
      "home@example.com",
    ]);
  });

  test("records where the numbers came from", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile(["FN:Hai Số", "TEL:0912345678", "TEL:0987000111"]),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Hai Số/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.channels.map((entry) => entry.source)).toEqual(["import_vcf"]);
  });

  /** TYPE= pre-fills a name for the channel. It is a suggestion, never a decision. */
  test("passes the card's own words on as a suggested label", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile(["FN:Có Nhãn", "TEL;type=CELL:0912345678", "TEL;type=WORK:02838220011"]),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Có Nhãn/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.channels).toEqual([
      expect.objectContaining({ value: "02838220011", label: "Cơ quan" }),
    ]);
  });

  /**
   * A company suggestion still has to be confirmed. The card cannot supply a tax code, so the
   * row stays unpickable until a person fills the two fields a company cannot exist without.
   */
  test("a company suggestion still waits for the person to complete it", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile([
        "FN:Công ty Cổ phần Sen Vàng",
        "ORG:Công ty Cổ phần Sen Vàng;Kinh doanh",
        "X-ABShowAs:COMPANY",
        "TEL;type=WORK:19001234",
      ]),
    );

    await expect.element(screen.getByText("0 liên hệ sẵn sàng")).toBeInTheDocument();
    await expect.element(screen.getByText(/Doanh nghiệp cần mã số thuế/)).toBeInTheDocument();
  });

  /** An employer beside a person's name is not a company contact. */
  test("does not file a person as a company for having an employer", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      vcardFile([
        "N:Nguyễn;An;;;",
        "FN:Nguyễn Văn An",
        "ORG:Công ty TNHH An Phát;",
        "TEL;type=CELL:0912345678",
      ]),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Nguyễn Văn An/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([{ type: "individual", name: "Nguyễn Văn An" }]);
  });

  /** Same dedup as every other route — no separate branch for phone book files. */
  test("matches against the book the same way a spreadsheet does", async () => {
    state.contacts = [{ ...blank("c1", "Chị Hoa"), phone: "0912345678" }];
    const screen = await openDialog();

    await upload(screen, vcardFile(["FN:Hoa Mới", "TEL:+84 912 345 678"]));

    await expect.element(screen.getByText(/Trùng số điện thoại/)).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Gộp" })).toBeInTheDocument();
  });

  /** An unreadable card costs one contact, never the whole address book. */
  test("keeps the rest of the file when one card is unreadable", async () => {
    const screen = await openDialog();

    const good = [
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Đọc được\r\nTEL:0912345678\r\nEND:VCARD",
      "BEGIN:VCARD\r\nkhông phải thẻ\r\n",
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Cũng được\r\nTEL:0987000111\r\nEND:VCARD",
    ].join("\r\n");

    await upload(screen, new File([good], "Danh bạ.vcf", { type: "text/vcard" }));

    await expect.element(screen.getByText("2 liên hệ sẵn sàng")).toBeInTheDocument();
  });

  test("a phone book past the limit says so instead of starting", async () => {
    const screen = await openDialog();

    const cards = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_unused, index) => [
      `FN:Người ${index}`,
      `TEL:09${String(index).padStart(8, "0")}`,
    ]);
    await upload(screen, vcardFile(...cards));

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(`vượt giới hạn ${MAX_IMPORT_ROWS}`);
  });
});

describe("a file of real size", () => {
  /**
   * Only the rows near the viewport are in the document. Rendering five thousand at once is
   * what made the preview stutter, and the count line above still speaks for all of them.
   */
  test("renders a fraction of a long list, not all of it", async () => {
    const screen = await openDialog();

    const body = Array.from({ length: 800 }, (_unused, index) =>
      line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
    );
    await upload(screen, csvFile(HEADER, ...body));

    await expect.element(screen.getByText("800 liên hệ sẵn sàng")).toBeInTheDocument();

    const rendered = document.querySelectorAll('[role="checkbox"]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
  });

  /** Ticking all of them is one act, and it must count every row, not the rendered few. */
  test("selecting all covers the rows that were never drawn", async () => {
    const screen = await openDialog();

    const body = Array.from({ length: 800 }, (_unused, index) =>
      line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
    );
    await upload(screen, csvFile(HEADER, ...body));
    await userEvent.click(screen.getByRole("button", { name: /Chọn tất cả 800/ }));

    await expect
      .element(screen.getByRole("button", { name: "Nhập 800 liên hệ đã chọn" }))
      .toBeEnabled();
  });

  /** A short list is left exactly as it was: no inner scroller, every row present. */
  test("leaves a short list rendered in full", async () => {
    const screen = await openDialog();

    const body = Array.from({ length: 6 }, (_unused, index) =>
      line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
    );
    await upload(screen, csvFile(HEADER, ...body));

    // Waited for before counting: a bare query runs before the preview has rendered and
    // would report zero rows whatever the component did.
    await expect.element(screen.getByText("6 liên hệ sẵn sàng")).toBeInTheDocument();
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(6);
  });

  /** Failures are reported in file order, however the parallel writes happened to finish. */
  test("reports failures in the order they appear in the file", async () => {
    const screen = await openDialog();

    state.createError = "Máy chủ từ chối.";
    await upload(
      screen,
      csvFile(
        HEADER,
        line({ loai: "ca_nhan", ten: "Một", email: "a@example.com" }),
        line({ loai: "ca_nhan", ten: "Hai", email: "b@example.com" }),
        line({ loai: "ca_nhan", ten: "Ba", email: "c@example.com" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 3 liên hệ/ }));

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Máy chủ từ chối.");
  });

  /** Everything ticked is written, and the run does not stop at the first refusal. */
  test("writes every ticked row even when one of them fails", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      csvFile(
        HEADER,
        ...Array.from({ length: 40 }, (_unused, index) =>
          line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
        ),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /Chọn tất cả 40/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 40 liên hệ/ }));

    expect(state.created).toHaveLength(40);
    // File order survives the parallel run, so the closing report reads the way the file does.
    expect(state.created[0].name).toBe("Người 0");
  });
});

/**
 * A file that does not use our column names.
 *
 * This is what almost every real file looks like: exported from a CRM, an old phone, an
 * accountant's spreadsheet. Before this step each one was refused at the door for lacking a
 * column literally called `ten`.
 */
describe("a file with somebody else's column names", () => {
  /** A file with its own headings, as another system would have written it. */
  function foreignFile(...lines: string[]): File {
    return new File([lines.join("\r\n")], "crm-export.csv", { type: "text/csv" });
  }

  const FOREIGN = ["Họ tên", "SĐT", "Ghi chú"].join(",");

  beforeEach(() => {
    window.localStorage.clear();
  });

  test("asks which column is which instead of refusing the file", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,khách quen"));

    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();
    // The old behaviour, which this step replaces.
    expect(document.body.textContent).not.toContain("thiếu cột loai hoặc ten");
  });

  /** Recognised headings arrive already filled in, so most files are one click. */
  test("fills in the columns it recognised itself", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,khách quen"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const name = document.querySelector<HTMLSelectElement>("#map-ten");
    const phone = document.querySelector<HTMLSelectElement>("#map-dien_thoai");
    const note = document.querySelector<HTMLSelectElement>("#map-ghi_chu");
    expect(name?.value).toBe("Họ tên");
    expect(phone?.value).toBe("SĐT");
    expect(note?.value).toBe("Ghi chú");
  });

  test("carries the mapped file into the preview that already existed", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,khách quen"));
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));

    await expect.element(screen.getByText("1 liên hệ sẵn sàng")).toBeInTheDocument();
    await expect.element(screen.getByRole("checkbox", { name: /Chị Hoa/ })).toBeInTheDocument();
  });

  /** The whole point: the mapped file is written by the same pipeline as the template. */
  test("writes the contact the mapped columns describe", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,khách quen"));
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([{ type: "individual", name: "Chị Hoa" }]);
  });

  /**
   * A heading nobody can interpret is left blank rather than guessed at. A plausible wrong
   * answer, pre-filled on a screen people click through, is how phone numbers end up in notes.
   */
  test("leaves a column it cannot interpret for the person to answer", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Chưa biết cột nào là Tên");
    expect(document.querySelector<HTMLSelectElement>("#map-ten")?.value).toBe("");
  });

  /**
   * Said here, once, about the file — rather than as two thousand identical per-row
   * complaints discovered one screen later.
   */
  test("will not continue until the name column is answered", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));

    await expect.element(screen.getByRole("button", { name: /Tiếp tục/ })).toBeDisabled();
  });

  test("accepts the column a person picks by hand", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const name = document.querySelector<HTMLSelectElement>("#map-ten");
    const phone = document.querySelector<HTMLSelectElement>("#map-dien_thoai");
    if (name === null || phone === null) throw new Error("no mapping selects");
    await userEvent.selectOptions(name, "Cột A");
    await userEvent.selectOptions(phone, "Cột B");

    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([{ type: "individual", name: "Chị Hoa" }]);
  });

  /** Our own template still goes straight through — no screen asking the obvious. */
  test("does not ask about our own template", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      csvFile(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" })),
    );

    await expect.element(screen.getByText("1 liên hệ sẵn sàng")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Ghép cột trong file của bạn");
  });

  /** A file of people says nowhere that they are people; the one answer covers the file. */
  test("asks what a file with no type column is, once", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const fallback = document.querySelector<HTMLSelectElement>("#map-fallback-type");
    expect(fallback?.value).toBe("individual");

    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Chị Hoa/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nhập 1 liên hệ/ }));

    expect(state.created).toEqual([{ type: "individual", name: "Chị Hoa" }]);
  });

  test("names the columns it will not be importing", async () => {
    const screen = await openDialog();

    await upload(
      screen,
      foreignFile(["Họ tên", "SĐT", "Điểm tín dụng"].join(","), "Chị Hoa,0912345678,720"),
    );

    await expect.element(screen.getByText(/Không dùng cột: Điểm tín dụng/)).toBeInTheDocument();
  });

  test("goes back to the source list without importing anything", async () => {
    const screen = await openDialog();

    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,"));
    await userEvent.click(screen.getByRole("button", { name: "Chọn file khác" }));

    await expect.element(screen.getByRole("button", { name: "Tải file mẫu" })).toBeInTheDocument();
    expect(state.created).toEqual([]);
  });

  /**
   * The same monthly export should not need answering twice.
   *
   * Done the way a person does it — one file, then another through "Chọn nguồn khác" — rather
   * than by mounting the dialog twice, which tests the harness more than the product.
   */
  test("remembers the mapping for the next file with the same columns", async () => {
    const screen = await openDialog();
    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const name = document.querySelector<HTMLSelectElement>("#map-ten");
    const phone = document.querySelector<HTMLSelectElement>("#map-dien_thoai");
    if (name === null || phone === null) throw new Error("no mapping selects");
    await userEvent.selectOptions(name, "Cột A");
    await userEvent.selectOptions(phone, "Cột B");
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));

    // Back out to the sources and bring the next export of the same report.
    await userEvent.click(screen.getByRole("button", { name: "Chọn nguồn khác" }));
    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Anh Bình,0987000111"));

    await expect
      .element(screen.getByText(/Đã dùng lại cách ghép cột bạn chọn lần trước/))
      .toBeInTheDocument();
    expect(document.querySelector<HTMLSelectElement>("#map-ten")?.value).toBe("Cột A");
    expect(document.querySelector<HTMLSelectElement>("#map-dien_thoai")?.value).toBe("Cột B");
  });

  /**
   * A remembered layout is still shown for review, never applied behind anyone's back: last
   * month's report may have grown a column since, and this file is about to be written to the
   * address book.
   */
  test("still shows a remembered mapping rather than skipping the step", async () => {
    const screen = await openDialog();
    await upload(screen, foreignFile(FOREIGN, "Chị Hoa,0912345678,"));
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));

    await userEvent.click(screen.getByRole("button", { name: "Chọn nguồn khác" }));
    await upload(screen, foreignFile(FOREIGN, "Anh Bình,0987000111,"));

    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /Tiếp tục/ })).toBeEnabled();
  });

  test("does not reuse a mapping for a file with different columns", async () => {
    const screen = await openDialog();
    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const name = document.querySelector<HTMLSelectElement>("#map-ten");
    const phone = document.querySelector<HTMLSelectElement>("#map-dien_thoai");
    if (name === null || phone === null) throw new Error("no mapping selects");
    await userEvent.selectOptions(name, "Cột A");
    await userEvent.selectOptions(phone, "Cột B");
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));

    await userEvent.click(screen.getByRole("button", { name: "Chọn nguồn khác" }));
    await upload(screen, foreignFile(["Cột X", "Cột Y"].join(","), "Anh Bình,0987000111"));

    expect(document.querySelector<HTMLSelectElement>("#map-ten")?.value).toBe("");
    expect(document.body.textContent).not.toContain("Đã dùng lại cách ghép cột");
  });

  /**
   * A name with no way of reaching anybody is still refused, and said where the columns are
   * chosen rather than a screen later: the answer is one dropdown away.
   */
  test("says so when the mapped columns leave nothing importable", async () => {
    const screen = await openDialog();
    await upload(screen, foreignFile(["Cột A", "Cột B"].join(","), "Chị Hoa,0912345678"));
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();

    const name = document.querySelector<HTMLSelectElement>("#map-ten");
    if (name === null) throw new Error("no mapping selects");
    await userEvent.selectOptions(name, "Cột A");
    await userEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));

    // Still on the mapping step, with the reason — the phone column was never chosen.
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Không có dòng nào dùng được");
    await expect.element(screen.getByText("Ghép cột trong file của bạn")).toBeInTheDocument();
  });
});
