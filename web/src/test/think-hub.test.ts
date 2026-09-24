import { describe, expect, it } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
import { vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  attentionSentence,
  cellValue,
  columnTypeLabel,
  groupByStatus,
  hubAttention,
  isTableFull,
  parseColumnDefs,
  parseExtensionFields,
  priorityLabel,
  RECORD_LIMIT,
  recordCountOf,
  recordsOf,
  statusLabel,
  SUGGESTED_STATUSES,
  toVietnameseHubError,
  visibleTables,
  type ThinkRecord,
  type ThinkTable,
  type ColumnDef,
  canGrowSubTable,
  DEPTH_LIMIT_MESSAGE,
  myTables,
  PERSONAL_SCOPE,
  rootTables,
  scopeOfTable,
  subTablesOf,
  suggestedSubTablePurpose,
  tableScope,
  tablesInScope,
} from "@/lib/think-hub";

const ME = "u-me";

function table(overrides: Partial<ThinkTable> & { id: string }): ThinkTable {
  return {
    ownerUserId: ME,
    name: "Bảng tổng hợp",
    position: 0,
    columns: [],
    projectId: null, conversationId: null, parentRecordId: null, depth: 1, purpose: null, 
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function record(
  overrides: Partial<ThinkRecord> & { id: string; tableId: string },
): ThinkRecord {
  return {
    ownerUserId: ME,
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
    ...overrides,
  };
}

describe("reading the column shape a table stored", () => {
  it("keeps a well-formed definition of every kind", () => {
    const defs = parseColumnDefs([
      { id: "col_a", key: "col_a", label: "Ghi chú", type: "text" },
      { id: "col_b", key: "col_b", label: "Giá trị", type: "number" },
      { id: "col_c", key: "col_c", label: "Ngày ký", type: "date" },
      { id: "col_d", key: "col_d", label: "Khu vực", type: "select", options: ["Bắc", "Nam"] },
    ]);

    expect(defs).toHaveLength(4);
    expect(defs[3]).toEqual({
      id: "col_d",
      key: "col_d",
      label: "Khu vực",
      type: "select",
      options: ["Bắc", "Nam"],
    });
  });

  /**
   * One unreadable column costs that column, never the table. A screen that refused to open
   * over a single bad definition would hide every record behind it, and the records are the
   * part somebody actually came for.
   */
  it("drops only the broken definitions and keeps the rest", () => {
    const defs = parseColumnDefs([
      { id: "col_a", key: "col_a", label: "Giữ lại", type: "text" },
      { key: "", label: "Không có khoá", type: "text" },
      { id: "col_c", key: "col_c", label: "   ", type: "text" },
      { id: "col_d", key: "col_d", label: "Kiểu lạ", type: "phone" },
      null,
      "chuỗi lạc",
      { id: "col_e", key: "col_e", label: "Cũng giữ", type: "number" },
    ]);

    expect(defs.map((def) => def.key)).toEqual(["col_a", "col_e"]);
  });

  /** A select with nothing to pick is a cell nobody can ever fill, so it is not a column. */
  it("drops a select column that has no options", () => {
    expect(parseColumnDefs([{ id: "col_a", key: "col_a", label: "Rỗng", type: "select", options: [] }])).toEqual(
      [],
    );
    expect(parseColumnDefs([{ id: "col_b", key: "col_b", label: "Thiếu", type: "select" }])).toEqual([]);
  });

  it("keeps the first of two definitions sharing a key", () => {
    const defs = parseColumnDefs([
      { id: "col_a", key: "col_a", label: "Bản đầu", type: "text" },
      { id: "col_a", key: "col_a", label: "Bản sau", type: "number" },
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe("Bản đầu");
  });

  it("reads anything that is not a list as no columns at all", () => {
    expect(parseColumnDefs(null)).toEqual([]);
    expect(parseColumnDefs({ key: "col_a" })).toEqual([]);
    expect(parseColumnDefs("[]")).toEqual([]);
  });
});

describe("reading the values someone typed into those columns", () => {
  it("keeps words and numbers, drops everything a cell cannot show", () => {
    expect(
      parseExtensionFields({ a: "chữ", b: 12, c: null, d: { sâu: 1 }, e: ["x"], f: true }),
    ).toEqual({ a: "chữ", b: 12 });
  });

  it("reads a missing or malformed bag as empty", () => {
    expect(parseExtensionFields(null)).toEqual({});
    expect(parseExtensionFields([1, 2])).toEqual({});
  });
});

describe("which tables belong on screen and in what order", () => {
  it("leaves out the ones put away", () => {
    const tables = visibleTables([
      table({ id: "t1" }),
      table({ id: "t2", deletedAt: "2026-09-02T00:00:00Z" }),
    ]);

    expect(tables.map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("orders by position, and by age when two share one", () => {
    const tables = visibleTables([
      table({ id: "t3", position: 2 }),
      table({ id: "t1", position: 0 }),
      table({ id: "t2b", position: 1, createdAt: "2026-09-05T00:00:00Z" }),
      table({ id: "t2a", position: 1, createdAt: "2026-09-03T00:00:00Z" }),
    ]);

    expect(tables.map((entry) => entry.id)).toEqual(["t1", "t2a", "t2b", "t3"]);
  });
});

describe("which records belong to a table", () => {
  const records: ThinkRecord[] = [
    record({ id: "r1", tableId: "t1", createdAt: "2026-09-01T00:00:00Z" }),
    record({ id: "r2", tableId: "t1", createdAt: "2026-09-03T00:00:00Z" }),
    record({ id: "r3", tableId: "t2" }),
    record({ id: "r4", tableId: "t1", deletedAt: "2026-09-04T00:00:00Z" }),
  ];

  it("takes only the live records of that one table, newest first", () => {
    expect(recordsOf(records, "t1").map((entry) => entry.id)).toEqual(["r2", "r1"]);
  });

  it("counts a table without counting what was put away", () => {
    expect(recordCountOf(records, "t1")).toBe(2);
    expect(recordCountOf(records, "t2")).toBe(1);
    expect(recordCountOf(records, "khong-co")).toBe(0);
  });
});

describe("the ceiling on one table", () => {
  function fill(count: number, extra: Partial<ThinkRecord> = {}): ThinkRecord[] {
    return Array.from({ length: count }, (_, index) =>
      record({ id: `r${index}`, tableId: "t1", ...extra }),
    );
  }

  it("is not reached one short of the limit", () => {
    expect(isTableFull(fill(RECORD_LIMIT - 1), "t1")).toBe(false);
  });

  it("is reached exactly at the limit", () => {
    expect(isTableFull(fill(RECORD_LIMIT), "t1")).toBe(true);
  });

  /**
   * Tidying up has to actually open space, otherwise "hãy dọn bớt trước khi thêm" is advice
   * that does not work — the same rule the server enforces when it counts.
   */
  it("opens back up when a record is put away", () => {
    const records = [...fill(RECORD_LIMIT - 1), record({ id: "last", tableId: "t1" })];
    expect(isTableFull(records, "t1")).toBe(true);

    const tidied = records.map((entry) =>
      entry.id === "last" ? { ...entry, deletedAt: "2026-09-05T00:00:00Z" } : entry,
    );
    expect(isTableFull(tidied, "t1")).toBe(false);
  });

  it("counts each table separately", () => {
    const records = [...fill(RECORD_LIMIT), record({ id: "other", tableId: "t2" })];
    expect(isTableFull(records, "t1")).toBe(true);
    expect(isTableFull(records, "t2")).toBe(false);
  });
});

describe("the board grouped by status", () => {
  /** A new table needs somewhere to drag a card TO, so the suggested columns always show. */
  it("shows the suggested columns even with nothing in them", () => {
    const columns = groupByStatus([]);
    expect(columns.map((column) => column.status)).toEqual([...SUGGESTED_STATUSES]);
    expect(columns.every((column) => column.records.length === 0)).toBe(true);
  });

  it("puts each record under its own status", () => {
    const columns = groupByStatus([
      record({ id: "r1", tableId: "t1", status: "moi" }),
      record({ id: "r2", tableId: "t1", status: "xong" }),
      record({ id: "r3", tableId: "t1", status: "moi" }),
    ]);

    const byStatus = new Map(columns.map((column) => [column.status, column.records.length]));
    expect(byStatus.get("moi")).toBe(2);
    expect(byStatus.get("xong")).toBe(1);
    expect(byStatus.get("dang_lam")).toBe(0);
  });

  /**
   * A status the app has never heard of is still somebody's word for their own work. Hiding
   * those records, or folding them into a catch-all, would lose them off the board.
   */
  it("gives a word of the person's own a column of its own, at the end", () => {
    const columns = groupByStatus([
      record({ id: "r1", tableId: "t1", status: "Đang thi công" }),
      record({ id: "r2", tableId: "t1", status: "moi" }),
    ]);

    expect(columns[columns.length - 1]).toEqual({
      status: "Đang thi công",
      label: "Đang thi công",
      records: [expect.objectContaining({ id: "r1" })],
    });
  });

  it("keeps every record somewhere on the board", () => {
    const records = [
      record({ id: "r1", tableId: "t1", status: "moi" }),
      record({ id: "r2", tableId: "t1", status: "la hoac" }),
      record({ id: "r3", tableId: "t1", status: "xong" }),
    ];
    const total = groupByStatus(records).reduce((sum, column) => sum + column.records.length, 0);
    expect(total).toBe(records.length);
  });
});

describe("what a status is called", () => {
  it("gives a known status its proper Vietnamese", () => {
    expect(statusLabel("moi")).toBe("Mới");
    expect(statusLabel("cho_phan_hoi")).toBe("Chờ phản hồi");
  });

  /** Read back exactly as typed — a catch-all would merge three of their columns into one. */
  it("shows a word of the person's own exactly as they wrote it", () => {
    expect(statusLabel("Đang thi công")).toBe("Đang thi công");
  });

  it("says so when there is no status at all", () => {
    expect(statusLabel("   ")).toBe("Chưa đặt");
  });
});

describe("what a cell shows", () => {
  const numberColumn: ColumnDef = { id: "col_n", key: "col_n", label: "Giá trị", type: "number" };
  const textColumn: ColumnDef = { id: "col_t", key: "col_t", label: "Ghi chú", type: "text" };

  it("writes a number the Vietnamese way", () => {
    const entry = record({ id: "r1", tableId: "t1", extensionFields: { col_n: 1234567 } });
    expect(cellValue(entry, numberColumn)).toBe("1.234.567");
  });

  it("leaves a cell nobody filled in empty rather than writing a zero", () => {
    const entry = record({ id: "r1", tableId: "t1" });
    expect(cellValue(entry, numberColumn)).toBe("");
    expect(cellValue(entry, textColumn)).toBe("");
  });

  it("shows text as it was typed", () => {
    const entry = record({ id: "r1", tableId: "t1", extensionFields: { col_t: "Đã gọi" } });
    expect(cellValue(entry, textColumn)).toBe("Đã gọi");
  });
});

describe("what the overview counts as asking for attention", () => {
  const today = "2026-09-17";

  it("splits the dates into late, today, and the rest of the week", () => {
    const attention = hubAttention(
      [
        record({ id: "r1", tableId: "t1", nextActionDate: "2026-09-10" }),
        record({ id: "r2", tableId: "t1", nextActionDate: "2026-09-17" }),
        record({ id: "r3", tableId: "t1", nextActionDate: "2026-09-20" }),
        // Beyond the week, so it is counted nowhere: a date a month out is not news today.
        record({ id: "r4", tableId: "t1", nextActionDate: "2026-10-24" }),
      ],
      today,
    );

    expect(attention).toEqual({ overdue: 1, today: 1, week: 1, total: 3 });
  });

  /** Nothing was promised about when, so it is never late. */
  it("never counts a record with no next date", () => {
    const attention = hubAttention([record({ id: "r1", tableId: "t1" })], today);
    expect(attention.total).toBe(0);
  });

  it("stops counting a record that was put away", () => {
    const attention = hubAttention(
      [
        record({
          id: "r1",
          tableId: "t1",
          nextActionDate: "2026-09-10",
          deletedAt: "2026-09-11T00:00:00Z",
        }),
      ],
      today,
    );
    expect(attention.total).toBe(0);
  });

  /** The three are a partition, so they always add up to the number the sentence states. */
  it("keeps the three parts adding up to the total", () => {
    const attention = hubAttention(
      [
        record({ id: "r1", tableId: "t1", nextActionDate: "2026-09-01" }),
        record({ id: "r2", tableId: "t1", nextActionDate: "2026-09-17" }),
        record({ id: "r3", tableId: "t1", nextActionDate: "2026-09-18" }),
        record({ id: "r4", tableId: "t1", nextActionDate: "2027-01-01" }),
        record({ id: "r5", tableId: "t1" }),
      ],
      today,
    );

    expect(attention.overdue + attention.today + attention.week).toBe(attention.total);
  });

  it("counts the last day of the window and not the day after", () => {
    const inside = hubAttention(
      [record({ id: "r1", tableId: "t1", nextActionDate: "2026-09-24" })],
      today,
    );
    const outside = hubAttention(
      [record({ id: "r1", tableId: "t1", nextActionDate: "2026-09-25" })],
      today,
    );

    expect(inside.week).toBe(1);
    expect(outside.total).toBe(0);
  });
});

describe("the sentence the overview leads with", () => {
  it("invites a first table when there are none", () => {
    expect(attentionSentence({ overdue: 0, today: 0, week: 0, total: 0 }, 0)).toBe(
      "Chưa có bảng nào. Tạo bảng đầu tiên để bắt đầu.",
    );
  });

  /** Tables exist and nothing in them is due — said as calm, not as a zero to worry about. */
  it("says a quiet week as quiet, not as zero", () => {
    expect(attentionSentence({ overdue: 0, today: 0, week: 0, total: 0 }, 2)).toBe(
      "Không có mục nào tới hạn trong tuần này.",
    );
  });

  it("names what is late first when anything is", () => {
    expect(attentionSentence({ overdue: 2, today: 1, week: 1, total: 4 }, 1)).toBe(
      "4 mục cần theo dõi, trong đó 2 mục đã quá hạn.",
    );
  });

  it("falls back to today, then to the week", () => {
    expect(attentionSentence({ overdue: 0, today: 3, week: 1, total: 4 }, 1)).toBe(
      "4 mục cần theo dõi, 3 mục đến hạn hôm nay.",
    );
    expect(attentionSentence({ overdue: 0, today: 0, week: 2, total: 2 }, 1)).toBe(
      "2 mục cần theo dõi trong tuần này.",
    );
  });
});

describe("what the labels read", () => {
  it("names each priority", () => {
    expect(priorityLabel("thap")).toBe("Thấp");
    expect(priorityLabel("trung_binh")).toBe("Trung bình");
    expect(priorityLabel("cao")).toBe("Cao");
  });

  it("names each column kind in the words the picker uses", () => {
    expect(columnTypeLabel("text")).toBe("Chữ");
    expect(columnTypeLabel("number")).toBe("Số");
    expect(columnTypeLabel("date")).toBe("Ngày");
    expect(columnTypeLabel("select")).toBe("Chọn 1 trong danh sách");
  });
});

describe("turning the database's refusals into something actionable", () => {
  /** The one a person is most likely to meet, and the only one that tells them what to do. */
  it("explains a full table with the number and the way out", () => {
    expect(toVietnameseHubError("P0001", "avora_think_hub_record_limit")).toBe(
      "Bảng đã đầy 1.000 mục, hãy dọn bớt trước khi thêm.",
    );
  });

  it("explains each refusal about the shape of a column", () => {
    expect(toVietnameseHubError("P0001", "avora_think_hub_column_options_required")).toBe(
      "Cột dạng chọn cần ít nhất một lựa chọn.",
    );
    expect(toVietnameseHubError("P0001", "avora_think_hub_value_not_number")).toBe(
      "Cột này chỉ nhận số.",
    );
    expect(toVietnameseHubError("P0001", "avora_think_hub_value_not_option")).toBe(
      "Giá trị này không nằm trong danh sách của cột.",
    );
  });

  /** Somebody else's table is indistinguishable from one that is gone, and should read that way. */
  it("does not hint that another person's table exists", () => {
    expect(toVietnameseHubError("P0001", "avora_think_hub_table_not_yours")).toBe(
      "Bảng này không còn nữa.",
    );
    expect(toVietnameseHubError("P0001", "avora_think_hub_record_not_yours")).toBe(
      "Mục này không còn nữa.",
    );
  });

  it("asks for a fresh sign-in when the session has gone", () => {
    expect(toVietnameseHubError("P0001", "avora_not_signed_in")).toBe(
      "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
    );
  });

  it("says plainly when the network is the problem", () => {
    expect(toVietnameseHubError(undefined, "Failed to fetch")).toBe(
      "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.",
    );
  });

  it("falls back to something honest for anything unrecognised", () => {
    expect(toVietnameseHubError(undefined, "chuyện lạ")).toBe(
      "Có lỗi xảy ra. Vui lòng thử lại.",
    );
  });
});

describe("scope, sub-tables and column ids", () => {
  const base = { ownerUserId: ME, position: 0, columns: [], purpose: null, createdAt: "", updatedAt: "", deletedAt: null };
  const personal: ThinkTable = { ...base, id: "p", name: "Riêng", projectId: null, conversationId: null, parentRecordId: null, depth: 1 };
  const direct: ThinkTable = { ...base, id: "d", name: "1-1", projectId: null, conversationId: "c-d", parentRecordId: null, depth: 1 };
  const group: ThinkTable = { ...base, id: "g", name: "Nhóm", projectId: null, conversationId: "c-g", parentRecordId: null, depth: 1 };
  const projectRoot: ThinkTable = { ...base, id: "pr", name: "Dự án", projectId: "p1", conversationId: null, parentRecordId: null, depth: 1 };
  const sub: ThinkTable = { ...base, id: "s", name: "Con", projectId: null, conversationId: "c-g", parentRecordId: "r1", depth: 2 };
  const deep: ThinkTable = { ...sub, id: "s3", parentRecordId: "r2", depth: 3 };
  const all = [personal, direct, group, projectRoot, sub, deep];

  it("offers only the tables of the scope a record is written from", () => {
    expect(tablesInScope(all, PERSONAL_SCOPE).map((t) => t.id)).toEqual(["p"]);
    expect(tablesInScope(all, { conversationId: "c-g", projectId: null }).map((t) => t.id)).toEqual(["g", "s", "s3"]);
    expect(tablesInScope(all, { conversationId: null, projectId: "p1" }).map((t) => t.id)).toEqual(["pr"]);
    expect(tableScope(projectRoot)).toBe("project");
    expect(tableScope(direct)).toBe("conversation");
    expect(scopeOfTable(sub)).toEqual({ conversationId: "c-g", projectId: null });
  });

  it("stops a sub-table chain at the third level, with the reason", () => {
    expect(canGrowSubTable(sub)).toBe(true);
    expect(canGrowSubTable(deep)).toBe(false);
    expect(DEPTH_LIMIT_MESSAGE).toMatch(/3 tầng/);
    expect(suggestedSubTablePurpose(" Nhập khẩu ")).toBe("Theo dõi cho: Nhập khẩu");
    expect(subTablesOf(all, "r1").map((t) => t.id)).toEqual(["s"]);
    expect(rootTables(all).map((t) => t.id)).toEqual(["p", "d", "g", "pr"]);
  });

  it("puts my personal and 1-1 roots under Bảng của tôi, nothing shared with a room", () => {
    const other: ThinkTable = { ...personal, id: "o", ownerUserId: "u-other" };
    const result = myTables([...all, other], ME, (id) => id === "c-d");
    expect(result.map((t) => t.id)).toEqual(["p", "d"]);
  });

  it("gives an old column its key as id, so renaming never loses its values", () => {
    const [def] = parseColumnDefs([{ key: "col_old", label: "Giá", type: "number" }]);
    expect(def.id).toBe("col_old");
  });
});
