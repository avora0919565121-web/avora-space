import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { COLUMN_TYPES, columnTypeLabel, type ColumnType } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

type AddColumnDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: { label: string; type: ColumnType; options?: readonly string[] }) => Promise<void>;
  isWorking: boolean;
};

/**
 * Adds one extension column to one table.
 *
 * The list of choices appears only for the kind that needs it. A type picker that always
 * showed an options box would ask everyone adding a plain text column to ignore a field.
 */
export function AddColumnDialog({ open, onOpenChange, onAdd, isWorking }: AddColumnDialogProps) {
  const { isSubmitting, guard } = useSubmitGuard();
  const [label, setLabel] = useState<string>("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setLabel("");
    setType("text");
    setOptions("");
    setNotice(null);
  }, [open]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const trimmed = label.trim();
      if (trimmed.length === 0) {
        setNotice("Cột cần một cái tên.");
        return;
      }

      const parsed: string[] =
        type === "select"
          ? options
              .split(/[\n,]/)
              .map((option) => option.trim())
              .filter((option) => option.length > 0)
          : [];

      if (type === "select" && parsed.length === 0) {
        setNotice("Cột dạng chọn cần ít nhất một lựa chọn.");
        return;
      }

      setNotice(null);
      try {
        await guard(async () => {
          await onAdd({ label: trimmed, type, options: type === "select" ? parsed : undefined });
        });
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
    },
    [label, type, options, onAdd, onOpenChange, guard],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Thêm cột</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Cột mới hiện ở cuối bảng. Những mục đã có để trống cột này cho tới khi bạn điền.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="think-column-label"
              className="text-[13px] font-medium text-muted-foreground"
            >
              Tên cột
            </label>
            <input
              id="think-column-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoFocus
              maxLength={60}
              placeholder="Giá trị hợp đồng"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>

          <fieldset>
            <legend className="text-[13px] font-medium text-muted-foreground">Kiểu dữ liệu</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {COLUMN_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  aria-pressed={type === option}
                  className={cn(
                    "press rounded-md border px-3 py-2.5 text-[14px] font-medium transition-colors",
                    type === option
                      ? "border-primary bg-accent/60 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/30",
                  )}
                >
                  {columnTypeLabel(option)}
                </button>
              ))}
            </div>
          </fieldset>

          {type === "select" ? (
            <div>
              <label
                htmlFor="think-column-options"
                className="text-[13px] font-medium text-muted-foreground"
              >
                Các lựa chọn
              </label>
              <textarea
                id="think-column-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                rows={3}
                placeholder={"Miền Bắc\nMiền Trung\nMiền Nam"}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
              />
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Mỗi dòng là một lựa chọn.
              </p>
            </div>
          ) : null}

          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Để sau
            </Button>
            <Button type="submit" disabled={isWorking || isSubmitting}>
              {isWorking ? "Đang thêm…" : "Thêm cột"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
