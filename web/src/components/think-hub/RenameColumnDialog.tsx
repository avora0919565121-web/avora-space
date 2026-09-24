import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ColumnDef } from "@/lib/think-hub";

/**
 * Renames one column. Only the label changes: the column keeps its permanent id, so every value
 * already written under it stays exactly where it was.
 */
export function RenameColumnDialog({
  column,
  onOpenChange,
  onRename,
  isWorking,
}: {
  column: ColumnDef | null;
  onOpenChange: (open: boolean) => void;
  onRename: (column: ColumnDef, label: string) => Promise<void>;
  isWorking: boolean;
}) {
  const [label, setLabel] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLabel(column?.label ?? "");
    setNotice(null);
  }, [column]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (column === null) return;
      if (label.trim().length === 0) {
        setNotice("Cột cần một cái tên.");
        return;
      }
      try {
        await onRename(column, label);
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không đổi được tên cột.");
      }
    },
    [column, label, onRename, onOpenChange],
  );

  return (
    <Dialog open={column !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Đổi tên cột</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Dữ liệu đã điền trong cột này giữ nguyên.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <input
            value={label}
            autoFocus
            maxLength={60}
            aria-label="Tên cột"
            onChange={(event) => setLabel(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
          />
          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Để sau
            </Button>
            <Button type="submit" disabled={isWorking}>
              Lưu
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
