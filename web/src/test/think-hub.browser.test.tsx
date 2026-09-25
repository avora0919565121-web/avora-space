import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { MemoryRouter } from "react-router-dom";
import { render } from "vitest-browser-react";

import type { ThinkRecord, ThinkTable, RecordPatch } from "@/lib/think-hub";

const state = vi.hoisted(() => ({
  tables: [] as ThinkTable[],
  records: [] as ThinkRecord[],
  ensured: 0,
  createdTables: [] as string[],
  createdRecords: [] as { tableId: string; title: string; extension: unknown }[],
  patched: [] as { recordId: string; patch: RecordPatch }[],
  addedColumns: [] as { tableId: string; label: string; type: string; options?: readonly string[] }[],
  createRecordError: null as string | null,
  nextId: 0,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));
vi.mock("@/lib/use-conversations", () => ({ useConversations: () => ({ data: [] }) }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => ({ data: [] }) }));

// The reads and writes are the boundary; everything above them is the reasoning this file is
// about — what a first visit shows, what the two views do with the same records, and what
// happens at the ceiling.
vi.mock("@/lib/think-hub", async () => {
  const actual = await vi.importActual<typeof import("@/lib/think-hub")>("@/lib/think-hub");

  function table(over: Partial<ThinkTable> & { id: string; name: string }): ThinkTable {
    return {
      ownerUserId: "u-me",
      position: 0,
      columns: [],
      projectId: null, conversationId: null, parentRecordId: null, depth: 1, purpose: null, 
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      deletedAt: null,
      ...over,
    };
  }

  return {
    ...actual,
    fetchThinkTables: async () => state.tables,
    fetchThinkRecords: async () => state.records,
    ensureDefaultTable: async () => {
      state.ensured += 1;
      const row = table({ id: "t-default", name: "Bảng tổng hợp" });
      state.tables = [row];
      return row;
    },
    createThinkTable: async ({ name }: { name: string }) => {
      state.createdTables.push(name);
      state.nextId += 1;
      const row = table({ id: `t-new-${state.nextId}`, name, position: state.tables.length });
      state.tables = [...state.tables, row];
      return row;
    },
    addThinkColumn: async (input: {
      tableId: string;
      label: string;
      type: string;
      options?: readonly string[];
    }) => {
      state.addedColumns.push(input);
      state.nextId += 1;
      const key = `col_${state.nextId}`;
      state.tables = state.tables.map((entry) =>
        entry.id === input.tableId
          ? {
              ...entry,
              columns: [
                ...entry.columns,
                {
                  id: key,
                  key,
                  label: input.label,
                  type: input.type as "text" | "number" | "date" | "select",
                  ...(input.options === undefined ? {} : { options: input.options }),
                },
              ],
            }
          : entry,
      );
      return state.tables.find((entry) => entry.id === input.tableId) as ThinkTable;
    },
    createThinkRecord: async (input: {
      tableId: string;
      title: string;
      status?: string;
      extensionFields?: Record<string, string | number | null>;
    }) => {
      if (state.createRecordError !== null) throw new Error(state.createRecordError);
      state.createdRecords.push({
        tableId: input.tableId,
        title: input.title,
        extension: input.extensionFields,
      });
      state.nextId += 1;
      const row: ThinkRecord = {
        id: `r-new-${state.nextId}`,
        tableId: input.tableId,
        ownerUserId: "u-me",
        title: input.title,
        status: input.status ?? "moi",
        priority: "trung_binh",
        category: null,
        nextActionDate: null,
        remindAt: null,
        tags: [],
        notes: null,
        extensionFields: input.extensionFields ?? {},
        projectId: null,
        createdAt: "2026-09-10T00:00:00Z",
        updatedAt: "2026-09-10T00:00:00Z",
        deletedAt: null,
      };
      state.records = [row, ...state.records];
      return row;
    },
    updateThinkRecord: async (recordId: string, patch: RecordPatch) => {
      state.patched.push({ recordId, patch });
      state.records = state.records.map((entry) =>
        entry.id === recordId ? { ...entry, ...patch, tags: patch.tags ?? entry.tags } : entry,
      );
      return state.records.find((entry) => entry.id === recordId) as ThinkRecord;
    },
  };
});

const ThinkHub = (await import("@/pages/ThinkHub")).default;

