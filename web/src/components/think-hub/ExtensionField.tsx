import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Paperclip, X } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { ColumnTypeIcon } from "@/components/think-hub/ColumnTypeIcon";
import {
  boardFileKeys,
  deleteBoardFile,
  fetchBoardFiles,
  signedBoardFileUrl,
  uploadBoardFile,
  type BoardCellFile,
} from "@/lib/board-files";
import { COLUMN_PLACEHOLDERS, isHttpLink, parseColumnInput, type ColumnDef } from "@/lib/think-hub";
import { useAuth } from "@/lib/auth";
import { useContacts } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

const fieldClass =
  "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[16px] md:text-[15px] text-foreground outline-none transition-colors focus:border-personal";

/** Opens a board file in a new tab through a short-lived link. */
export async function openBoardFile(file: BoardCellFile): Promise<void> {
  try {
    const url = await signedBoardFileUrl(file.storagePath);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Không mở được tệp.");
  }
}

/** The files of one cell: list, open, add (anyone on the board), remove (uploader or owner). */
export function BoardFileList({
  tableId,
  recordId,
  columnKey,
  boardOwnerId,
  canAdd,
}: {
  tableId: string;
  recordId: string;
  columnKey: string;
  boardOwnerId: string;
  canAdd: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const files = useQuery({ queryKey: boardFileKeys.table(tableId), queryFn: () => fetchBoardFiles(tableId) });
  const mine = (files.data ?? []).filter((file) => file.recordId === recordId && file.columnKey === columnKey);
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: boardFileKeys.table(tableId) });
  const upload = useMutation({
    mutationFn: (file: File) => uploadBoardFile({ tableId, recordId, columnKey, file }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (file: BoardCellFile) => deleteBoardFile(file),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="mt-1.5 space-y-1.5" data-board-files={columnKey}>
      {mine.map((file) => {
        const canRemove = user?.id === file.uploadedBy || user?.id === boardOwnerId;
        return (
          <div key={file.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[13.5px]">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button type="button" onClick={() => void openBoardFile(file)} className="press min-w-0 flex-1 truncate text-left text-foreground hover:underline">
              {file.fileName}
            </button>
            <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
            {canRemove ? (
              <button
                type="button"
                aria-label={`Gỡ tệp ${file.fileName}`}
                onClick={() => remove.mutate(file)}
                className="press rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
      {canAdd ? (
        <>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) upload.mutate(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="press inline-flex min-h-10 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[13.5px] text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          >
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
            {COLUMN_PLACEHOLDERS.file}
          </button>
        </>
      ) : mine.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Chưa có tệp.</p>
      ) : null}
    </div>
  );
}

/**
 * One extension field in `Sửa Hạng mục` (AVORA-61 · F): a small kind icon by the column's name,
 * a hint inside the box, and a wrong-kind message right under it — the typed text is kept.
 */
export function ExtensionField({
  column,
  value,
  onChange,
  disabled,
  file,
  isSharedBoard = false,
}: {
  isSharedBoard?: boolean;
  column: ColumnDef;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** For Tệp: where files go. Absent = the Hạng mục is not saved yet. */
  file?: { tableId: string; recordId: string; boardOwnerId: string } | null;
}) {
  const id = `record-ext-${column.key}`;
  const parsed = column.type === "number" || column.type === "link" ? parseColumnInput(column, value) : null;
  const error = parsed !== null && "error" in parsed ? parsed.error : null;
  const contacts = useContacts();
  const label = (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
      <ColumnTypeIcon type={column.type} />
      {column.label}
    </label>
  );

  if (column.type === "checkbox") {
    const isOn = value === "1";
    return (
      <label
        htmlFor={id}
        data-checkbox-cell={isOn ? "on" : "off"}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
          isOn ? "border-emerald-500/40 bg-emerald-500/[0.14]" : "border-border bg-background",
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={isOn}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? "1" : "")}
          className="h-5 w-5 accent-emerald-600"
        />
        <ColumnTypeIcon type="checkbox" className="text-muted-foreground" />
        <span className="text-[14.5px] text-foreground">{column.label}</span>
        <span className="ml-auto text-[12.5px] text-muted-foreground">{isOn ? "Có" : "Không"}</span>
      </label>
    );
  }

  if (column.type === "file") {
    return (
      <div>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <ColumnTypeIcon type="file" />
          {column.label}
        </span>
        {file == null ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">Lưu Hạng mục trước, rồi thêm tệp.</p>
        ) : (
          <BoardFileList tableId={file.tableId} recordId={file.recordId} columnKey={column.key} boardOwnerId={file.boardOwnerId} canAdd={disabled !== true} />
        )}
      </div>
    );
  }

  if (column.type === "select" || column.type === "contact") {
    const people = (contacts.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return (
      <div>
        {label}
        <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
          <option value="">{COLUMN_PLACEHOLDERS[column.type]}</option>
          {column.type === "select"
            ? (column.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            : people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          {column.type === "contact" && value !== "" && !people.some((person) => person.id === value) ? (
            <option value={value}>Liên hệ không còn trong danh bạ của bạn</option>
          ) : null}
        </select>
        {column.type === "contact" && isSharedBoard ? (
          <p data-contact-shared-note="" className="mt-1.5 text-[12.5px] text-muted-foreground">
            Mọi người trong bảng sẽ thấy tên này. Số điện thoại, email chỉ bạn thấy.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {label}
      <div className="relative">
        <input
          id={id}
          type={column.type === "date" ? "date" : column.type === "link" ? "url" : "text"}
          inputMode={column.type === "number" ? "decimal" : column.type === "link" ? "url" : undefined}
          placeholder={COLUMN_PLACEHOLDERS[column.type]}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(fieldClass, error !== null && "border-destructive focus:border-destructive", column.type === "link" && isHttpLink(value) && "pr-10")}
        />
        {column.type === "link" && isHttpLink(value) ? (
          <a
            href={value.trim()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Mở link trong tab mới"
            className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {error !== null ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
