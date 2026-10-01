import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { DateField } from "@/components/calendar/DateField";
import { DateTimeField } from "@/components/calendar/DateTimeField";
import { Button } from "@/components/ui/button";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Copy, ListPlus, MoreHorizontal, MoveRight, Star, Table2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import {
  DEPTH_LIMIT_MESSAGE,
  priorityLabel,
  RECORD_PRIORITIES,
  statusLabel,
  suggestedSubTablePurpose,
  SUGGESTED_STATUSES,
  type ThinkRecord,
  type ThinkTable,
  type ColumnDef,
  type ExtensionValue,
  type RecordPatch,
  type RecordPriority,
} from "@/lib/think-hub";
import { deadlineLabel, taskStatusLabel, todayIso, type TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";

type RecordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The table's own extension columns, so a new one can be filled in straight away. */
  columns: readonly ColumnDef[];
  /** Null when writing a new record, the record itself when editing one. */
  record: ThinkRecord | null;
  /** The statuses already used in this table, so a person's own words come back to them. */
  knownStatuses: readonly string[];
  onSave: (patch: RecordPatch) => Promise<void>;
  isWorking: boolean;
  /**
   * For a new Hạng mục: the tables it may be filed into — only those in the current scope, the
   * same rule the server applies. The picker is shown only when there is a real choice.
   */
  tableChoices?: readonly ThinkTable[];
  selectedTableId?: string;
  onSelectTable?: (tableId: string) => void;
  /** For an existing Hạng mục: the sub-tables grown from it, and whether another may grow. */
  subTables?: readonly ThinkTable[];
  canGrowSubTable?: boolean;
  onCreateSubTable?: (input: { name: string; purpose: string }) => Promise<void>;
  onOpenTable?: (tableId: string) => void;
  /** "Tạo nhiệm vụ" for an existing Hạng mục; absent when the table is read-only. */
  onQuickTask?: () => void;
  /** The tasks hanging under this Hạng mục, read-only; each row carries `data-record-task-id` so a link can light it. */
  tasks?: readonly TaskItem[];
  onOpenTask?: (taskId: string) => void;
  /** Đợt gộp 2 · C8: this person's own ★. */
  isStarred?: boolean;
  onToggleStar?: () => void;
  /** C11: absent when the source table is archived. */
  onMove?: () => void;
  onCopy?: () => void;
  /** C10: an archived table is read-only — the form shows, saving is off. */
  isReadOnly?: boolean;
};

/**
 * Grows a sub-table from this Hạng mục. The purpose starts as "Theo dõi cho: …" and is the
 * person's to rewrite or clear; at the third level the button gives way to the reason.
 */
