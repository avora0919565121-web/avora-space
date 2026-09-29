import { BookOpen, ExternalLink, Loader2, MapPin, MessagesSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { contextLink } from "@/lib/task-context";
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
import { useTaskFlagIndex } from "@/lib/use-task-flags";
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

/** Label left, value right on a wide screen; stacked on a phone — the same words as the form. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12px] font-medium text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-[14px] leading-6 text-foreground">{children}</dd>
    </div>
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
  const { togglePersonalDone, binPersonal, deleteShared } = useTaskActions();
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

  const awaitsDecision =
    canConfirmSharedTask(task, userId) ||
    canMarkSharedDone(task, userId) ||
    canReviewSharedDone(task, userId) ||
    canReturnSharedTask(task, userId);

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
              ? `Từ ${snapshot.conversationName}`
              : null;

  const assignLabel: string =
    task.type === "personal"
      ? "Chỉ bạn"
      : isOwned && !isAssignee
        ? "Bạn đã gợi ý · người nhận đã đồng ý"
        : isOwned
          ? "Do người khác gợi ý · việc của bạn"
          : task.creatorId === userId
            ? "Bạn giao"
            : isTaskAssignee(task, userId)
              ? "Người khác giao cho bạn"
              : "Việc trong nhóm";

  const start = task.startAt === null ? null : new Date(task.startAt);
  const end = task.endAt === null ? null : new Date(task.endAt);
  const span = task.startAt !== null && task.endAt !== null ? eventDurationLabel(toLocalInput(task.startAt), toLocalInput(task.endAt)) : null;
  const travel = travelOf(task, travelPlans);
  const departure = showPrivate ? departureTimes(task.startAt, travel.travelMinutes, travel.reminderOffsetMinutes) : null;
  const location = task.location?.trim() ?? "";

  const complete = (output: string | null): void => {
    void togglePersonalDone
      .mutateAsync({ taskId: task.id, done: true, output })
      .then(() => {
        toast.success("Đã đánh dấu hoàn thành.");
        celebrate(task.isMilestone ? "milestone" : "task");
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
    if (!window.confirm("Chuyển việc này vào Thùng rác?")) return;
    const run =
      task.type === "personal"
        ? binPersonal.mutateAsync({ taskId: task.id, deleted: true })
        : deleteShared.mutateAsync(task.id);
    void run
      .then(() => {
        toast.success("Đã chuyển vào Thùng rác.");
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
        <SheetDescription className="sr-only">
          Xem nhiệm vụ theo đúng thứ tự lúc tạo. Nhận việc và xác nhận hoàn thành nằm trong cuộc trò chuyện.
        </SheetDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-6">
          <div className="flex items-start gap-3 pr-8">
            <TaskBubble
              state={shared ? SHARED_BUBBLE_STATE[task.status] : PERSONAL_BUBBLE_STATE[task.status]}
              label={taskStatusLabel(task.status)}
              onClick={shared || done ? undefined : () => setIsCompleteOpen(true)}
            />
            <div className="min-w-0 flex-1">
              <h2 className={cn("text-[17px] font-semibold leading-6", done ? "text-muted-foreground line-through" : "text-foreground")}>
                {task.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <span className={done ? undefined : "font-medium text-foreground"}>
                  {shared ? sharedTaskNote(task, userId) : taskStatusLabel(task.status)}
                </span>
                {" · "}
                {TIER_LABELS[taskTier(task, userId)]}
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
                      navigate(contextLink(target.conversationId, task.id));
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
                  <p className="text-[13px] text-foreground">
                    <span className="text-muted-foreground">Đánh giá của bạn · </span>
                    {isImportantFor(flags, task.id) ? "Quan trọng" : "Bình thường"}
                    {duration !== null ? ` · ${duration}` : ""}
                  </p>
                }
              />
            ) : (
              <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13px]">
                <p className="text-[12px] font-medium text-muted-foreground">Kế hoạch</p>
                <p className="mt-1 text-foreground">
                  <span className="text-muted-foreground">Đánh giá của bạn · </span>
                  {isImportantFor(flags, task.id) ? "Quan trọng" : "Bình thường"}
                  {duration !== null ? ` · ${duration}` : ""}
                </p>
              </div>
            )}
          </div>

          {!canEdit && blocked !== null ? <p className="mt-3 text-[12px] leading-5 text-muted-foreground">{blocked}</p> : null}
          {awaitsDecision ? (
            <p className="mt-3 rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
              Nhiệm vụ này đang chờ bạn quyết định. Nhận việc, báo xong và xác nhận hoàn thành nằm trong cuộc trò chuyện — nơi cả hai
              bên cùng thấy điều đã thống nhất.
            </p>
          ) : null}
        </div>

        {/* Pinned: never scrolled away. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <MyDayButton task={task} />
          <StartButton task={task} />
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
                      navigate(contextLink(target.conversationId, task.id));
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
          confirmLabel="Hoàn thành"
          isWorking={togglePersonalDone.isPending}
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
