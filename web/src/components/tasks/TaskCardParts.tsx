import { ChevronDown, ChevronLeft, ChevronRight, Circle, CircleCheck, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { FadeIn } from "@/components/tasks/FadeIn";
import { formatFileSize } from "@/lib/attachments";
import {
  CARD_HOURS,
  CARD_MINUTES,
  CARD_REPEATS,
  minutesOf,
  monthTitle,
  monthWeeks,
  quickDays,
  type CardGroupId,
} from "@/lib/task-card";
import { nextChecklistPosition } from "@/lib/task-collab";
import { openTaskFile, useTaskFileActions, useTaskFiles, type TaskFile } from "@/lib/task-files";
import type { RecurrencePattern, TaskRecurrence } from "@/lib/task-schedule";
import { useChecklist, useChecklistActions } from "@/lib/use-task-collab";
import { cn } from "@/lib/utils";

/**
 * AVORA-104 · PHẦN 2 — the building blocks of the one task card (ADR-075). Every row is drawn by
 * these, so a card opened from the Nhiệm vụ tab, a Hạng mục or a chat reads exactly the same.
 */

const ICON = "h-[18px] w-[18px] shrink-0";

/** `CÁC BƯỚC ··· 1/2 ⌃` — a group that folds; folded, it keeps one line of summary on the right. */
export function CardGroup({
  id,
  title,
  summary,
  isFolded,
  onToggle,
  children,
}: {
  id: CardGroupId;
  title: string;
  summary?: string | null;
  isFolded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section data-card-group={id} aria-label={title} className="mt-3">
      <button
        type="button"
        aria-expanded={!isFolded}
        onClick={onToggle}
        className="press flex min-h-9 w-full items-center gap-2 px-1 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
        <span className="min-w-0 flex-1" />
        {summary !== null && summary !== undefined ? (
          <span data-group-summary="" className="tabular min-w-0 truncate text-[12px] text-muted-foreground">
            {summary}
          </span>
        ) : null}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !isFolded && "rotate-180")}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>
      {isFolded ? null : (
        <div className="overflow-hidden rounded-[12px] border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">{children}</div>
      )}
    </section>
  );
}

/**
 * One row: icon · label (+ the value under it) · whatever sits at the right. An empty row reads
 * faint; a set one carries the personal tone. Tapping it opens its editor in place, right below.
 */
