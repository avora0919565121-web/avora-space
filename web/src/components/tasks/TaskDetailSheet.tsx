import { BookOpen, Check, ExternalLink, Loader2, Lock, MapPin, MessagesSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { celebrate } from "@/lib/confetti";
import { forwardTaskOutputToJournal } from "@/lib/task-report";

import { PERSONAL_BUBBLE_STATE, SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { TaskCompleteDialog } from "@/components/tasks/TaskCompleteDialog";
import { TaskEditComposer } from "@/components/tasks/TaskEditComposer";
import { ownedTaskIds } from "@/lib/task-suggestions";
import { useTaskSuggestions } from "@/lib/use-task-suggestions";
import { MyDayButton, StartButton, TaskPlanFields } from "@/components/tasks/TaskPlanFields";
import { TaskPrepPanel } from "@/components/tasks/TaskPrepPanel";
import { ownerCircleClass } from "@/components/tasks/TaskOwner";
import { usePeopleNames } from "@/lib/use-task-owner";
import { taskOwnership } from "@/lib/task-owner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { contextLinkFromTasks } from "@/lib/task-context";
import { departureTimes, eventDurationLabel, isLinkLocation, toLocalInput } from "@/lib/task-composer";
import { taskContextTarget } from "@/lib/task-scope";
import { useMyTravelPlans, travelOf } from "@/lib/use-task-composer";
import { useTaskProjectIndex } from "@/lib/use-projects";
import { durationFor, formatProgress, isImportantFor } from "@/lib/tasks";
import { formatDuration } from "@/lib/task-flags";
import {
  canConfirmSharedTask,
  canDeleteTask,
  canEditTask,
  canMarkSharedDone,
  canReturnSharedTask,
  canReviewSharedDone,
  deadlineLabel,
  editBlockedReason,
  isSharedTask,
  isTaskAssignee,
  sharedTaskNote,
  taskClosedReason,
  taskStatusLabel,
  TIER_LABELS,
  taskTier,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskFlagActions, useTaskFlagIndex } from "@/lib/use-task-flags";
import { DURATION_CHOICES } from "@/components/tasks/TaskComposer";
import { useClosedSharedTasks, useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const DAY = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** "Mở link họp" for a meeting service, else the bare domain. */
function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/meet\.google|zoom\.us|teams\.microsoft|webex|whereby|jitsi/.test(host)) return "Mở link họp";
    return host;
  } catch {
    return "Mở link";
  }
}

