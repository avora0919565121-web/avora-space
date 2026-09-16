import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BulkInvitePanel } from "@/components/contacts/BulkInvitePanel";
import { CandidatePreview } from "@/components/contacts/CandidatePreview";
import { ColumnMapStep } from "@/components/contacts/ColumnMapStep";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  buildCandidateRows,
  defaultCandidateChoice,
  summarizeCandidates,
  type CandidateChoice,
  type CandidateRow,
  type ImportedContactCandidate,
  type TypeDecision,
} from "@/lib/contact-candidates";
import {
  DeviceContactsError,
  isDeviceContactsSupported,
  pickDeviceContacts,
} from "@/lib/contact-device";
import {
  buildImportRows,
  canImportRow,
  mapHeaderRow,
  MAX_IMPORT_ROWS,
  rowToCandidate,
  summarizeRows,
  type ImportColumn,
  type ImportRow,
} from "@/lib/contact-import";
import {
  applyColumnMapping,
  autoMapColumns,
  fileColumns,
  readRememberedMapping,
  rememberMapping,
  type ColumnMapping,
} from "@/lib/contact-import-mapping";
import {
  downloadImportTemplate,
  IMPORT_ACCEPT,
  ImportFileError,
  isVcardName,
  readImportFile,
} from "@/lib/contact-import-file";
import { parseVcards } from "@/lib/contact-vcard";
import type { Contact, ContactType } from "@/lib/contacts";
import { useAuth } from "@/lib/auth";
import { CHANNEL_REVIEW_ROUTE } from "@/lib/navigation";
import { useCandidateImport, type CandidateOutcome } from "@/lib/use-candidate-import";
import { useChannelIndex } from "@/lib/use-contact-channels";
import { useContacts } from "@/lib/use-contacts";

type ImportContactsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Step = "pick" | "map" | "preview" | "invite" | "done";

/**
 * A spreadsheet waiting on the one question its headings could not answer.
 *
 * Held whole rather than as candidates because the mapping decides what the cells mean: until
 * it is settled there is nothing to validate, and re-reading the file after every dropdown
 * change would be reading the same megabyte a dozen times.
 */
type PendingTable = {
  fileName: string;
  table: readonly string[][];
  header: readonly string[];
  columns: readonly string[];
  /** True when these exact headings have been matched before by this person. */
  wasRemembered: boolean;
  /** How many fields we recognised without help, for the line that admits to guessing. */
  matchedCount: number;
};

/** What the file itself was wrong about, kept separate from the candidates it did yield. */
type FileProblems = { invalid: number; sample: number } | null;

/** A phone book export, read card by card. */
async function readVcardFile(file: File): Promise<{
  candidates: readonly ImportedContactCandidate[];
  origins: string[];
  problems: FileProblems;
}> {
  const result = parseVcards(await file.text());

  if (result.total > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      `File có ${result.total} liên hệ, vượt giới hạn ${MAX_IMPORT_ROWS} mỗi lần nhập. Hãy tách thành nhiều file.`,
    );
  }

  return {
    candidates: result.candidates,
    // Counted over the cards actually read, so the numbering matches what is on screen.
    origins: result.candidates.map((_entry, position) => `Thẻ ${position + 1}`),
    // An unreadable card is the same kind of fact as a spreadsheet line missing a column, and
    // is shown in the same place rather than as a separate species of problem.
    problems: result.skipped > 0 ? { invalid: result.skipped, sample: 0 } : null,
  };
}

/**
 * Importing an address book, whichever way it arrives.
 *
 * Four steps, each a decision rather than a wizard page: choose a source, review what would be
 * written and tick it, invite whoever is new, then go wherever the result points. The two
 * sources part company only at the first step — a spreadsheet is parsed and validated, a phone
 * book is handed over by the operating system — and from the preview onwards they are the same
 * code working on the same shape.
 *
 * Nothing survives the dialog closing. The file is read into memory, shown, and forgotten; the
 * phone book entries likewise. These are other people's details and we are only passing them on.
 */
