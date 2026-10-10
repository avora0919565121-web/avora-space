import {
  Bell,
  BookOpen,
  Link2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Circle,
  CircleCheck,
  Loader2,
  Lock,
  MapPin,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Repeat,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { RecordPicker } from "@/components/tasks/LinkPickers";
import { RecipientPicker } from "@/components/tasks/RecipientPicker";
import {
  CardGroup,
  CardRow,
  ClearButton,
  DraftFiles,
  DraftSteps,
  InlineCalendar,
  InlineTime,
  LiveFiles,
  LiveSteps,
  NoteField,
  RepeatPicker,
} from "@/components/tasks/TaskCardParts";
import { useLiveFilesLine, useLiveStepsLine } from "@/lib/use-task-card";
import { TaskCompleteDialog } from "@/components/tasks/TaskCompleteDialog";
import { TaskPlanFields } from "@/components/tasks/TaskPlanFields";
import { TaskPrepPanel } from "@/components/tasks/TaskPrepPanel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useAutoList } from "@/hooks/use-auto-list";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLongPress } from "@/hooks/use-long-press";
import { useEdgeSwipeBack } from "@/components/chat/StackedSheetHeader";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { useAuth } from "@/lib/auth";
import { celebrate } from "@/lib/confetti";
import type { GroupMember } from "@/lib/groups";
import { logError } from "@/lib/log";
import {
  CARD_GROUPS,
  footerLine,
  localInstant,
  localParts,
  minutesOf,
  readFoldedGroups,
  repeatLine,
  saveLabel,
  whenLine,
  writeFoldedGroups,
  cardDay,
  type CardGroupId,
  type SaveState,
} from "@/lib/task-card";
import {
  composerCopy,
  composerPartialFailure,
  composerSuccess,
  departureLine,
  hasRecipients,
  initialChoice,
  memberName,
  missingLine,
  recipientSummary,
  REMINDER_CHIPS,
  resolveRecipients,
  TRAVEL_CHIPS,
  type ComposerPlace,
  type RecipientChoice,
  type Recipients,
} from "@/lib/task-composer";
import { contextLinkFromTasks } from "@/lib/task-context";
import { useTaskLinkActions, useTaskRecord } from "@/lib/task-links";
import { recordLink } from "@/lib/think-hub";
import { myDayOption } from "@/lib/task-hub";
import { taskOwnership } from "@/lib/task-owner";
import { forwardTaskOutputToJournal } from "@/lib/task-report";
import { taskContextTarget } from "@/lib/task-scope";
import { browserTimezone, type RecurrencePattern, type TaskRecurrence } from "@/lib/task-schedule";
import { createTaskReminderAt, deleteTaskReminder, taskReminderKeys } from "@/lib/task-reminders";
import { ownedTaskIds, type TaskSuggestion } from "@/lib/task-suggestions";
import {
  canConfirmSharedTask,
  canDeleteTask,
  canEditTask,
  canMarkSharedDone,
  canReviewSharedDone,
  isOnMyDay,
  isSharedTask,
  isTaskAssignee,
  setTaskRecurrence,
  taskClosedReason,
  taskKeys,
  todayIso,
  validateTaskDraft,
  type TaskItem,
} from "@/lib/tasks";
import { useTaskFlagIndex, useMyDay } from "@/lib/use-task-flags";
import { useTaskReminders } from "@/lib/use-task-meta";
import { useTaskSuggestions, useSuggestionActions } from "@/lib/use-task-suggestions";
import { eventOf, sendToRecipients, travelOf, useComposerActions, useMyTravelPlans, useTaskExtras, type ComposerValues } from "@/lib/use-task-composer";
import { useTaskProjectIndex } from "@/lib/use-projects";
import { usePeopleNames } from "@/lib/use-task-owner";
import { useClosedSharedTasks, useTaskActions } from "@/lib/use-tasks";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/** The one line under the name that says where the task came from, and opens it. */
export type ComposerSource = {
  label: string;
  /** What opens under the line. Receives a way to drop text into Ghi chú (paste). */
  render?: (api: { appendNote: (text: string) => void }) => ReactNode;
  defaultOpen?: boolean;
};

/** Creating: where it is made and who it may go to. Wrappers only pass Nguồn + Giao cho (2.3). */
export type TaskCardCreateProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: ComposerPlace;
  source?: ComposerSource | null;
  peerId?: string | null;
  peerName?: string;
  members?: readonly GroupMember[];
  initial?: Partial<ComposerValues>;
  allowTravel?: boolean;
  /** The author's own task. Return the created task (or its id) so the extra rows can be written. */
  onCreateMine?: (values: ComposerValues) => Promise<unknown>;
  onPropose?: (assigneeId: string, values: ComposerValues) => Promise<unknown>;
  onCreated?: (recipients: Recipients) => void;
  /** `+ › Sự kiện`: open full with Ngày diễn ra unfolded. */
  startWithEvent?: boolean;
  startChoice?: RecipientChoice;
  /** Open the full card straight away (skip the quick sheet). */
  startExpanded?: boolean;
};

/** Seeing = editing a live task (2.2 · 5). */
export type TaskCardTaskProps = {
  task: TaskItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today?: string;
  /** Phone `‹ {nơi trước}`. */
  backLabel?: string;
  /**
   * AVORA-104 · PHẦN 4: drawn in place (Toàn cảnh's right column / last phone column) instead of a
   * sheet. `‹ {backLabel}` closes it; switching task remounts the card, which saves what was typed.
   */
  embedded?: boolean;
};

/** The proposer rewording a suggestion nobody has answered yet. */
export type TaskCardSuggestionProps = {
  suggestion: TaskSuggestion | null;
  assigneeName: string;
  place?: ComposerPlace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type TaskCardProps = TaskCardCreateProps | TaskCardTaskProps | TaskCardSuggestionProps;

/**
 * Một thẻ nhiệm vụ (AVORA-104 · PHẦN 2 · ADR-075). Creating, seeing and editing a task are one card,
 * everywhere: Tên việc · Các bước · Hôm nay · Nhắc · Ngày diễn ra · Lặp lại · Hiện diện · Giao cho ·
 * Tệp · Ghi chú — same order, same words, same icons. Only the Nguồn line and Giao cho differ.
 */
export function TaskCard(props: TaskCardProps) {
  if ("task" in props) return <LiveTaskCard {...props} />;
  if ("suggestion" in props) return <SuggestionCard {...props} />;
  return <CreateTaskCard {...props} />;
}

/* ------------------------------------------------------------------ shared pieces */

const ICON = "h-[18px] w-[18px]";

function useFolds(): { folded: Set<CardGroupId>; toggle: (id: CardGroupId) => void } {
  const [folded, setFolded] = useState<Set<CardGroupId>>(() => readFoldedGroups());
  const toggle = useCallback((id: CardGroupId): void => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFoldedGroups(next);
      return next;
    });
  }, []);
  return { folded, toggle };
}

/** `Đang lưu…` → `Đã lưu ✓`; a failure keeps what was typed and offers `Thử lại` (2.2 · 5). */
function useSaver(): { state: SaveState; run: (job: () => Promise<unknown>) => Promise<boolean>; retry: () => void } {
  const [state, setState] = useState<SaveState>("idle");
  const lastFailed = useRef<(() => Promise<unknown>) | null>(null);
  const run = useCallback(async (job: () => Promise<unknown>): Promise<boolean> => {
    setState("saving");
    try {
      await job();
      lastFailed.current = null;
      setState("saved");
      return true;
    } catch (error) {
      logError("task-card", error);
      lastFailed.current = job;
      setState("error");
      return false;
    }
  }, []);
  const retry = useCallback((): void => {
    const job = lastFailed.current;
    if (job !== null) void run(job);
  }, [run]);
  return { state, run, retry };
}

