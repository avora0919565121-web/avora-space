import { Bell, BellOff, Hourglass, Repeat, Star, X } from "lucide-react";
import { useMemo } from "react";

import { TimeField } from "@/components/tasks/TimeField";
import { cn } from "@/lib/utils";
import type { GuidanceKey } from "@/lib/guidance";
import { GUIDANCE_TEXT } from "@/lib/guidance";
import type { TaskCategory } from "@/lib/task-categories";
import {
  DURATION_PRESETS,
  durationPresetOf,
  formatDuration,
  parseDurationInput,
} from "@/lib/task-flags";
import type { TaskReminder } from "@/lib/task-reminders";
import { useGuidance } from "@/lib/use-task-flags";
import {
  DEFAULT_REMINDER_PRESET,
  feasibleReminderPresets,
  formatReminderAt,
  RECURRENCE_LABELS,
  reminderInstant,
  reminderPresetById,
  TASK_RECURRENCES,
  type ReminderPresetId,
  type TaskRecurrence,
} from "@/lib/task-schedule";
import { TASK_VIEW_LABELS, type TaskViewMode } from "@/lib/tasks";

const CONTROL_CLASS =
  "w-full rounded-[10px] border border-input bg-card px-3 text-[14px] text-foreground outline-none focus:border-muted-foreground";

function OptionalLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-muted-foreground">
      {children}
    </label>
  );
}

export type ScheduleDraft = {
  deadlineTime: string;
  categoryId: string | null;
  isImportant: boolean;
  /** This person's own estimate in minutes, or null for "not estimated". Never required. */
  durationMinutes: number | null;
  recurrence: TaskRecurrence;
  customInterval: number;
  customFrequency: "daily" | "weekly" | "monthly";
  reminder: ReminderPresetId | null;
};

export const emptyScheduleDraft: ScheduleDraft = {
  deadlineTime: "",
  categoryId: null,
  isImportant: false,
  durationMinutes: null,
  recurrence: "none",
  customInterval: 2,
  customFrequency: "weekly",
  reminder: DEFAULT_REMINDER_PRESET,
};

/**
 * An explanation shown until the person says they have read it.
 *
 * Dismissing is the whole point: a hint that cannot be turned off is read once and then
 * becomes part of the wallpaper, which is exactly when it stops working.
 */
export function GuidanceNote({ guidanceKey }: { guidanceKey: GuidanceKey }) {
  const { shouldShow, dismiss } = useGuidance();
  if (!shouldShow(guidanceKey)) return null;
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5">
      <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
        {GUIDANCE_TEXT[guidanceKey]}
      </p>
      <button
        type="button"
        onClick={() => dismiss(guidanceKey)}
        className="press shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        Đã hiểu
      </button>
    </div>
  );
}

/**
 * How long this person thinks the work will take them.
 *
 * Two quick answers come first because that is the honest resolution of most estimates — few
 * people know whether something is 40 or 55 minutes, and the heavy view only needs to know
 * which side of an hour it falls on. The exact box stays for whoever genuinely knows.
 */
export function DurationField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const preset = durationPresetOf(value);
  const exact = formatDuration(value);

  return (
    <div className="space-y-2">
      <OptionalLabel htmlFor={`${idPrefix}-duration-exact`}>
        Thời lượng dự kiến (không bắt buộc)
      </OptionalLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {DURATION_PRESETS.map((option) => {
          const active = preset === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(active ? null : option.minutes)}
              aria-pressed={active}
              className={cn(
                "press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
                active
                  ? "border-foreground/25 bg-accent text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent/40",
              )}
            >
              <Hourglass className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
        <div className="flex items-center gap-1.5">
          <input
            id={`${idPrefix}-duration-exact`}
            type="number"
            min={1}
            max={100000}
            inputMode="numeric"
            value={value === null ? "" : value}
            placeholder="phút"
            onChange={(event) => onChange(parseDurationInput(event.target.value))}
            className={cn(CONTROL_CLASS, "tabular h-9 w-[92px]")}
          />
          <span className="text-[12px] text-muted-foreground">phút</span>
        </div>
        {value !== null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="press flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Bỏ
          </button>
        ) : null}
      </div>
      {exact !== null ? (
        <p className="text-[12px] text-muted-foreground">Dự kiến {exact}</p>
      ) : null}
      <GuidanceNote guidanceKey="task_duration_field" />
    </div>
  );
}

/**
 * The optional half of the composer: a clock, a shelf, a nudge and a repeat rule.
 *
 * All of it is optional by design. A deadline is a day first and an hour only if the person
 * says so — forcing a time onto every errand would make the form heavier than the work.
 */