export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("pick");
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, CandidateChoice>>({});
  const [decisions, setDecisions] = useState<Record<string, TypeDecision>>({});
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fallbackType, setFallbackType] = useState<ContactType>("individual");
  const [fileProblems, setFileProblems] = useState<FileProblems>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isReading, setIsReading] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<CandidateOutcome | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const contactsQuery = useContacts();
  const contacts: Contact[] = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);

  // Both the book and its extra channels have to be loaded before anything is compared: an
  // index that is merely incomplete would report "not a duplicate" for someone already here.
  const { index, isPending: isIndexPending } = useChannelIndex();
  const { run, progress, isRunning } = useCandidateImport();

  const canPick = !isIndexPending && !isReading;

  useEffect(() => {
    if (open) return;
    setStep("pick");
    setRows([]);
    setPicked(new Set());
    setChoices({});
    setDecisions({});
    setSourceLabel(null);
    setPending(null);
    setMapping({});
    setFallbackType("individual");
    setFileProblems(null);
    setNotice(null);
    setOutcome(null);
    if (inputRef.current !== null) inputRef.current.value = "";
  }, [open]);

  /** Both sources end here: candidates in, preview out. */
  const startPreview = useCallback(
    (
      candidates: readonly ImportedContactCandidate[],
      origins: readonly string[],
      label: string,
      problems: FileProblems,
    ): void => {
      const built = buildCandidateRows(candidates, index, origins);

      if (built.length === 0) {
        setNotice(
          problems !== null && problems.invalid + problems.sample > 0
            ? "Không có dòng nào dùng được. Mỗi dòng cần tên và ít nhất một số điện thoại hoặc email."
            : "Không có liên hệ nào có tên kèm số điện thoại hoặc email.",
        );
        return;
      }

      setRows(built);
      // Nothing is ticked: importing is a decision per entry, never a default.
      setPicked(new Set());
      setChoices(Object.fromEntries(built.map((row) => [row.key, defaultCandidateChoice(row)])));
      setDecisions({});
      setSourceLabel(label);
      setFileProblems(problems);
      setStep("preview");
    },
    [index],
  );

  /**
   * A validated table turned into candidates, for a file whose columns are already settled.
   *
   * Everything from here on is the shared pipeline, untouched: the same validator, the same
   * duplicate matching, the same preview. A mapped file and a template file arrive here as the
   * same shape, which is what stops the two from drifting apart.
   */
  const startTable = useCallback(
    (table: readonly string[][], fileName: string): void => {
      const result = buildImportRows(table);
      if (result.kind === "refused") {
        setNotice(result.reason);
        return;
      }

      const counts = summarizeRows(result.rows);
      const usable: ImportRow[] = result.rows.filter((row) => canImportRow(row));

      startPreview(
        usable.map(rowToCandidate),
        usable.map((row) => `Dòng ${row.lineNumber}`),
        fileName,
        { invalid: counts.invalid, sample: counts.sample },
      );
    },
    [startPreview],
  );

  const chooseFile = useCallback(
    async (file: File): Promise<void> => {
      setNotice(null);
      setIsReading(true);
      try {
        // The extension picks the reader, as it does between .csv and .xlsx: a .vcf arrives
        // with a different MIME type from almost every phone, and some send none at all.
        if (isVcardName(file.name)) {
          const read = await readVcardFile(file);
          if (read.candidates.length === 0) {
            setNotice(
              read.problems !== null
                ? "Không đọc được liên hệ nào trong file này. Hãy xuất lại danh bạ rồi thử lại."
                : "File này không có liên hệ nào.",
            );
            return;
          }
          startPreview(read.candidates, read.origins, file.name, read.problems);
          return;
        }

        const table = await readImportFile(file);
        const header = table[0] ?? [];

        // Our own template goes straight through. Asking whether the column called `ten` is
        // the name would be a screen that exists only to be clicked past.
        const asTemplate = mapHeaderRow(header);
        if (asTemplate.ten !== undefined && asTemplate.loai !== undefined) {
          startTable(table, file.name);
          return;
        }

        const remembered =
          user === null ? null : readRememberedMapping(user.id, header);
        const guessed = autoMapColumns(header);

        setPending({
          fileName: file.name,
          table,
          header,
          columns: fileColumns(header),
          wasRemembered: remembered !== null,
          matchedCount: Object.keys(guessed).length,
        });
        // A remembered mapping is shown, never applied behind anyone's back: last month's
        // export may have grown a column, and the file is about to be written to the book.
        setMapping(remembered ?? guessed);
        setFallbackType("individual");
        setStep("map");
      } catch (error) {
        setNotice(
          error instanceof ImportFileError
            ? error.message
            : "Không đọc được file này. Hãy thử lại với file .csv, .xlsx hoặc .vcf.",
        );
      } finally {
        setIsReading(false);
        if (inputRef.current !== null) inputRef.current.value = "";
      }
    },
    [startPreview, startTable, user],
  );

  /** The mapping accepted: the file is rewritten under our headings and handed onward. */
  const continueFromMapping = useCallback((): void => {
    if (pending === null) return;
    setNotice(null);
    if (user !== null) rememberMapping(user.id, pending.header, mapping);
    startTable(applyColumnMapping(pending.table, mapping, fallbackType), pending.fileName);
  }, [pending, mapping, fallbackType, user, startTable]);

  const chooseDevice = useCallback(async (): Promise<void> => {
    setNotice(null);
    setIsReading(true);
    try {
      const candidates = await pickDeviceContacts();
      if (candidates.length === 0) {
        setNotice("Bạn chưa chọn liên hệ nào từ danh bạ máy.");
        return;
      }
      startPreview(
        candidates,
        candidates.map((entry, position) => `Danh bạ ${position + 1}`),
        "Danh bạ trên máy này",
        null,
      );
    } catch (error) {
      setNotice(
        error instanceof DeviceContactsError
          ? error.message
          : "Không mở được danh bạ máy. Hãy thử lại, hoặc nhập bằng file.",
      );
    } finally {
      setIsReading(false);
    }
  }, [startPreview]);

  const togglePicked = useCallback((key: string): void => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const counts = useMemo(() => summarizeCandidates(rows, decisions), [rows, decisions]);

  const toggleAll = useCallback((): void => {
    setPicked((current) => {
      if (current.size === counts.ready) return new Set();
      const ready = rows.filter((row) => {
        const summary = summarizeCandidates([row], decisions);
        return summary.ready === 1;
      });
      return new Set(ready.map((row) => row.key));
    });
  }, [rows, decisions, counts.ready]);

  const startImport = useCallback(async (): Promise<void> => {
    setNotice(null);
    const chosen = rows.filter((row) => picked.has(row.key));
    const result = await run(chosen, choices, decisions, contacts);
    setOutcome(result);

    if (result.created.length === 0 && result.merged.length === 0) {
      setNotice(
        result.failed.length > 0
          ? `Không nhập được liên hệ nào. ${result.failed[0].reason}`
          : "Không có liên hệ nào được nhập.",
      );
      return;
    }
    setStep("invite");
  }, [rows, picked, choices, decisions, contacts, run]);

  const total = (outcome?.created.length ?? 0) + (outcome?.merged.length ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] max-w-[720px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between border-b border-border px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              {step === "pick"
                ? "Nhập liên hệ"
                : step === "map"
                  ? "Ghép cột trong file của bạn"
                  : step === "preview"
                    ? "Xem trước trước khi nhập"
                    : step === "invite"
                      ? "Đã nhập xong"
                      : "Xong"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              {step === "pick"
                ? "Từ file bảng tính, file vCard (.vcf) xuất từ iPhone/Android, hoặc thẳng từ danh bạ trên máy"
                : step === "map"
                  ? "File không cần đúng tên cột như file mẫu — chỉ cần nói cột nào là gì"
                  : step === "preview"
                    ? (sourceLabel ?? "Chọn những liên hệ muốn lưu")
                    : `${total} liên hệ đã vào danh bạ`}
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
              canPick={canPick}
              isReading={isReading}
              isIndexPending={isIndexPending}
              onFile={(file) => void chooseFile(file)}
              onDevice={() => void chooseDevice()}
            />
          ) : step === "map" && pending !== null ? (
            <ColumnMapStep
              fileName={pending.fileName}
              header={pending.header}
              columns={pending.columns}
              mapping={mapping}
              fallbackType={fallbackType}
              wasRemembered={pending.wasRemembered}
              matchedCount={pending.matchedCount}
              onChange={(column: ImportColumn, heading) =>
                setMapping((current) => {
                  const next = { ...current };
                  if (heading === undefined) delete next[column];
                  else next[column] = heading;
                  return next;
                })
              }
              onFallbackType={setFallbackType}
              onBack={() => {
                setStep("pick");
                setPending(null);
                setMapping({});
                setNotice(null);
              }}
              onContinue={continueFromMapping}
            />
          ) : step === "preview" ? (
            <>
              {fileProblems !== null && fileProblems.invalid + fileProblems.sample > 0 ? (
                <p className="mb-3 rounded-md border border-border bg-primary/[0.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
                  {fileProblems.invalid > 0
                    ? `${fileProblems.invalid} dòng trong file bị thiếu trường bắt buộc nên không hiện ở đây. `
                    : ""}
                  {fileProblems.sample > 0
                    ? `${fileProblems.sample} dòng ví dụ của file mẫu đã được bỏ qua.`
                    : ""}
                </p>
              ) : null}
              <CandidatePreview
                rows={rows}
                picked={picked}
                choices={choices}
                decisions={decisions}
                counts={counts}
                onToggle={togglePicked}
                onToggleAll={toggleAll}
                onChoice={(key, choice) =>
                  setChoices((current) => ({ ...current, [key]: choice }))
                }
                onDecision={(key, decision) =>
                  setDecisions((current) => ({ ...current, [key]: decision }))
                }
              />
            </>
          ) : step === "invite" ? (
            <InviteStep outcome={outcome} onDone={() => setStep("done")} />
          ) : (
            <DoneStep
              outcome={outcome}
              onReview={() => {
                onOpenChange(false);
                navigate(CHANNEL_REVIEW_ROUTE);
              }}
              onClose={() => onOpenChange(false)}
            />
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
              Chọn nguồn khác
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
  canPick,
  isReading,
  isIndexPending,
  onFile,
  onDevice,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  canPick: boolean;
  isReading: boolean;
  isIndexPending: boolean;
  onFile: (file: File) => void;
  onDevice: () => void;
}) {
  // Absent rather than greyed out: a disabled button poses a question it cannot answer, and the
  // file route below works on every browser.
  const hasDevice = isDeviceContactsSupported();

  return (
    <div>
      <div className="rounded-xl border border-border bg-accent/20 p-5">
        <h3 className="text-[15px] font-semibold text-foreground">1. Tải file mẫu</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          File mẫu có sẵn 2 dòng ví dụ — một cá nhân, một doanh nghiệp.{" "}
          <strong className="font-semibold text-foreground">Xoá 2 dòng đó trước khi nhập</strong>,
          cột <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">loai</code> chỉ nhận{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">ca_nhan</code> hoặc{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">doanh_nghiep</code>. Ai
          có hai số thì điền thêm cột{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">dien_thoai_2</code>.
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
        <h3 className="text-[15px] font-semibold text-foreground">2. Tải file lên</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Tối đa {MAX_IMPORT_ROWS.toLocaleString("vi-VN")} liên hệ mỗi lần. Bạn sẽ xem lại từng
          liên hệ trước khi có gì được lưu.
        </p>
        {/* The template is an offer, not a requirement: a file exported from another CRM keeps
            its own headings and the next step asks which is which. */}
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Tên cột không cần giống file mẫu — để “Họ tên” hay “SĐT” cũng được, AVORA sẽ hỏi cột
          nào là gì trước khi nhập.
        </p>
        {/* The one route an iPhone owner has: Safari has no contacts picker, so the phone's own
            export is what they can actually produce. */}
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Nhận cả file danh bạ{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-[12.5px]">.vcf</code> xuất từ
          iPhone hay Android — không cần điền theo mẫu.
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
          disabled={!canPick}
          onClick={() => inputRef.current?.click()}
        >
          <FileSpreadsheet className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {isReading ? "Đang đọc…" : "Chọn file .csv, .xlsx hoặc .vcf"}
        </Button>
      </div>

      {hasDevice ? (
        <div className="mt-4 rounded-xl border border-border p-5">
          <h3 className="text-[15px] font-semibold text-foreground">Hoặc lấy từ danh bạ máy</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            Máy sẽ mở danh bạ của bạn để tự chọn ai muốn chia sẻ — AVORA chỉ nhận đúng những người
            bạn chọn, không đọc cả danh bạ.
          </p>
          <Button
            variant="outline"
            className="press mt-3.5 h-10 px-4"
            disabled={!canPick}
            onClick={onDevice}
          >
            <Smartphone className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            {isReading ? "Đang mở…" : "Chọn từ danh bạ máy"}
          </Button>
        </div>
      ) : null}

      {isIndexPending ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Đang tải danh bạ hiện có để đối chiếu trùng lặp…
        </p>
      ) : null}
    </div>
  );
}

function InviteStep({
  outcome,
  onDone,
}: {
  outcome: CandidateOutcome | null;
  onDone: () => void;
}) {
  const fresh: Contact[] = useMemo(() => outcome?.created ?? [], [outcome]);

  return (
    <div>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-accent/20 p-5">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-money-in"
          strokeWidth={1.9}
          aria-hidden="true"
        />
        <div>
          <p className="text-[14.5px] font-semibold text-foreground">
            Đã nhập {outcome?.created.length ?? 0} liên hệ mới
            {(outcome?.merged.length ?? 0) > 0 ? `, gộp ${outcome?.merged.length} liên hệ` : ""}
          </p>
          {(outcome?.failed.length ?? 0) > 0 ? (
            <p className="mt-1 text-[13px] leading-relaxed text-primary">
              {outcome?.failed.length} liên hệ không nhập được:{" "}
              {outcome?.failed
                .slice(0, 3)
                .map((entry) => entry.origin)
                .join(", ")}
              . Sửa lại rồi nhập lại phần đó.
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

/**
 * The one thing worth doing next.
 *
 * An import that could not decide which of someone's numbers is the real one has left a
 * question open, and this is where it gets handed over rather than left to be discovered later.
 * When there is nothing to settle, the same slot says so and goes back to the book — either way
 * the flow ends on an action and never on a static list.
 */
function DoneStep({
  outcome,
  onReview,
  onClose,
}: {
  outcome: CandidateOutcome | null;
  onReview: () => void;
  onClose: () => void;
}) {
  const needsReview = outcome?.needsReviewCount ?? 0;

  if (needsReview > 0) {
    return (
      <div className="rounded-xl border border-border bg-accent/25 p-5">
        <p className="text-[14.5px] font-semibold text-foreground">
          {needsReview} liên hệ cần bạn xem lại
        </p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Những người này có nhiều số điện thoại hoặc email. AVORA giữ lại tất cả nhưng chưa biết
          cái nào là chính — bạn chọn giúp.
        </p>
        <Button className="press mt-4 h-10 gap-1.5 px-4" onClick={onReview}>
          Xem lại ngay
          <ArrowRight className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-accent/20 p-5 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-card">
        <CheckCircle2 className="h-6 w-6 text-money-in" strokeWidth={1.9} aria-hidden="true" />
      </span>
      <p className="mt-3 text-[14.5px] font-semibold text-foreground">Xong</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
        Mọi liên hệ vừa nhập đã có kênh liên hệ rõ ràng — không còn gì phải xem lại.
      </p>
      <Button variant="outline" className="press mt-4 h-10 px-4" onClick={onClose}>
        Quay lại Liên hệ
      </Button>
    </div>
  );
}
