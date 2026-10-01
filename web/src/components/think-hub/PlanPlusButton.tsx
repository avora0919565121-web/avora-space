import { LayoutGrid, ListPlus } from "lucide-react";

import { PlusMenuButton } from "@/components/PlusMenuButton";

/**
 * Kế hoạch's one `+` (AVORA-57 · E), on the shared `PlusMenuButton` (AVORA-59 · D).
 *
 * Click: a new Hạng mục in the open table (no table yet → a new table). Hold or right-click:
 * `Hạng mục mới` · `Bảng mới`, anchored under the button — the same on phone and computer.
 */
export function PlanPlusButton({
  canAddRecord,
  onNewRecord,
  onNewTable,
}: {
  canAddRecord: boolean;
  onNewRecord: () => void;
  onNewTable: () => void;
}) {
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
