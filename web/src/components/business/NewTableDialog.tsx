import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type NewTableDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  isWorking: boolean;
};

/**
 * Names a new table.
 *
 * One field and nothing else. A table is whatever its owner says it is, so asking for a type
 * or a template up front would be asking them to fit their work into our categories before
 * they have written down a single row.
 */
export function NewTableDialog({ open, onOpenChange, onCreate, isWorking }: NewTableDialogProps) {
  const [name, setName] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setName("");
    setNotice(null);
  }, [open]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setNotice("Bảng cần một cái tên.");
        return;
      }
      setNotice(null);
      try {
        await onCreate(trimmed);
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
    },
    [name, onCreate, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Bảng mới</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Đặt tên theo đúng thứ bạn đang theo dõi — "Công trình", "Nhà cung cấp", "Đơn hàng".
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="business-table-name"
              className="text-[13px] font-medium text-muted-foreground"
            >
              Tên bảng
            </label>
            <input
              id="business-table-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={80}
              placeholder="Sales Pipeline"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>

          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Để sau
            </Button>
            <Button type="submit" disabled={isWorking}>
              {isWorking ? "Đang tạo…" : "Tạo bảng"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