function record(
  over: Partial<ThinkRecord> & { id: string; tableId: string },
): ThinkRecord {
  return {
    ownerUserId: "u-me",
    title: "Một mục",
    status: "moi",
    priority: "trung_binh",
    category: null,
    nextActionDate: null,
    remindAt: null,
    tags: [],
    notes: null,
    extensionFields: {},
    projectId: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

function businessTable(
  over: Partial<ThinkTable> & { id: string; name: string },
): ThinkTable {
  return {
    ownerUserId: "u-me",
    position: 0,
    columns: [],
    projectId: null, conversationId: null, parentRecordId: null, depth: 1, purpose: null, 
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <div style={{ width: 1100 }}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ThinkHub />
        </MemoryRouter>
      </QueryClientProvider>
    </div>,
  );
}

beforeEach(() => {
  state.tables = [];
  state.records = [];
  state.ensured = 0;
  state.createdTables = [];
  state.createdRecords = [];
  state.patched = [];
  state.addedColumns = [];
  state.createRecordError = null;
  state.nextId = 0;
});

/**
 * The first visit has to produce something to work in without asking for anything. A new user
 * who is shown an empty screen and a "create your first table" button has been given homework
 * before they know what a table here even is.
 */
test("the first visit lands in a table nobody had to create", async () => {
  const screen = await open();

  // Scoped to the table strip: the overview lists the same names, and a bare name lookup
  // would match both places at once.
  const strip = screen.getByRole("navigation", { name: "Các bảng" });
  await expect
    .element(strip.getByRole("button", { name: /Bảng tổng hợp/ }))
    .toBeInTheDocument();
  expect(state.ensured).toBe(1);
});

/** The seven default columns ARE the offer — they show before there is a single record. */
test("an empty table still shows the columns it is offering", async () => {
  const screen = await open();

  await expect.element(screen.getByRole("columnheader", { name: "Tiêu đề" })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("columnheader", { name: "Ngày cần làm tiếp" }))
    .toBeInTheDocument();
  await expect.element(screen.getByRole("columnheader", { name: "Nhãn" })).toBeInTheDocument();
});

test("a table is created by name and becomes the one on screen", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Tạo bảng mới" }));
  await userEvent.fill(screen.getByLabelText("Tên bảng"), "Công trình");
  await userEvent.click(screen.getByRole("button", { name: "Tạo bảng" }));

  expect(state.createdTables).toEqual(["Công trình"]);
  const strip = screen.getByRole("navigation", { name: "Các bảng" });
  await expect.element(strip.getByRole("button", { name: /Công trình/ })).toBeInTheDocument();
});

/**
 * Switching view is a way of looking, not a place you go: the same records have to be there
 * on the other side, grouped rather than reloaded.
 */
test("the board shows the same records the grid does, standing under their status", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = [
    record({ id: "r-1", tableId: "t-1", title: "Khách sạn ABC", status: "dang_lam" }),
    record({ id: "r-2", tableId: "t-1", title: "Kho Long Biên", status: "moi" }),
  ];

  const screen = await open();
  await expect.element(screen.getByText("Khách sạn ABC")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Theo trạng thái" }));

  await expect.element(screen.getByRole("region", { name: "Đang làm" })).toBeInTheDocument();
  await expect.element(screen.getByText("Khách sạn ABC")).toBeInTheDocument();
  await expect.element(screen.getByText("Kho Long Biên")).toBeInTheDocument();
});

/** A status the app never heard of is still the person's own word for their own work. */
test("the board keeps a status of the person's own rather than hiding its records", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = [
    record({ id: "r-1", tableId: "t-1", title: "Nhà xưởng số 3", status: "Đang thi công" }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Theo trạng thái" }));

  await expect.element(screen.getByRole("region", { name: "Đang thi công" })).toBeInTheDocument();
  await expect.element(screen.getByText("Nhà xưởng số 3")).toBeInTheDocument();
});

test("a new column is added to this table and appears at the end of the row", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột" }));
  await userEvent.fill(screen.getByLabelText("Tên cột"), "Giá trị hợp đồng");
  await userEvent.click(screen.getByRole("button", { name: "Số" }));
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột", exact: true }));

  expect(state.addedColumns).toEqual([
    { tableId: "t-1", label: "Giá trị hợp đồng", type: "number", options: undefined },
  ]);
  await expect
    .element(screen.getByRole("columnheader", { name: "Giá trị hợp đồng" }))
    .toBeInTheDocument();
});

/** A list with nothing to pick is a cell nobody can fill, so the form says so before saving. */
test("a choice column will not be added without any choices", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột" }));
  await userEvent.fill(screen.getByLabelText("Tên cột"), "Khu vực");
  await userEvent.click(screen.getByRole("button", { name: "Chọn 1 trong danh sách" }));
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột", exact: true }));

  await expect
    .element(screen.getByText("Cột dạng chọn cần ít nhất một lựa chọn."))
    .toBeInTheDocument();
  expect(state.addedColumns).toEqual([]);
});

/**
 * Adding a column must not disturb what is already written. This is the promise that makes a
 * custom column safe to add at all.
 */
