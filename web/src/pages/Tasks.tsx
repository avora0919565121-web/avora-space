import {
  CalendarClock,
  CalendarDays,
  BookOpen,
  StickyNote,
  UserPlus,
  UserRound,
  ChevronRight,
  FolderKanban,
  GripVertical,
  Loader2,
  MessagesSquare,
  Plus,
  Repeat,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { celebrate } from "@/lib/confetti";
import { TaskHubNav } from "@/components/tasks/TaskHubNav";
import { TaskHubSectionView } from "@/components/tasks/TaskHubSectionView";
import { CalendarView } from "@/components/tasks/CalendarView";
import {
  CALENDAR_DAY_PARAM,
  CALENDAR_MODE_PARAM,
  calendarModeSlug,
  parseCalendarMode,
  parseIsoDay,
  type CalendarMode,
} from "@/lib/calendar-view";
import { sectionBySlug, tasksForSection, TASK_HUB_PARAM, type TaskHubSection, type TaskHubSectionId } from "@/lib/task-hub";
import { usePendingInvitationCount } from "@/lib/use-task-collab";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { PERSONAL_BUBBLE_STATE, SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { TaskCompleteDialog } from "@/components/tasks/TaskCompleteDialog";
import {
  CategoryFilterBar,
  CategoryTag,
  DurationTag,
  emptyScheduleDraft,
  ImportantStar,
  ReminderLine,
  ScheduleFields,
  TimeTag,
  type ScheduleDraft,
} from "@/components/tasks/ScheduleFields";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { ownerCircleClass, ownerStripeClass, TaskOwnerLine } from "@/components/tasks/TaskOwner";
import { AssignTaskFlow } from "@/components/tasks/AssignTaskFlow";
import { PlusMenuButton } from "@/components/PlusMenuButton";
import { askText } from "@/components/ConfirmHost";
import { emptyBlock, saveNote } from "@/lib/notes";
import { DIARY_VIEW_PARAM, diaryViewSlug } from "@/lib/diary-views";
import { ensureJournalConversation } from "@/lib/chat";
import { useTaskOwnership } from "@/lib/use-task-owner";
import { BlockLoadError } from "@/components/RouteErrorBoundary";
import { useComposerActions } from "@/lib/use-task-composer";
import { AvoraSearchButton } from "@/components/search/AvoraSearch";
import { HubTitle } from "@/components/nav/HubTitle";
import { TaskViewTabs } from "@/components/tasks/TaskViewTabs";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import type { TaskCategory } from "@/lib/task-categories";
import { projectLink } from "@/lib/projects";
import { contextLink, contextLinkFromTasks, CONTEXT_TASK_PARAM } from "@/lib/task-context";
import { carryReturn, hereFrom, stripReturn, withReturn } from "@/lib/return-to";
import { spotlight } from "@/lib/spotlight";
import { ReturnChip } from "@/components/nav/ReturnChip";
import { DateField } from "@/components/calendar/DateField";
import { forwardTaskOutputToJournal, completedDayLabel } from "@/lib/task-report";
import { applyManualOrder, defaultViewMode } from "@/lib/task-order";
import { RECURRENCE_LABELS } from "@/lib/task-schedule";
import {
  filterByScope,
  OPEN_TASK_PARAM,
  parseTaskScope,
  parseTaskView,
  projectOfTask,
  scopeOfTask,
  scopeSlug,
  taskContextTarget,
  TASK_SCOPE_LABELS,
  TASK_SCOPE_PARAM,
  TASK_SCOPES,
  TASK_VIEW_PARAM,
  type TaskScope,
} from "@/lib/task-scope";
import {
  useCategoryIndex,
  useDueReminders,
  useTaskCategories,
  useTaskReminderActions,
} from "@/lib/use-task-meta";
import {
  canPurgeTask,
  countOpenTasks,
  deadlineLabel,
  deadlinePriority,
  deletedByOtherNote,
  durationFor,
  filterByCategories,
  groupSharedByConversation,
  groupTasksByDeadlineDay,
  heavyTasks,
  HEAVY_TASK_MINUTES,
  highestOpenPriority,
  importantTasks,
  isDeletedByOther,
  isImportantFor,
  isTaskDraftComplete,
  needsAttention,
  partitionByBin,
  reportTasks,
  sharedTaskNote,
  slackMinutes,
  sortTasksByPriority,
  TASK_VIEW_LABELS,
  taskStatusLabel,
  taskTier,
  TIER_LABELS,
  todayIso,
  validateTaskDraft,
  type TaskDraft,
  type TaskFlagIndex,
  type TaskItem,
  type TaskPriority,
  type TaskViewMode,
} from "@/lib/tasks";
import { suggestionsProposed, type TaskSuggestion } from "@/lib/task-suggestions";
import { TASK_VOICE_HINT, TASK_VOICE_TITLE_CLASS, taskVoice, type TaskVoice } from "@/lib/task-voice";
import { useConversations } from "@/lib/use-conversations";
import { useSuggestionActions, useTaskSuggestions } from "@/lib/use-task-suggestions";
import { EditSuggestionDialog } from "@/components/tasks/EditSuggestionDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTaskFlagIndex } from "@/lib/use-task-flags";
import { useSharedTaskOrder, useViewOrder } from "@/lib/use-task-order";
import { useTaskProjectIndex, useTaskProjectLinks } from "@/lib/use-projects";
import { useTaskActions, useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

function showError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
}

/** Deadline pressure, in text colour. Warm throughout — urgency here is never an alarm. */
const PRIORITY_TEXT: Record<TaskPriority, string> = {
  overdue: "text-task-overdue",
  due_soon: "text-task-due-soon",
  routine: "text-task-routine",
  none: "text-task-idle",
};

/**
 * A branch of the tree remembers only what the person changed by hand; everything else
 * follows the rule below. So a task that starts asking for attention opens its branch
 * on its own, instead of being buried by a stale collapsed flag.
 */
function useTree(): {
  isOpen: (id: string, auto: boolean) => boolean;
  toggle: (id: string, auto: boolean) => void;
} {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isOpen = useCallback(
    (id: string, auto: boolean): boolean => overrides[id] ?? auto,
    [overrides],
  );

  const toggle = useCallback((id: string, auto: boolean): void => {
    setOverrides((previous) => ({ ...previous, [id]: !(previous[id] ?? auto) }));
  }, []);

  return { isOpen, toggle };
}

/**
 * "N nhiệm vụ đang mở". Bold and coloured by the most pressing thing inside while there is
 * work left, faint and plain at zero — so the number alone says whether to look further.
 * A count above zero never drops to the unscheduled grey: nothing outstanding is invisible.
 */
function OpenCounter({ count, tone, suffix }: { count: number; tone: TaskPriority; suffix: string }) {
  const zero = count === 0;
  const colour = tone === "none" ? PRIORITY_TEXT.routine : PRIORITY_TEXT[tone];
  return (
    <span
      className={cn("tabular shrink-0 whitespace-nowrap text-[13px]", zero ? "text-task-idle" : `font-semibold ${colour}`)}
    >
      {count} {suffix}
    </span>
  );
}

/**
 * The deadline, said the way a person would: relative while it presses, a bare date after,
 * with the clock beside it when one was set and the shelf and emergency mark after that.
 */
function DeadlineChip({
  task,
  today,
  category,
}: {
  task: TaskItem;
  today: string;
  category?: TaskCategory | undefined;
}) {
  const label = deadlineLabel(task.deadline, today);
  const priority = deadlinePriority(task.deadline, today);
  // The star and the estimate are this viewer's own reading of the task, never the other
  // party's. Read here rather than passed down so every row that shows a deadline shows the
  // same person's marks.
  const flags = useTaskFlagIndex();
  return (
    <span className="flex shrink-0 items-center gap-2">
      {label === null ? (
        <span className="text-task-idle" title="Không có hạn">
          Không có hạn
        </span>
      ) : (
        <span className={cn("font-semibold", PRIORITY_TEXT[priority])}>{label}</span>
      )}
      <TimeTag time={task.deadlineTime} />
      {task.recurrence !== "none" ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Repeat className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {RECURRENCE_LABELS[task.recurrence]}
        </span>
      ) : null}
      <ImportantStar active={isImportantFor(flags, task.id)} />
      <DurationTag minutes={durationFor(flags, task.id)} />
      <CategoryTag category={category} />
    </span>
  );
}

function BranchHeader({
  open,
  onToggle,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn("press flex w-full items-center gap-2.5 text-left", className)}
    >
      <ChevronRight
        aria-hidden="true"
        strokeWidth={2.2}
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
          open && "rotate-90",
        )}
      />
      {children}
    </button>
  );
}

