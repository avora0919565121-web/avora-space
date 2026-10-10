import { describe, expect, test, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null }) }));

import { BRANCH_PAGE, UNLINKED_KEY, addressOf, branchSlice, handleLabel, buildTree, columnsFor, pathTo, tallyLabel, taskListOf } from "@/lib/project-tree";
import type { TaskItem } from "@/lib/tasks";

const row = (kind: string, id: string, parent: string | null, title: string, order: number, done = 0, total = 0, own = 0) => ({
  node_kind: kind, node_id: id, parent_id: parent, title, depth: 0, sort_order: order, done, total, own_total: own,
});

const tree = buildTree([
  row("project", "b0", null, "Hoiana", 1, 1, 4),
  row("record", "r2", "b0", "Hành lang", 2),
  row("record", "r1", "b0", "Sảnh chính", 1, 1, 3),
  row("table", "b2", "r1", "Vật tư sảnh", 1, 1, 3),
  row("record", "r3", "b2", "Đèn panel", 1, 1, 2, 2),
  row("unlinked", "b0", "b0", "Việc chưa gắn Hạng mục", 1000000, 0, 1, 1),
]);

describe("AVORA-104 · PHẦN 4 · cây", () => {
  test("gốc, con theo thứ tự, nút chưa gắn có khoá riêng", () => {
    expect(tree.root?.id).toBe("b0");
    expect(tree.childrenOf("b0").map((node) => node.title)).toEqual(["Sảnh chính", "Hành lang", "Việc chưa gắn Hạng mục"]);
    expect(tree.byId.get(UNLINKED_KEY)?.kind).toBe("unlinked");
    expect(tree.byId.get("b0")?.kind).toBe("project");
    expect(pathTo(tree, "r3").map((node) => node.id)).toEqual(["b0", "r1", "b2", "r3"]);
  });

  test("cột trên điện thoại từ ?bang=&muc=&viec=", () => {
    const columns = columnsFor(tree, "b2", "r3", "t1");
    expect(columns.map((column) => column.kind)).toEqual(["board", "record", "board", "record", "task"]);
    expect(addressOf(columns, 1, tree)).toEqual({ board: "b0", record: "r1", task: null });
    expect(addressOf(columns, 4, tree)).toEqual({ board: "b2", record: "r3", task: "t1" });
    expect(handleLabel(columns[0], columns[1], tree)).toBe("Hoiana · 2 hạng mục");
    expect(handleLabel(columns[3], columns[4], tree)).toBe("Việc · Đèn panel");
    expect(columnsFor(tree, "b0", UNLINKED_KEY, null).map((column) => column.kind)).toEqual(["board", "unlinked"]);
    // A task without a list before it is dropped.
    expect(columnsFor(tree, "b0", null, "t1").map((column) => column.kind)).toEqual(["board"]);
  });

  test("số đếm và Xem thêm", () => {
    expect(tallyLabel({ done: 1, total: 4 }, false)).toBe("1/4");
    expect(tallyLabel({ done: 1, total: 4 }, true)).toBe("3");
    const many = Array.from({ length: 120 }, (_, index) => index);
    expect(branchSlice(many, { recordCount: 120 }, undefined)).toEqual({ rows: many, more: 0 });
    const big = branchSlice(many, { recordCount: 600 }, undefined);
    expect(big.rows.length).toBe(BRANCH_PAGE);
    expect(big.more).toBe(70);
  });

  test("danh sách việc: mở trước theo ngày, xong cuối; Chỉ việc chưa xong ẩn việc xong", () => {
    const task = (id: string, status: string, deadline: string | null): TaskItem => ({ id, status, deadline, createdAt: "2026-10-01", deletedByCreator: false, deletedByPeer: false }) as unknown as TaskItem;
    const list = [task("a", "done", "2026-10-01"), task("b", "confirmed", "2026-10-12"), task("c", "confirmed", "2026-10-11"), task("d", "skipped", null)];
    expect(taskListOf(list, false).map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(taskListOf(list, true).map((item) => item.id)).toEqual(["c", "b"]);
  });
});