test("adding a column leaves the records that came before it untouched", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = [record({ id: "r-1", tableId: "t-1", title: "Khách sạn ABC" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột" }));
  await userEvent.fill(screen.getByLabelText("Tên cột"), "Ghi chú thêm");
  await userEvent.click(screen.getByRole("button", { name: "Thêm cột", exact: true }));

  // The record is still there, and nothing was written to it to make room for the column.
  await expect.element(screen.getByText("Khách sạn ABC")).toBeInTheDocument();
  expect(state.patched).toEqual([]);
});

test("a record is written with only a title", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm Hạng mục" }));
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Kho Long Biên");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));

  expect(state.createdRecords).toHaveLength(1);
  expect(state.createdRecords[0].title).toBe("Kho Long Biên");
  await expect.element(screen.getByText("Kho Long Biên")).toBeInTheDocument();
});

/** An empty cell is "nobody filled this in", not a zero and not an empty word. */
test("a cell left blank is saved as nothing at all", async () => {
  state.tables = [
    businessTable({
      id: "t-1",
      name: "Bảng tổng hợp",
      columns: [{ id: "col_1", key: "col_1", label: "Giá trị", type: "number" }],
    }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm Hạng mục" }));
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Chưa định giá");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));

  expect(state.createdRecords[0].extension).toEqual({ col_1: null });
});

test("a number column refuses a word, and says which column it means", async () => {
  state.tables = [
    businessTable({
      id: "t-1",
      name: "Bảng tổng hợp",
      columns: [{ id: "col_1", key: "col_1", label: "Giá trị", type: "number" }],
    }),
  ];

  const screen = await open();
  await userEvent.click(screen.getByRole("button", { name: "Thêm Hạng mục" }));
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Khách sạn ABC");
  await userEvent.fill(screen.getByLabelText("Giá trị"), "nhiều lắm");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));

  await expect.element(screen.getByText('Cột "Giá trị" chỉ nhận số.')).toBeInTheDocument();
  expect(state.createdRecords).toEqual([]);
});

/**
 * The ceiling is refused before the form opens, not after somebody has typed a record out.
 * The server enforces it too — this is only the part that saves the wasted typing.
 */
test("a full table says so instead of opening the form", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = Array.from({ length: 1000 }, (_, index) =>
    record({ id: `r-${index}`, tableId: "t-1", title: `Mục ${index}` }),
  );

  const screen = await open();
  await expect
    .element(screen.getByText(/Bảng đã đầy 1\.000 mục, hãy dọn bớt trước khi thêm\./))
    .toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Thêm Hạng mục" }));

  expect(state.createdRecords).toEqual([]);
  expect(screen.container.textContent).not.toContain("Hạng mục mới");
});

/** A table one short of the ceiling behaves completely normally. */
test("a table one record short of the ceiling still accepts one", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = Array.from({ length: 999 }, (_, index) =>
    record({ id: `r-${index}`, tableId: "t-1", title: `Mục ${index}` }),
  );

  const screen = await open();
  expect(screen.container.textContent).not.toContain("Bảng đã đầy");

  await userEvent.click(screen.getByRole("button", { name: "Thêm Hạng mục" }));
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Mục cuối cùng");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));

  expect(state.createdRecords).toHaveLength(1);
});

/** Editing sends what changed; the record it names is the one that was opened. */
test("opening a record edits that record rather than writing a new one", async () => {
  state.tables = [businessTable({ id: "t-1", name: "Bảng tổng hợp" })];
  state.records = [record({ id: "r-1", tableId: "t-1", title: "Khách sạn ABC" })];

  const screen = await open();
  await userEvent.click(screen.getByText("Khách sạn ABC"));
  await userEvent.fill(screen.getByLabelText("Tiêu đề"), "Khách sạn ABC - giai đoạn 2");
  await userEvent.click(screen.getByRole("button", { name: "Lưu" }));

  expect(state.createdRecords).toEqual([]);
  expect(state.patched).toHaveLength(1);
  expect(state.patched[0].recordId).toBe("r-1");
  expect(state.patched[0].patch.title).toBe("Khách sạn ABC - giai đoạn 2");
});

/**
 * The overview counts across every table, not just the one being read — that is the whole
 * reason it exists above the table strip.
 */
test("the overview counts what is due across all the tables at once", async () => {
  const today = new Date();
  const iso = (offset: number): string => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  state.tables = [
    businessTable({ id: "t-1", name: "Bảng tổng hợp", position: 0 }),
    businessTable({ id: "t-2", name: "Công trình", position: 1 }),
  ];
  state.records = [
    record({ id: "r-1", tableId: "t-1", nextActionDate: iso(-3) }),
    record({ id: "r-2", tableId: "t-2", nextActionDate: iso(0) }),
    record({ id: "r-3", tableId: "t-2", nextActionDate: iso(2) }),
  ];

  const screen = await open();

  const space = screen.getByRole("region", { name: "Tổng quan kế hoạch" });
  await expect.element(space).toBeInTheDocument();
  await expect
    .element(screen.getByText(/3 mục cần theo dõi, trong đó 1 mục đã quá hạn\./))
    .toBeInTheDocument();
});
