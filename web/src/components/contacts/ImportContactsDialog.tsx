import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BulkInvitePanel } from "@/components/contacts/BulkInvitePanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  buildImportRows,
  canImportRow,
  defaultChoice,
  MAX_IMPORT_ROWS,
  summarizeRows,
  type DuplicateChoice,
  type ImportRow,
} from "@/lib/contact-import";
import {
  downloadImportTemplate,
  IMPORT_ACCEPT,
  ImportFileError,
  readImportFile,
} from "@/lib/contact-import-file";
import type { Contact } from "@/lib/contacts";
import { useContactImport, type ImportOutcome } from "@/lib/use-contact-import";
import { useContacts } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

type ImportContactsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Step = "pick" | "preview" | "invite";

/**
 * Importing an address book from a spreadsheet.
 *
 * Three steps, each one a decision rather than a wizard page: choose the file, read the table and
 * tick what should be written, then invite whoever is new. Nothing is stored between steps and
 * nothing survives the dialog closing — the uploaded file is read into memory, shown, and
 * forgotten, because these are other people's details and we are only passing them along.
 */
export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const [step, setStep] = useState<Step>("pick");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<number, DuplicateChoice>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isReading, setIsReading] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const contactsQuery = useContacts();
  const contacts: Contact[] = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const { run, progress, isRunning } = useContactImport();

  /**
   * Everything read from the file is dropped the moment the dialog closes. There is no table,
   * no cache and no draft kept anywhere: reopening starts from an empty file picker.
   */
  useEffect(() => {
    if (open) return;
    setStep("pick");
    setRows([]);
    setPicked(new Set());
    setChoices({});
    setFileName(null);
    setNotice(null);
    setOutcome(null);
    if (inputRef.current !== null) inputRef.current.value = "";
  }, [open]);

  const chooseFile = useCallback(
    async (file: File): Promise<void> => {
      setNotice(null);
      setIsReading(true);
      try {
        const table = await readImportFile(file);
        const result = buildImportRows(table, contacts);
        if (result.kind === "refused") {
          setNotice(result.reason);
          return;
        }
        setRows(result.rows);
        // Nothing is ticked: importing is a decision per row, never a default.
        setPicked(new Set());
        setChoices(
          Object.fromEntries(result.rows.map((row) => [row.lineNumber, defaultChoice(row)])),
        );
        setFileName(file.name);
        setStep("preview");
      } catch (error) {
        setNotice(
          error instanceof ImportFileError
            ? error.message
            : "Không đọc được file này. Hãy thử lại với file .csv hoặc .xlsx.",
        );
      } finally {
        setIsReading(false);
        if (inputRef.current !== null) inputRef.current.value = "";
      }
    },
    [contacts],
  );

  const togglePicked = useCallback((lineNumber: number): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(lineNumber)) next.delete(lineNumber);
      else next.add(lineNumber);
      return next;
    });
  }, []);

  const importable = useMemo(() => rows.filter((row) => canImportRow(row)), [rows]);
  const counts = useMemo(() => summarizeRows(rows), [rows]);

  const allPicked = importable.length > 0 && picked.size === importable.length;

  const toggleAll = useCallback((): void => {
    setPicked((current) =>
      current.size === importable.length ? new Set() : new Set(importable.map((row) => row.lineNumber)),
    );
  }, [importable]);

  const startImport = useCallback(async (): Promise<void> => {
    setNotice(null);
    const chosen = rows.filter((row) => picked.has(row.lineNumber));
    const result = await run(chosen, choices, contacts);
    setOutcome(result);

    if (result.created.length === 0 && result.merged.length === 0) {
      setNotice(
        result.failed.length > 0
          ? `Không nhập được dòng nào. ${result.failed[0].reason}`
          : "Không có dòng nào được nhập.",
      );
      return;
    }
    setStep("invite");
  }, [rows, picked, choices, contacts, run]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] max-w-[720px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between border-b border-border px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              {step === "invite" ? "Đã nhập xong" : "Nhập liên hệ từ file"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              {step === "pick"
                ? "Tải file mẫu, điền vào, rồi tải lên — hỗ trợ .csv và .xlsx"
                : step === "preview"
                  ? (fileName ?? "Xem trước trước khi nhập")
                  : `${(outcome?.created.length ?? 0) + (outcome?.merged.length ?? 0)} liên hệ đã vào danh bạ`}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === "pick" ? (
            <PickStep
              inputRef={inputRef}
              isReading={isReading}
              onFile={(file) => void chooseFile(file)}
            />
          ) : step === "preview" ? (
            <PreviewStep
              rows={rows}
              picked={picked}
              choices={choices}
              allPicked={allPicked}
              counts={counts}
              onToggle={togglePicked}
              onToggleAll={toggleAll}
              onChoice={(lineNumber, choice) =>
                setChoices((current) => ({ ...current, [lineNumber]: choice }))
              }
            />
          ) : (
            <InviteStep outcome={outcome} onDone={() => onOpenChange(false)} />
          )}

          {notice !== null ? (
            <p role="alert" className="mt-4 text-[13px] leading-relaxed text-primary">
              {notice}
            </p>
          ) : null}
        </div>

        {step === "preview" ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
            <Button
              variant="outline"
              className="press h-10 px-5"
              disabled={isRunning}
              onClick={() => {
                setStep("pick");
                setRows([]);
                setPicked(new Set());
                setNotice(null);
              }}
            >
              Chọn file khác
            </Button>
            <Button
              className="press h-10 px-5"
              disabled={picked.size === 0 || isRunning}
              onClick={() => void startImport()}
            >
              {isRunning && progress !== null
                ? `Đang nhập ${progress.done}/${progress.total}…`
                : `Nhập ${picked.size} liên hệ đã chọn`}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PickStep({
  inputRef,
  isReading,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isReading: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <div>
      <div className="rounded-xl border border-border bg-accent/20 p-5">
        <h3 className="text-[15px] font-semibold text-foreground">1. Tải file mẫu</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          File mẫu có sẵn 2 dòng ví dụ — một cá nhân, một doanh nghiệp.{" "}
          <strong className="font-semibold text-foreground">Xoá 2 dòng đó trước khi nhập</strong>, cột{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">loai</code> chỉ nhận{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">ca_nhan</code> hoặc{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">doanh_nghiep</code>.
        </p>
        <Button
          variant="outline"
          className="press mt-3.5 h-10 px-4"
          onClick={() => downloadImportTemplate()}
        >
          <Download className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Tải file mẫu
        </Button>
      </div>

      <div className="mt-4 rounded-xl border border-border p-5">
        <h3 className="text-[15px] font-semibold text-foreground">2. Tải file đã điền lên</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Tối đa {MAX_IMPORT_ROWS} dòng mỗi lần. Bạn sẽ xem lại từng dòng trước khi có gì được lưu.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="sr-only"
          aria-label="Chọn file liên hệ"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onFile(file);
          }}
        />
        <Button
          className="press mt-3.5 h-10 px-4"
          disabled={isReading}
          onClick={() => inputRef.current?.click()}
        >
          <FileSpreadsheet className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {isReading ? "Đang đọc file…" : "Chọn file .csv hoặc .xlsx"}
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  rows,
  picked,
  choices,
  allPicked,
  counts,
  onToggle,
  onToggleAll,
  onChoice,
}: {
  rows: readonly ImportRow[];
  picked: ReadonlySet<number>;
  choices: Readonly<Record<number, DuplicateChoice>>;
  allPicked: boolean;
  counts: { valid: number; invalid: number; duplicate: number; sample: number };
  onToggle: (lineNumber: number) => void;
  onToggleAll: () => void;
  onChoice: (lineNumber: number, choice: DuplicateChoice) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <span className="font-medium text-foreground">{counts.valid} dòng hợp lệ</span>
        <span className={counts.invalid > 0 ? "text-primary" : "text-muted-foreground"}>
          {counts.invalid} dòng lỗi
        </span>
        <span className="text-muted-foreground">{counts.duplicate} dòng trùng</span>
        {counts.sample > 0 ? (
          <span className="text-primary">{counts.sample} dòng ví dụ chưa xoá</span>
        ) : null}
      </div>

      {counts.valid > 0 ? (
        <button
          type="button"
          onClick={onToggleAll}
          className="press mt-3 text-[13px] font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
        >
          {allPicked ? "Bỏ chọn tất cả" : `Chọn tất cả ${counts.valid} dòng hợp lệ`}
        </button>
      ) : null}

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => {
          const usable = canImportRow(row);
          const isPicked = picked.has(row.lineNumber);
          const choice = choices[row.lineNumber] ?? defaultChoice(row);

          return (
            <li
              key={row.lineNumber}
              className={cn("px-4 py-3", usable ? null : "bg-primary/[0.04]")}
            >
              <div className="flex items-start gap-3">
                {/* A row that cannot be written has no checkbox at all: a disabled one would
                    invite a click that can never do anything. */}
                {usable ? (
                  <Checkbox
                    className="mt-0.5"
                    checked={isPicked}
                    onCheckedChange={() => onToggle(row.lineNumber)}
                    aria-label={`Nhập dòng ${row.lineNumber}: ${row.name || "chưa có tên"}`}
                  />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-[12px] text-muted-foreground">
                      Dòng {row.lineNumber}
                    </span>
                    {row.kind !== null ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-foreground/75">
                        {row.kind === "individual" ? (
                          <UserRound className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
                        ) : (
                          <Building2 className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
                        )}
                        {row.kind === "individual" ? "Cá nhân" : "Doanh nghiệp"}
                      </span>
                    ) : null}
                    <span className="truncate text-[14.5px] font-semibold text-foreground">
                      {row.name.length > 0 ? row.name : "(chưa có tên)"}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {[row.fields.dien_thoai, row.fields.email].filter((value) => value.length > 0).join(" · ") ||
                      "Không có số điện thoại hoặc email"}
                  </p>

                  {row.isSample ? (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-primary">
                      Đây là dòng ví dụ trong file mẫu — xoá khỏi file rồi tải lên lại.
                    </p>
                  ) : null}

                  {row.problems.map((problem) => (
                    <p key={problem} className="mt-1.5 text-[12.5px] leading-relaxed text-primary">
                      {problem}
                    </p>
                  ))}

                  {usable && row.duplicate !== null ? (
                    <div className="mt-2 rounded-md border border-border bg-accent/25 px-3 py-2.5">
                      <p className="text-[12.5px] text-foreground">
                        Trùng {row.duplicate.on === "phone" ? "số điện thoại" : "email"} với{" "}
                        <strong className="font-semibold">{row.duplicate.contactName}</strong>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {/* Merging is only offered when the two are the same kind of contact:
                            a person's details cannot be poured into a company row. */}
                        {row.duplicate.canMerge ? (
                          <ChoiceChip
                            label="Gộp"
                            isActive={choice === "merge"}
                            onClick={() => onChoice(row.lineNumber, "merge")}
                          />
                        ) : null}
                        <ChoiceChip
                          label="Bỏ qua"
                          isActive={choice === "skip"}
                          onClick={() => onChoice(row.lineNumber, "skip")}
                        />
                        <ChoiceChip
                          label="Vẫn tạo mới"
                          isActive={choice === "create"}
                          onClick={() => onChoice(row.lineNumber, "create")}
                        />
                      </div>
                      {choice === "merge" ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                          Chỉ điền vào những ô đang trống của {row.duplicate.contactName} — không ghi
                          đè dữ liệu đã có.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChoiceChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "press rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
        isActive
          ? "border-primary/60 bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-card/70",
      )}
    >
      {label}
    </button>
  );
}

function InviteStep({
  outcome,
  onDone,
}: {
  outcome: ImportOutcome | null;
  onDone: () => void;
}) {
  const fresh: Contact[] = useMemo(() => outcome?.created ?? [], [outcome]);

  return (
    <div>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-accent/20 p-5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-money-in" strokeWidth={1.9} aria-hidden="true" />
        <div>
          <p className="text-[14.5px] font-semibold text-foreground">
            Đã nhập {outcome?.created.length ?? 0} liên hệ mới
            {(outcome?.merged.length ?? 0) > 0 ? `, gộp ${outcome?.merged.length} liên hệ` : ""}
          </p>
          {(outcome?.failed.length ?? 0) > 0 ? (
            <p className="mt-1 text-[13px] leading-relaxed text-primary">
              {outcome?.failed.length} dòng không nhập được:{" "}
              {outcome?.failed
                .slice(0, 3)
                .map((entry) => `dòng ${entry.lineNumber}`)
                .join(", ")}
              . Sửa lại trong file rồi nhập lại phần đó.
            </p>
          ) : null}
        </div>
      </div>

      <h3 className="mt-5 text-[15px] font-semibold text-foreground">Mời họ dùng AVORA</h3>
      <div className="mt-2">
        <BulkInvitePanel contacts={fresh} onDone={onDone} />
      </div>
    </div>
  );
}