export function CardRow({
  rowId,
  icon,
  label,
  value,
  tone = "plain",
  onClick,
  trailing,
  isOpen = false,
  disabled = false,
  children,
}: {
  rowId: string;
  icon: ReactNode;
  label: string;
  value?: string | null;
  tone?: "empty" | "plain" | "set";
  onClick?: () => void;
  trailing?: ReactNode;
  isOpen?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className={cn(tone === "set" ? "text-personal" : tone === "empty" ? "text-muted-foreground/70" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[15px] leading-5",
            tone === "set" ? "text-personal" : tone === "empty" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {label}
        </span>
        {value !== null && value !== undefined && value !== "" ? (
          <span className="tabular mt-0.5 block truncate text-[12px] leading-4 text-muted-foreground">{value}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <div data-card-row={rowId}>
      <div className="flex min-h-[52px] items-center">
        {onClick !== undefined ? (
          <button
            type="button"
            disabled={disabled}
            aria-expanded={children !== undefined ? isOpen : undefined}
            onClick={onClick}
            className="press flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-3.5 text-left disabled:cursor-default disabled:opacity-60"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-3.5">{body}</div>
        )}
        {trailing !== undefined ? <div className="flex shrink-0 items-center pr-1.5">{trailing}</div> : null}
      </div>
      {isOpen && children !== undefined ? <FadeIn className="px-3.5 pb-3.5">{children}</FadeIn> : null}
    </div>
  );
}

/** The small × that clears a row. */
export function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function Chip({ isActive, onClick, children, label }: { isActive: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "press h-9 rounded-full border px-3 text-[13px] font-medium transition-colors",
        isActive ? "border-personal bg-personal text-personal-foreground" : "border-border bg-card text-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 24 h clock in five-minute marks, drawn in the card (never a floating layer, 2.2 · 6).
 * `after`: only marks strictly later can be picked (an end time).
 */
export function InlineTime({
  label,
  value,
  onChange,
  after = null,
  allowClear = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  after?: string | null;
  allowClear?: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const floor = minutesOf(after);
  const [hour, minute] = value === "" ? ["", ""] : value.split(":");
  const [pendingHour, setPendingHour] = useState<string>(hour ?? "");
  const allowed = (h: string, m: string): boolean => floor === null || Number(h) * 60 + Number(m) > floor;

  return (
    <div data-inline-time={label}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`${label}: ${value === "" ? "chưa chọn" : value}`}
            aria-expanded={isOpen}
            onClick={() => {
              setPendingHour(hour ?? "");
              setIsOpen((current) => !current);
            }}
            className={cn(
              "press tabular h-9 min-w-[72px] rounded-[10px] border border-border bg-card px-3 text-[14px]",
              value === "" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {value === "" ? "--:--" : value}
          </button>
          {allowClear && value !== "" ? <ClearButton label={`Bỏ ${label.toLowerCase()}`} onClick={() => onChange("")} /> : null}
        </div>
      </div>
      {isOpen ? (
        <FadeIn className="mt-2 space-y-2">
          <div role="group" aria-label="Giờ" className="grid grid-cols-8 gap-1">
            {CARD_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={pendingHour === h}
                disabled={!allowed(h, "55")}
                onClick={() => setPendingHour(h)}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] disabled:opacity-30",
                  pendingHour === h ? "bg-personal text-personal-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary",
                )}
              >
                {h}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Phút" className="grid grid-cols-6 gap-1">
            {CARD_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={pendingHour === "" || !allowed(pendingHour, m)}
                aria-pressed={pendingHour === hour && minute === m}
                onClick={() => {
                  onChange(`${pendingHour}:${m}`);
                  setIsOpen(false);
                }}
                className={cn(
                  "press tabular h-9 rounded-md text-[13px] disabled:opacity-30",
                  pendingHour === hour && minute === m ? "bg-personal text-personal-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary",
                )}
              >
                :{m}
              </button>
            ))}
          </div>
        </FadeIn>
      ) : null}
    </div>
  );
}

/**
 * Lịch Avora inside the card (2.2 · 6): Hôm nay · Ngày mai · Tuần sau, a month, then the clock.
 * Tapping a day hands it back at once — the caller saves (or writes the draft) and folds this.
 */
export function InlineCalendar({
  value,
  today,
  onPick,
  minDay = null,
  label,
  children,
}: {
  value: string;
  today: string;
  onPick: (day: string) => void;
  /** Days before this cannot be picked (only when creating, 2.2 · 6). */
  minDay?: string | null;
  label: string;
  children?: ReactNode;
}) {
  const anchor = value !== "" ? value : today;
  const [view, setView] = useState<{ year: number; month: number }>(() => ({
    year: Number(anchor.slice(0, 4)),
    month: Number(anchor.slice(5, 7)) - 1,
  }));
  const weeks = useMemo(() => monthWeeks(view.year, view.month), [view]);
  const step = (delta: number): void =>
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  const isAllowed = (day: string): boolean => minDay === null || day >= minDay;

  return (
    <div data-inline-calendar="" role="group" aria-label={label} className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {quickDays(today).map((quick) => (
          <Chip key={quick.id} isActive={value === quick.day} onClick={() => isAllowed(quick.day) && onPick(quick.day)}>
            {quick.label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Tháng trước" onClick={() => step(-1)} className="press flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary">
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="text-[14px] font-semibold text-foreground">{monthTitle(view.year, view.month)}</span>
        <button type="button" aria-label="Tháng sau" onClick={() => step(1)} className="press flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary">
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {weeks.flat().map((day, index) =>
          day === null ? (
            <span key={`blank-${index}`} />
          ) : (
            <button
              key={day}
              type="button"
              data-card-day={day}
              disabled={!isAllowed(day)}
              aria-pressed={day === value}
              aria-label={day}
              onClick={() => onPick(day)}
              className={cn(
                "press tabular mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[14px] disabled:opacity-30",
                day === value
                  ? "bg-personal font-semibold text-personal-foreground"
                  : day === today
                    ? "font-semibold text-personal"
                    : "text-foreground hover:bg-secondary",
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          ),
        )}
      </div>
      {children !== undefined ? <div className="space-y-2 border-t border-border pt-2.5">{children}</div> : null}
    </div>
  );
}

/** Lặp lại: the six choices; Tuỳ chỉnh opens "mỗi N ngày / tuần / tháng". */
export function RepeatPicker({
  value,
  pattern,
  onChange,
}: {
  value: TaskRecurrence;
  pattern: RecurrencePattern | null;
  onChange: (next: TaskRecurrence, pattern: RecurrencePattern | null) => void;
}) {
  const custom = pattern ?? { interval: 2, frequency: "weekly" as const };
  return (
    <div className="space-y-2.5">
      <div role="group" aria-label="Lặp lại" className="flex flex-wrap gap-1.5">
        {CARD_REPEATS.map((entry) => (
          <Chip
            key={entry.id}
            isActive={value === entry.id}
            onClick={() => onChange(entry.id, entry.id === "custom" ? custom : null)}
          >
            {entry.label}
          </Chip>
        ))}
      </div>
      {value === "custom" ? (
        <div className="flex items-center gap-2 text-[14px] text-foreground">
          <span>Mỗi</span>
          <input
            inputMode="numeric"
            aria-label="Khoảng cách"
            value={String(custom.interval)}
            onChange={(event) => {
              const n = Number.parseInt(event.target.value.replace(/\D/g, "").slice(0, 3), 10);
              if (Number.isFinite(n) && n >= 1) onChange("custom", { ...custom, interval: n });
            }}
            className="h-10 w-16 rounded-[10px] border border-input bg-card px-2 text-center text-[16px] outline-none focus:border-muted-foreground md:text-[14px]"
          />
          {(["daily", "weekly", "monthly"] as const).map((frequency) => (
            <Chip key={frequency} isActive={custom.frequency === frequency} onClick={() => onChange("custom", { ...custom, frequency })}>
              {frequency === "daily" ? "ngày" : frequency === "weekly" ? "tuần" : "tháng"}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ghi chú: one bare box that grows with what is written. Enter is a new line. */
export function NoteField({
  value,
  onChange,
  onBlur,
  onKeyDown,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(96, node.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      lang="vi"
      spellCheck
      data-card-row="note"
      aria-label="Ghi chú"
      value={value}
      readOnly={readOnly}
      maxLength={2000}
      rows={3}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder="Ghi chú"
      className="mt-3 block w-full resize-none rounded-[12px] border border-border bg-card px-3.5 py-3 text-[16px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground md:text-[15px]"
    />
  );
}

function StepCircle({ done, label, onClick, disabled }: { done: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-default"
    >
      {done ? (
        <CircleCheck className="h-[22px] w-[22px] fill-personal text-personal-foreground" strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Circle className="h-[22px] w-[22px] text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
      )}
    </button>
  );
}

/** `＋ Thêm bước` — Enter or leaving the box adds it (a step is not a message). */
function AddStep({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState<string>("");
  const commit = (): void => {
    const clean = text.trim();
    if (clean === "") return;
    onAdd(clean.slice(0, 500));
    setText("");
  };
  return (
    <div className="flex min-h-[48px] items-center gap-1 pl-1 pr-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center text-personal">
        <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <input
        lang="vi"
        value={text}
        maxLength={500}
        aria-label="Thêm bước"
        placeholder="Thêm bước"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-personal md:text-[15px]"
      />
    </div>
  );
}

/** Các bước while creating: kept in the draft, written once the task exists. */
export function DraftSteps({ steps, onChange }: { steps: string[]; onChange: (next: string[]) => void }) {
  return (
    <>
      {steps.map((step, index) => (
        <div key={`${index}-${step}`} data-step="" className="flex min-h-[48px] items-center gap-1 pl-1 pr-1.5">
          <StepCircle done={false} label={step} onClick={() => undefined} disabled />
          <span className="min-w-0 flex-1 text-[15px] text-foreground">{step}</span>
          <ClearButton label={`Xoá bước ${step}`} onClick={() => onChange(steps.filter((_, at) => at !== index))} />
        </div>
      ))}
      <AddStep onAdd={(text) => onChange([...steps, text])} />
    </>
  );
}

function showError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Bạn thử lại nhé.");
}

/** Các bước of a live task: tick, add, remove — each saved as it happens. */
export function LiveSteps({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const { data } = useChecklist(taskId);
  const actions = useChecklistActions(taskId);
  const list = data ?? [];
  return (
    <>
      {list.map((item) => (
        <div key={item.id} data-step="" className="flex min-h-[48px] items-center gap-1 pl-1 pr-1.5">
          <StepCircle
            done={item.completed}
            label={item.content}
            disabled={!canEdit}
            onClick={() => actions.toggle.mutate({ itemId: item.id, completed: !item.completed }, { onError: showError })}
          />
          <span className={cn("min-w-0 flex-1 text-[15px]", item.completed ? "text-muted-foreground line-through" : "text-foreground")}>
            {item.content}
          </span>
          {canEdit ? (
            <button
              type="button"
              aria-label={`Xoá bước ${item.content}`}
              onClick={() => actions.remove.mutate(item.id, { onError: showError })}
              className="press flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <AddStep onAdd={(content) => actions.add.mutate({ content, position: nextChecklistPosition(list) }, { onError: showError })} />
      ) : list.length === 0 ? (
        <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Chưa có bước nào.</p>
      ) : null}
    </>
  );
}

function FileLine({ name, size, note, onOpen, onRemove }: { name: string; size: number; note: string | null; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <div data-task-file="" className="flex min-h-[48px] items-center gap-3 pl-3.5 pr-1.5">
      <FileText className={cn(ICON, "text-muted-foreground")} strokeWidth={1.7} aria-hidden="true" />
      <button type="button" onClick={onOpen} disabled={onOpen === undefined} className="press min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="block truncate text-[14.5px] text-foreground">{name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {formatFileSize(size)}
          {note !== null ? ` · ${note}` : ""}
        </span>
      </button>
      {onRemove !== undefined ? <ClearButton label={`Bỏ tệp ${name}`} onClick={onRemove} /> : <span className="w-2" />}
    </div>
  );
}

function PickFiles({ label, onPick, isWorking = false, disabled = false }: { label: string; onPick: (files: File[]) => void; isWorking?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        data-task-file-input=""
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onPick(files);
        }}
      />
      <button
        type="button"
        disabled={disabled || isWorking}
        onClick={() => ref.current?.click()}
        className="press flex min-h-[52px] w-full items-center gap-3 px-3.5 text-left text-[15px] text-muted-foreground disabled:opacity-60"
      >
        {isWorking ? <Loader2 className={cn(ICON, "animate-spin")} aria-hidden="true" /> : <Plus className={ICON} strokeWidth={2} aria-hidden="true" />}
        {label}
      </button>
    </>
  );
}

const MAX_BYTES = 25 * 1024 * 1024;

/** Tệp while creating: picked now, uploaded once the task exists. */
export function DraftFiles({ files, onChange, disabledNote = null }: { files: File[]; onChange: (next: File[]) => void; disabledNote?: string | null }) {
  return (
    <>
      {files.map((file, index) => (
        <FileLine key={`${file.name}-${index}`} name={file.name} size={file.size} note={null} onRemove={() => onChange(files.filter((_, at) => at !== index))} />
      ))}
      <PickFiles
        label={disabledNote ?? "Thêm tệp"}
        disabled={disabledNote !== null}
        onPick={(picked) => {
          const fit = picked.filter((file) => file.size <= MAX_BYTES && file.size > 0);
          if (fit.length < picked.length) toast.error("Có tệp quá lớn (tối đa 25 MB) hoặc trống — đã bỏ qua.");
          onChange([...files, ...fit]);
        }}
      />
    </>
  );
}

/** Tệp of a live task: its own files, then the source message's files marked `Từ tin nhắn`. */
export function LiveFiles({ taskId, messageIds, canEdit, canRemove }: { taskId: string; messageIds: readonly string[]; canEdit: boolean; canRemove: (file: TaskFile) => boolean }) {
  const { data } = useTaskFiles(taskId, messageIds);
  const { upload, remove } = useTaskFileActions(taskId);
  const open = (file: TaskFile): void => {
    void openTaskFile(file)
      .then((url) => window.open(url, "_blank", "noopener,noreferrer"))
      .catch(showError);
  };
  return (
    <>
      {(data ?? []).map((file) => (
        <FileLine
          key={`${file.origin}-${file.id}`}
          name={file.fileName}
          size={file.byteSize}
          note={file.origin === "message" ? "Từ tin nhắn" : null}
          onOpen={() => open(file)}
          onRemove={file.origin === "own" && canRemove(file) ? () => remove.mutate(file, { onError: showError }) : undefined}
        />
      ))}
      {canEdit ? (
        <PickFiles
          label="Thêm tệp"
          isWorking={upload.isPending}
          onPick={(files) => {
            void (async () => {
              for (const file of files) {
                try {
                  await upload.mutateAsync(file);
                } catch (error) {
                  showError(error);
                }
              }
            })();
          }}
        />
      ) : (data ?? []).length === 0 ? (
        <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Chưa có tệp.</p>
      ) : null}
    </>
  );
}