export function ScheduleFields({
  idPrefix,
  deadline,
  draft,
  categories,
  onPatch,
}: {
  idPrefix: string;
  /** Owned by the composer's required-fields block; read here only to size the reminder list. */
  deadline: string;
  draft: ScheduleDraft;
  categories: readonly TaskCategory[];
  onPatch: (part: Partial<ScheduleDraft>) => void;
}) {
  // Only offer nudges that can still happen: "1 ngày trước" on a task due tomorrow morning
  // would already be in the past, and the server refuses those outright.
  const presets = useMemo(
    () =>
      deadline === ""
        ? []
        : feasibleReminderPresets(deadline, draft.deadlineTime === "" ? null : draft.deadlineTime),
    [deadline, draft.deadlineTime],
  );

  const chosen = draft.reminder === null ? null : reminderPresetById(draft.reminder);
  const chosenIsPossible = chosen !== null && presets.some((preset) => preset.id === chosen.id);
  const firesAt =
    chosenIsPossible && deadline !== ""
      ? reminderInstant(chosen, deadline, draft.deadlineTime === "" ? null : draft.deadlineTime)
      : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <OptionalLabel htmlFor={`${idPrefix}-time`}>Giờ (không bắt buộc)</OptionalLabel>
          <TimeField
            id={`${idPrefix}-time`}
            value={draft.deadlineTime}
            onChange={(next) => onPatch({ deadlineTime: next })}
          />
        </div>

        <div>
          <OptionalLabel htmlFor={`${idPrefix}-category`}>Hạng mục</OptionalLabel>
          <select
            id={`${idPrefix}-category`}
            value={draft.categoryId ?? ""}
            onChange={(event) => onPatch({ categoryId: event.target.value === "" ? null : event.target.value })}
            className={cn(CONTROL_CLASS, "h-11")}
          >
            <option value="">Không phân loại</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <OptionalLabel htmlFor={`${idPrefix}-reminder`}>Nhắc trước</OptionalLabel>
          <div className="relative">
            {draft.reminder === null ? (
              <BellOff
                aria-hidden="true"
                strokeWidth={1.6}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
            ) : (
              <Bell
                aria-hidden="true"
                strokeWidth={1.6}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
            )}
            <select
              id={`${idPrefix}-reminder`}
              value={chosenIsPossible && draft.reminder !== null ? draft.reminder : ""}
              onChange={(event) =>
                onPatch({ reminder: event.target.value === "" ? null : (event.target.value as ReminderPresetId) })
              }
              disabled={deadline === ""}
              className={cn(CONTROL_CLASS, "h-11 pl-9 disabled:opacity-50")}
            >
              <option value="">Không nhắc</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          {firesAt !== null ? (
            <p className="mt-1 text-[12px] text-muted-foreground">Nhắc lúc {formatReminderAt(firesAt)}</p>
          ) : null}
        </div>

        <div>
          <OptionalLabel htmlFor={`${idPrefix}-recurrence`}>Lặp lại</OptionalLabel>
          <div className="relative">
            <Repeat
              aria-hidden="true"
              strokeWidth={1.6}
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <select
              id={`${idPrefix}-recurrence`}
              value={draft.recurrence}
              onChange={(event) => onPatch({ recurrence: event.target.value as TaskRecurrence })}
              className={cn(CONTROL_CLASS, "h-11 pl-9")}
            >
              {TASK_RECURRENCES.map((option) => (
                <option key={option} value={option}>
                  {RECURRENCE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {draft.recurrence === "custom" ? (
        <div className="flex items-end gap-2 rounded-[10px] border border-border bg-secondary/30 p-3">
          <div className="w-24">
            <OptionalLabel htmlFor={`${idPrefix}-interval`}>Mỗi</OptionalLabel>
            <input
              id={`${idPrefix}-interval`}
              type="number"
              min={1}
              max={99}
              value={draft.customInterval}
              onChange={(event) =>
                onPatch({ customInterval: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })
              }
              className={cn(CONTROL_CLASS, "h-10 tabular")}
            />
          </div>
          <div className="flex-1">
            <OptionalLabel htmlFor={`${idPrefix}-frequency`}>Đơn vị</OptionalLabel>
            <select
              id={`${idPrefix}-frequency`}
              value={draft.customFrequency}
              onChange={(event) =>
                onPatch({ customFrequency: event.target.value as "daily" | "weekly" | "monthly" })
              }
              className={cn(CONTROL_CLASS, "h-10")}
            >
              <option value="daily">ngày</option>
              <option value="weekly">tuần</option>
              <option value="monthly">tháng</option>
            </select>
          </div>
        </div>
      ) : null}

      <DurationField
        idPrefix={idPrefix}
        value={draft.durationMinutes}
        onChange={(minutes) => onPatch({ durationMinutes: minutes })}
      />

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onPatch({ isImportant: !draft.isImportant })}
          aria-pressed={draft.isImportant}
          className={cn(
            "press flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] transition-colors",
            draft.isImportant
              ? "border-task-important/40 bg-task-important/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent/40",
          )}
        >
          <Star
            aria-hidden="true"
            strokeWidth={1.8}
            className={cn("h-4 w-4", draft.isImportant && "fill-task-important text-task-important")}
          />
          {TASK_VIEW_LABELS.important}
        </button>
        <GuidanceNote guidanceKey="task_important_flag" />
        {draft.isImportant ? (
          <p className="text-[12px] leading-5 text-muted-foreground">
            Đánh dấu này là của riêng bạn — người kia không thấy và không bị ảnh hưởng. Nó không đẩy
            nhiệm vụ lên trước việc có hạn sớm hơn, chỉ phân định khi hai việc cùng một thời điểm.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A task's shelf, shown inline in the list. Small, coloured, never shouting. */
export function CategoryTag({ category }: { category: TaskCategory | undefined }) {
  if (category === undefined) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: category.color }}
      />
      {category.name}
    </span>
  );
}

/** The clock beside a deadline, when one was set. Tabular so a column of times lines up. */
export function TimeTag({ time }: { time: string | null }) {
  if (time === null) return null;
  return <span className="tabular text-[12px] text-muted-foreground">{time}</span>;
}

export function ImportantStar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <Star
      aria-label={TASK_VIEW_LABELS.important}
      strokeWidth={1.8}
      className="h-3.5 w-3.5 shrink-0 fill-task-important text-task-important"
    />
  );
}

/** The effort estimate beside a task, shown only once this person has made one. */
export function DurationTag({ minutes }: { minutes: number | null }) {
  const label = formatDuration(minutes);
  if (label === null) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
      <Hourglass className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Filter chips. An empty selection means "everything", which is the resting state. */
export function CategoryFilterBar({
  categories,
  selected,
  onToggle,
  onClear,
}: {
  categories: readonly TaskCategory[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {categories.map((category) => {
        const active = selected.includes(category.id);
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onToggle(category.id)}
            aria-pressed={active}
            className={cn(
              "press flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
              active
                ? "border-foreground/25 bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent/40",
            )}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            {category.name}
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="press flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          Bỏ lọc
        </button>
      ) : null}
    </div>
  );
}

/** Three ways to read the same list. Deadline is the default because it is the objective one. */
export function ViewModeSwitch({
  mode,
  onChange,
}: {
  mode: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  const modes: TaskViewMode[] = ["deadline", "relationship", "important", "heavy"];
  return (
    <div role="tablist" aria-label="Cách xem" className="flex items-center gap-1 rounded-[10px] border border-border bg-card p-1">
      {modes.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={mode === option}
          onClick={() => onChange(option)}
          className={cn(
            "press rounded-[7px] px-3 py-1.5 text-[13px] transition-colors",
            mode === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {TASK_VIEW_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * Reminders that have come due while the app is open.
 *
 * This is the honest limit of the feature: AVORA has no mail, SMS or push sender, so a
 * reminder is delivered here, in the page, and cannot reach a closed tab. The banner says so
 * rather than letting someone rely on a notification that will never arrive.
 */
export function ReminderBanner({
  due,
  titleFor,
  onDismiss,
}: {
  due: readonly TaskReminder[];
  titleFor: (taskId: string) => string | null;
  onDismiss: (reminderId: string) => void;
}) {
  if (due.length === 0) return null;
  return (
    <div className="space-y-2">
      {due.map((reminder) => {
        const title = titleFor(reminder.taskId);
        return (
          <div
            key={reminder.id}
            role="status"
            className="flex items-start gap-3 rounded-[10px] border border-task-important/40 bg-task-important/10 px-3 py-2.5"
          >
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-task-important" strokeWidth={1.8} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-foreground">Đến hẹn: {title ?? "một nhiệm vụ"}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Nhắc lúc {formatReminderAt(new Date(reminder.at))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(reminder.id)}
              className="press shrink-0 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-card hover:text-foreground"
            >
              Đã biết
            </button>
          </div>
        );
      })}
    </div>
  );
}