function FlagChip({ isActive, onClick, children }: { isActive: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "press h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
        isActive ? "border-personal bg-personal text-personal-foreground" : "border-border bg-card text-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}

/** Label left, value right on a wide screen; stacked on a phone — the same words as the form. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12px] font-medium text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-[14px] leading-6 text-foreground">{children}</dd>
    </div>
  );
}

/** The one orange button of the detail (ADR-038). */
function PrimaryAction({ label, isWorking, onClick }: { label: string; isWorking: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isWorking}
      className="press flex h-11 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />}
      {label}
    </button>
  );
}

/** A quiet "＋ Thêm …" for an empty part, only for someone who may edit. */
function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex min-h-10 w-full items-center gap-1.5 py-1.5 text-left text-[13px] text-muted-foreground/80 hover:text-foreground"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

function NoteText({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const isLong = text.split("\n").length > 6 || text.length > 420;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap break-words", !isOpen && isLong && "line-clamp-6")}>{text}</p>
      {isLong ? (
        <button type="button" onClick={() => setIsOpen((current) => !current)} className="press mt-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
          {isOpen ? "Thu gọn" : "Xem thêm"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One task, read in the same order it was written (Đợt gộp 2 · A13).
 *
 * Seeing and editing are two sides of one sheet: Nguồn → Giao cho → Hạn → Sự kiện → Hiện diện →
 * Ghi chú, with the same names as TaskComposer; then, under "Mở rộng", what only exists after
 * creating it: Các bước → Cần mang theo → Kế hoạch (with Đánh giá của bạn). Actions are pinned
 * to the bottom. Permissions are unchanged: a proposer only reads a task that became the
 * assignee's, and never sees their private steps or things to bring.
 */
export function TaskDetailSheet({
  task,
  today,
  open,
  onOpenChange,
}: {
  task: TaskItem | null;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const flags = useTaskFlagIndex();
  const { setFlag } = useTaskFlagActions();
  const { togglePersonalDone, binPersonal, deleteShared, restoreShared, confirmShared, markSharedDone, reviewSharedDone } = useTaskActions();
  const { nameOf, peerOf } = usePeopleNames();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isCompleteOpen, setIsCompleteOpen] = useState<boolean>(false);
  const [isForwarding, setIsForwarding] = useState<boolean>(false);

  const projectIndex = useTaskProjectIndex();
  const { data: suggestions } = useTaskSuggestions();
  const { data: travelPlans } = useMyTravelPlans();
  const closedShared = useClosedSharedTasks();
  if (task === null) return null;
  const closedReason = closedShared.data?.get(task.id) ?? taskClosedReason(task, user?.id);

  const userId = user?.id;
  // D3: a task from an accepted suggestion is the assignee's alone; the proposer only reads it.
  const isOwned = ownedTaskIds(suggestions ?? []).has(task.id);
  const isAssignee = task.assigneeId === userId;
  const canEdit = canEditTask(task, userId) && (!isOwned || isAssignee);
  const blocked =
    isOwned && !isAssignee && canEditTask(task, userId)
      ? "Việc này đã thuộc về người nhận — bạn chỉ xem. Muốn đổi, hãy nhắn hoặc gửi gợi ý mới."
      : editBlockedReason(task, userId);
  const target = taskContextTarget(task, projectIndex);
  const deadline = deadlineLabel(task.deadline, today);
  const duration = formatDuration(durationFor(flags, task.id));
  const shared = isSharedTask(task);
  const done = task.status === "done";
  const progress = formatProgress(task.progressPercent);
  const showPrivate = !isOwned || isAssignee;

  const owner = taskOwnership(task, userId, nameOf, peerOf);
  /*
   * ADR-038 (AVORA-59 · A): the doer acts right here, wherever the task was opened. The same
   * server steps as in the chat run behind each button — `Xong` on shared work is the "báo xong"
   * claim, and the one who gave it still confirms. Nothing skips the giver.
   */
  const canAccept = canConfirmSharedTask(task, userId);
  const canClaimDone = canMarkSharedDone(task, userId);
  const canConfirmDone = canReviewSharedDone(task, userId);
  const canFinishOwn = !shared && task.creatorId === userId && !done && task.status !== "skipped";
  void canReturnSharedTask;

  const snapshot = task.contextSnapshot;
  const sourceLabel: string | null =
    snapshot === null
      ? null
      : snapshot.origin?.type === "external_paste"
        ? "Từ nội dung đã dán"
        : snapshot.selectedMessageIds !== undefined
          ? `Từ ${snapshot.selectedMessageIds.length} tin nhắn đã chọn`
          : snapshot.originalMessageSenderName !== ""
            ? `Từ tin nhắn của ${snapshot.originalMessageSenderName}`
            : snapshot.conversationName !== ""
              ? `Từ ${snapshot.conversationName === "Nhật ký của bạn" ? "Nhật ký của tôi" : snapshot.conversationName}`
              : null;

  // AVORA-59 · B: real display names, never "Người khác", never an email.
  void isTaskAssignee;
  const assignLabel: string =
    task.type === "personal"
      ? "Tôi"
      : isOwned && !isAssignee
        ? `${owner.line.replace(/^Giao /, "")} · đã đồng ý gợi ý của tôi`
        : owner.line
            .replace(/^Của tôi · từ (.+)$/, "Tôi · do $1 giao")
            .replace(/^Của tôi$/, "Tôi")
            .replace(/^Giao /, "");

  const start = task.startAt === null ? null : new Date(task.startAt);
  const end = task.endAt === null ? null : new Date(task.endAt);
  const span = task.startAt !== null && task.endAt !== null ? eventDurationLabel(toLocalInput(task.startAt), toLocalInput(task.endAt)) : null;
  const travel = travelOf(task, travelPlans);
  const departure = showPrivate ? departureTimes(task.startAt, travel.travelMinutes, travel.reminderOffsetMinutes) : null;
  const location = task.location?.trim() ?? "";

  const runStep = (step: Promise<unknown>, success: string, celebrateAfter = false): void => {
    void step
      .then(() => {
        toast.success(success);
        if (celebrateAfter) celebrate(task.isMilestone ? "milestone" : "task", { taskId: task.id });
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Thử lại nhé."));
  };

  const complete = (output: string | null): void => {
    if (canClaimDone) {
      // Shared work: the same "báo xong" as the chat panel; the giver confirms after.
      void markSharedDone
        .mutateAsync({ taskId: task.id, output })
        .then(() => {
          setIsCompleteOpen(false);
          toast.success(`Đã báo xong — chờ ${nameOf(task.creatorId)} xác nhận.`);
          celebrate(task.isMilestone ? "milestone" : "task", { taskId: task.id });
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không báo xong được."));
      return;
    }
    void togglePersonalDone
      .mutateAsync({ taskId: task.id, done: true, output })
      .then(() => {
        toast.success("Đã đánh dấu hoàn thành.");
        celebrate(task.isMilestone ? "milestone" : "task", { taskId: task.id });
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Thử lại nhé.");
      });
  };

  const forward = async (): Promise<void> => {
    if (user === undefined || task.outputValue === null) return;
    setIsForwarding(true);
    try {
      const conversationId = await forwardTaskOutputToJournal(user.id, task);
      toast.success("Đã chuyển vào Nhật ký.", {
        action: { label: "Mở", onClick: () => navigate(`/tin-nhan/${conversationId}`) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không chuyển được vào Nhật ký.");
    } finally {
      setIsForwarding(false);
    }
  };

  const close = (): void => {
    setIsEditing(false);
    onOpenChange(false);
  };

  const remove = (): void => {
    // AVORA-53 · 4.6: no confirm box — a toast with Hoàn tác, the same as on the row.
    const isPersonal = task.type === "personal";
    const run = isPersonal ? binPersonal.mutateAsync({ taskId: task.id, deleted: true }) : deleteShared.mutateAsync(task.id);
    void run
      .then(() => {
        toast.success("Đã chuyển vào Thùng rác", {
          action: {
            label: "Hoàn tác",
            onClick: () =>
              void (isPersonal ? binPersonal.mutateAsync({ taskId: task.id, deleted: false }) : restoreShared.mutateAsync(task.id)),
          },
        });
        close();
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không xoá được."));
  };

  const openEdit = (): void => setIsEditing(true);
  const hasMore = target !== null || canDeleteTask(task, userId, closedReason);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setIsEditing(false);
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetTitle className="sr-only">Chi tiết nhiệm vụ</SheetTitle>
        <SheetDescription className="sr-only">Xem nhiệm vụ theo đúng thứ tự lúc tạo và làm luôn tại đây.</SheetDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-0">
          {/* 44b · H4 / AVORA-50 · C: the task's name stays in view while the details scroll. */}
          {/*
            AVORA-59 · F: on a phone the panel's own `‹` bar (sheet.tsx) sits above this and owns the
            notch inset, so this title row starts right under it instead of padding for the notch
            a second time.
          */}
          <div className="sticky top-0 z-10 -mx-5 flex items-start gap-3 border-b border-border/60 bg-background px-5 pb-3 pt-3 md:pr-12 md:pt-[max(1.5rem,env(safe-area-inset-top))]">
            <span className={ownerCircleClass(owner.isMine)}>
              <TaskBubble
                state={shared ? SHARED_BUBBLE_STATE[task.status] : PERSONAL_BUBBLE_STATE[task.status]}
                label={taskStatusLabel(task.status)}
                onClick={canFinishOwn || canClaimDone ? () => setIsCompleteOpen(true) : undefined}
              />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className={cn("text-[17px] font-semibold leading-6", done ? "text-muted-foreground line-through" : "text-foreground")}>
                {task.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <span className={done ? undefined : "font-medium text-foreground"}>
                  {shared ? sharedTaskNote(task, userId) : taskStatusLabel(task.status)}
                </span>
                {/* AVORA-59 · B / AVORA-94 · B2.1: whose it is is said once, in `Giao cho` below — not here too. */}
                {task.isMilestone ? " · Cột mốc" : ""}
                {progress !== null ? ` · ${progress}` : ""}
              </p>
            </div>
          </div>

          <dl className="mt-3 divide-y divide-border border-y border-border">
            {sourceLabel !== null ? (
              <Row label="Nguồn">
                {target !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      navigate(contextLinkFromTasks(target.conversationId, task.id, window.location));
                    }}
                    className="press text-left font-medium underline decoration-border underline-offset-2 hover:decoration-foreground"
                  >
                    {sourceLabel} ›
                  </button>
                ) : (
                  sourceLabel
                )}
              </Row>
            ) : null}
            <Row label="Giao cho">{assignLabel}</Row>
            <Row label="Hạn">
              {deadline ?? "Không có hạn"}
              {task.deadlineTime !== null ? ` · ${task.deadlineTime}` : ""}
            </Row>
            {start !== null ? (
              <Row label="Sự kiện">
                <span className="tabular">
                  {DAY.format(start)} · {CLOCK.format(start)}
                  {end !== null ? `–${CLOCK.format(end)}` : ""}
                  {span !== null ? ` · ${span}` : ""}
                </span>
                {location !== "" ? (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13.5px]">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    {isLinkLocation(location) ? (
                      <a href={location} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                        {linkLabel(location)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <>
                        <span className="min-w-0 truncate">{location}</span>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          Mở bản đồ ›
                        </a>
                      </>
                    )}
                  </span>
                ) : null}
              </Row>
            ) : canEdit ? (
              <AddRow label="Thêm sự kiện" onClick={openEdit} />
            ) : null}
            {task.requiresPresence && start !== null ? (
              <Row label="Hiện diện">
                Có mặt trực tiếp
                {departure !== null && travel.travelMinutes !== null
                  ? ` · đi ${travel.travelMinutes} phút · nhắc lúc ${CLOCK.format(departure.remindAt)}`
                  : ""}
              </Row>
            ) : canEdit && start !== null ? (
              <AddRow label="Hiện diện" onClick={openEdit} />
            ) : null}
            {task.description.trim() !== "" ? (
              <Row label="Ghi chú">
                <NoteText text={task.description} />
              </Row>
            ) : canEdit ? (
              <AddRow label="Ghi chú" onClick={openEdit} />
            ) : null}
            {task.outputValue !== null && (done || task.status === "done_pending_review") ? (
              <Row label={done ? "Kết quả" : "Kết quả báo xong"}>
                <p className="whitespace-pre-wrap">{task.outputValue}</p>
              </Row>
            ) : null}
          </dl>

          {/* What only exists after creating it. */}
          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11.5px] font-medium text-muted-foreground">Mở rộng</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-3">
            <TaskPrepPanel task={task} canEdit={canEdit && !done} showPrivate={showPrivate} showSchedule={false} />
            {canEdit ? (
              <TaskPlanFields
                task={task}
                footer={
                  // AVORA-53 · 4.2: set here what the Quan trọng and Theo độ nặng views read.
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Đánh giá của bạn">
                    <FlagChip isActive={isImportantFor(flags, task.id)} onClick={() => setFlag(task.id, { isImportant: !isImportantFor(flags, task.id) })}>
                      ★ Quan trọng
                    </FlagChip>
                    <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
                    {DURATION_CHOICES.map((option) => {
                      const current = durationFor(flags, task.id);
                      return (
                        <FlagChip
                          key={option.minutes}
                          isActive={current === option.minutes}
                          onClick={() => setFlag(task.id, { durationMinutes: current === option.minutes ? null : option.minutes })}
                        >
                          {option.label}
                        </FlagChip>
                      );
                    })}
                  </div>
                }
              />
            ) : showPrivate ? (
              // AVORA-55 · 3.1 (ADR-030 / ADR-033): Nhắc · Quan trọng · thời lượng belong to the
              // person doing the work. The suggester — who only reads the task — sees neither,
              // and can set neither (server keeps task_reminders to the owner).
              <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13px]">
                <p className="text-[12px] font-medium text-muted-foreground">Kế hoạch</p>
                <p className="mt-1 text-foreground">
                  <span className="text-muted-foreground">Đánh giá của bạn · </span>
                  {isImportantFor(flags, task.id) ? "Quan trọng" : "Bình thường"}
                  {duration !== null ? ` · ${duration}` : ""}
                </p>
              </div>
            ) : null}
          </div>

          {!canEdit && blocked !== null ? <p className="mt-3 text-[12px] leading-5 text-muted-foreground">{blocked}</p> : null}
        </div>

        {/* Pinned: never scrolled away. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* ADR-038: the one orange button follows the viewer's role. */}
          {canAccept ? (
            <PrimaryAction
              label="Nhận việc"
              isWorking={confirmShared.isPending}
              onClick={() => runStep(confirmShared.mutateAsync(task.id), "Đã nhận việc.")}
            />
          ) : canClaimDone || canFinishOwn ? (
            <PrimaryAction label="Xong" isWorking={markSharedDone.isPending || togglePersonalDone.isPending} onClick={() => setIsCompleteOpen(true)} />
          ) : canConfirmDone ? (
            <PrimaryAction
              label="Xác nhận xong"
              isWorking={reviewSharedDone.isPending}
              onClick={() => runStep(reviewSharedDone.mutateAsync(task.id), "Đã xác nhận hoàn thành.", true)}
            />
          ) : null}
          {owner.isMine && !done ? (
            <>
              <MyDayButton task={task} />
              <StartButton task={task} />
            </>
          ) : null}
          {target !== null ? (
            <button
              type="button"
              onClick={() => {
                close();
                navigate(contextLinkFromTasks(target.conversationId, task.id, window.location));
              }}
              className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <MessagesSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Mở cuộc trò chuyện
            </button>
          ) : null}
          {/* AVORA-51: a loan reminder carries no amount; how much is owed is read inside Két sắt. */}
          {task.sourceTransactionId ? (
            <button
              type="button"
              onClick={() => {
                close();
                navigate("/ket-sat/giao-dich?can_lam=den_han");
              }}
              className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Lock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Mở trong Két sắt
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={openEdit}
              className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Sửa
            </button>
          ) : null}
          {done && task.outputValue !== null ? (
            <button
              type="button"
              onClick={() => void forward()}
              disabled={isForwarding}
              aria-label="Chuyển kết quả vào Nhật ký"
              className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {isForwarding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BookOpen className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
              Vào Nhật ký
            </button>
          ) : null}
          {hasMore ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Tuỳ chọn nhiệm vụ"
                  className="press ml-auto flex h-11 w-11 items-center justify-center rounded-[10px] border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {target !== null ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      close();
                      navigate(contextLinkFromTasks(target.conversationId, task.id, window.location));
                    }}
                  >
                    <MessagesSquare className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    Xem trong ngữ cảnh
                  </DropdownMenuItem>
                ) : null}
                {canDeleteTask(task, userId, closedReason) ? (
                  <DropdownMenuItem onSelect={remove} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    Xoá
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <TaskCompleteDialog
          task={task}
          open={isCompleteOpen}
          onOpenChange={setIsCompleteOpen}
          confirmLabel={canClaimDone ? "Báo xong" : "Hoàn thành"}
          isWorking={togglePersonalDone.isPending || markSharedDone.isPending}
          onComplete={complete}
        />
        <TaskEditComposer
          task={isEditing ? task : null}
          open={isEditing}
          onOpenChange={setIsEditing}
          lockedLabel={assignLabel}
          isOwnedByAssignee={isOwned && isAssignee}
        />
      </SheetContent>
    </Sheet>
  );
}
