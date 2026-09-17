import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  priorityLabel,
  RECORD_PRIORITIES,
  statusLabel,
  SUGGESTED_STATUSES,
  type BusinessRecord,
  type ColumnDef,
  type ExtensionValue,
  type RecordPatch,
  type RecordPriority,
} from "@/lib/business-hub";
import { cn } from "@/lib/utils";

type RecordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The table's own extension columns, so a new one can be filled in straight away. */
  columns: readonly ColumnDef[];
  /** Null when writing a new record, the record itself when editing one. */
  record: BusinessRecord | null;
  /** The statuses already used in this table, so a person's own words come back to them. */
  knownStatuses: readonly string[];
  onSave: (patch: RecordPatch) => Promise<void>;
  isWorking: boolean;
};

type Draft = {
  title: string;
  status: string;
  priority: RecordPriority;
  category: string;
  nextActionDate: string;
  tags: string;
  notes: string;
  extension: Record<string, string>;
};

function draftOf(record: BusinessRecord | null, columns: readonly ColumnDef[]): Draft {
  const extension: Record<string, string> = {};
  for (const column of columns) {
    const value: ExtensionValue | undefined = record?.extensionFields[column.key];
    extension[column.key] = value === undefined || value === null ? "" : String(value);
  }

  return {
    title: record?.title ?? "",
    status: record?.status ?? SUGGESTED_STATUSES[0],
    priority: record?.priority ?? "trung_binh",
    category: record?.category ?? "",
    nextActionDate: record?.nextActionDate ?? "",
    tags: (record?.tags ?? []).join(", "),
    notes: record?.notes ?? "",
    extension,
  };
}

/**
 * Writes or edits one record.
 *
 * The seven built-in fields and this table's own columns in one form, because to the person
 * filling it in there is no difference between them — "Ngày cần làm tiếp" and a column they
 * added yesterday are both just things they track.
 */
export function RecordDialog({
  open,
  onOpenChange,
  columns,
  record,
  knownStatuses,
  onSave,
  isWorking,
}: RecordDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(record, columns));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(record, columns));
    setNotice(null);
  }, [open, record, columns]);

  const statuses: string[] = useMemo(() => {
    const all = [...SUGGESTED_STATUSES, ...knownStatuses, draft.status];
    return [...new Set(all.map((status) => status.trim()).filter((status) => status.length > 0))];
  }, [knownStatuses, draft.status]);

  const setField = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const title = draft.title.trim();
      if (title.length === 0) {
        setNotice("Mục này cần một tiêu đề.");
        return;
      }

      // Empty cells are sent as null rather than "": a blank is "nobody filled this in",
      // and storing it as an empty string would make a Số column hold a word.
      const extension: Record<string, ExtensionValue> = {};
      for (const column of columns) {
        const raw = (draft.extension[column.key] ?? "").trim();
        if (raw.length === 0) {
          extension[column.key] = null;
          continue;
        }
        if (column.type === "number") {
          const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, "."));
          if (!Number.isFinite(parsed)) {
            setNotice(`Cột "${column.label}" chỉ nhận số.`);
            return;
          }
          extension[column.key] = parsed;
        } else {
          extension[column.key] = raw;
        }
      }

      setNotice(null);
      try {
        await onSave({
          title,
          status: draft.status,
          priority: draft.priority,
          category: draft.category.trim().length === 0 ? null : draft.category.trim(),
          nextActionDate: draft.nextActionDate.length === 0 ? null : draft.nextActionDate,
          tags: draft.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
          notes: draft.notes.trim().length === 0 ? null : draft.notes.trim(),
          extensionFields: extension,
        });
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
    },
    [draft, columns, onSave, onOpenChange],
  );

  const fieldClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";
  const labelClass = "text-[13px] font-medium text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">
          {record === null ? "Mục mới" : "Sửa mục"}
        </DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          {record === null
            ? "Chỉ tiêu đề là bắt buộc. Những ô còn lại điền dần cũng được."
            : "Sửa gì lưu nấy — những ô bạn không đụng tới giữ nguyên."}
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <label htmlFor="record-title" className={labelClass}>
              Tiêu đề
            </label>
            <input
              id="record-title"
              value={draft.title}
              onChange={(event) => setField("title", event.target.value)}
              autoFocus
              maxLength={200}
              className={fieldClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="record-status" className={labelClass}>
                Trạng thái
              </label>
              <select
                id="record-status"
                value={draft.status}
                onChange={(event) => setField("status", event.target.value)}
                className={fieldClass}
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={labelClass}>Độ ưu tiên</span>
              <div className="mt-1.5 flex gap-1.5">
                {RECORD_PRIORITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setField("priority", option)}
                    aria-pressed={draft.priority === option}
                    className={cn(
                      "press flex-1 rounded-md border px-2 py-2.5 text-[13.5px] font-medium transition-colors",
                      draft.priority === option
                        ? "border-primary bg-accent/60 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/30",
                    )}
                  >
                    {priorityLabel(option)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="record-category" className={labelClass}>
                Phân loại
              </label>
              <input
                id="record-category"
                value={draft.category}
                onChange={(event) => setField("category", event.target.value)}
                maxLength={80}
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="record-next-date" className={labelClass}>
                Ngày cần làm tiếp
              </label>
              <input
                id="record-next-date"
                type="date"
                value={draft.nextActionDate}
                onChange={(event) => setField("nextActionDate", event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="record-tags" className={labelClass}>
              Nhãn
            </label>
            <input
              id="record-tags"
              value={draft.tags}
              onChange={(event) => setField("tags", event.target.value)}
              placeholder="gấp, khách quen"
              className={fieldClass}
            />
            <p className="mt-1 text-[12.5px] text-muted-foreground">Ngăn cách bằng dấu phẩy.</p>
          </div>

          <div>
            <label htmlFor="record-notes" className={labelClass}>
              Ghi chú
            </label>
            <textarea
              id="record-notes"
              value={draft.notes}
              onChange={(event) => setField("notes", event.target.value)}
              rows={3}
              className={fieldClass}
            />
          </div>

          {columns.length > 0 ? (
            <div className="space-y-4 border-t border-border pt-4">
              {columns.map((column) => (
                <div key={column.key}>
                  <label htmlFor={`record-ext-${column.key}`} className={labelClass}>
                    {column.label}
                  </label>
                  {column.type === "select" ? (
                    <select
                      id={`record-ext-${column.key}`}
                      value={draft.extension[column.key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extension: { ...current.extension, [column.key]: event.target.value },
                        }))
                      }
                      className={fieldClass}
                    >
                      <option value="">Chưa chọn</option>
                      {(column.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`record-ext-${column.key}`}
                      type={column.type === "date" ? "date" : "text"}
                      inputMode={column.type === "number" ? "decimal" : undefined}
                      value={draft.extension[column.key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extension: { ...current.extension, [column.key]: event.target.value },
                        }))
                      }
                      className={fieldClass}
                    />
                  )}
                </div>
              ))}
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
            <Button type="submit" disabled={isWorking}>
              {isWorking ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