/**
 * Destructive-but-reversible actions stay quiet: an icon that names itself on hover.
 * A full 48px to hit on a phone; the compact square is a pointer-only luxury.
 */
function IconAction({
  label,
  hint,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  hint?: string;
  icon: typeof Trash2;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={hint ?? label}
      title={hint ?? label}
      className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 sm:h-8 sm:w-8"
    >
      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/**
 * A task's title, weighted by whose move it is.
 *
 * Work the reader is carrying is ink at semibold; work somebody else is carrying is lighter,
 * italic and warm grey — still in the same place in the list, just visibly not theirs to do.
 * A finished or binned row ignores the voice entirely: a closed task is nobody's next move,
 * and bolding it would claim something is still owed.
 *
 * The weight is only a hint, so the same fact is spelled out for screen readers beside it.
 */
function TaskTitle({
  task,
  muted,
  voice,
}: {
  task: TaskItem;
  muted: boolean;
  voice?: TaskVoice;
}) {
  const settled = task.status === "done" || muted;
  return (
    <p
      className={cn(
        "truncate text-[15px] leading-6",
        task.status === "done"
          ? "text-muted-foreground line-through"
          : muted
            ? "text-muted-foreground"
            : voice === undefined
              ? "text-foreground"
              : TASK_VOICE_TITLE_CLASS[voice],
      )}
    >
      {task.title}
      {voice !== undefined && !settled ? (
        <span className="sr-only"> — {TASK_VOICE_HINT[voice]}</span>
      ) : null}
    </p>
  );
}

function PersonalRow({
  task,
  today,
  onOpen,
}: {
  task: TaskItem;
  today: string;
  onOpen?: (task: TaskItem) => void;
}) {
  const { togglePersonalDone, binPersonal } = useTaskActions();
  const categories = useCategoryIndex();
  const done = task.status === "done";
  const [isCompleteOpen, setIsCompleteOpen] = useState<boolean>(false);

  const run = async (action: Promise<unknown>): Promise<void> => {
    try {
      await action;
    } catch (error) {
      showError(error);
    }
  };

  return (
    <li data-task-id={task.id} data-task-mine="true" className={cn("-ml-3 flex items-start gap-3 py-2 pl-[9px]", ownerStripeClass(true))}>
      <TaskBubble
        state={PERSONAL_BUBBLE_STATE[task.status]}
        onClick={() => {
          // Completing asks the one question first; re-opening needs no dialog.
          if (done) void run(togglePersonalDone.mutateAsync({ taskId: task.id, done: false }));
          else setIsCompleteOpen(true);
        }}
        label={done ? "Mở lại nhiệm vụ" : "Đánh dấu hoàn thành"}
      />
      {/*
        The row itself opens the task. The bubble and the bin keep their own jobs, so the only
        thing left to click is the text — which is exactly what someone reaches for when they
        want to re-read what a task actually said.
      */}
      <button
        type="button"
        onClick={() => onOpen?.(task)}
        disabled={onOpen === undefined}
        className="press min-w-0 flex-1 pt-0.5 text-left disabled:cursor-default"
      >
        {/* A personal task is always the reader's own move — nobody else can carry it. */}
        <TaskTitle task={task} muted={false} voice="mine" />
        {/* AVORA-94 · B2.1: 1 + 1 — the title, then one meta line that never wraps (the description lives in the sheet). */}
        <div data-task-meta="" className="mt-0.5 flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-[12px]">
          <TaskOwnerLine task={task} />
          <DeadlineChip task={task} today={today} category={categories.get(task.categoryId ?? "")} />
        </div>
      </button>
      <IconAction
        label="Xoá"
        icon={Trash2}
        disabled={binPersonal.isPending}
        onClick={() =>
          void run(
            binPersonal.mutateAsync({ taskId: task.id, deleted: true }).then(() => {
              // AVORA-53 · 4.6: never silent, never a confirm box — a toast with the way back.
              toast.success("Đã chuyển vào Thùng rác", {
                action: { label: "Hoàn tác", onClick: () => void binPersonal.mutateAsync({ taskId: task.id, deleted: false }) },
              });
            }),
          )
        }
      />

      <TaskCompleteDialog
        task={task}
        open={isCompleteOpen}
        onOpenChange={setIsCompleteOpen}
        confirmLabel="Hoàn thành"
        isWorking={togglePersonalDone.isPending}
        onComplete={(output) => {
          void run(
            togglePersonalDone
              .mutateAsync({ taskId: task.id, done: true, output })
              // Once, right after the completion is confirmed — never on load.
              .then(() => celebrate(task.isMilestone ? "milestone" : "task", { taskId: task.id })),
          );
        }}
      />
    </li>
  );
}

/**
 * One shared task, as Tab Nhiệm vụ shows it: something to read and arrange, never to decide.
 *
 * Accepting, handing back, finishing and binning a shared task all happen in the conversation
 * it belongs to, because that is where both people can see what was actually agreed. So the
 * only button here is the one that takes you there — and dragging, which changes nothing but
 * the order of this person's own list.
 */
function SharedRow({
  task,
  userId,
  today,
  draggable,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMove,
  onOpen,
}: {
  task: TaskItem;
  userId: string | undefined;
  today: string;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onOpen?: (task: TaskItem) => void;
}) {
  const navigate = useNavigate();
  const categories = useCategoryIndex();
  const abandoned = isDeletedByOther(task, userId);
  const note = sharedTaskNote(task, userId);
  const projectIndex = useTaskProjectIndex();
  // Project work opens the project's own sub-group chat; everything else its own chat.
  const target = taskContextTarget(task, projectIndex);
  const voice = taskVoice(task, userId);
  /** Set when this task was linked to a deliverable — then the project is its first context. */
  const projectOf = useTaskProjectLinks().get(task.id);
  const owner = useTaskOwnership(task);

  return (
    <li
      data-task-id={task.id}
      draggable={draggable === true}
      onDragStart={(event) => {
        if (draggable !== true) return;
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(event) => {
        if (draggable !== true) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver?.();
      }}
      onDragLeave={() => onDragLeave?.()}
      onDrop={(event) => {
        if (draggable !== true) return;
        event.preventDefault();
        onDrop?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onMove?.(-1);
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onMove?.(1);
        }
      }}
      tabIndex={draggable === true ? 0 : undefined}
      aria-label={draggable === true ? `${task.title} — kéo để đổi vị trí` : undefined}
      data-task-mine={owner.isMine ? "true" : "false"}
      className={cn(
        "-ml-3 flex flex-row items-start gap-2 rounded-r-[10px] py-2 pl-[9px] transition-colors sm:gap-3",
        ownerStripeClass(owner.isMine),
        draggable === true ? "cursor-grab active:cursor-grabbing" : "",
        isDragging === true ? "opacity-50" : "",
        isDropTarget === true ? "bg-accent/50 ring-1 ring-primary/40" : "",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {draggable === true ? (
          <GripVertical
            aria-hidden="true"
            strokeWidth={1.8}
            className="mt-1.5 hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block"
          />
        ) : null}
        <span className={ownerCircleClass(owner.isMine)}>
          <TaskBubble state={SHARED_BUBBLE_STATE[task.status]} label={taskStatusLabel(task.status)} />
        </span>

        {/* The text opens the task; dragging still belongs to the row around it. */}
        <button
          type="button"
          onClick={() => onOpen?.(task)}
          disabled={onOpen === undefined}
          className="press min-w-0 flex-1 pt-0.5 text-left disabled:cursor-default"
        >
          <TaskTitle task={task} muted={false} voice={voice} />
          <div data-task-meta="" className="mt-0.5 flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-[12px]">
            <TaskOwnerLine task={task} ownership={owner} />
            <DeadlineChip task={task} today={today} category={categories.get(task.categoryId ?? "")} />
            <span className="text-task-idle" aria-hidden="true">
              ·
            </span>
            <span
              title={taskStatusLabel(task.status)}
              className={
                task.status === "done_pending_review" ? "font-medium text-foreground" : "text-muted-foreground"
              }
            >
              {note}
            </span>
            {abandoned ? (
              <>
                <span className="text-task-idle" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted-foreground">{deletedByOtherNote(task, userId)}</span>
              </>
            ) : null}
          </div>
        </button>
      </div>

      {/* AVORA-61 · I: after ADR-038 the way to the conversation is secondary — a small icon at the
          card's right edge, named for screen readers. The detail sheet keeps "Mở cuộc trò chuyện". */}
      <div className="flex shrink-0 items-center gap-0.5">
        {projectOf !== undefined ? (
          <button
            type="button"
            onClick={() =>
              navigate(
                withReturn(`${projectLink(projectOf.projectId)}?${CONTEXT_TASK_PARAM}=${encodeURIComponent(task.id)}`, {
                  path: stripReturn(`${window.location.pathname}${window.location.search}`),
                  label: "Nhiệm vụ",
                }),
              )
            }
            aria-label={`Xem "${task.title}" trong dự án`}
            title="Xem trong dự án"
            data-task-context="project"
            className="press flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FolderKanban className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
          </button>
        ) : null}
        {target !== null ? (
          <button
            type="button"
            onClick={() => navigate(contextLinkFromTasks(target.conversationId, task.id, window.location))}
            aria-label={`Xem "${task.title}" trong cuộc trò chuyện`}
            title="Xem trong ngữ cảnh"
            data-task-context="chat"
            className="press flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MessagesSquare className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** A binned task. Two ways out: back to the list, or gone for good where that is this person's call. */
function BinRow({ task, userId, today }: { task: TaskItem; userId: string | undefined; today: string }) {
  const categories = useCategoryIndex();
  const { restoreShared, binPersonal, purgePersonal } = useTaskActions();
  const isPersonal = task.type === "personal";

  const run = async (action: Promise<unknown>): Promise<void> => {
    try {
      await action;
    } catch (error) {
      showError(error);
    }
  };

  const restore = (): void => {
    void run(
      isPersonal
        ? binPersonal.mutateAsync({ taskId: task.id, deleted: false })
        : restoreShared.mutateAsync(task.id),
    );
  };

  return (
    <li className="flex items-start gap-3 py-2">
      <span className="opacity-45">
        <TaskBubble
          state={isPersonal ? PERSONAL_BUBBLE_STATE[task.status] : SHARED_BUBBLE_STATE[task.status]}
          label={taskStatusLabel(task.status)}
        />
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <TaskTitle task={task} muted={true} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]">
          <DeadlineChip task={task} today={today} category={categories.get(task.categoryId ?? "")} />
          {isPersonal ? null : (
            <>
              <span className="text-task-idle" aria-hidden="true">
                ·
              </span>
              <span className="text-muted-foreground">
                {isDeletedByOther(task, userId)
                  ? "Cả hai đã xoá"
                  : `${task.creatorId === userId ? "Người nhận" : "Người giao"} vẫn còn giữ`}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={restore}
          disabled={restoreShared.isPending || binPersonal.isPending}
          className="press h-9 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          Khôi phục
        </button>
        {canPurgeTask(task) ? (
          <button
            type="button"
            onClick={() => void run(purgePersonal.mutateAsync(task.id))}
            disabled={purgePersonal.isPending}
            className="press h-9 rounded-[10px] px-3 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
          >
            Xoá hẳn
          </button>
        ) : null}
      </div>
    </li>
  );
}

function PersonalSection({
  tasks,
  today,
  onOpen,
}: {
  tasks: TaskItem[];
  today: string;
  onOpen: (task: TaskItem) => void;
}) {
  const { user } = useAuth();
  const { createPersonal } = useComposerActions();
  const { isOpen, toggle } = useTree();
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);

  const openCount = countOpenTasks(tasks);
  const tone = highestOpenPriority(tasks, today);
  const auto = tasks.some((task) => needsAttention(task, user?.id, today));
  const open = isOpen("personal", auto);

  return (
    <section aria-labelledby="tasks-personal" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={open} onToggle={() => toggle("personal", auto)} className="px-5 py-4">
        <h2 id="tasks-personal" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          {TASK_SCOPE_LABELS.personal}
        </h2>
        <OpenCounter count={openCount} tone={tone} suffix="nhiệm vụ đang mở" />
      </BranchHeader>

      {open ? (
        <div className="rise-in">
          {tasks.length > 0 ? (
            <ul className="px-5 pb-2">
              {tasks.map((task) => (
                <PersonalRow key={task.id} task={task} today={today} onOpen={onOpen} />
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-3 text-[14px] text-muted-foreground">Chưa có việc gì. Thêm việc bạn cần làm nhé.</p>
          )}

        </div>
      ) : null}
      <TaskComposer
        open={isComposerOpen}
        onOpenChange={setIsComposerOpen}
        place="personal"
        onCreateMine={async (values) => {
          if (!user) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
          await createPersonal(user.id, values, null);
        }}
      />
    </section>
  );
}

type NamedGroup = {
  /** The chat the branch opens; for a project, the project's own sub-group. */
  conversationId: string;
  /** Which Connect Hub layer the branch sits in. Never "personal". */
  scope: SharedScope;
  peerName: string;
  tasks: TaskItem[];
  tone: TaskPriority;
  auto: boolean;
};

type SharedScope = Exclude<TaskScope, "personal">;

const SHARED_SCOPES: readonly SharedScope[] = ["direct", "group", "project"];

const SHARED_SCOPE_NOTES: Record<SharedScope, string> = {
  direct: "Việc giữa bạn và từng người, tạo và xử lý ngay trong cuộc trò chuyện 1-1.",
  group: "Việc trong các nhóm của bạn — ngoài dự án.",
  project: "Việc thuộc dự án, xếp theo từng dự án. \u201cXem trong ngữ cảnh\u201d mở nhóm của dự án.",
};

function SharedSection({
  layer,
  groups,
  today,
  onOpen,
}: {
  layer: SharedScope;
  groups: NamedGroup[];
  today: string;
  onOpen: (task: TaskItem) => void;
}) {
  const { user } = useAuth();
  const { isOpen, toggle } = useTree();
  const { reorder } = useSharedTaskOrder();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const openCount = groups.reduce((total, group) => total + countOpenTasks(group.tasks), 0);
  const sectionTone = highestOpenPriority(
    groups.flatMap((group) => group.tasks),
    today,
  );
  const sectionAuto = groups.some((group) => group.auto);
  const sectionKey = `shared-${layer}`;
  const sectionOpen = isOpen(sectionKey, sectionAuto);

  return (
    <section aria-labelledby={`tasks-${sectionKey}`} className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={sectionOpen} onToggle={() => toggle(sectionKey, sectionAuto)} className="px-5 py-4">
        <h2 id={`tasks-${sectionKey}`} className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          {TASK_SCOPE_LABELS[layer]}
        </h2>
        <OpenCounter count={openCount} tone={sectionTone} suffix="nhiệm vụ đang mở" />
      </BranchHeader>

      {sectionOpen ? (
        <div className="rise-in">
          <p className="px-5 pb-3 text-[13px] text-muted-foreground">
            {SHARED_SCOPE_NOTES[layer]} Kéo để đổi vị trí hiển thị của riêng bạn.
          </p>

          {groups.length > 0 ? (
            <div className="px-5 pb-2">
              {groups.map((group) => {
                const branchOpen = isOpen(group.conversationId, group.auto);
                const visibleIds = group.tasks.map((task) => task.id);
                const moveBy = (taskId: string, direction: -1 | 1): void => {
                  const index = visibleIds.indexOf(taskId);
                  const target = visibleIds[index + direction];
                  if (target === undefined) return;
                  reorder(visibleIds, taskId, target);
                };
                return (
                  <div key={group.conversationId} className="border-t border-border/60 py-1 first:border-t-0">
                    <BranchHeader
                      open={branchOpen}
                      onToggle={() => toggle(group.conversationId, group.auto)}
                      className="py-2"
                    >
                      <InitialsAvatar name={group.peerName} size="md" />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                        {group.peerName}
                      </span>
                      <OpenCounter count={countOpenTasks(group.tasks)} tone={group.tone} suffix="đang mở" />
                    </BranchHeader>

                    {branchOpen ? (
                      <ul className="rise-in sm:pl-[26px]">
                        {group.tasks.map((task) => (
                          <SharedRow
                            key={task.id}
                            task={task}
                            userId={user?.id}
                            today={today}
                            draggable={true}
                            isDragging={draggingId === task.id}
                            isDropTarget={overId === task.id && draggingId !== task.id}
                            onDragStart={() => setDraggingId(task.id)}
                            onDragOver={() => setOverId(task.id)}
                            onDragLeave={() => setOverId((current) => (current === task.id ? null : current))}
                            onDrop={() => {
                              if (draggingId !== null && draggingId !== task.id) {
                                reorder(visibleIds, draggingId, task.id);
                              }
                              setDraggingId(null);
                              setOverId(null);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setOverId(null);
                            }}
                            onMove={(direction) => moveBy(task.id, direction)}
                            onOpen={onOpen}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-5 pb-3 text-[14px] text-muted-foreground">
              {layer === "project"
                ? "Chưa có việc nào thuộc dự án."
                : "Chưa có việc nào ở đây. Mở một cuộc trò chuyện và bấm “Nhiệm vụ” để giao việc."}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * What this person has proposed to others and not heard back on.
 *
 * This half used to be invisible in the worst way: the request sat in their task list looking
 * like work in progress, so "waiting on an answer" and "work underway" were the same row. They
 * are different states of mind, and only one of them is anyone's responsibility yet.
 *
 * Collapsed on arrival, like the bin: nothing here is owed by the reader, so it must not
 * compete with work that is.
 */
function ProposedSection({
  suggestions,
  today,
}: {
  suggestions: TaskSuggestion[];
  today: string;
}) {
  const { isOpen, toggle } = useTree();
  const open = isOpen("proposed", false);
  const { withdraw } = useSuggestionActions();
  const [editTarget, setEditTarget] = useState<TaskSuggestion | null>(null);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [withdrawTarget, setWithdrawTarget] = useState<TaskSuggestion | null>(null);

  const handleWithdraw = useCallback(
    async (id: string): Promise<void> => {
      try {
        await withdraw.mutateAsync(id);
        toast.success("Đã rút lại gợi ý.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không rút được gợi ý.");
      }
    },
    [withdraw],
  );

  return (
    <section aria-labelledby="tasks-proposed" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={open} onToggle={() => toggle("proposed", false)} className="px-5 py-4">
        <h2 id="tasks-proposed" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          Đã gợi ý, đang chờ
        </h2>
        <span className="tabular shrink-0 text-[13px] text-muted-foreground">
          {suggestions.length} gợi ý
        </span>
      </BranchHeader>

      {open ? (
        <div className="rise-in">
          <p className="px-5 pb-2 text-[13px] text-muted-foreground">
            Chưa ai nhận những việc này — người được gợi ý sẽ quyết định. Trả lời nằm trong cuộc
            trò chuyện.
          </p>
          <ul className="px-5 pb-3">
            {suggestions.map((entry) => {
              const deadline = deadlineLabel(entry.deadline, today);
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0"
                >
                  {/* Dashed: nothing here has been agreed to, so it gets no task bubble. */}
                  <span
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-5 text-foreground">{entry.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                      <span>Chờ trả lời</span>
                      {deadline !== null ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{deadline}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {/* AVORA-53 · 2.7: an in-app link (no reload), carrying the way back. */}
                    <Link
                      to={withReturn(`/tin-nhan/${entry.conversationId}`, hereFrom(window.location, "Nhiệm vụ"))}
                      className="press flex h-12 items-center rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground sm:h-9"
                    >
                      Mở cuộc trò chuyện
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(entry);
                        setIsEditOpen(true);
                      }}
                      disabled={withdraw.isPending}
                      title="Sửa gợi ý"
                      className="press flex h-12 items-center rounded-[10px] border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50 sm:h-9"
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => setWithdrawTarget(entry)}
                      disabled={withdraw.isPending}
                      title="Rút lại gợi ý"
                      className="press flex h-12 items-center rounded-[10px] border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50 sm:h-9"
                    >
                      Rút lại
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <EditSuggestionDialog
        suggestion={editTarget}
        assigneeName="người được gợi ý"
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />

      {/*
        Withdrawing gets one confirmation and no second chance — the question goes back and
        nobody is asked to answer it again. No task was ever created, so nothing is deleted;
        the request simply stops being open.
      */}
      <AlertDialog
        open={withdrawTarget !== null}
        onOpenChange={(next) => (!next ? setWithdrawTarget(null) : undefined)}
      >
        {withdrawTarget !== null ? (
          <AlertDialogContent className="border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">Rút lại gợi ý này?</AlertDialogTitle>
              <AlertDialogDescription>
                “{withdrawTarget.title}” sẽ ngừng chờ câu trả lời và biến mất khỏi danh sách của
                cả hai bên. Không có nhiệm vụ nào bị xoá — nó chưa từng tồn tại.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border bg-transparent text-foreground hover:bg-accent/40">
                Để nguyên
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const id = withdrawTarget.id;
                  setWithdrawTarget(null);
                  void handleWithdraw(id);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Rút lại
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </section>
  );
}

/**
 * Báo cáo — the reading of work that closed AND named what it brought.
 *
 * A section of the Nhiệm vụ page, not a view mode: it sits between the working lists and the
 * bin, collapsed on arrival like the bin, because a report is a place you go looking for too.
 * Newest first — it answers "what have I delivered lately".
 */
function ReportsSection({
  tasks,
  today,
  onOpen,
}: {
  tasks: TaskItem[];
  today: string;
  onOpen: (task: TaskItem) => void;
}) {
  const { isOpen, toggle } = useTree();
  const open = isOpen("reports", false);

  return (
    <section aria-labelledby="tasks-reports" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={open} onToggle={() => toggle("reports", false)} className="px-5 py-4">
        <h2 id="tasks-reports" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          Báo cáo
        </h2>
        <span className="tabular shrink-0 text-[13px] text-muted-foreground">{tasks.length} kết quả</span>
      </BranchHeader>

      {open ? (
        <div className="rise-in">
          <p className="px-5 pb-2 text-[13px] text-muted-foreground">
            Việc đã hoàn thành kèm kết quả cụ thể, mới nhất trước. Chuyển vào Nhật ký để giữ lại những
            điều đáng nhớ.
          </p>
          <ul className="px-5 pb-3">
            {tasks.map((task) => (
              <ReportRow key={task.id} task={task} today={today} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** One delivered result, with the one action a finished task still offers: keep it. */
function ReportRow({
  task,
  today,
  onOpen,
}: {
  task: TaskItem;
  today: string;
  onOpen: (task: TaskItem) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isForwarding, setIsForwarding] = useState<boolean>(false);
  const day = completedDayLabel(task);

  const forward = async (): Promise<void> => {
    if (user?.id === undefined) return;
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

  return (
    <li className="flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0">
      <TaskBubble state={SHARED_BUBBLE_STATE[task.status]} label="Đã hoàn thành" />
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="press min-w-0 flex-1 pt-0.5 text-left"
      >
        <TaskTitle task={task} muted />
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-foreground/90">{task.outputValue}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          {day !== null ? <span>Hoàn thành {day}</span> : null}
          {task.isMilestone ? (
            <span className="font-medium text-star">Cột mốc</span>
          ) : null}
          {deadlineLabel(task.deadline, today) !== null ? (
            <span>Hạn {deadlineLabel(task.deadline, today)}</span>
          ) : null}
        </p>
      </button>
      <button
        type="button"
        onClick={() => void forward()}
        disabled={isForwarding}
        aria-label="Chuyển kết quả vào Nhật ký"
        title="Chuyển kết quả vào Nhật ký"
        className="press flex h-12 shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50 sm:h-9"
      >
        {isForwarding ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        )}
        Vào Nhật ký
      </button>
    </li>
  );
}

/** `9 thg 9` — a day heading in the timeline, with today and tomorrow named outright. */
function dayHeading(dateIso: string | null, today: string): string {
  if (dateIso === null) return "Không có hạn";
  if (dateIso === today) return "Hôm nay";
  const [, month, day] = dateIso.split("-");
  return `${Number(day)} thg ${Number(month)}`;
}

/**
 * The timeline: every task in one list, grouped by the day it is due and ordered inside each
 * day by the clock, then by whose work it is, then by the emergency mark. This is the default
 * reading because it is the only objective one — what is due soonest is not a matter of taste.
 */
function TimelineView({
  tasks,
  userId,
  today,
  onOpen,
}: {
  tasks: TaskItem[];
  userId: string | undefined;
  today: string;
  onOpen: (task: TaskItem) => void;
}) {
  const groups = useMemo(() => groupTasksByDeadlineDay(tasks, today, userId), [tasks, today, userId]);

  if (groups.length === 0) {
    return (
      <section className="rounded-[10px] border border-border bg-card px-5 py-6">
        <p className="text-[14px] text-muted-foreground">Không có nhiệm vụ nào khớp với bộ lọc này.</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const priority = deadlinePriority(group.date, today);
        return (
          <section
            key={group.date ?? "none"}
            className="rounded-[10px] border border-border bg-card"
            aria-label={dayHeading(group.date, today)}
          >
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <CalendarDays className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
              <h2 className={cn("flex-1 text-[15px] font-semibold", PRIORITY_TEXT[priority])}>
                {dayHeading(group.date, today)}
              </h2>
              <span className="tabular text-[13px] text-muted-foreground">{group.tasks.length}</span>
            </div>
            <ul className="px-5 py-1">
              {group.tasks.map((task) =>
                task.type === "personal" ? (
                  <PersonalRow key={task.id} task={task} today={today} onOpen={onOpen} />
                ) : (
                  <SharedRow key={task.id} task={task} userId={userId} today={today} onOpen={onOpen} />
                ),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Only what THIS person marked as mattering, still in deadline order. */
function ImportantView({
  tasks,
  userId,
  today,
  flags,
  onOpen,
}: {
  tasks: TaskItem[];
  userId: string | undefined;
  today: string;
  flags: TaskFlagIndex;
  onOpen: (task: TaskItem) => void;
}) {
  const starred = useMemo(() => importantTasks(tasks, today, flags, userId), [tasks, today, flags, userId]);

  if (starred.length === 0) {
    return (
      <section className="rounded-[10px] border border-border bg-card px-5 py-6">
        <p className="text-[14px] text-muted-foreground">
          Bạn chưa đánh dấu việc nào là quan trọng. Dấu này dành cho những việc bạn không muốn để trọn
          — kể cả khi chúng không gấp và không tốn nhiều thời gian.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-[15px] font-semibold text-foreground">Việc quan trọng</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Những việc bạn đánh dấu quan trọng, sắp theo hạn. Chỉ bạn thấy danh sách này.
        </p>
      </div>
      <ul className="px-5 py-1">
        {starred.map((task) => {
          const tier = taskTier(task, userId);
          return (
            <li key={task.id} className="border-b border-border/50 last:border-b-0">
              <ul>
                {task.type === "personal" ? (
                  <PersonalRow task={task} today={today} onOpen={onOpen} />
                ) : (
                  <SharedRow task={task} userId={userId} today={today} onOpen={onOpen} />
                )}
              </ul>
              <p className="pb-1.5 pl-[44px] text-[11px] text-muted-foreground">{TIER_LABELS[tier]}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `Còn 2 giờ trống` — how much room is left once the work itself is subtracted. */
function slackNote(minutes: number): string {
  if (!Number.isFinite(minutes)) return "Không có hạn";
  if (minutes < 0) {
    const late = Math.round(Math.abs(minutes) / 60);
    return late < 1 ? "Đã không còn kịp" : `Thiếu khoảng ${late} giờ`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return "Chỉ còn dưới 1 giờ trống";
  if (hours < 24) return `Còn ~${hours} giờ trống`;
  return `Còn ~${Math.floor(hours / 24)} ngày trống`;
}

/**
 * Heavy work, ordered by how little room is left rather than by deadline.
 *
 * This is the one view where the deadline is not the answer. A four-hour job due tomorrow
 * evening is in more trouble than a ten-minute errand due this afternoon, so sorting by date
 * would put the wrong task first. What it sorts by is the gap between now and the deadline
 * minus the time the work is expected to cost — the room actually left to do it in.
 */
function HeavyView({
  tasks,
  userId,
  today,
  flags,
  onOpen,
}: {
  tasks: TaskItem[];
  userId: string | undefined;
  today: string;
  flags: TaskFlagIndex;
  onOpen: (task: TaskItem) => void;
}) {
  const heavy = useMemo(() => heavyTasks(tasks, today, flags, userId), [tasks, today, flags, userId]);

  if (heavy.length === 0) {
    return (
      <section className="rounded-[10px] border border-border bg-card px-5 py-6">
        <p className="text-[14px] text-muted-foreground">
          Chưa có việc nào bạn đánh giá là tốn hơn {HEAVY_TASK_MINUTES} phút. Khi thêm hoặc sửa một nhiệm
          vụ, chọn “Nặng” hoặc nhập số phút để nó xuất hiện ở đây.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-[15px] font-semibold text-foreground">{TASK_VIEW_LABELS.heavy}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Việc bạn đánh giá tốn hơn {HEAVY_TASK_MINUTES} phút, sắp theo chỗ trống còn lại — việc sắp
          không còn đủ thời gian để làm nằm trên.
        </p>
      </div>
      <ul className="px-5 py-1">
        {heavy.map((task) => (
          <li key={task.id} className="border-b border-border/50 last:border-b-0">
            <ul>
              {task.type === "personal" ? (
                <PersonalRow task={task} today={today} onOpen={onOpen} />
              ) : (
                <SharedRow task={task} userId={userId} today={today} onOpen={onOpen} />
              )}
            </ul>
            <p className="pb-1.5 pl-[44px] text-[11px] text-muted-foreground">
              {slackNote(slackMinutes(task, today, flags))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tất cả, then the four Connect Hub layers in their fixed order. */
/** `Xếp · Lọc` — the readings and filters of `Tất cả`, folded behind one button (89 · 3.B). */
function SortFilterButton({ mode, filterCount, children }: { mode: TaskViewMode; filterCount: number; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  return (
    <div data-sort-filter="">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="press inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13.5px] text-foreground"
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        Xếp · Lọc
        <span className="text-muted-foreground">· {TASK_VIEW_LABELS[mode]}{filterCount > 0 ? ` · ${filterCount} bộ lọc` : ""}</span>
      </button>
      {isOpen ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}

function ScopeChips({ value, onChange }: { value: TaskScope | null; onChange: (next: TaskScope | null) => void }) {
  const options: { id: TaskScope | null; label: string }[] = [
    { id: null, label: "Tất cả" },
    ...TASK_SCOPES.map((id) => ({ id, label: TASK_SCOPE_LABELS[id] })),
  ];
  return (
    <div role="group" aria-label="Lọc theo lớp" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id ?? "all"}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "press h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
              isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Nhiệm vụ — personal to-dos plus shared tasks from 1-1s, groups and projects, read four ways. */
export default function Tasks() {
  const { user } = useAuth();
  const { data: tasks, isLoading, isError: tasksFailed, refetch: refetchTasks } = useTasks();
  const { data: allSuggestions } = useTaskSuggestions();
  const userId: string | undefined = user?.id;
  const today = todayIso();

  /** Questions this person asked and is still waiting on. Never work, so never in the lists. */
  const proposed: TaskSuggestion[] = useMemo(
    () => suggestionsProposed(allSuggestions ?? [], userId),
    [allSuggestions, userId],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const scope: TaskScope | null = parseTaskScope(searchParams.get(TASK_SCOPE_PARAM));
  const { order: sharedOrder } = useSharedTaskOrder();
  const projectIndex = useTaskProjectIndex();
  // This person's own marks, which now break ties in every ordering on this page.
  const flags = useTaskFlagIndex();

  /** Which Task Hub section is open. "Tasks" is the existing four readings, unchanged. */
  const hubSection: TaskHubSection = sectionBySlug(searchParams.get(TASK_HUB_PARAM));
  const invitationCount = usePendingInvitationCount();
  const hubCounts = useMemo<Partial<Record<TaskHubSectionId, number>>>(() => {
    const list = tasks ?? [];
    return {
      my_day: tasksForSection("my_day", list, userId, today, flags).length,
      overdue: tasksForSection("overdue", list, userId, today).length,
      events: tasksForSection("events", list, userId, today).length,
      invitations: invitationCount,
    };
  }, [tasks, userId, today, invitationCount, flags]);
  const selectHubSection = useCallback(
    (section: TaskHubSection): void => {
      const next = new URLSearchParams(searchParams);
      next.set(TASK_HUB_PARAM, section.slug);
      if (section.id !== "calendar") {
        next.delete(CALENDAR_MODE_PARAM);
        next.delete(CALENDAR_DAY_PARAM);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  /** Lịch keeps its view and day in the address, so a link (e.g. from Avora Space) lands exactly. */
  const calendarMode: CalendarMode = parseCalendarMode(searchParams.get(CALENDAR_MODE_PARAM));
  const calendarAnchor: string = parseIsoDay(searchParams.get(CALENDAR_DAY_PARAM)) ?? today;
  const setCalendarParam = useCallback(
    (key: string, value: string): void => {
      const next = new URLSearchParams(searchParams);
      next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const navigate = useNavigate();
  const { createPersonal } = useComposerActions();
  // AVORA-53 · 4.1: one `+ Nhiệm vụ` at the head of the page, in every section and view.
  const [isNewOpen, setIsNewOpen] = useState<boolean>(() => searchParams.get("moi") === "1");
  // `?moi=1` (Avora Space › Bắt đầu) is a one-shot: it leaves the address once the form is open.
  useEffect(() => {
    if (searchParams.get("moi") !== "1") return;
    const next = new URLSearchParams(searchParams);
    next.delete("moi");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [newKind, setNewKind] = useState<"task" | "event">("task");
  const [isAssignOpen, setIsAssignOpen] = useState<boolean>(false);
  const openNew = useCallback((kind: "task" | "event"): void => {
    setNewKind(kind);
    setIsNewOpen(true);
  }, []);
  /**
   * `Ghi chú nhanh`: only a title, no deadline. A task always carries a deadline (server rule),
   * so this lands as a Ghi chép in Nhật ký instead — nothing half-made sits in the task list.
   */
  const quickNote = useCallback(async (): Promise<void> => {
    const title = await askText({ title: "Ghi chú nhanh", body: "Chỉ cần một dòng, không có hạn.", confirmLabel: "Lưu", maxLength: 200 });
    if (title === null || title.trim() === "") return;
    try {
      await saveNote({ id: crypto.randomUUID(), folderId: null, title: title.trim(), blocks: [emptyBlock()], tags: [], bookRecordId: null });
      const journal = await ensureJournalConversation();
      toast.success("Đã lưu vào Ghi chép", {
        action: { label: "Mở", onClick: () => navigate(`/tin-nhan/${journal}?${DIARY_VIEW_PARAM}=${diaryViewSlug("notes")}`) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chưa lưu được ghi chú.");
    }
  }, [navigate]);
  const newTaskDeadline: string | undefined =
    hubSection.id === "my_day" ? today : hubSection.id === "calendar" && calendarAnchor >= today ? calendarAnchor : undefined;

  const { personal, sharedGroups, binned } = useMemo(() => {
    const all = filterByScope(tasks ?? [], scope, projectIndex);
    const split = partitionByBin(all, userId);

    const personalTasks = sortTasksByPriority(
      split.kept.filter((task) => task.type === "personal"),
      today,
      userId,
      flags,
    );

    /*
     * One branch per chat for 1-1 and Nhóm; one per project for Dự án, so work agreed in the
     * parent group before the project had its own chat still sits under that project.
     */
    const branches = new Map<string, { scope: SharedScope; key: string; tasks: TaskItem[] }>();
    for (const group of groupSharedByConversation(split.kept)) {
      for (const task of group.tasks) {
        const layer = scopeOfTask(task, projectIndex);
        if (layer === "personal") continue;
        const key = layer === "project" ? (projectOfTask(task, projectIndex)?.conversationId ?? group.conversationId) : group.conversationId;
        const id = `${layer}:${key}`;
        const branch = branches.get(id) ?? { scope: layer, key, tasks: [] };
        branch.tasks.push(task);
        branches.set(id, branch);
      }
    }

    const named: NamedGroup[] = [...branches.values()].map((branch) => ({
      conversationId: branch.key,
      scope: branch.scope,
      // Filled in below, which is where conversation and project names live.
      peerName: "",
      // Deadline order first, then whatever this person dragged into place on top of it.
      tasks: applyManualOrder(sortTasksByPriority(branch.tasks, today, userId, flags), sharedOrder),
      tone: highestOpenPriority(branch.tasks, today),
      auto: branch.tasks.some((task) => needsAttention(task, userId, today)),
    }));

    return {
      personal: personalTasks,
      sharedGroups: named,
      binned: sortTasksByPriority(split.binned, today, userId, flags),
    };
  }, [tasks, userId, today, scope, sharedOrder, flags, projectIndex]);

  /** Work that closed and named what it brought — the section between the lists and the bin. */
  const reports: TaskItem[] = useMemo(
    () => reportTasks(filterByScope(tasks ?? [], scope, projectIndex), userId),
    [tasks, userId, scope, projectIndex],
  );

  const { order: viewOrder, isReady: isOrderReady, reorder: reorderViews } = useViewOrder();
  /**
   * A link may name the reading it wants; arriving without one means no opinion.
   *
   * Read once at mount rather than on every render, so switching tabs by hand afterwards is
   * not immediately undone by the address that brought them here.
   */
  const requestedView: TaskViewMode | null = parseTaskView(searchParams.get(TASK_VIEW_PARAM));
  const [mode, setMode] = useState<TaskViewMode>(requestedView ?? "deadline");
  const [categoryFilter, setCategoryFilter] = useState<readonly string[]>([]);
  const { data: categories } = useTaskCategories();
  const { due, dismiss } = useDueReminders();

  /**
   * The tab sitting first is the one that opens — but only on arrival, and only when the link
   * did not already say which reading it wanted. Dragging the strip around later must not
   * yank the person out of the view they are reading, and a dashboard block that asked for
   * the by-contact reading must not be overruled by someone's saved tab order.
   */
  const hasAppliedDefaultView = useRef<boolean>(false);
  useEffect(() => {
    if (!isOrderReady || hasAppliedDefaultView.current) return;
    hasAppliedDefaultView.current = true;
    if (requestedView === null) setMode(defaultViewMode(viewOrder));
  }, [isOrderReady, viewOrder, requestedView]);

  /** The layer chips in Theo đối tượng: pick one of the four, or all. Kept in the address like the dashboard link. */
  const chooseScope = useCallback(
    (next: TaskScope | null): void => {
      const params = new URLSearchParams(searchParams);
      if (next === null) params.delete(TASK_SCOPE_PARAM);
      else params.set(TASK_SCOPE_PARAM, scopeSlug(next));
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearScope = useCallback((): void => {
    const next = new URLSearchParams(searchParams);
    next.delete(TASK_SCOPE_PARAM);
    // The requested reading goes with the filter it arrived with, so "Bỏ lọc" does not leave
    // a stale view= behind to reassert itself on the next reload.
    next.delete(TASK_VIEW_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleCategory = useCallback((id: string): void => {
    setCategoryFilter((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }, []);

  /** Everything still on the list, filtered by shelf — what the timeline and starred views read. */
  const visible = useMemo(() => {
    const split = partitionByBin(filterByScope(tasks ?? [], scope, projectIndex), userId);
    return filterByCategories(split.kept, categoryFilter);
  }, [tasks, userId, categoryFilter, scope, projectIndex]);

  const titleFor = useCallback(
    (taskId: string): string | null => (tasks ?? []).find((task) => task.id === taskId)?.title ?? null,
    [tasks],
  );

  /**
   * Which task the detail panel is showing, kept as an id rather than the row itself.
   *
   * Holding the object would freeze it at the moment it was clicked, so an edit saved in the
   * panel — or the other party accepting the task while it is open — would leave stale text
   * on screen. Looking it up each render means the panel always shows what is actually true.
   */
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openedTask = useMemo<TaskItem | null>(
    () => (tasks ?? []).find((task) => task.id === openTaskId) ?? null,
    [tasks, openTaskId],
  );
  const openTask = useCallback((task: TaskItem): void => setOpenTaskId(task.id), []);

  /**
   * `?mo=<id>` opens one task from outside (AVORA-39 / Phần 1 · A1): detail open, row in view
   * and lit. Handled once per id, after the list has loaded; a task that is gone says so.
   */
  const requestedTaskId: string | null = searchParams.get(OPEN_TASK_PARAM);
  const handledOpenRef = useRef<string | null>(null);
  useEffect(() => {
    if (requestedTaskId === null || tasks === undefined || handledOpenRef.current === requestedTaskId) return;
    handledOpenRef.current = requestedTaskId;
    const found = tasks.find((task) => task.id === requestedTaskId);
    if (found === undefined) {
      toast("Không tìm thấy việc này nữa.");
      const next = new URLSearchParams(searchParams);
      next.delete(OPEN_TASK_PARAM);
      setSearchParams(next, { replace: true });
      return;
    }
    setOpenTaskId(found.id);
    spotlight("data-task-id", found.id);
  }, [requestedTaskId, tasks, searchParams, setSearchParams]);

  const closeTask = useCallback((): void => {
    setOpenTaskId(null);
    if (searchParams.get(OPEN_TASK_PARAM) !== null) {
      const next = new URLSearchParams(searchParams);
      next.delete(OPEN_TASK_PARAM);
      handledOpenRef.current = null;
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /**
   * Lịch never edits. A task with a conversation goes back to where it was agreed; a personal
   * task with no thread opens in Nhiệm vụ — the calendar itself stays read-only.
   */
  const openFromCalendar = useCallback((task: TaskItem): void => {
    // ADR-038: the detail opens right over Lịch and its owner acts there; closing it leaves
    // the same day and view. The conversation stays one tap away inside the detail.
    setOpenTaskId(task.id);
  }, []);

  const { data: conversations } = useConversations();
  const namedGroups = useMemo<NamedGroup[]>(() => {
    const options = conversations ?? [];
    const rank: Record<TaskPriority, number> = { overdue: 0, due_soon: 1, routine: 2, none: 3 };
    return sharedGroups
      .map((group) => {
        const project = group.scope === "project" ? projectIndex.byConversation.get(group.conversationId) : undefined;
        const conversation = options.find((item) => item.conversationId === group.conversationId);
        return {
          ...group,
          // A project branch is named after the project, a group after the group, a 1-1 after the person.
          peerName: project?.title ?? (conversation ? conversationTitle(conversation) : "Cuộc trò chuyện"),
        };
      })
      // Most pressing contact first; ties settle alphabetically so the order is stable.
      .sort((a, b) => rank[a.tone] - rank[b.tone] || a.peerName.localeCompare(b.peerName, "vi"));
  }, [sharedGroups, conversations, projectIndex]);

  return (
    <div className="paper flex min-h-0 flex-1 flex-col">
      <HubTitle
        title="Nhiệm vụ"
        className="max-w-[720px] md:px-6"
        action={
          // AVORA-57 · E: Tìm kiếm first, the main `+` outermost on the right.
          <div className="flex items-center gap-1.5">
            <AvoraSearchButton here={{ tab: "nhiem-vu", label: "Nhiệm vụ" }} />
            {/* AVORA-61 · A: the shared `+` — click = a task for me, hold / right-click = what kind. */}
            <PlusMenuButton
              label="Thêm nhiệm vụ"
              tapLabel="giữ để chọn loại"
              tapAction="nhiệm vụ cho tôi"
              onTap={() => openNew("task")}
              hintKey="task_plus_hold"
              entries={[
                { id: "mine", label: "Nhiệm vụ cho tôi", icon: UserRound, onSelect: () => openNew("task") },
                { id: "assign", label: "Giao việc cho người khác", icon: UserPlus, onSelect: () => setIsAssignOpen(true) },
                { id: "event", label: "Sự kiện", icon: CalendarClock, onSelect: () => openNew("event") },
                { id: "note", label: "Ghi chú nhanh", icon: StickyNote, onSelect: () => void quickNote() },
              ]}
            />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="rise-in mx-auto w-full max-w-[720px] px-4 pb-6 pt-4 sm:px-6 sm:pb-8 short:mx-0 short:max-w-none short:px-4">
        <ReturnChip className="-mt-2 mb-1" />
        <div>
          <TaskHubNav active={hubSection} counts={hubCounts} onChange={selectHubSection} />
        </div>

        {hubSection.id !== "tasks" ? (
          <div className="mt-5 space-y-3 pb-10">
            {/* AVORA-93 · 4: reminders fold into one line, only on `Hôm nay`. */}
            {hubSection.id === "my_day" ? <ReminderLine due={due} titleFor={titleFor} onDismiss={dismiss} onOpen={setOpenTaskId} /> : null}
            {tasksFailed ? (
              <BlockLoadError name="nhiệm vụ" onRetry={() => void refetchTasks()} />
            ) : isLoading ? (
              <div className="flex justify-center py-16" role="status" aria-label="Đang tải nhiệm vụ">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : hubSection.id === "calendar" ? (
              <CalendarView
                mode={calendarMode}
                anchor={calendarAnchor}
                today={today}
                onModeChange={(mode) => setCalendarParam(CALENDAR_MODE_PARAM, calendarModeSlug(mode))}
                onAnchorChange={(day) => setCalendarParam(CALENDAR_DAY_PARAM, day)}
                onOpenContext={openFromCalendar}
              />
            ) : (
              <TaskHubSectionView section={hubSection} tasks={tasks ?? []} userId={userId} today={today} onOpen={openTask} />
            )}
          </div>
        ) : (
        <>
        <div className="mt-4 space-y-3">
          {/* Arrived from a dashboard block: say what is being left out, and offer the way back.
              In Theo đối tượng the layer chips already say it. */}
          {scope !== null && mode !== "relationship" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2">
              <span className="text-[13px] text-muted-foreground">Đang xem riêng</span>
              <span className="text-[13px] font-semibold text-foreground">{TASK_SCOPE_LABELS[scope]}</span>
              <button
                type="button"
                onClick={clearScope}
                className="press ml-auto flex h-12 items-center gap-1 rounded-[8px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Bỏ lọc
              </button>
            </div>
          ) : null}

          {/* AVORA-89 · 3.B: one `Xếp · Lọc` instead of four view tabs and six category chips. */}
          <SortFilterButton
            mode={mode}
            filterCount={categoryFilter.length + (scope !== null ? 1 : 0)}
          >
            <TaskViewTabs mode={mode} order={viewOrder} onChange={setMode} onReorder={reorderViews} />
            {mode === "relationship" ? <ScopeChips value={scope} onChange={chooseScope} /> : null}
            <CategoryFilterBar
              categories={categories ?? []}
              selected={categoryFilter}
              onToggle={toggleCategory}
              onClear={() => setCategoryFilter([])}
            />
          </SortFilterButton>
        </div>

        {tasksFailed ? (
          <BlockLoadError className="mt-5" name="nhiệm vụ" onRetry={() => void refetchTasks()} />
        ) : isLoading ? (
          <div className="flex justify-center py-16" role="status" aria-label="Đang tải nhiệm vụ">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-5 space-y-4 pb-10">
            {mode === "deadline" ? (
              <TimelineView tasks={visible} userId={userId} today={today} onOpen={openTask} />
            ) : null}
            {mode === "important" ? (
              <ImportantView
                tasks={visible}
                userId={userId}
                today={today}
                flags={flags}
                onOpen={openTask}
              />
            ) : null}
            {mode === "heavy" ? (
              <HeavyView
                tasks={visible}
                userId={userId}
                today={today}
                flags={flags}
                onOpen={openTask}
              />
            ) : null}
            {mode === "relationship" ? (
              <>
                {/* Connect Hub order, always: Của tôi → 1-1 → Nhóm → Dự án. Empty shared layers stay out of the way. */}
                {scope === null || scope === "personal" ? (
                  <PersonalSection tasks={personal} today={today} onOpen={openTask} />
                ) : null}
                {SHARED_SCOPES.map((layer) => {
                  const groups = namedGroups.filter((group) => group.scope === layer);
                  if (groups.length === 0 && scope !== layer) return null;
                  return <SharedSection key={layer} layer={layer} groups={groups} today={today} onOpen={openTask} />;
                })}
              </>
            ) : null}


            {proposed.length > 0 ? <ProposedSection suggestions={proposed} today={today} /> : null}

            {reports.length > 0 ? <ReportsSection tasks={reports} today={today} onOpen={openTask} /> : null}

            {/* AVORA-53 · 4.7: one Thùng rác — the ⋯ › Thùng rác section. */}
          </div>
        )}
        </>
        )}
      </div>
      </div>

      {/*
        Held by id rather than by value, so the panel keeps showing the live row: an edit
        saved inside it, or the other side moving the task along, is reflected immediately
        instead of freezing whatever was clicked.
      */}
      <AssignTaskFlow open={isAssignOpen} onOpenChange={setIsAssignOpen} />
      <TaskComposer
        key={newKind}
        open={isNewOpen}
        onOpenChange={setIsNewOpen}
        startWithEvent={newKind === "event"}
        place="personal"
        initial={newTaskDeadline !== undefined ? { deadline: newTaskDeadline } : undefined}
        onCreateMine={async (values) => {
          if (!user) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
          await createPersonal(user.id, values, null);
        }}
      />
      <TaskDetailSheet
        task={openedTask}
        today={today}
        open={openedTask !== null}
        onOpenChange={(next) => {
          if (!next) closeTask();
        }}
      />
    </div>
  );
}
