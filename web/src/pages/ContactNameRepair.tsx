import { ArrowLeft, Check, FileUp, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { readReturn } from "@/lib/return-to";
import { IMPORT_ACCEPT, ImportFileError, readNameEntriesFromFile } from "@/lib/contact-import-file";
import { proposeNamesFromFile, suspectSyllables, type NameIssue, type NameIssueKind } from "@/lib/contact-name-repair";
import { useContacts } from "@/lib/use-contacts";
import { useContactNameIssues, useRenameContacts } from "@/lib/use-contact-name-repair";
import { cn } from "@/lib/utils";

const GROUPS: readonly { kind: NameIssueKind; title: string; hint: string }[] = [
  { kind: "broken", title: "Chữ bị vỡ", hint: "Đọc lại đúng bảng mã. Dòng không khôi phục được thì sửa tay." },
  { kind: "case", title: "Viết hoa / khoảng trắng", hint: "Tên viết thường hết hoặc hoa hết. Tên viết hoa có chủ ý được giữ nguyên." },
  { kind: "typo", title: "Có thể gõ sai", hint: "Âm tiết không giống tiếng Việt. Không tự đề xuất — sửa tay nếu đúng là sai." },
  { kind: "accents", title: "Thiếu dấu", hint: "Chỉ đề xuất khi có nguồn đáng tin: bạn bè trên AVORA, hoặc cùng số ở lần nhập khác." },
];

/**
 * Liên hệ › Sửa tên (AVORA-63 · B): old → proposed, a tick per row, `Chọn tất cả` per group,
 * `Áp dụng (N)`, and a toast with `Hoàn tác`. Nothing is changed until the person applies it;
 * everything is worked out on this device.
 */
const ContactNameRepair = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const back = readReturn(searchParams);
  const { issues: found, counts, isPending } = useContactNameIssues();
  const contacts = useContacts();
  // AVORA-65 · D: proposals read from the original file, matched by phone number.
  const [fromFile, setFromFile] = useState<NameIssue[] | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const issues = useMemo(() => {
    if (fromFile === null) return found;
    const replaced = new Map(fromFile.map((issue) => [issue.contactId, issue] as const));
    return found.map((issue) => replaced.get(issue.contactId) ?? issue);
  }, [found, fromFile]);
  const readOriginal = async (file: File): Promise<void> => {
    setIsReadingFile(true);
    setFileNote(null);
    try {
      const entries = await readNameEntriesFromFile(file);
      const proposals = proposeNamesFromFile(contacts.data ?? [], found, entries);
      setFromFile(proposals);
      setTicked((current) => new Set([...current, ...proposals.map((issue) => issue.contactId)]));
      setFileNote(
        proposals.length === 0
          ? `Đã đọc ${entries.length} dòng trong file, không có tên đúng dấu nào khớp số với tên cần sửa.`
          : `Đã đọc ${entries.length} dòng trong file: ${proposals.length} tên đúng dấu khớp theo số điện thoại, đã chọn sẵn.`,
      );
    } catch (error) {
      setFileNote(error instanceof ImportFileError ? error.message : "Không đọc được file này. Hãy thử .vcf, .csv hoặc .xlsx.");
    } finally {
      setIsReadingFile(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  };
  const rename = useRenameContacts();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState<boolean>(false);

  useEffect(() => {
    if (seeded || isPending) return;
    setTicked(new Set(issues.filter((issue) => issue.preselected).map((issue) => issue.contactId)));
    setSeeded(true);
  }, [issues, isPending, seeded]);

  const proposed = (issue: NameIssue): string => edits[issue.contactId] ?? issue.suggestion ?? "";
  const toApply = useMemo(
    () =>
      issues
        .filter((issue) => ticked.has(issue.contactId))
        .map((issue) => ({ id: issue.contactId, name: proposed(issue).trim() }))
        .filter((change, index) => change.name !== "" && change.name !== issues.find((issue) => issue.contactId === change.id)?.current && index >= 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, ticked, edits],
  );

  const apply = async (): Promise<void> => {
    try {
      const applied = await rename.mutateAsync(toApply);
      setTicked(new Set());
      setEdits({});
      toast.success(`Đã sửa ${applied.length} tên`, {
        duration: 10_000,
        action: {
          label: "Hoàn tác",
          onClick: () =>
            void rename.mutateAsync(applied.map((row) => ({ id: row.id, name: row.previous }))).then(
              () => toast.success("Đã trả lại đúng tên cũ."),
              (error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa hoàn tác được."),
            ),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa sửa được tên.");
    }
  };

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pt-10">
        <button
          type="button"
          onClick={() => navigate(back?.path ?? "/lien-he")}
          className="press -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-[14px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {back?.label ?? "Liên hệ"}
        </button>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-foreground">Sửa tên</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Tên chỉ đổi khi bạn bấm Áp dụng. Mọi kiểm tra chạy ngay trên máy, không gửi tên đi đâu.
        </p>
        {counts.broken + counts.accents > 0 ? (
          <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3" data-from-file="">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[13.5px] text-muted-foreground">
                File danh bạ gốc (hoặc bản xuất từ điện thoại) thường vẫn còn tên đúng. AVORA so theo số điện thoại, chỉ đề xuất cho tên bị vỡ / thiếu dấu, không thêm liên hệ mới, không đổi số hay email.
              </p>
              <button
                type="button"
                disabled={isReadingFile}
                onClick={() => fileRef.current?.click()}
                className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[14px] font-medium"
              >
                {isReadingFile ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
                Lấy tên đúng từ file gốc
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={IMPORT_ACCEPT}
                className="sr-only"
                aria-label="Chọn file danh bạ gốc"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void readOriginal(file);
                }}
              />
            </div>
            {fileNote !== null ? <p role="status" className="mt-2 text-[13px] font-medium text-foreground">{fileNote}</p> : null}
          </div>
        ) : null}

        {isPending ? (
          <div className="flex justify-center py-16" role="status" aria-label="Đang tải">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : issues.length === 0 ? (
          <p className="mt-10 rounded-xl border border-dashed border-border px-5 py-8 text-center text-[14.5px] text-muted-foreground">
            Không thấy tên nào cần sửa.
          </p>
        ) : (
          GROUPS.filter((group) => counts[group.kind] > 0).map((group) => {
            const rows = issues.filter((issue) => issue.kind === group.kind);
            const selectable = rows.filter((issue) => proposed(issue).trim() !== "");
            const allOn = selectable.length > 0 && selectable.every((issue) => ticked.has(issue.contactId));
            return (
              <section key={group.kind} data-name-group={group.kind} className="mt-6 rounded-xl border border-border bg-card">
                <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                  <h2 className="text-[15.5px] font-semibold text-foreground">
                    {group.title} <span className="tabular ml-1 text-[13px] font-medium text-muted-foreground">({rows.length})</span>
                  </h2>
                  {selectable.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setTicked((current) => {
                          const next = new Set(current);
                          for (const issue of selectable) {
                            if (allOn) next.delete(issue.contactId);
                            else next.add(issue.contactId);
                          }
                          return next;
                        })
                      }
                      className="press ml-auto rounded-md px-2 py-1 text-[13px] font-semibold text-primary"
                    >
                      {allOn ? "Bỏ chọn" : "Chọn tất cả"}
                    </button>
                  ) : null}
                  <p className="w-full text-[12.5px] text-muted-foreground">{group.hint}</p>
                </header>
                <ul>
                  {rows.slice(0, 400).map((issue) => (
                    <IssueRow
                      key={issue.contactId}
                      issue={issue}
                      value={proposed(issue)}
                      isOn={ticked.has(issue.contactId)}
                      onToggle={(on) =>
                        setTicked((current) => {
                          const next = new Set(current);
                          if (on) next.add(issue.contactId);
                          else next.delete(issue.contactId);
                          return next;
                        })
                      }
                      onEdit={(next) => {
                        setEdits((current) => ({ ...current, [issue.contactId]: next }));
                        setTicked((current) => new Set([...current, issue.contactId]));
                      }}
                    />
                  ))}
                  {rows.length > 400 ? <li className="px-4 py-3 text-[13px] text-muted-foreground">và {rows.length - 400} tên khác — áp dụng đợt này rồi mở lại.</li> : null}
                </ul>
              </section>
            );
          })
        )}
      </div>
      {toApply.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-md md:left-auto md:right-6 md:bottom-6 md:rounded-xl md:border">
          <button
            type="button"
            disabled={rename.isPending}
            onClick={() => void apply()}
            data-apply-names=""
            className="press flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-semibold text-primary-foreground disabled:opacity-60 md:w-auto"
          >
            {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Áp dụng ({toApply.length})
          </button>
        </div>
      ) : null}
    </div>
  );
};

function IssueRow({
  issue,
  value,
  isOn,
  onToggle,
  onEdit,
}: {
  issue: NameIssue;
  value: string;
  isOn: boolean;
  onToggle: (on: boolean) => void;
  onEdit: (next: string) => void;
}) {
  const needsHand = issue.suggestion === null;
  const suspects = issue.kind === "typo" ? (issue.suspects ?? []) : [];
  const stillSuspect = value.trim() === "" ? [] : suspectSyllables(value);
  return (
    <li data-name-row={issue.contactId} className="flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
      <input
        type="checkbox"
        checked={isOn}
        disabled={value.trim() === ""}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`Sửa "${issue.current}"`}
        className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-muted-foreground">
          <span className={cn(issue.kind === "broken" && "font-mono text-[13px]")}>
            {suspects.length === 0
              ? issue.current
              : issue.current.split(" ").map((word, index) => (
                  <span key={`${word}-${index}`} className={suspects.includes(word) ? "underline decoration-destructive decoration-dotted underline-offset-4" : undefined}>
                    {index > 0 ? " " : ""}
                    {word}
                  </span>
                ))}
          </span>
          {issue.source === "avora" ? <span className="ml-2 text-[11.5px]">· tên trên AVORA</span> : null}
          {issue.source === "phone" ? <span className="ml-2 text-[11.5px]">· cùng số ở liên hệ khác</span> : null}
          {issue.source === "file" ? <span className="ml-2 text-[11.5px] text-primary">· từ file gốc, cùng số</span> : null}
        </p>
        {needsHand && issue.kind === "broken" ? <p className="text-[12px] text-destructive">Không khôi phục được, sửa tay</p> : null}
        <input
          value={value}
          onChange={(event) => onEdit(event.target.value)}
          placeholder={needsHand ? "Gõ tên đúng" : undefined}
          spellCheck
          lang="vi"
          aria-label={`Tên mới cho "${issue.current}"`}
          className={cn(
            "mt-1 h-10 w-full rounded-md border bg-background px-3 text-[16px] font-medium text-foreground outline-none focus:border-primary md:text-[15px]",
            stillSuspect.length > 0 && value !== issue.current ? "border-amber-500/60" : "border-border",
          )}
        />
      </div>
    </li>
  );
}

export default ContactNameRepair;
