import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, Hourglass, Lightbulb, Loader2, Scissors, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DateField } from "@/components/calendar/DateField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { useAuth } from "@/lib/auth";
import { chatKeys, ensureJournalConversation, sendMessage } from "@/lib/chat";
import { logError } from "@/lib/log";
import { hereFrom, withReturn } from "@/lib/return-to";
import { DAY_QUESTIONS, dismissReview, reviewJournalText, WEEK_QUESTIONS, type ReviewKind } from "@/lib/review";
import { recordLink, statusLabelIn } from "@/lib/think-hub";
import { useThinkHubActions } from "@/lib/use-think-hub";
import { useShelfActions } from "@/lib/use-think-hub-shelf";
import type { ReviewState } from "@/lib/use-review";
import { cn } from "@/lib/utils";

const THOUGHT_LIMIT = 8;
const DONE_LIMIT = 5;

function Block({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-card px-4 py-3">
      <h3 className="flex items-center gap-2 text-[14.5px] font-semibold text-foreground">
        {icon}
        <span className="min-w-0 flex-1">{title}</span>
        <span className="tabular text-[12.5px] font-medium text-muted-foreground">{count}</span>
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The review screen (C7, AVORA-50 · B): four read-only blocks worked out from existing data,
 * the short questions, and one `Lưu vào Nhật ký` that writes a single entry into the person's own
 * journal. No score, no streak, no push; closing it without saving is fine.
 */
export function ReviewSheet({
  kind,
  review,
  open,
  onOpenChange,
}: {
  kind: ReviewKind;
  review: ReviewState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const actions = useThinkHubActions();
  const { star } = useShelfActions();
  const { range, summary } = review.summaryOf(kind);
  const questions = kind === "week" ? WEEK_QUESTIONS : DAY_QUESTIONS;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showAllThought, setShowAllThought] = useState<boolean>(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const here = hereFrom(location, kind === "week" ? "Nhìn lại tuần" : "Nhìn lại hôm nay");

  const thoughtRows = useMemo(
    () => summary.thought.flatMap((group) => group.records.map((record) => ({ record, table: group.table }))),
    [summary.thought],
  );
  const focusChoices = useMemo(() => {
    const seen = new Set<string>();
    return [...summary.pending, ...thoughtRows].filter((row) => (seen.has(row.record.id) ? false : (seen.add(row.record.id), true))).slice(0, 8);
  }, [summary.pending, thoughtRows]);
  const focusTitle = focusChoices.find((row) => row.record.id === focusId)?.record.title ?? null;

  const save = async (): Promise<void> => {
    if (user?.id === undefined || isSaving) return;
    setIsSaving(true);
    try {
      const journalId = await ensureJournalConversation();
      await sendMessage(journalId, user.id, reviewJournalText({ range, summary, answers, focusTitle }));
      if (focusId !== null) await star.mutateAsync(focusId).catch(() => undefined);
      dismissReview(user.id, kind, review.today);
      review.refresh();
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(journalId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      toast.success("Đã lưu vào Nhật ký.", {
        action: { label: "Mở", onClick: () => navigate(withReturn(`/tin-nhan/${journalId}?xem=nhat-ky`, here)) },
      });
      onOpenChange(false);
    } catch (error) {
      logError("review", error);
      toast.error("Chưa lưu được vào Nhật ký. Thử lại nhé.");
    } finally {
      setIsSaving(false);
    }
  };

  const setAside = (recordId: string): void => {
    actions
      .updateRecord(recordId, { status: "khong_lam" })
      .then(() => toast.success("Đã chuyển sang Không làm nữa (không xoá)."))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không đổi được."));
  };

  const shownThought = showAllThought ? thoughtRows : thoughtRows.slice(0, THOUGHT_LIMIT);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(longDialogContentClass, "max-w-[600px] bg-background")}>
        <LongDialogHeader>
          <DialogTitle className="text-[19px] font-semibold tracking-tight">
            {kind === "week" ? `Nhìn lại tuần ${range.label}` : `Nhìn lại hôm nay · ${range.label}`}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
            Ôn lại điều đã nghĩ, đã đọc, đã làm. Không chấm điểm — bỏ qua câu nào cũng được.
          </DialogDescription>
        </LongDialogHeader>

        <LongDialogBody className="space-y-3">
          <Block icon={<Lightbulb className="h-4 w-4 text-amber-600" aria-hidden="true" />} title="Đã suy nghĩ" count={`${summary.thoughtCount} Hạng mục`}>
            {thoughtRows.length === 0 ? (
              <Empty>Chưa có Hạng mục nào mới hay sửa.</Empty>
            ) : (
              <ul className="space-y-0.5">
                {shownThought.map(({ record, table }) => (
                  <li key={record.id}>
                    <Link
                      to={withReturn(recordLink(table.id, record.id), here)}
                      onClick={() => onOpenChange(false)}
                      className="press flex min-h-10 items-center gap-2 rounded-md px-1.5 text-[14px] hover:bg-accent/40"
                    >
                      <span className="min-w-0 flex-1 truncate">{record.title}</span>
                      <span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted-foreground">{table.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {thoughtRows.length > THOUGHT_LIMIT ? (
              <button type="button" onClick={() => setShowAllThought((current) => !current)} className="press mt-1 px-1.5 text-[12.5px] font-medium text-primary">
                {showAllThought ? "Thu gọn" : `Xem thêm ${thoughtRows.length - THOUGHT_LIMIT}`}
              </button>
            ) : null}
          </Block>

          <Block
            icon={<BookOpen className="h-4 w-4 text-amber-700" aria-hidden="true" />}
            title="Đã đọc"
            count={`${summary.books.length} sách · ${summary.readingNotes} ghi chép`}
          >
            {summary.books.length === 0 && summary.readingNotes === 0 ? (
              <Empty>Chưa có sách hay ghi chép đọc sách nào.</Empty>
            ) : (
              <ul className="space-y-0.5 text-[14px]">
                {summary.books.map((book) => (
                  <li key={book.id} className="flex min-h-9 items-center gap-2 px-1.5">
                    <span className="min-w-0 flex-1 truncate">{book.title}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{statusLabelIn(null, book.status)}</span>
                  </li>
                ))}
                {summary.readingNotes > 0 ? (
                  <li className="px-1.5 text-[12.5px] text-muted-foreground">{summary.readingNotes} ghi chép đọc sách đã viết / sửa</li>
                ) : null}
              </ul>
            )}
          </Block>

          <Block icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />} title="Đã làm xong" count={`${summary.done.length} việc`}>
            {summary.done.length === 0 ? (
              <Empty>Chưa có nhiệm vụ nào xong.</Empty>
            ) : (
              <ul className="space-y-0.5 text-[14px]">
                {summary.done.slice(0, DONE_LIMIT).map((task) => (
                  <li key={task.id} className="flex min-h-9 items-center gap-2 px-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  </li>
                ))}
                {summary.done.length > DONE_LIMIT ? <li className="px-1.5 text-[12.5px] text-muted-foreground">và {summary.done.length - DONE_LIMIT} việc khác</li> : null}
              </ul>
            )}
          </Block>

          <Block icon={<Hourglass className="h-4 w-4 text-destructive" aria-hidden="true" />} title="Còn treo" count={`${summary.pending.length} Hạng mục`}>
            {summary.pending.length === 0 ? (
              <Empty>Không có Hạng mục nào quá hạn.</Empty>
            ) : (
              <ul className="space-y-2">
                {summary.pending.slice(0, 8).map(({ record, table }) => (
                  <li key={record.id} className="rounded-md border border-border/70 px-2.5 py-2">
                    <p className="truncate text-[14px] font-medium">{record.title}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {table.name} · hạn {record.nextActionDate?.slice(8, 10)}/{record.nextActionDate?.slice(5, 7)}
                    </p>
                    {moving === record.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <DateField
                          value={null}
                          label="Ngày mới"
                          title="Dời tới ngày"
                          allow="future"
                          onChange={(day) => {
                            if (day === "") return;
                            setMoving(null);
                            actions
                              .updateRecord(record.id, { nextActionDate: day })
                              .then(() => toast.success("Đã dời ngày."))
                              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không dời được."));
                          }}
                        />
                        <button type="button" aria-label="Thôi" onClick={() => setMoving(null)} className="press flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setMoving(record.id)} className="press inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-[12.5px] hover:bg-accent/40">
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Dời ngày
                        </button>
                        <Link
                          to={withReturn(recordLink(table.id, record.id), here)}
                          onClick={() => onOpenChange(false)}
                          className="press inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-[12.5px] hover:bg-accent/40"
                        >
                          <Scissors className="h-3.5 w-3.5" aria-hidden="true" /> Chia nhỏ
                        </Link>
                        <button type="button" onClick={() => setAside(record.id)} className="press inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-[12.5px] text-muted-foreground hover:bg-accent/40">
                          Bỏ
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <section className="space-y-3 pt-1">
            {questions.map((question, index) => (
              <label key={question} className="block">
                <span className="text-[14px] font-medium text-foreground">{question}</span>
                <textarea
                  value={answers[index] ?? ""}
                  onChange={(event) => setAnswers((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
                  rows={2}
                  maxLength={1000}
                  placeholder="Không bắt buộc"
                  className="mt-1.5 w-full resize-y rounded-[10px] border border-border bg-card px-3 py-2 text-[16px] md:text-[14.5px] outline-none focus:border-primary"
                />
                {kind === "week" && index === 2 && focusChoices.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Chọn một Hạng mục để đánh sao">
                    {focusChoices.map(({ record }) => (
                      <button
                        key={record.id}
                        type="button"
                        aria-pressed={focusId === record.id}
                        onClick={() => setFocusId((current) => (current === record.id ? null : record.id))}
                        className={cn(
                          "press inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px]",
                          focusId === record.id ? "border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border text-muted-foreground",
                        )}
                      >
                        <Star className={cn("h-3.5 w-3.5 shrink-0", focusId === record.id && "fill-current")} aria-hidden="true" />
                        <span className="truncate">{record.title}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
            ))}
          </section>
        </LongDialogBody>

        <LongDialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="press h-11 rounded-[10px] px-4 text-[14px] text-muted-foreground hover:bg-accent/40">
            Đóng
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void save()}
            className="press inline-flex h-11 items-center gap-1.5 rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Lưu vào Nhật ký
          </button>
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The prompt itself: a card at the top of Kế hoạch (`variant="card"`) or one line on Avora Space
 * (`variant="line"`). Shows only when a review is due; `Để sau` folds it for the rest of the day.
 *
 * AVORA-55 · 3.3 (ADR-013): on Avora Space the line only leads — tapping `Nhìn lại` opens the
 * review inside Kế hoạch (where Dời ngày · Bỏ · ★ live), carrying a way back to Space.
 * `initialOpen` lets Kế hoạch receive that jump (`?nhin-lai=week|day`) already open.
 */
export function ReviewPrompt({ review, variant, initialOpen = null }: { review: ReviewState; variant: "card" | "line"; initialOpen?: ReviewKind | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openKind, setOpenKind] = useState<ReviewKind | null>(initialOpen);
  const due = review.due;

  const later = (kind: ReviewKind): void => {
    dismissReview(user?.id, kind, review.today);
    review.refresh();
  };
  const openReview = (kind: ReviewKind): void => {
    if (variant === "line") {
      const here = hereFrom(location, "Avora Space");
      navigate(withReturn(`/ke-hoach?nhin-lai=${kind}`, { path: here.path, label: "Avora Space" }));
      return;
    }
    setOpenKind(kind);
  };

  const sheet =
    openKind !== null ? (
      <ReviewSheet
        kind={openKind}
        review={review}
        open
        onOpenChange={(next) => {
          if (next) return;
          // Opened once is enough for today: the card folds either way.
          dismissReview(user?.id, openKind, review.today);
          review.refresh();
          setOpenKind(null);
        }}
      />
    ) : null;

  if (due === null) return sheet;

  const weekSummary = due === "week" ? review.summaryOf("week").summary : null;
  const text =
    due === "week"
      ? `${weekSummary?.thoughtCount ?? 0} Hạng mục đã nghĩ · ${weekSummary?.done.length ?? 0} việc xong · ${weekSummary?.pending.length ?? 0} còn treo`
      : (review.dayLine ?? "");

  if (variant === "line") {
    return (
      <>
        <div className="mb-5 flex min-h-12 items-center gap-2 rounded-[14px] border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2">
          <Hourglass className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <button type="button" onClick={() => openReview(due)} className="press min-w-0 flex-1 truncate text-left text-[14px] text-foreground">
            <span className="font-semibold">{due === "week" ? "Nhìn lại tuần" : "Nhìn lại hôm nay"}</span>
            <span className="text-muted-foreground"> · {text}</span>
          </button>
          <button type="button" onClick={() => later(due)} className="press shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground hover:bg-accent/50">
            Để sau
          </button>
        </div>
        {sheet}
      </>
    );
  }

  return (
    <>
      {due === "week" ? (
        <section aria-label="Nhìn lại tuần" className="mb-4 rounded-[16px] border border-amber-500/35 bg-gradient-to-br from-amber-500/[0.10] to-transparent px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
              <Hourglass className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold text-foreground">Nhìn lại tuần {review.summaryOf("week").range.label}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{text}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => openReview("week")} className="press inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
                  Nhìn lại <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => later("week")} className="press h-10 whitespace-nowrap rounded-[10px] px-3 text-[14px] text-muted-foreground hover:bg-accent/50">
                  Để sau
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="mb-4 flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-card px-3.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{text}</span>
          <button type="button" onClick={() => openReview("day")} className="press shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-primary hover:bg-accent/50">
            Nhìn lại
          </button>
          <button type="button" onClick={() => later("day")} className="press shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground hover:bg-accent/50">
            Để sau
          </button>
        </div>
      )}
      {sheet}
    </>
  );
}
