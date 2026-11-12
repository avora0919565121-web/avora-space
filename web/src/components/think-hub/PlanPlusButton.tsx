import { LayoutGrid, ListPlus } from "lucide-react";

import { PlusMenuButton } from "@/components/PlusMenuButton";

/**
 * Kế hoạch's one `+` (AVORA-57 · E), on the shared `PlusMenuButton` (AVORA-59 · D).
 *
 * Click: a new Hạng mục in the open table (no table yet → a new table). Hold or right-click:
 * `Hạng mục mới` · `Bảng mới`, anchored under the button — the same on phone and computer.
 * AVORA-101C: in the books (kệ 5 · Sách) the same `+` adds a book — no orange pill of its own.
 */
export function PlanPlusButton({
  canAddRecord,
  onNewRecord,
  onNewTable,
  onAddBook,
  onWrite,
}: {
  canAddRecord: boolean;
  onNewRecord: () => void;
  onNewTable: () => void;
  /** Set while standing among the books: tap = `Thêm sách`. */
  onAddBook?: () => void;
  /** Nhà mới · Thư phòng › Ghi chép: tap = write a line in Nhật ký. */
  onWrite?: () => void;
}) {
  // Nhà mới: in Đọc and Ghi chép the `+` does the one thing of that part — no hold menu, no hint about boards.
  if (onAddBook !== undefined) {
    return <PlusMenuButton label="Thêm sách" onTap={onAddBook} entries={[]} />;
  }
  if (onWrite !== undefined) {
    return <PlusMenuButton label="Viết ghi chép" onTap={onWrite} entries={[]} />;
  }
  return (
    <PlusMenuButton
      label={canAddRecord ? "Thêm Hạng mục" : "Tạo bảng mới"}
      tapLabel="giữ để tạo bảng mới"
      tapAction={canAddRecord ? "Hạng mục mới" : "Bảng mới"}
      onTap={() => (canAddRecord ? onNewRecord() : onNewTable())}
      hintKey="plan_plus_hold"
      entries={[
        { id: "record", label: "Hạng mục mới", icon: ListPlus, onSelect: onNewRecord, disabled: !canAddRecord },
        { id: "table", label: "Bảng mới", icon: LayoutGrid, onSelect: onNewTable },
      ]}
    />
  );
}
