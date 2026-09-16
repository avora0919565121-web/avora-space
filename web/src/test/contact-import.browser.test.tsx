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
      needsReview?: boolean;
    }) => {
      state.channels.push({
        contactId: input.contactId,
        kind: input.kind,
        value: input.value,
        source: input.source ?? "manual",
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
  await userEvent.click(screen.getByRole("button", { name: "Chọn file .csv hoặc .xlsx" }));
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

test("a file without the columns it needs is refused as a whole", async () => {
  const screen = await openDialog();

  await upload(screen, csvFile("ho_ten,so_dt", "Anh,0912345678"));

  await expect.element(screen.getByRole("alert")).toHaveTextContent("thiếu cột loai hoặc ten");
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
