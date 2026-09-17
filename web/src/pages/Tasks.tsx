import {
  CalendarDays,
  BookOpen,
  ChevronRight,
  FolderKanban,
  GripVertical,
  Loader2,
  MessagesSquare,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { celebrate, MILESTONE_BURSTS } from "@/lib/confetti";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { PERSONAL_BUBBLE_STATE, SHARED_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { TaskCompleteDialog } from "@/components/tasks/TaskCompleteDialog";
import {
  CategoryFilterBar,
  CategoryTag,
  DurationTag,
  emptyScheduleDraft,
  ImportantStar,
  ReminderBanner,
  ScheduleFields,
  TimeTag,
  type ScheduleDraft,
} from "@/components/tasks/ScheduleFields";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { TaskViewTabs } from "@/components/tasks/TaskViewTabs";
import { useAuth } from "@/lib/auth";
import { conversationTitle } from "@/lib/chat";
import type { TaskCategory } from "@/lib/task-categories";
import { projectLink } from "@/lib/projects";
import { contextLink, contextTarget } from "@/lib/task-context";
import { forwardTaskOutputToJournal, completedDayLabel } from "@/lib/task-report";
import { applyManualOrder, defaultViewMode } from "@/lib/task-order";
import { RECURRENCE_LABELS } from "@/lib/task-schedule";
import {
  filterByScope,
  parseTaskScope,
  parseTaskView,
  TASK_SCOPE_LABELS,
  TASK_SCOPE_PARAM,
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
import { useTaskProjectLinks } from "@/lib/use-projects";
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
    <span className="flex flex-wrap items-center gap-2">
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

/**
 * The description is what was actually asked for, so it is shown on the row rather than hidden
 * behind a tap. Two lines is enough to recognise the work; the rest stays in the row's title
 * attribute so nothing is lost.
 */
function TaskDescription({ task }: { task: TaskItem }) {
  if (task.description.trim() === "") return null;
  return (
    <p
      title={task.description}
      className={cn(
        "mt-0.5 line-clamp-2 text-[13px] leading-5",
        task.status === "done" ? "text-task-idle" : "text-muted-foreground",
      )}
    >
      {task.description}
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
    <li className="flex items-start gap-3 py-2">
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
        <TaskDescription task={task} />
        <div className="mt-0.5 text-[12px]">
          <DeadlineChip task={task} today={today} category={categories.get(task.categoryId ?? "")} />
        </div>
      </button>
      <IconAction
        label="Xoá"
        icon={Trash2}
        disabled={binPersonal.isPending}
        onClick={() => void run(binPersonal.mutateAsync({ taskId: task.id, deleted: true }))}
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
              // A milestone is several pops in a row, on the whole screen — the canvas is
              // parented to the document, so no open dialog or panel can clip it.
              .then(() =>
                celebrate(
                  task.isMilestone ? "milestone" : "task",
                  task.isMilestone ? MILESTONE_BURSTS : 1,
                ),
              ),
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
  const target = contextTarget(task.contextSnapshot, task.conversationId);
  const voice = taskVoice(task, userId);
  /** Set when this task was linked to a deliverable — then the project is its first context. */
  const projectOf = useTaskProjectLinks().get(task.id);

  return (
    <li
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
      className={cn(
        "flex flex-col gap-2 rounded-[10px] py-2 transition-colors sm:flex-row sm:items-start sm:gap-3",
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
        <TaskBubble state={SHARED_BUBBLE_STATE[task.status]} label={taskStatusLabel(task.status)} />

        {/* The text opens the task; dragging still belongs to the row around it. */}
        <button
          type="button"
          onClick={() => onOpen?.(task)}
          disabled={onOpen === undefined}
          className="press min-w-0 flex-1 pt-0.5 text-left disabled:cursor-default"
        >
          <TaskTitle task={task} muted={false} voice={voice} />
          <TaskDescription task={task} />
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
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

      <div className="flex shrink-0 items-center gap-1.5 pl-11 sm:pl-0">
        {/* A task inside a project answers "why am I doing this" with the project, so that
            comes first; the conversation it was agreed in stays available beside it. */}
        {projectOf !== undefined ? (
          <button
            type="button"
            onClick={() => navigate(projectLink(projectOf.projectId))}
            className="press flex h-12 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <FolderKanban className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Xem trong dự án
          </button>
        ) : null}
        {target !== null ? (
          <button
            type="button"
            onClick={() => navigate(contextLink(target.conversationId, task.id))}
            className="press flex h-12 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <MessagesSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Xem trong ngữ cảnh
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
          Phục hồi
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

/** Field label carrying the one thing the person needs to know: this cannot be left out. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-muted-foreground">
      {children}
      <span aria-hidden="true" className="ml-1 text-primary">
        *
      </span>
      <span className="sr-only"> (bắt buộc)</span>
    </label>
  );
}

const FIELD_CLASS =
  "w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground";

/**
 * One composer for both kinds of task, because both have to clear the same bar: a title, a
 * description of what is actually wanted, and a day it is due. The submit button stays inert
 * until all three carry something, so the form never invites a request it will refuse.
 */
function TaskComposer({
  idPrefix,
  titlePlaceholder,
  submitLabel,
  pendingLabel,
  pending,
  today,
  onCreate,
  children,
}: {
  idPrefix: string;
  titlePlaceholder: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  today: string;
  onCreate: (draft: TaskDraft) => Promise<TaskItem | null>;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<TaskDraft>({ title: "", description: "", deadline: "" });
  const [schedule, setSchedule] = useState<ScheduleDraft>(emptyScheduleDraft);
  const { data: categories } = useTaskCategories();
  const reminders = useTaskReminderActions();
  const complete = isTaskDraftComplete(draft);

  const patch = (part: Partial<TaskDraft>): void => setDraft((previous) => ({ ...previous, ...part }));
  const patchSchedule = (part: Partial<ScheduleDraft>): void =>
    setSchedule((previous) => ({ ...previous, ...part }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const clean = validateTaskDraft(
      {
        ...draft,
        deadlineTime: schedule.deadlineTime,
        categoryId: schedule.categoryId,
        isImportant: schedule.isImportant,
        recurrence: schedule.recurrence,
        recurrencePattern:
          schedule.recurrence === "custom"
            ? { interval: schedule.customInterval, frequency: schedule.customFrequency }
            : null,
      },
      today,
    );
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return;
    }
    try {
      const created = await onCreate(clean.value);
      // The reminder needs the task's id, so it can only be attached once the row exists.
      // A failed reminder must not read as a failed task: the task is already saved.
      if (created !== null && schedule.reminder !== null && created.deadline !== null) {
        try {
          await reminders.set.mutateAsync({
            taskId: created.id,
            preset: schedule.reminder,
            deadline: created.deadline,
            deadlineTime: created.deadlineTime,
          });
        } catch (error) {
          showError(error);
        }
      }
      setDraft({ title: "", description: "", deadline: "" });
      setSchedule(emptyScheduleDraft);
    } catch (error) {
      showError(error);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-border p-4">
      <p className="text-[12px] leading-5 text-muted-foreground">
        Một nhiệm vụ cần đủ ba phần: tên, mô tả cụ thể và hạn hoàn thành. Thiếu một trong ba thì đó chỉ là
        một ghi chú.
      </p>

      {children}

      <div>
        <FieldLabel htmlFor={`${idPrefix}-title`}>Tiêu đề</FieldLabel>
        <input
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          placeholder={titlePlaceholder}
          maxLength={200}
          required={true}
          className={cn(FIELD_CLASS, "h-11")}
        />
      </div>

      <div>
        <FieldLabel htmlFor={`${idPrefix}-description`}>Mô tả cụ thể</FieldLabel>
        <textarea
          id={`${idPrefix}-description`}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Mô tả cụ thể (bắt buộc) — Bạn cần gì? Kết quả dự kiến là gì?"
          rows={2}
          maxLength={2000}
          required={true}
          className={cn(FIELD_CLASS, "resize-y py-2.5 leading-6")}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-[190px]">
          <FieldLabel htmlFor={`${idPrefix}-deadline`}>Hạn hoàn thành</FieldLabel>
          <input
            id={`${idPrefix}-deadline`}
            type="date"
            value={draft.deadline}
            min={today}
            onChange={(event) => patch({ deadline: event.target.value })}
            required={true}
            className={cn(FIELD_CLASS, "h-11 text-[14px]")}
          />
        </div>
        <div className="flex-1" />
      </div>

      <ScheduleFields
        idPrefix={idPrefix}
        deadline={draft.deadline}
        draft={schedule}
        categories={categories ?? []}
        onPatch={patchSchedule}
      />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !complete}
          title={complete ? undefined : "Cần đủ tiêu đề, mô tả và hạn hoàn thành"}
          className="press flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
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
  const { addPersonal } = useTaskActions();
  const { isOpen, toggle } = useTree();

  const openCount = countOpenTasks(tasks);
  const tone = highestOpenPriority(tasks, today);
  const auto = tasks.some((task) => needsAttention(task, user?.id, today));
  const open = isOpen("personal", auto);

  return (
    <section aria-labelledby="tasks-personal" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={open} onToggle={() => toggle("personal", auto)} className="px-5 py-4">
        <h2 id="tasks-personal" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          Cá nhân
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

          <TaskComposer
            idPrefix="personal"
            titlePlaceholder="Tiêu đề"
            submitLabel="Thêm"
            pendingLabel="Đang thêm…"
            pending={addPersonal.isPending}
            today={today}
            onCreate={async (draft) => {
              if (!user) return null;
              return await addPersonal.mutateAsync({ userId: user.id, draft });
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

type NamedGroup = {
  conversationId: string;
  peerName: string;
  tasks: TaskItem[];
  tone: TaskPriority;
  auto: boolean;
};

function SharedSection({
  groups,
  today,
  onOpen,
}: {
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
  const sectionOpen = isOpen("shared", sectionAuto);

  return (
    <section aria-labelledby="tasks-shared" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={sectionOpen} onToggle={() => toggle("shared", sectionAuto)} className="px-5 py-4">
        <h2 id="tasks-shared" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          Nhiệm vụ chung
        </h2>
        <OpenCounter count={openCount} tone={sectionTone} suffix="nhiệm vụ đang mở" />
      </BranchHeader>

      {sectionOpen ? (
        <div className="rise-in">
          <p className="px-5 pb-3 text-[13px] text-muted-foreground">
            Nhiệm vụ chung được tạo và xử lý ngay trong cuộc trò chuyện. Ở đây bạn xem lại và sắp xếp —
            kéo để đổi vị trí hiển thị của riêng bạn.
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
              Chưa có nhiệm vụ chung nào. Mở một cuộc trò chuyện và bấm “Nhiệm vụ” để giao việc.
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
                    <a
                      href={`/tin-nhan/${entry.conversationId}`}
                      className="press flex h-12 items-center rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground sm:h-9"
                    >
                      Mở cuộc trò chuyện
                    </a>
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
        suggestionId={editTarget?.id ?? null}
        draft={
          editTarget === null
            ? null
            : {
                title: editTarget.title,
                description: editTarget.description,
                deadline: editTarget.deadline,
                deadlineTime: editTarget.deadlineTime,
              }
        }
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
                cả hai bên. Không có tác vụ nào bị xoá — nó chưa từng tồn tại.
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
                className="bg-destructive text-white hover:bg-destructive/90"
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
            <span className="font-medium text-[#b98a2f]">Cột mốc</span>
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

/** The bin. Always collapsed on arrival: it is a place you go looking for, never a distraction. */
function BinSection({ tasks, userId, today }: { tasks: TaskItem[]; userId: string | undefined; today: string }) {
  const { isOpen, toggle } = useTree();
  const open = isOpen("bin", false);

  return (
    <section aria-labelledby="tasks-bin" className="rounded-[10px] border border-border bg-card">
      <BranchHeader open={open} onToggle={() => toggle("bin", false)} className="px-5 py-4">
        <h2 id="tasks-bin" className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
          Thùng rác
        </h2>
        <span className="tabular shrink-0 text-[13px] text-muted-foreground">{tasks.length} việc đã xoá</span>
      </BranchHeader>

      {open ? (
        <div className="rise-in">
          <p className="px-5 pb-2 text-[13px] text-muted-foreground">
            Việc chung chỉ mất hẳn khi cả hai bên đều xoá. Trước đó, người kia vẫn thấy nó.
          </p>
          <ul className="px-5 pb-3">
            {tasks.map((task) => (
              <BinRow key={task.id} task={task} userId={userId} today={today} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
        <p className="text-[14px] text-muted-foreground">Không có nhiệm vụ nào khớp vời bộ lọc này.</p>
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

/** Nhiệm vụ — personal to-dos plus shared tasks from 1-1s and groups, read four ways. */
export default function Tasks() {
  const { user } = useAuth();
  const { data: tasks, isLoading } = useTasks();
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
  // This person's own marks, which now break ties in every ordering on this page.
  const flags = useTaskFlagIndex();

  const { personal, sharedGroups, binned } = useMemo(() => {
    const all = filterByScope(tasks ?? [], scope);
    const split = partitionByBin(all, userId);

    const personalTasks = sortTasksByPriority(
      split.kept.filter((task) => task.type === "personal"),
      today,
      userId,
      flags,
    );

    const named: NamedGroup[] = groupSharedByConversation(split.kept).map((group) => ({
      conversationId: group.conversationId,
      // Filled in by the section, which is where conversation names live.
      peerName: "",
      // Deadline order first, then whatever this person dragged into place on top of it.
      tasks: applyManualOrder(sortTasksByPriority(group.tasks, today, userId, flags), sharedOrder),
      tone: highestOpenPriority(group.tasks, today),
      auto: group.tasks.some((task) => needsAttention(task, userId, today)),
    }));

    return {
      personal: personalTasks,
      sharedGroups: named,
      binned: sortTasksByPriority(split.binned, today, userId, flags),
    };
  }, [tasks, userId, today, scope, sharedOrder, flags]);

  /** Work that closed and named what it brought — the section between the lists and the bin. */
  const reports: TaskItem[] = useMemo(
    () => reportTasks(filterByScope(tasks ?? [], scope), userId),
    [tasks, userId, scope],
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
    const split = partitionByBin(filterByScope(tasks ?? [], scope), userId);
    return filterByCategories(split.kept, categoryFilter);
  }, [tasks, userId, categoryFilter, scope]);

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

  const { data: conversations } = useConversations();
  const namedGroups = useMemo<NamedGroup[]>(() => {
    const options = conversations ?? [];
    const rank: Record<TaskPriority, number> = { overdue: 0, due_soon: 1, routine: 2, none: 3 };
    return sharedGroups
      .map((group) => {
        const conversation = options.find((item) => item.conversationId === group.conversationId);
        return {
          ...group,
          // A group branch is named after the group; only a 1-1 is named after a person.
          peerName: conversation ? conversationTitle(conversation) : "Cuộc trò chuyện",
        };
      })
      // Most pressing contact first; ties settle alphabetically so the order is stable.
      .sort((a, b) => rank[a.tone] - rank[b.tone] || a.peerName.localeCompare(b.peerName, "vi"));
  }, [sharedGroups, conversations]);

  return (
    <div className="paper min-h-screen flex-1 md:h-screen md:overflow-y-auto">
      <div className="rise-in mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">Nhiệm vụ</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {mode === "deadline"
            ? "Tất cả việc của bạn theo thứ tự phải làm trước."
            : mode === "relationship"
              ? "Việc của bạn và việc chung theo từng đối tượng. Bấm vào từng mục để mở ra."
              : mode === "heavy"
                ? "Việc bạn đánh giá là nặng, sắp theo chỗ trống còn lại trước hạn."
                : "Những việc bạn đánh dấu là quan trọng — chỉ riêng bạn thấy."}
        </p>

        <div className="mt-5 space-y-3">
          <ReminderBanner due={due} titleFor={titleFor} onDismiss={dismiss} />

          {/* Arrived from a dashboard block: say what is being left out, and offer the way back. */}
          {scope !== null ? (
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

          <TaskViewTabs mode={mode} order={viewOrder} onChange={setMode} onReorder={reorderViews} />
          <CategoryFilterBar
            categories={categories ?? []}
            selected={categoryFilter}
            onToggle={toggleCategory}
            onClear={() => setCategoryFilter([])}
          />
        </div>

        {isLoading ? (
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
                <PersonalSection tasks={personal} today={today} onOpen={openTask} />
                <SharedSection groups={namedGroups} today={today} onOpen={openTask} />
              </>
            ) : null}

            {/* Personal work is added here; shared work is only ever raised inside a chat. */}
            {mode !== "relationship" ? (
              <p className="text-[13px] text-muted-foreground">
                Để thêm việc cá nhân, chuyển sang{" "}
                <button
                  type="button"
                  onClick={() => setMode("relationship")}
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                >
                  {TASK_VIEW_LABELS.relationship}
                </button>
                . Việc chung được giao ngay trong cuộc trò chuyện.
              </p>
            ) : null}

            {proposed.length > 0 ? <ProposedSection suggestions={proposed} today={today} /> : null}

            {reports.length > 0 ? <ReportsSection tasks={reports} today={today} onOpen={openTask} /> : null}

            {binned.length > 0 ? <BinSection tasks={binned} userId={userId} today={today} /> : null}
          </div>
        )}
      </div>

      {/*
        Held by id rather than by value, so the panel keeps showing the live row: an edit
        saved inside it, or the other side moving the task along, is reflected immediately
        instead of freezing whatever was clicked.
      */}
      <TaskDetailSheet
        task={openedTask}
        today={today}
        open={openedTask !== null}
        onOpenChange={(next) => {
          if (!next) setOpenTaskId(null);
        }}
      />
    </div>
  );
}