function SubTableSection({
  record,
  subTables,
  canGrow,
  onCreate,
  onOpenTable,
  isWorking,
}: {
  record: ThinkRecord;
  subTables: readonly ThinkTable[];
  canGrow: boolean;
  onCreate?: (input: { name: string; purpose: string }) => Promise<void>;
  onOpenTable?: (tableId: string) => void;
  isWorking: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>(record.title);
  const [purpose, setPurpose] = useState<string>(suggestedSubTablePurpose(record.title));
  const [notice, setNotice] = useState<string | null>(null);

  const inputClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-[13px] font-medium text-muted-foreground">Bảng con</p>
      {subTables.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {subTables.map((table) => (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => onOpenTable?.(table.id)}
                className="press flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[14px] text-foreground transition-colors hover:bg-accent/40"
              >
                <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Mở bảng con: {table.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {subTables.length > 0 ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground">Mỗi Hạng mục có đúng một bảng con.</p>
      ) : !canGrow ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{DEPTH_LIMIT_MESSAGE}</p>
      ) : isOpen ? (
        <div className="mt-2 space-y-3 rounded-lg border border-dashed border-border p-3.5">
          <label className="block">
            <span className="text-[13px] font-medium text-muted-foreground">Tên bảng con</span>
            <input lang="vi" spellCheck value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-muted-foreground">Mục đích</span>
            <input
              lang="vi"
              spellCheck
              value={purpose}
              maxLength={2000}
              onChange={(event) => setPurpose(event.target.value)}
              className={inputClass}
            />
          </label>
          {notice !== null ? (
            <p role="alert" className="text-[13px] text-destructive">
              {notice}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Để sau
            </Button>
            <Button
              type="button"
              disabled={isWorking || onCreate === undefined}
              onClick={() => {
                if (onCreate === undefined) return;
                setNotice(null);
                onCreate({ name, purpose }).then(
                  () => setIsOpen(false),
                  (error: unknown) =>
                    setNotice(error instanceof Error ? error.message : "Không tạo được bảng con."),
                );
              }}
            >
              Tạo bảng con
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="press mt-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          + Tạo bảng con từ Hạng mục này
        </button>
      )}
    </div>
  );
}

type Draft = {
  title: string;
  status: string;
  priority: RecordPriority;
  category: string;
  nextActionDate: string;
  /** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input speaks it. */
  remindAt: string;
  tags: string;
  notes: string;
  extension: Record<string, string>;
};

/** An ISO instant as the local `YYYY-MM-DDTHH:MM` a datetime-local field shows. */
function toLocalInput(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function draftOf(record: ThinkRecord | null, columns: readonly ColumnDef[]): Draft {
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
    remindAt: toLocalInput(record?.remindAt),
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
  tableChoices,
  selectedTableId,
  onSelectTable,
  subTables,
  canGrowSubTable,
  onCreateSubTable,
  onOpenTable,
  onQuickTask,
  tasks,
  onOpenTask,
  isStarred = false,
  onToggleStar,
  onMove,
  onCopy,
  isReadOnly = false,
}: RecordDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(record, columns));
  const [notice, setNotice] = useState<string | null>(null);
  const { isSubmitting, guard } = useSubmitGuard();

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

  /** The form as a patch, or null (with a notice) when something in it cannot be saved. */
  const buildPatch = useCallback((): RecordPatch | null => {
      const title = draft.title.trim();
      if (title.length === 0) {
        setNotice("Hạng mục này cần một tiêu đề.");
        return null;
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
            return null;
          }
          extension[column.key] = parsed;
        } else {
          extension[column.key] = raw;
        }
      }

      setNotice(null);
      return {
          title,
          status: draft.status,
          priority: draft.priority,
          category: draft.category.trim().length === 0 ? null : draft.category.trim(),
          nextActionDate: draft.nextActionDate.length === 0 ? null : draft.nextActionDate,
          remindAt: draft.remindAt.length === 0 ? null : new Date(draft.remindAt).toISOString(),
          tags: draft.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
          notes: draft.notes.trim().length === 0 ? null : draft.notes.trim(),
          extensionFields: extension,
      };
  }, [draft, columns]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const patch = buildPatch();
      if (patch === null) return;
      await guard(async () => {
      try {
        await onSave(patch);
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
      });
    },
    [buildPatch, onSave, onOpenChange, guard],
  );

  /**
   * AVORA-53 · 5.3 — Di chuyển / Sao chép / Tạo nhiệm vụ save what was typed first; a save that
   * fails keeps the person here with the reason, nothing is lost.
   */
  const isDirty: boolean = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftOf(record, columns)),
    [draft, record, columns],
  );
  const thenAct = useCallback(
    (action: (() => void) | undefined) =>
      action === undefined
        ? undefined
        : (): void => {
            if (!isDirty || isReadOnly) {
              action();
              return;
            }
            const patch = buildPatch();
            if (patch === null) return;
            void onSave(patch).then(action, (error: unknown) =>
              setNotice(error instanceof Error ? error.message : "Chưa lưu được nên chưa làm tiếp. Thử lại nhé."),
            );
          },
    [buildPatch, isDirty, isReadOnly, onSave],
  );

  const fieldClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";
  const labelClass = "text-[13px] font-medium text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 44b · H4: the title and the Lưu row stay in view; only the middle scrolls. */}
      <DialogContent className={cn(longDialogContentClass, "max-w-lg")}>
        <LongDialogHeader className="relative pr-24">
          <DialogTitle className="text-[19px] font-semibold tracking-tight">
            {record === null ? "Hạng mục mới" : isReadOnly ? "Hạng mục" : "Sửa Hạng mục"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[14px] text-muted-foreground">
            {record === null
              ? "Chỉ tiêu đề là bắt buộc. Những ô còn lại điền dần cũng được."
              : "Sửa gì lưu nấy — những ô bạn không đụng tới giữ nguyên."}
          </DialogDescription>
          {/* AVORA-53 · 5.4: the extra actions live in ⋯ at the head; Lưu / Huỷ are the fixed footer. */}
          {record !== null && (onToggleStar !== undefined || onMove !== undefined || onCopy !== undefined || onQuickTask !== undefined || subTables !== undefined) ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Thêm thao tác với Hạng mục"
                className="press absolute right-12 top-4 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {onToggleStar !== undefined ? (
                  <DropdownMenuItem onSelect={onToggleStar} className="gap-2 py-2.5">
                    <Star className={cn("h-4 w-4", isStarred ? "fill-amber-400 text-amber-400" : "")} aria-hidden="true" />
                    {isStarred ? "Bỏ quan trọng" : "Đánh dấu quan trọng"}
                  </DropdownMenuItem>
                ) : null}
                {onMove !== undefined ? (
                  <DropdownMenuItem onSelect={thenAct(onMove)} className="gap-2 py-2.5">
                    <MoveRight className="h-4 w-4" aria-hidden="true" /> Di chuyển sang Bảng khác
                  </DropdownMenuItem>
                ) : null}
                {onCopy !== undefined ? (
                  <DropdownMenuItem onSelect={thenAct(onCopy)} className="gap-2 py-2.5">
                    <Copy className="h-4 w-4" aria-hidden="true" /> Sao chép sang Bảng khác
                  </DropdownMenuItem>
                ) : null}
                {onQuickTask !== undefined ? (
                  <DropdownMenuItem onSelect={thenAct(onQuickTask)} className="gap-2 py-2.5">
                    <ListPlus className="h-4 w-4" aria-hidden="true" /> Tạo nhiệm vụ từ Hạng mục này
                  </DropdownMenuItem>
                ) : null}
                {subTables !== undefined ? (
                  <DropdownMenuItem
                    onSelect={() => document.getElementById("record-sub-tables")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    className="gap-2 py-2.5"
                  >
                    <Table2 className="h-4 w-4" aria-hidden="true" /> Bảng con
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </LongDialogHeader>

        <LongDialogBody className="px-6">
        {isReadOnly ? (
          <p role="status" className="mb-4 rounded-md bg-secondary/70 px-3 py-2 text-[13px] text-muted-foreground">
            🔒 Bảng đang lưu trữ — chỉ xem
          </p>
        ) : null}
        <form id="record-form" onSubmit={handleSubmit} className="space-y-4">
        {/* AVORA-53 · 5.7: an archived table locks the whole form, not just the Lưu button. */}
        <fieldset disabled={isReadOnly} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {record === null && tableChoices !== undefined && tableChoices.length > 1 ? (
            <div>
              <label htmlFor="record-table" className={labelClass}>
                Ghi vào bảng
              </label>
              <select
                id="record-table"
                value={selectedTableId}
                onChange={(event) => onSelectTable?.(event.target.value)}
                className={fieldClass}
              >
                {tableChoices.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.depth > 1 ? `${"— ".repeat(table.depth - 1)}${table.name}` : table.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Chỉ hiện những bảng cùng nơi với bảng đang mở.</p>
            </div>
          ) : null}

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
                      "press min-w-0 flex-1 whitespace-nowrap rounded-md border px-1 py-2.5 text-[13px] font-medium transition-colors",
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
              <DateField
                id="record-next-date"
                value={draft.nextActionDate}
                onChange={(day) => setField("nextActionDate", day)}
                label="Ngày cần làm tiếp"
                title="Chọn ngày cần làm tiếp"
                allow="any"
              />
            </div>
          </div>

          <div>
            <label htmlFor="record-remind-at" className={labelClass}>
              Nhắc tôi xem lại
            </label>
            <DateTimeField
              id="record-remind-at"
              value={draft.remindAt}
              onChange={(next) => setField("remindAt", next)}
              label="Nhắc tôi xem lại"
              title="Chọn ngày nhắc"
              allow="future"
            />
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Tới lúc đó, mục này sẽ hiện ở Góc hoạch định trên Avora Space. Để trống nếu không cần.
            </p>
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
              lang="vi"
              spellCheck
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

        </fieldset>
          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}

        </form>

        {record !== null && tasks !== undefined && tasks.length > 0 ? (
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[12.5px] font-medium text-muted-foreground">Việc trong Hạng mục này</p>
            <ul className="mt-2 space-y-1">
              {tasks.map((task) => (
                <li key={task.id} data-record-task-id={task.id}>
                  <button
                    type="button"
                    disabled={onOpenTask === undefined}
                    onClick={() => onOpenTask?.(task.id)}
                    className="press flex min-h-10 w-full items-center gap-2.5 rounded-md border border-transparent px-2 text-left transition-colors hover:bg-accent/30 disabled:cursor-default"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", task.status === "done" ? "bg-primary" : "bg-muted-foreground/40")}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{task.title}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {task.deadline !== null ? `${deadlineLabel(task.deadline, todayIso()) ?? task.deadline} · ` : ""}
                      {taskStatusLabel(task.status)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {record !== null && record.movedFrom !== null ? (
          <p className="mt-4 text-[12px] text-muted-foreground">
            Chuyển từ Bảng {record.movedFrom.tableName} · {record.movedFrom.at.slice(8, 10)}/{record.movedFrom.at.slice(5, 7)}
          </p>
        ) : null}

        {record !== null && subTables !== undefined ? (
          <div id="record-sub-tables">
          <SubTableSection
            key={record.id}
            record={record}
            subTables={subTables}
            canGrow={canGrowSubTable === true}
            onCreate={onCreateSubTable}
            onOpenTable={onOpenTable}
            isWorking={isWorking}
          />
          </div>
        ) : null}
        </LongDialogBody>
        <LongDialogFooter className="px-6">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {isReadOnly ? "Đóng" : "Huỷ"}
          </Button>
          {isReadOnly ? null : (
            <Button type="submit" form="record-form" disabled={isWorking || isSubmitting}>
              {isWorking ? "Đang lưu…" : "Lưu"}
            </Button>
          )}
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}