/** Text saves when the box is left, or 800 ms after typing stops. */
function useIdleCommit(commit: () => void): { touch: () => void; flush: () => void } {
  const timer = useRef<number | null>(null);
  const latest = useRef(commit);
  latest.current = commit;
  const flush = useCallback((): void => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    latest.current();
  }, []);
  const touch = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      latest.current();
    }, 800);
  }, []);
  useEffect(() => () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      latest.current();
    }
  }, []);
  return { touch, flush };
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const label = saveLabel(state);
  if (label === null) return null;
  return (
    <span role="status" data-save-state={state} className={cn("flex shrink-0 items-center gap-1 text-[12px]", state === "error" ? "text-destructive" : "text-muted-foreground")}>
      {label}
      {state === "error" ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={onRetry} className="press font-medium underline underline-offset-2">
            Thử lại
          </button>
        </>
      ) : null}
    </span>
  );
}

/** ○ + the name, large. Tapping the circle finishes the task where that is allowed. */
function TitleRow({
  title,
  onTitle,
  onBlur,
  readOnly,
  isDone,
  onCircle,
  children,
}: {
  title: string;
  onTitle: (next: string) => void;
  onBlur?: () => void;
  readOnly: boolean;
  isDone: boolean;
  onCircle?: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [title]);
  return (
    <div data-card-row="title" className="flex items-start gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? "Đã xong" : "Đánh dấu xong"}
        disabled={onCircle === undefined}
        onClick={onCircle}
        className="press -ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-default"
      >
        {isDone ? (
          <CircleCheck className="h-[26px] w-[26px] fill-personal text-personal-foreground" strokeWidth={1.6} aria-hidden="true" />
        ) : (
          <Circle className="h-[26px] w-[26px] text-muted-foreground" strokeWidth={1.4} aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1 pt-1.5">
        <textarea
          ref={ref}
          lang="vi"
          spellCheck
          id="task-card-title"
          aria-label="Tên việc"
          rows={1}
          value={title}
          maxLength={200}
          readOnly={readOnly}
          placeholder="Việc cần làm là gì?"
          onChange={(event) => onTitle(event.target.value.replace(/\n/g, " "))}
          onKeyDown={(event) => {
            // Enter never sends; in a name it simply moves on.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={onBlur}
          className={cn(
            "block w-full resize-none overflow-hidden bg-transparent text-[21px] font-semibold leading-7 tracking-tight outline-none placeholder:text-muted-foreground/70",
            isDone ? "text-muted-foreground line-through" : "text-foreground",
          )}
        />
        {children}
      </div>
    </div>
  );
}

/** The Nguồn line: `Bảng Khách hàng › Cty Hoà Phát   Mở ›`. */
function SourceLine({ label, onOpen, openWord = "Mở ›", children }: { label: string; onOpen?: () => void; openWord?: string; children?: ReactNode }) {
  return (
    <div data-card-source="" className="mt-1">
      {onOpen !== undefined ? (
        <button type="button" onClick={onOpen} className="press flex min-h-8 w-full items-center gap-2 text-left text-[12.5px] text-muted-foreground hover:text-foreground">
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 font-medium text-foreground/80">{openWord}</span>
        </button>
      ) : (
        <p className="flex min-h-8 items-center text-[12.5px] text-muted-foreground">
          <span className="min-w-0 truncate">{label}</span>
        </p>
      )}
      {children}
    </div>
  );
}

type WhenDraft = { day: string; time: string; endTime: string };

/** Hiện diện, in the card: Tôi cần có mặt · Địa điểm · đi bao lâu · nhắc lên đường. */
function PresenceFields({
  readOnly,
  isOn,
  location,
  travelMinutes,
  reminderOffset,
  allowTravel,
  startIso,
  note,
  label,
  onChange,
}: {
  readOnly: boolean;
  isOn: boolean;
  location: string;
  travelMinutes: number | null;
  reminderOffset: number;
  allowTravel: boolean;
  startIso: string | null;
  note?: string;
  label: string;
  onChange: (next: { requiresPresence?: boolean; location?: string; travelMinutes?: number | null; reminderOffset?: number }, commit: boolean) => void;
}) {
  const departure = departureLine(startIso, travelMinutes, reminderOffset);
  return (
    <div className="space-y-3">
      {note !== undefined ? <p className="text-[12px] text-muted-foreground">{note}</p> : null}
      <label className="flex min-h-11 items-center justify-between gap-3 text-[14px] text-foreground">
        {label}
        <Switch
          checked={isOn}
          disabled={readOnly}
          onCheckedChange={(checked) => onChange({ requiresPresence: checked, travelMinutes: checked ? travelMinutes : null }, true)}
          aria-label="Cần có mặt trực tiếp"
        />
      </label>
      <input
        aria-label="Địa điểm hoặc link"
        value={location}
        readOnly={readOnly}
        maxLength={300}
        onChange={(event) => onChange({ location: event.target.value }, false)}
        onBlur={() => onChange({}, true)}
        placeholder="Địa điểm hoặc link họp"
        className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground md:text-[14px]"
      />
      {isOn && allowTravel ? (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">Thời gian di chuyển</p>
          <div className="flex flex-wrap gap-1.5">
            {TRAVEL_CHIPS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={readOnly}
                aria-pressed={travelMinutes === minutes}
                onClick={() => onChange({ travelMinutes: travelMinutes === minutes ? null : minutes }, true)}
                className={cn(
                  "press h-9 rounded-full border px-3 text-[13px] font-medium",
                  travelMinutes === minutes ? "border-personal bg-personal text-personal-foreground" : "border-border bg-card text-foreground",
                )}
              >
                {minutes} phút
              </button>
            ))}
          </div>
          {travelMinutes !== null ? (
            <>
              <p className="text-[12px] font-medium text-muted-foreground">Nhắc trước khi lên đường</p>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_CHIPS.map((chip) => (
                  <button
                    key={chip.minutes}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={reminderOffset === chip.minutes}
                    onClick={() => onChange({ reminderOffset: chip.minutes }, true)}
                    className={cn(
                      "press h-9 rounded-full border px-3 text-[13px] font-medium",
                      reminderOffset === chip.minutes ? "border-personal bg-personal text-personal-foreground" : "border-border bg-card text-foreground",
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              {departure !== null ? <p className="text-[13px] font-medium text-foreground">{departure}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function presenceLine(isOn: boolean, location: string, travelMinutes: number | null, startIso: string | null, reminderOffset: number): string | null {
  if (!isOn && location.trim() === "") return null;
  const parts: string[] = [];
  if (location.trim() !== "") parts.push(location.trim());
  if (isOn && travelMinutes !== null) parts.push(`đi ${travelMinutes} phút`);
  if (isOn && travelMinutes !== null && startIso !== null) {
    const leave = new Date(new Date(startIso).getTime() - (travelMinutes + reminderOffset) * 60_000);
    parts.push(`nhắc ${String(leave.getHours()).padStart(2, "0")}:${String(leave.getMinutes()).padStart(2, "0")}`);
  }
  if (isOn && parts.length === 0) parts.push("Có mặt trực tiếp");
  return parts.join(" · ");
}

type OpenRow = "reminder" | "when" | "repeat" | "presence" | null;

/**
 * Rows 2–10 in their fixed order (2.2 · 2). Each mode hands in what it can show; a row a mode
 * cannot have (Nhắc on a suggestion) is simply absent, never moved.
 */
function CardRows({
  readOnly,
  today,
  folds,
  openRow,
  setOpenRow,
  steps,
  myDay,
  reminder,
  when,
  repeat,
  presence,
  people,
  files,
  note,
}: {
  readOnly: boolean;
  today: string;
  folds: ReturnType<typeof useFolds>;
  openRow: OpenRow;
  setOpenRow: (row: OpenRow) => void;
  steps: { node: ReactNode; summary: string | null } | null;
  myDay: { label: string; isOn: boolean; disabled: boolean; onToggle: () => void } | null;
  reminder: { value: WhenDraft | null; set: (day: string, time: string) => void; clear: () => void } | null;
  when: { value: WhenDraft; minDay: string | null; set: (next: WhenDraft) => void };
  repeat: { value: TaskRecurrence; pattern: RecurrencePattern | null; set: (value: TaskRecurrence, pattern: RecurrencePattern | null) => void; disabledNote?: string } | null;
  presence: { node: ReactNode; summary: string | null; disabledNote: string | null } | null;
  people: { node: ReactNode; summary: string };
  files: { node: ReactNode; summary: string | null } | null;
  note: { value: string; onChange: (next: string) => void; onBlur: () => void };
}) {
  const noteKeyDown = useAutoList(note.onChange);
  const toggle = (row: OpenRow): void => setOpenRow(openRow === row ? null : row);
  const whenText = whenLine(when.value.day, when.value.time, when.value.endTime);
  const reminderText = reminder?.value === null || reminder === null ? null : whenLine(reminder.value.day, reminder.value.time);
  const repeatText = repeat === null ? null : repeatLine(repeat.value, repeat.pattern);
  const timeSummary = [whenText, reminderText !== null ? `nhắc ${reminderText}` : null].filter((part) => part !== null).join(" · ") || null;
  const title = (id: CardGroupId): string => CARD_GROUPS.find((group) => group.id === id)?.title ?? id;

  return (
    <>
      {steps !== null ? (
        <CardGroup id="steps" title={title("steps")} summary={steps.summary} isFolded={folds.folded.has("steps")} onToggle={() => folds.toggle("steps")}>
          {steps.node}
        </CardGroup>
      ) : null}

      <CardGroup id="time" title={title("time")} summary={timeSummary} isFolded={folds.folded.has("time")} onToggle={() => folds.toggle("time")}>
        {myDay !== null ? (
          <CardRow
            rowId="my-day"
            icon={<Sun className={ICON} strokeWidth={1.8} aria-hidden="true" />}
            label={myDay.label}
            tone={myDay.isOn ? "set" : "plain"}
            disabled={myDay.disabled || readOnly}
            onClick={myDay.onToggle}
          />
        ) : null}
        {reminder !== null ? (
          <CardRow
            rowId="reminder"
            icon={<Bell className={ICON} strokeWidth={1.8} aria-hidden="true" />}
            label="Nhắc tôi"
            value={reminderText}
            tone={reminderText === null ? "plain" : "set"}
            onClick={readOnly ? undefined : () => toggle("reminder")}
            isOpen={openRow === "reminder"}
            trailing={reminderText !== null && !readOnly ? <ClearButton label="Bỏ nhắc" onClick={reminder.clear} /> : undefined}
          >
            <InlineCalendar
              label="Chọn ngày nhắc"
              value={reminder.value?.day ?? ""}
              today={today}
              minDay={today}
              onPick={(day) => reminder.set(day, reminder.value?.time || "08:30")}
            >
              <InlineTime label="Giờ" value={reminder.value?.time ?? ""} allowClear={false} onChange={(time) => reminder.value !== null && reminder.set(reminder.value.day, time)} />
            </InlineCalendar>
          </CardRow>
        ) : null}
        <CardRow
          rowId="when"
          icon={<CalendarDays className={ICON} strokeWidth={1.8} aria-hidden="true" />}
          label="Ngày diễn ra"
          value={whenText !== null ? `${whenText}${openRow === "when" ? " · đang chọn" : ""}` : "Bắt buộc"}
          tone={whenText === null ? "plain" : "set"}
          onClick={readOnly ? undefined : () => toggle("when")}
          isOpen={openRow === "when"}
        >
          <InlineCalendar
            label="Chọn ngày diễn ra"
            value={when.value.day}
            today={today}
            minDay={when.minDay}
            onPick={(day) => {
              when.set({ ...when.value, day });
              setOpenRow(null);
            }}
          >
            <InlineTime label="Giờ" value={when.value.time} onChange={(time) => when.set({ ...when.value, time, endTime: time === "" ? "" : when.value.endTime })} />
            {when.value.time !== "" ? (
              <InlineTime label="Đến" value={when.value.endTime} after={when.value.time} onChange={(endTime) => when.set({ ...when.value, endTime })} />
            ) : null}
          </InlineCalendar>
        </CardRow>
        {repeat !== null ? (
          <CardRow
            rowId="repeat"
            icon={<Repeat className={ICON} strokeWidth={1.8} aria-hidden="true" />}
            label={repeatText ?? "Lặp lại"}
            value={repeat.disabledNote}
            tone={repeatText === null ? "empty" : "set"}
            disabled={repeat.disabledNote !== undefined}
            onClick={readOnly ? undefined : () => toggle("repeat")}
            isOpen={openRow === "repeat"}
          >
            <RepeatPicker value={repeat.value} pattern={repeat.pattern} onChange={repeat.set} />
          </CardRow>
        ) : null}
      </CardGroup>

      {presence !== null ? (
        <CardGroup id="presence" title={title("presence")} summary={presence.summary} isFolded={folds.folded.has("presence")} onToggle={() => folds.toggle("presence")}>
          <CardRow
            rowId="presence"
            icon={<MapPin className={ICON} strokeWidth={1.8} aria-hidden="true" />}
            label="Hiện diện"
            value={presence.disabledNote ?? presence.summary}
            tone={presence.summary === null ? "plain" : "set"}
            disabled={presence.disabledNote !== null}
            onClick={() => toggle("presence")}
            isOpen={openRow === "presence"}
            trailing={<ChevronDown className={cn("mr-2.5 h-4 w-4 text-muted-foreground transition-transform", openRow === "presence" && "rotate-180")} strokeWidth={1.8} aria-hidden="true" />}
          >
            {presence.node}
          </CardRow>
        </CardGroup>
      ) : null}

      <CardGroup id="people" title={title("people")} summary={people.summary} isFolded={folds.folded.has("people")} onToggle={() => folds.toggle("people")}>
        <div data-card-row="assign">{people.node}</div>
      </CardGroup>

      {files !== null ? (
        <CardGroup id="files" title={title("files")} summary={files.summary} isFolded={folds.folded.has("files")} onToggle={() => folds.toggle("files")}>
          <div data-card-row="files">{files.node}</div>
        </CardGroup>
      ) : null}

      <NoteField value={note.value} onChange={note.onChange} onBlur={note.onBlur} onKeyDown={noteKeyDown} readOnly={readOnly} />
    </>
  );
}

/** `Giao cho · Chỉ tôi` as one locked line (live tasks, suggestions). */
function LockedPeople({ label }: { label: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-3.5">
      <Users className={cn(ICON, "text-muted-foreground")} strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-foreground">Giao cho</span>
        <span className="block truncate text-[12px] text-muted-foreground">{label}</span>
      </span>
      <Lock className="mr-1 h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={1.8} aria-hidden="true" />
    </div>
  );
}

/** The panel every card lives in: full screen on a phone, a 460 px column on the right on a computer. */
function CardPanel({
  open,
  onOpenChange,
  backLabel,
  heading,
  description,
  status,
  menu,
  children,
  footer,
  modalOnDesktop = false,
  mode,
  embedded = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backLabel: string;
  heading: string;
  description: string;
  status?: ReactNode;
  menu?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  modalOnDesktop?: boolean;
  mode: "task" | "suggestion" | "create";
  embedded?: boolean;
}) {
  const isMobile = useIsMobile();
  const isModal = isMobile || modalOnDesktop;
  // Phone: a swipe from the left edge is `‹`; holding `‹` closes and goes back to the top of the tab (94B / 100 C).
  const edge = useEdgeSwipeBack(isMobile && !embedded ? () => onOpenChange(false) : undefined);
  const hold = useLongPress({
    onTap: () => onOpenChange(false),
    onHold: () => {
      onOpenChange(false);
      window.scrollTo({ top: 0 });
      document.querySelector("main")?.scrollTo({ top: 0 });
    },
  });
  if (embedded) {
    if (!open) return null;
    return (
      <section data-task-card={mode} data-card-embedded="" aria-label={heading} className="flex h-full min-h-0 flex-col bg-background">
        <div data-card-head="" className="flex min-h-[52px] shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={backLabel}
            className="press no-callout flex min-h-11 min-w-0 items-center gap-1 rounded-md px-2 text-[15px] text-foreground/80 hover:bg-accent/40"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="truncate">{backLabel}</span>
          </button>
          <span className="min-w-0 flex-1" />
          {status}
          {menu}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">{children}</div>
        {footer}
      </section>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={isModal}>
      <SheetContent
        side="right"
        backLabel={backLabel}
        data-task-card={mode}
        onPointerDown={edge.onPointerDown}
        onPointerUp={edge.onPointerUp}
        onPointerCancel={edge.onPointerCancel}
        onInteractOutside={(event) => {
          // Computer: the list beside the card stays usable (2.2 · 7).
          if (!isModal) event.preventDefault();
        }}
        className="flex w-full flex-col gap-0 bg-background p-0 pt-[env(safe-area-inset-top)] sm:max-w-none md:w-[460px] md:max-w-[460px] md:shadow-xl [&>button.absolute]:hidden"
      >
        <SheetTitle className="sr-only">{heading}</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        {/* One row: `‹ {nơi trước}` · Đang lưu / Đã lưu ✓ · ⋯ (· × on a computer). */}
        <div data-card-head="" className="flex min-h-[52px] shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <button
            type="button"
            {...hold}
            aria-label={backLabel}
            className="press no-callout flex min-h-11 min-w-0 items-center gap-1 rounded-md px-2 text-[15px] text-foreground/80 hover:bg-accent/40 md:hidden"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="truncate">{backLabel}</span>
          </button>
          <span className="hidden min-w-0 truncate px-2 text-[14px] text-muted-foreground md:block">{backLabel}</span>
          <span className="min-w-0 flex-1" />
          {status}
          {menu}
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press hidden h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground md:flex"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">{children}</div>
        {footer}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ live task */

function LiveTaskCard({ task, open, onOpenChange, today: todayProp, backLabel = "Nhiệm vụ", embedded = false }: TaskCardTaskProps) {
  if (task === null) return null;
  return <LiveTaskCardBody key={task.id} task={task} open={open} onOpenChange={onOpenChange} today={todayProp ?? todayIso()} backLabel={backLabel} embedded={embedded} />;
}

function LiveTaskCardBody({ task, open, onOpenChange, today, backLabel, embedded }: { task: TaskItem; open: boolean; onOpenChange: (open: boolean) => void; today: string; backLabel: string; embedded: boolean }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const folds = useFolds();
  const saver = useSaver();
  const { saveTaskEdit } = useComposerActions();
  const { togglePersonalDone, binPersonal, deleteShared, restoreShared, confirmShared, skipShared, markSharedDone, reviewSharedDone } = useTaskActions();
  const { nameOf, peerOf } = usePeopleNames();
  const flags = useTaskFlagIndex();
  const myDay = useMyDay();
  const { data: reminders } = useTaskReminders();
  const { data: suggestions } = useTaskSuggestions();
  const { data: travelPlans } = useMyTravelPlans();
  const projectIndex = useTaskProjectIndex();
  const closedShared = useClosedSharedTasks();
  const [openRow, setOpenRow] = useState<OpenRow>(null);
  const [isCompleteOpen, setIsCompleteOpen] = useState<boolean>(false);
  const [isMoreOpen, setIsMoreOpen] = useState<boolean>(false);
  const [isForwarding, setIsForwarding] = useState<boolean>(false);
  const [isLinkOpen, setIsLinkOpen] = useState<boolean>(false);
  const recordQuery = useTaskRecord(task.id);
  const linkedRecord = recordQuery.data ?? null;
  const { unlink } = useTaskLinkActions();

  const travel = travelOf(task, travelPlans);
  const start = localParts(task.startAt);
  const end = localParts(task.endAt);
  const [title, setTitle] = useState<string>(task.title);
  const [note, setNote] = useState<string>(task.description);
  const [when, setWhen] = useState<WhenDraft>({
    day: task.deadline ?? start?.day ?? "",
    time: start?.time ?? task.deadlineTime ?? "",
    endTime: end?.time ?? "",
  });
  const [presence, setPresence] = useState<{ requiresPresence: boolean; location: string; travelMinutes: number | null; reminderOffset: number }>({
    requiresPresence: task.requiresPresence,
    location: task.location ?? "",
    travelMinutes: travel.travelMinutes,
    reminderOffset: travel.reminderOffsetMinutes,
  });
  const [repeat, setRepeat] = useState<{ value: TaskRecurrence; pattern: RecurrencePattern | null }>({ value: task.recurrence, pattern: task.recurrencePattern });

  const isOwned = ownedTaskIds(suggestions ?? []).has(task.id);
  const isAssignee = task.assigneeId === userId;
  const shared = isSharedTask(task);
  const done = task.status === "done";
  const canAccept = canConfirmSharedTask(task, userId);
  const canEdit = canEditTask(task, userId) && (!isOwned || isAssignee) && !canAccept && !done;
  const readOnly = !canEdit;
  const showPrivate = !isOwned || isAssignee;
  const canClaimDone = canMarkSharedDone(task, userId);
  const canConfirmDone = canReviewSharedDone(task, userId);
  const canFinishOwn = !shared && task.creatorId === userId && !done && task.status !== "skipped";
  const goes = !shared || isTaskAssignee(task, userId);
  const owner = taskOwnership(task, userId, nameOf, peerOf);
  const target = taskContextTarget(task, projectIndex);
  const closedReason = closedShared.data?.get(task.id) ?? taskClosedReason(task, userId);
  const snapshot = task.contextSnapshot;
  const messageIds = useMemo(
    () => (snapshot?.selectedMessageIds ?? (snapshot?.originalMessageId != null ? [snapshot.originalMessageId] : [])),
    [snapshot],
  );

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

  const assignLabel: string =
    task.type === "personal"
      ? "Chỉ tôi"
      : isOwned && !isAssignee
        ? `${owner.line.replace(/^Giao /, "")} · đã đồng ý gợi ý của tôi`
        : owner.line.replace(/^Của tôi · từ (.+)$/, "Tôi · do $1 giao").replace(/^Của tôi$/, "Chỉ tôi").replace(/^Giao /, "");

  const startIso = when.time !== "" && when.day !== "" ? localInstant(when.day, when.time) : null;

  const valuesFrom = (next: { title?: string; note?: string; when?: WhenDraft; presence?: typeof presence }): ComposerValues => {
    const w = next.when ?? when;
    const p = next.presence ?? presence;
    const hasEvent = w.time !== "" && (w.endTime !== "" || p.requiresPresence || p.location.trim() !== "" || task.startAt !== null);
    return {
      title: (next.title ?? title).trim(),
      description: next.note ?? note,
      deadline: w.day,
      deadlineTime: w.time === "" ? null : w.time,
      startAt: hasEvent ? localInstant(w.day, w.time) : null,
      endAt: hasEvent && w.endTime !== "" ? localInstant(w.day, w.endTime) : null,
      location: hasEvent && p.location.trim() !== "" ? p.location.trim() : null,
      requiresPresence: hasEvent && p.requiresPresence,
      travelMinutes: hasEvent && p.requiresPresence && goes ? p.travelMinutes : null,
      reminderOffsetMinutes: p.reminderOffset,
    };
  };

  const save = (values: ComposerValues, parts: ("details" | "schedule")[]): void => {
    void saver.run(() => saveTaskEdit.mutateAsync({ task, values, parts }));
  };

  const commitTitle = (): void => {
    if (title.trim() === "" || title.trim() === task.title) return;
    save(valuesFrom({}), ["details"]);
  };
  const commitNote = (): void => {
    if (note === task.description) return;
    save(valuesFrom({}), ["details"]);
  };
  const titleCommit = useIdleCommit(commitTitle);
  const noteCommit = useIdleCommit(commitNote);

  const myReminder = (reminders ?? []).find((entry) => entry.taskId === task.id && !entry.isSent && new Date(entry.at).getTime() > Date.now()) ?? null;
  const reminderValue = myReminder === null ? null : (() => {
    const parts = localParts(myReminder.at);
    return parts === null ? null : { day: parts.day, time: parts.time, endTime: "" };
  })();

  const setReminder = (day: string, time: string): void => {
    const at = localInstant(day, time);
    if (at === null || userId === undefined) return;
    void saver.run(async () => {
      if (myReminder !== null) await deleteTaskReminder(myReminder.id);
      await createTaskReminderAt(task.id, userId, new Date(at), when.day || null, when.time === "" ? null : when.time, browserTimezone());
      await queryClient.invalidateQueries({ queryKey: taskReminderKeys.all });
    });
  };
  const clearReminder = (): void => {
    if (myReminder === null) return;
    void saver.run(async () => {
      await deleteTaskReminder(myReminder.id);
      await queryClient.invalidateQueries({ queryKey: taskReminderKeys.all });
    });
  };

  const option = myDayOption({ ...task, deadline: when.day || task.deadline }, today);
  const onToday = isOnMyDay(flags, task.id, today);
  const myDayRow =
    !owner.isMine || done
      ? null
      : option === "today-auto"
        ? { label: "Đã ở Hôm nay vì hạn hôm nay", isOn: true, disabled: true, onToggle: () => undefined }
        : option === "none"
          ? null
          : {
              label: onToday ? "Đã thêm vào Hôm nay" : "Thêm vào Hôm nay",
              isOn: onToday,
              disabled: myDay.isWorking,
              onToggle: () => (onToday ? myDay.remove(task.id) : myDay.add(task.id, today)),
            };

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
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Thử lại nhé."));
  };

  const remove = (): void => {
    const isPersonal = task.type === "personal";
    const run = isPersonal ? binPersonal.mutateAsync({ taskId: task.id, deleted: true }) : deleteShared.mutateAsync(task.id);
    void run
      .then(() => {
        toast.success("Đã chuyển vào Thùng rác", {
          action: {
            label: "Hoàn tác",
            onClick: () => void (isPersonal ? binPersonal.mutateAsync({ taskId: task.id, deleted: false }) : restoreShared.mutateAsync(task.id)),
          },
        });
        onOpenChange(false);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không xoá được."));
  };

  const forward = async (): Promise<void> => {
    if (user === undefined || user === null || task.outputValue === null) return;
    setIsForwarding(true);
    try {
      const conversationId = await forwardTaskOutputToJournal(user.id, task);
      toast.success("Đã chuyển vào Nhật ký.", { action: { label: "Mở", onClick: () => navigate(`/tin-nhan/${conversationId}`) } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không chuyển được vào Nhật ký.");
    } finally {
      setIsForwarding(false);
    }
  };

  const openContext = target === null ? undefined : () => {
    onOpenChange(false);
    navigate(contextLinkFromTasks(target.conversationId, task.id, window.location));
  };

  const stepsLine = useLiveStepsLine(showPrivate ? task.id : null);
  const filesLine = useLiveFilesLine(task.id, messageIds);
  const canDelete = canDeleteTask(task, userId, closedReason);
  const creatorName = task.creatorId === userId ? "bạn" : nameOf(task.creatorId);

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Tuỳ chọn nhiệm vụ" className="press flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => setIsMoreOpen((current) => !current)}>
          <Plus className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {isMoreOpen ? "Ẩn phần Thêm" : "Thêm (mang theo · kế hoạch)"}
        </DropdownMenuItem>
        {openContext !== undefined ? (
          <DropdownMenuItem onSelect={openContext}>
            <MessagesSquare className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Xem trong ngữ cảnh
          </DropdownMenuItem>
        ) : null}
        {task.sourceTransactionId ? (
          <DropdownMenuItem
            onSelect={() => {
              onOpenChange(false);
              navigate("/ket-sat/giao-dich?can_lam=den_han");
            }}
          >
            <Lock className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Mở trong Két sắt
          </DropdownMenuItem>
        ) : null}
        {done && task.outputValue !== null ? (
          <DropdownMenuItem disabled={isForwarding} onSelect={() => void forward()}>
            <BookOpen className="mr-2 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Kết quả vào Nhật ký
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const primary: { label: string; isWorking: boolean; onClick: () => void } | null = canClaimDone || canFinishOwn
    ? null
    : canConfirmDone
      ? { label: "Xác nhận xong", isWorking: reviewSharedDone.isPending, onClick: () => runStep(reviewSharedDone.mutateAsync(task.id), "Đã xác nhận hoàn thành.", true) }
      : null;

  const footer = (
    <div className="shrink-0 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      {canAccept ? (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => runStep(skipShared.mutateAsync({ taskId: task.id, silent: false }), "Đã từ chối.")}
            className="press h-11 flex-1 rounded-[10px] border border-border text-[14px] font-medium text-foreground hover:bg-secondary"
          >
            Từ chối
          </button>
          <button
            type="button"
            onClick={() => runStep(confirmShared.mutateAsync(task.id), "Đã đồng ý — việc này giờ là của bạn.")}
            disabled={confirmShared.isPending}
            className="press flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[14px] font-semibold text-primary-foreground disabled:opacity-60"
          >
            {confirmShared.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Đồng ý
          </button>
        </div>
      ) : primary !== null ? (
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.isWorking}
          className="press mb-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[14px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {primary.label}
        </button>
      ) : null}
      <div className="flex items-center gap-2">
        <p data-card-footer="" className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {footerLine(task.createdAt, creatorName, sourceLabel !== null ? sourceLabel.replace(/^Từ /, "từ ") : null)}
        </p>
        {canDelete ? (
          <button type="button" aria-label="Xoá nhiệm vụ" onClick={remove} className="press flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive">
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <CardPanel
      open={open}
      onOpenChange={onOpenChange}
      backLabel={backLabel}
      embedded={embedded}
      heading="Nhiệm vụ"
      description="Xem và sửa ngay tại đây; mỗi ô tự lưu."
      status={<SaveBadge state={saver.state} onRetry={saver.retry} />}
      menu={menu}
      footer={footer}
      mode="task"
    >
      <TitleRow
        title={title}
        readOnly={readOnly}
        isDone={done}
        onCircle={canFinishOwn || canClaimDone ? () => setIsCompleteOpen(true) : undefined}
        onTitle={(next) => {
          setTitle(next);
          titleCommit.touch();
        }}
        onBlur={titleCommit.flush}
      >
        {linkedRecord !== null ? (
          // PHẦN 3: once under a Hạng mục, that is where the task comes from — and where it opens.
          <div data-card-record="" className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SourceLine
                label={`${linkedRecord.path} › ${linkedRecord.recordTitle}`}
                onOpen={() => {
                  onOpenChange(false);
                  navigate(recordLink(linkedRecord.tableId, linkedRecord.recordId, task.id));
                }}
              />
            </div>
            {linkedRecord.canEdit && canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Tuỳ chọn Hạng mục" className="press mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => setIsLinkOpen(true)}>Đổi Hạng mục</DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      unlink.mutate(task.id, {
                        onSuccess: () => toast.success("Đã bỏ gắn khỏi Hạng mục."),
                        onError: (error) => toast.error(error.message),
                      })
                    }
                  >
                    Bỏ gắn
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : sourceLabel !== null ? (
          <SourceLine label={sourceLabel} onOpen={openContext} />
        ) : null}
        {linkedRecord === null && recordQuery.isSuccess && canEdit ? (
          <button
            type="button"
            data-card-link-chip=""
            onClick={() => setIsLinkOpen(true)}
            className="press mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/50 px-3 text-[12.5px] text-muted-foreground hover:border-foreground/50 hover:text-foreground"
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            Gắn vào Hạng mục
          </button>
        ) : null}
        {readOnly && !canAccept ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {isOwned && !isAssignee ? "Việc này đã thuộc về người nhận — bạn chỉ xem." : done ? "Đã xong." : "Bạn chỉ xem việc này."}
          </p>
        ) : canAccept ? (
          <p className="mt-1 text-[12px] font-medium text-foreground">{nameOf(task.creatorId)} gợi ý việc này cho bạn — đồng ý thì sửa được.</p>
        ) : null}
      </TitleRow>

      <CardRows
        readOnly={readOnly}
        today={today}
        folds={folds}
        openRow={openRow}
        setOpenRow={setOpenRow}
        steps={showPrivate ? { node: <LiveSteps taskId={task.id} canEdit={canEdit} />, summary: stepsLine } : null}
        myDay={myDayRow}
        reminder={showPrivate ? { value: reminderValue, set: setReminder, clear: clearReminder } : null}
        when={{
          value: when,
          minDay: null,
          set: (next) => {
            if (next.day === "") return;
            setWhen(next);
            save(valuesFrom({ when: next }), ["details", "schedule"]);
          },
        }}
        repeat={{
          value: repeat.value,
          pattern: repeat.pattern,
          set: (value, pattern) => {
            setRepeat({ value, pattern });
            void saver.run(async () => {
              await setTaskRecurrence(task.id, value, pattern);
              await queryClient.invalidateQueries({ queryKey: taskKeys.all });
            });
          },
        }}
        presence={{
          summary: presenceLine(presence.requiresPresence, presence.location, presence.travelMinutes, startIso, presence.reminderOffset),
          disabledNote: when.time === "" && !readOnly ? "Cần giờ ở Ngày diễn ra" : null,
          node: (
            <PresenceFields
              readOnly={readOnly}
              isOn={presence.requiresPresence}
              location={presence.location}
              travelMinutes={presence.travelMinutes}
              reminderOffset={presence.reminderOffset}
              allowTravel={goes}
              startIso={startIso}
              note={shared && !isOwned ? "Áp dụng cho cả hai" : undefined}
              label="Tôi cần có mặt"
              onChange={(patch, commit) => {
                const next = { ...presence, ...patch };
                setPresence(next);
                if (commit) save(valuesFrom({ presence: next }), ["schedule"]);
              }}
            />
          ),
        }}
        people={{ node: <LockedPeople label={assignLabel} />, summary: assignLabel }}
        files={{
          node: (
            <LiveFiles
              taskId={task.id}
              messageIds={messageIds}
              canEdit={canEdit}
              canRemove={(file) => file.uploadedBy === userId || task.creatorId === userId}
            />
          ),
          summary: filesLine,
        }}
        note={{
          value: note,
          onChange: (next) => {
            setNote(next);
            noteCommit.touch();
          },
          onBlur: noteCommit.flush,
        }}
      />

      {isMoreOpen ? (
        <section data-card-more="" aria-label="Thêm" className="mt-4 space-y-3">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Thêm</p>
          <TaskPrepPanel task={task} canEdit={canEdit} showPrivate={showPrivate} />
          {canEdit ? <TaskPlanFields task={task} /> : null}
        </section>
      ) : null}

      {canEdit ? <RecordPicker taskId={task.id} open={isLinkOpen} onOpenChange={setIsLinkOpen} /> : null}
      <TaskCompleteDialog
        task={task}
        open={isCompleteOpen}
        onOpenChange={setIsCompleteOpen}
        confirmLabel={canClaimDone ? "Báo xong" : "Hoàn thành"}
        isWorking={togglePersonalDone.isPending || markSharedDone.isPending}
        onComplete={complete}
      />
    </CardPanel>
  );
}

/* ------------------------------------------------------------------ suggestion (proposer) */

function SuggestionCard({ suggestion, assigneeName, open, onOpenChange }: TaskCardSuggestionProps) {
  if (suggestion === null) return null;
  return <SuggestionCardBody key={suggestion.id} suggestion={suggestion} assigneeName={assigneeName} open={open} onOpenChange={onOpenChange} />;
}

function SuggestionCardBody({ suggestion, assigneeName, open, onOpenChange }: { suggestion: TaskSuggestion; assigneeName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { edit } = useSuggestionActions();
  const folds = useFolds();
  const saver = useSaver();
  const today = todayIso();
  const [openRow, setOpenRow] = useState<OpenRow>(null);
  const start = localParts(suggestion.startAt);
  const end = localParts(suggestion.endAt);
  const [title, setTitle] = useState<string>(suggestion.title);
  const [note, setNote] = useState<string>(suggestion.description);
  const [when, setWhen] = useState<WhenDraft>({ day: suggestion.deadline, time: start?.time ?? suggestion.deadlineTime ?? "", endTime: end?.time ?? "" });
  const [presence, setPresence] = useState<{ requiresPresence: boolean; location: string }>({ requiresPresence: suggestion.requiresPresence, location: suggestion.location ?? "" });

  const write = (next: { title?: string; note?: string; when?: WhenDraft; presence?: typeof presence }): void => {
    const w = next.when ?? when;
    const p = next.presence ?? presence;
    const hasEvent = w.time !== "" && (w.endTime !== "" || p.requiresPresence || p.location.trim() !== "" || suggestion.startAt !== null);
    const values: ComposerValues = {
      title: (next.title ?? title).trim(),
      description: next.note ?? note,
      deadline: w.day,
      deadlineTime: w.time === "" ? null : w.time,
      startAt: hasEvent ? localInstant(w.day, w.time) : null,
      endAt: hasEvent && w.endTime !== "" ? localInstant(w.day, w.endTime) : null,
      location: hasEvent && p.location.trim() !== "" ? p.location.trim() : null,
      requiresPresence: hasEvent && p.requiresPresence,
      travelMinutes: null,
      reminderOffsetMinutes: 10,
    };
    if (values.title === "") return;
    void saver.run(() =>
      edit.mutateAsync({
        suggestionId: suggestion.id,
        draft: { title: values.title, description: values.description, deadline: values.deadline, deadlineTime: values.deadlineTime, event: eventOf(values) },
      }),
    );
  };
  const titleCommit = useIdleCommit(() => title.trim() !== suggestion.title && write({}));
  const noteCommit = useIdleCommit(() => note !== suggestion.description && write({}));
  const startIso = when.time !== "" ? localInstant(when.day, when.time) : null;

  return (
    <CardPanel
      open={open}
      onOpenChange={onOpenChange}
      backLabel="Quay lại"
      heading="Sửa gợi ý"
      description={`Chỉnh lời đề nghị trong khi ${assigneeName} chưa trả lời.`}
      status={<SaveBadge state={saver.state} onRetry={saver.retry} />}
      mode="suggestion"
    >
      <TitleRow
        title={title}
        readOnly={false}
        isDone={false}
        onTitle={(next) => {
          setTitle(next);
          titleCommit.touch();
        }}
        onBlur={titleCommit.flush}
      >
        <p className="mt-1 text-[12px] text-muted-foreground">Gợi ý cho {assigneeName} · chưa trả lời</p>
      </TitleRow>
      <CardRows
        readOnly={false}
        today={today}
        folds={folds}
        openRow={openRow}
        setOpenRow={setOpenRow}
        steps={null}
        myDay={null}
        reminder={null}
        when={{
          value: when,
          minDay: today,
          set: (next) => {
            if (next.day === "") return;
            setWhen(next);
            write({ when: next });
          },
        }}
        repeat={null}
        presence={{
          summary: presenceLine(presence.requiresPresence, presence.location, null, startIso, 10),
          disabledNote: when.time === "" ? "Cần giờ ở Ngày diễn ra" : null,
          node: (
            <PresenceFields
              readOnly={false}
              isOn={presence.requiresPresence}
              location={presence.location}
              travelMinutes={null}
              reminderOffset={10}
              allowTravel={false}
              startIso={startIso}
              label="Cần bạn có mặt"
              onChange={(patch, commit) => {
                const next = { requiresPresence: patch.requiresPresence ?? presence.requiresPresence, location: patch.location ?? presence.location };
                setPresence(next);
                if (commit) write({ presence: next });
              }}
            />
          ),
        }}
        people={{ node: <LockedPeople label={assigneeName} />, summary: assigneeName }}
        files={null}
        note={{
          value: note,
          onChange: (next) => {
            setNote(next);
            noteCommit.touch();
          },
          onBlur: noteCommit.flush,
        }}
      />
    </CardPanel>
  );
}

/* ------------------------------------------------------------------ create */

type CreateDraft = {
  title: string;
  when: WhenDraft;
  location: string;
  requiresPresence: boolean;
  travelMinutes: number | null;
  reminderOffset: number;
  description: string;
  steps: string[];
  myDay: boolean;
  reminder: WhenDraft | null;
  recurrence: TaskRecurrence;
  pattern: RecurrencePattern | null;
  files: File[];
};

function createdIdOf(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result !== null && typeof result === "object") {
    const record = result as { id?: unknown; acceptedTaskId?: unknown };
    if (typeof record.acceptedTaskId === "string") return record.acceptedTaskId;
    if (typeof record.id === "string") return record.id;
  }
  return null;
}

function QuickChip({ icon, label, isActive, onClick, ariaLabel }: { icon: ReactNode; label: string; isActive: boolean; onClick: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "press flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors",
        isActive ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-card text-foreground hover:bg-accent/50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CreateTaskCard(props: TaskCardCreateProps) {
  return props.open ? <CreateTaskCardBody {...props} /> : null;
}

function CreateTaskCardBody({
  open,
  onOpenChange,
  place,
  source = null,
  peerId = null,
  peerName = "",
  members = [],
  initial,
  allowTravel,
  onCreateMine,
  onPropose,
  onCreated,
  startWithEvent = false,
  startChoice,
  startExpanded = false,
}: TaskCardCreateProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const selfId = user?.id;
  const today = todayIso();
  const folds = useFolds();
  const applyExtras = useTaskExtras();
  const { isSubmitting, guard } = useSubmitGuard();
  const initialStart = localParts(initial?.startAt ?? null);
  const initialEnd = localParts(initial?.endAt ?? null);
  const [draft, setDraft] = useState<CreateDraft>(() => ({
    title: initial?.title ?? "",
    when: { day: initial?.deadline ?? "", time: initialStart?.time ?? initial?.deadlineTime ?? "", endTime: initialEnd?.time ?? "" },
    location: initial?.location ?? "",
    requiresPresence: initial?.requiresPresence ?? false,
    travelMinutes: initial?.travelMinutes ?? null,
    reminderOffset: initial?.reminderOffsetMinutes ?? 10,
    description: initial?.description ?? "",
    steps: [],
    myDay: false,
    reminder: null,
    recurrence: "none",
    pattern: null,
    files: [],
  }));
  const [choice, setChoice] = useState<RecipientChoice>(() => startChoice ?? initialChoice(place));
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(startExpanded || startWithEvent);
  const [openRow, setOpenRow] = useState<OpenRow>(startWithEvent ? "when" : null);
  // Giao cho is required where there is a choice, so the quick sheet shows it straight away.
  const [quickOpen, setQuickOpen] = useState<"date" | "people" | null>(() => (place !== "personal" && (startChoice ?? initialChoice(place)) === "none" ? "people" : null));
  const [isSourceOpen, setIsSourceOpen] = useState<boolean>(source?.defaultOpen ?? false);
  const patch = (part: Partial<CreateDraft>): void => setDraft((current) => ({ ...current, ...part }));

  const eligibleIds = useMemo(() => members.map((member) => member.userId), [members]);
  const nameOf = (userId: string): string => (userId === peerId ? peerName : memberName(members, userId, peerName || "Thành viên"));
  const recipients: Recipients = resolveRecipients({ place, choice, selfId, peerId, eligibleIds, pickedIds });
  const chosen = hasRecipients(recipients);
  const onlyMe = recipients.others.length === 0 && recipients.includesSelf;
  const hasChoices = place !== "personal";
  const travelAllowed = allowTravel ?? onlyMe;
  const copy = composerCopy({ place, recipients, peerName, nameOf });

  const missing: string[] = [];
  if (draft.title.trim() === "") missing.push("tên việc");
  if (draft.when.day === "") missing.push("ngày diễn ra");
  if (draft.requiresPresence && draft.when.time === "") missing.push("giờ ở Ngày diễn ra");
  // ADR-030: nobody chosen yet → no send button at all, only the line asking to choose.
  const missingText = chosen ? missingLine(missing) : copy.description;
  const canSubmit = chosen && missing.length === 0 && !isSubmitting;
  const startIso = draft.when.time !== "" && draft.when.day !== "" ? localInstant(draft.when.day, draft.when.time) : null;

  const values = (): ComposerValues | null => {
    const clean = validateTaskDraft(
      { title: draft.title, description: draft.description, deadline: draft.when.day, deadlineTime: draft.when.time },
      today,
    );
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return null;
    }
    const hasEvent = draft.when.time !== "" && (draft.when.endTime !== "" || draft.requiresPresence || draft.location.trim() !== "");
    const presence = hasEvent && draft.requiresPresence;
    const reminderAt = draft.reminder === null || draft.reminder.time === "" ? null : localInstant(draft.reminder.day, draft.reminder.time);
    return {
      title: clean.value.title,
      description: clean.value.description,
      deadline: clean.value.deadline,
      deadlineTime: clean.value.deadlineTime,
      startAt: hasEvent ? localInstant(draft.when.day, draft.when.time) : null,
      endAt: hasEvent && draft.when.endTime !== "" ? localInstant(draft.when.day, draft.when.endTime) : null,
      location: hasEvent && draft.location.trim() !== "" ? draft.location.trim() : null,
      requiresPresence: presence,
      travelMinutes: presence && travelAllowed ? draft.travelMinutes : null,
      reminderOffsetMinutes: draft.reminderOffset,
      extras: {
        steps: draft.steps,
        myDay: draft.myDay,
        reminderAt,
        recurrence: draft.recurrence,
        recurrencePattern: draft.pattern,
        files: draft.files,
      },
    };
  };

  const submit = async (): Promise<void> => {
    const clean = values();
    if (clean === null) return;
    let extrasError: Error | null = null;
    const result = await sendToRecipients({
      recipients,
      createMine: async () => {
        if (onCreateMine === undefined) throw new Error("Nơi này chưa tạo được việc cho bạn.");
        const created = await onCreateMine(clean);
        const id = createdIdOf(created);
        if (id !== null && selfId !== undefined) {
          try {
            await applyExtras(id, selfId, clean);
          } catch (error) {
            extrasError = error instanceof Error ? error : new Error("Chưa lưu đủ các phần thêm.");
          }
        }
      },
      proposeTo: async (assigneeId) => {
        if (onPropose === undefined) throw new Error("Nơi này chưa gửi được gợi ý.");
        await onPropose(assigneeId, { ...clean, extras: undefined });
      },
    });
    if (result.error !== null) {
      toast.error(composerPartialFailure(result.done, result.total, result.error.message));
      return;
    }
    toast.success(composerSuccess(recipients, nameOf));
    if (extrasError !== null) toast.error((extrasError as Error).message);
    onCreated?.(recipients);
    onOpenChange(false);
  };

  const appendNote = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    setDraft((current) => ({
      ...current,
      description: (current.description.trim() === "" ? trimmed : `${current.description.trim()}\n\n${trimmed}`).slice(0, 2000),
    }));
  };

  const peopleSummary = recipientSummary(recipients, choice, nameOf) ?? (place === "personal" ? "Chỉ tôi" : "Chưa chọn");
  const picker = (
    <div className="px-3.5 py-3">
      <RecipientPicker
        id="card-recipients"
        place={place}
        choice={choice}
        onChoice={setChoice}
        peerName={peerName}
        members={members}
        selfId={selfId}
        pickedIds={pickedIds}
        onPickedIds={setPickedIds}
        summary={recipientSummary(recipients, choice, nameOf)}
      />
    </div>
  );

  const sourceBlock =
    source !== null ? (
      <SourceLine label={source.label} openWord={isSourceOpen ? "Thu ‹" : "Xem ›"} onOpen={source.render !== undefined ? () => setIsSourceOpen((current) => !current) : undefined}>
        {isSourceOpen && source.render !== undefined ? (
          <div className="mt-1.5 rounded-[10px] border border-border bg-secondary/40 px-3 pb-3 pt-2.5">{source.render({ appendNote })}</div>
        ) : null}
      </SourceLine>
    ) : null;

  const titleRow = (
    <TitleRow title={draft.title} readOnly={false} isDone={false} onTitle={(title) => patch({ title })}>
      {sourceBlock}
    </TitleRow>
  );

  const full = (
    <>
      {titleRow}
      <CardRows
        readOnly={false}
        today={today}
        folds={folds}
        openRow={openRow}
        setOpenRow={setOpenRow}
        steps={{ node: <DraftSteps steps={draft.steps} onChange={(steps) => patch({ steps })} />, summary: draft.steps.length === 0 ? null : `0/${draft.steps.length}` }}
        myDay={onlyMe ? { label: draft.myDay ? "Đã thêm vào Hôm nay" : "Thêm vào Hôm nay", isOn: draft.myDay, disabled: false, onToggle: () => patch({ myDay: !draft.myDay }) } : null}
        reminder={onlyMe ? { value: draft.reminder, set: (day, time) => patch({ reminder: { day, time, endTime: "" } }), clear: () => patch({ reminder: null }) } : null}
        when={{ value: draft.when, minDay: today, set: (when) => patch({ when }) }}
        repeat={{
          value: draft.recurrence,
          pattern: draft.pattern,
          set: (recurrence, pattern) => patch({ recurrence, pattern }),
          disabledNote: onlyMe ? undefined : "Người nhận tự đặt khi đồng ý",
        }}
        presence={{
          summary: presenceLine(draft.requiresPresence, draft.location, draft.travelMinutes, startIso, draft.reminderOffset),
          disabledNote: draft.when.time === "" ? "Cần giờ ở Ngày diễn ra" : null,
          node: (
            <PresenceFields
              readOnly={false}
              isOn={draft.requiresPresence}
              location={draft.location}
              travelMinutes={draft.travelMinutes}
              reminderOffset={draft.reminderOffset}
              allowTravel={travelAllowed}
              startIso={startIso}
              label={onlyMe ? "Tôi cần có mặt" : "Cần bạn có mặt"}
              onChange={(next) =>
                patch({
                  ...(next.requiresPresence !== undefined ? { requiresPresence: next.requiresPresence } : {}),
                  ...(next.location !== undefined ? { location: next.location } : {}),
                  ...(next.travelMinutes !== undefined ? { travelMinutes: next.travelMinutes } : {}),
                  ...(next.reminderOffset !== undefined ? { reminderOffset: next.reminderOffset } : {}),
                })
              }
            />
          ),
        }}
        people={{ node: hasChoices ? picker : <LockedPeople label="Chỉ tôi" />, summary: peopleSummary }}
        files={{
          node: <DraftFiles files={draft.files} onChange={(files) => patch({ files })} disabledNote={recipients.includesSelf || !chosen ? null : "Người nhận tự thêm tệp khi đồng ý"} />,
          summary: draft.files.length === 0 ? null : `${draft.files.length} tệp`,
        }}
        note={{ value: draft.description, onChange: (description) => patch({ description }), onBlur: () => undefined }}
      />
    </>
  );

  const dateLabel = cardDay(draft.when.day);
  const quick = (
    <>
      {titleRow}
      <div className="mt-3 flex flex-wrap gap-2 pl-10">
        {onlyMe || !hasChoices ? (
          <QuickChip
            icon={<Sun className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            label="Hôm nay"
            isActive={draft.myDay}
            onClick={() => patch({ myDay: !draft.myDay })}
          />
        ) : null}
        <QuickChip
          icon={<CalendarDays className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
          label={dateLabel ?? "Ngày"}
          ariaLabel={`Ngày diễn ra: ${dateLabel ?? "chưa chọn"}`}
          isActive={dateLabel !== null}
          onClick={() => setQuickOpen(quickOpen === "date" ? null : "date")}
        />
        {hasChoices ? (
          <QuickChip
            icon={<Users className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            label={chosen ? peopleSummary : "Giao cho"}
            isActive={chosen}
            onClick={() => setQuickOpen(quickOpen === "people" ? null : "people")}
          />
        ) : (
          <QuickChip icon={<Users className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />} label="Chỉ tôi" isActive={false} onClick={() => undefined} />
        )}
      </div>
      {quickOpen === "date" ? (
        <div className="mt-3 rounded-[12px] border border-border bg-card p-3.5">
          <InlineCalendar
            label="Chọn ngày diễn ra"
            value={draft.when.day}
            today={today}
            minDay={today}
            onPick={(day) => {
              patch({ when: { ...draft.when, day } });
              setQuickOpen(null);
            }}
          />
        </div>
      ) : quickOpen === "people" ? (
        <div className="mt-3 rounded-[12px] border border-border bg-card">{picker}</div>
      ) : null}
      <button
        type="button"
        data-card-expand=""
        onClick={() => setIsExpanded(true)}
        className="press mx-auto mt-4 flex h-11 items-center gap-1 px-3 text-[14px] font-semibold text-personal"
      >
        Mở rộng
        <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </>
  );

  const footer = (
    <div className="shrink-0 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {missingText !== null ? (
        <p role="status" className="mb-2 text-[12.5px] text-muted-foreground">
          {missingText}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => onOpenChange(false)}
          className="press h-12 rounded-[10px] border border-border px-5 text-[15px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-40"
        >
          Huỷ
        </button>
        {copy.submitLabel !== null ? (
          <button
            type="button"
            data-card-submit=""
            disabled={!canSubmit}
            onClick={() => {
              if (canSubmit) void guard(submit);
            }}
            className="press flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {copy.submitLabel}
          </button>
        ) : null}
      </div>
    </div>
  );

  // Phone, quick: a sheet from below (màn 1). Expanded — or any computer — the full card (màn 2).
  if (isMobile && !isExpanded) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" data-task-card="create" data-card-size="quick" className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[18px] border-border bg-background p-0 [&>button:last-child]:hidden">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          <div className="flex items-center gap-2 px-4 pt-2">
            <SheetTitle className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">{copy.title}</SheetTitle>
            <SheetDescription className="sr-only">Thẻ nhiệm vụ mới: tên, ngày, người nhận; Mở rộng để thêm bước, nhắc, tệp.</SheetDescription>
            <button type="button" aria-label="Đóng" onClick={() => onOpenChange(false)} className="press flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
              <X className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
            {chosen ? <p data-card-copy="" className="mb-1 text-[12.5px] text-muted-foreground">{copy.description}</p> : null}
            {quick}
          </div>
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <CardPanel
      open={open}
      onOpenChange={onOpenChange}
      backLabel="Nhiệm vụ mới"
      heading={copy.title}
      description="Thẻ nhiệm vụ mới: đủ các dòng như khi sửa."
      footer={footer}
      modalOnDesktop
      mode="create"
    >
      {chosen ? <p data-card-copy="" className="mb-2 text-[12.5px] text-muted-foreground">{copy.description}</p> : null}
      {isExpanded ? full : quick}
    </CardPanel>
  );
}
