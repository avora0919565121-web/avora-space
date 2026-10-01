import { CalendarClock, ChevronDown, FileText, Loader2, MapPin, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DateField } from "@/components/calendar/DateField";
import { DateRangeField } from "@/components/calendar/DateRangeField";
import { FadeIn } from "@/components/tasks/FadeIn";
import { RecipientPicker } from "@/components/tasks/RecipientPicker";
import { TimeField } from "@/components/tasks/TimeField";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { longDialogContentClass, longSheetContentClass } from "@/components/ui/long-dialog";
import { Switch } from "@/components/ui/switch";
import { useAutoList } from "@/hooks/use-auto-list";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { useAuth } from "@/lib/auth";
import { joinLocalDateTime, splitLocalDateTime } from "@/lib/date-field";
import type { GroupMember } from "@/lib/groups";
import {
  composerCopy,
  composerPartialFailure,
  composerSuccess,
  departureLine,
  eventSummary,
  fromLocalInput,
  hasRecipients,
  initialChoice,
  memberName,
  missingFields,
  missingLine,
  noteSummary,
  presenceSummary,
  recipientSummary,
  REMINDER_CHIPS,
  resolveRecipients,
  eventDurationLabel,
  eventEndFor,
  toLocalInput,
  TRAVEL_CHIPS,
  type ComposerPlace,
  type Recipients,
  type RecipientChoice,
} from "@/lib/task-composer";
import { todayIso, validateTaskDraft } from "@/lib/tasks";
import { sendToRecipients, type ComposerValues } from "@/lib/use-task-composer";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-muted-foreground";

/** The one line at the top that says where the task came from, and opens to show it. */
export type ComposerSource = {
  label: string;
  /** What opens under the line. Receives a way to drop text into Ghi chú (paste). */
  render?: (api: { appendNote: (text: string) => void }) => ReactNode;
  defaultOpen?: boolean;
};

export type ComposerMode = "create" | "edit-task" | "edit-suggestion";

export type TaskComposerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ComposerMode;
  place: ComposerPlace;
  source?: ComposerSource | null;
  /** 1-1: the other person. */
  peerId?: string | null;
  peerName?: string;
  /** Group / project: members the server lets this person reach (task_recipient_ids). */
  members?: readonly GroupMember[];
  /** Starting values: a Hạng mục title, a suggestion being edited, a task being edited. */
  initial?: Partial<ComposerValues>;
  /** Edit modes: the settled receiver, shown locked. */
  lockedRecipientLabel?: string;
  /** Under "Hiện diện" for a shared task both sides edit: "Áp dụng cho cả hai". */
  presenceNote?: string;
  /** Whether this person may set travel (they are the one who goes). */
  allowTravel?: boolean;
  /** Create: the author's own task. */
  onCreateMine?: (values: ComposerValues) => Promise<void>;
  /** Create: one suggestion for one other person. */
  onPropose?: (assigneeId: string, values: ComposerValues) => Promise<void>;
  /** Edit modes. */
  onSave?: (values: ComposerValues) => Promise<void>;
  /** Called after a successful create, with who received it. */
  onCreated?: (recipients: Recipients) => void;
};

type Draft = {
  title: string;
  deadline: string;
  deadlineTime: string;
  startAt: string;
  endAt: string;
  location: string;
  requiresPresence: boolean;
  travelMinutes: number | null;
  reminderOffset: number;
  description: string;
};

function draftFrom(initial: Partial<ComposerValues> | undefined): Draft {
  return {
    title: initial?.title ?? "",
    deadline: initial?.deadline ?? "",
    deadlineTime: initial?.deadlineTime ?? "",
    startAt: toLocalInput(initial?.startAt ?? null),
    endAt: toLocalInput(initial?.endAt ?? null),
    location: initial?.location ?? "",
    requiresPresence: initial?.requiresPresence ?? false,
    travelMinutes: initial?.travelMinutes ?? null,
    reminderOffset: initial?.reminderOffsetMinutes ?? 10,
    description: initial?.description ?? "",
  };
}

/**
 * The one task form (ADR-030). Every place that creates or edits a task opens this, in the same
 * order with the same words — only the Nguồn line and the Giao cho choices differ.
 *
 * Nguồn → Giao cho → Tên việc → Hạn → Sự kiện · Hiện diện · Ghi chú (folded) → Huỷ / gửi,
 * with the buttons pinned to the bottom so they are never scrolled away.
 */
export function TaskComposer(props: TaskComposerProps) {
  const isMobile = useIsMobile();
  const { open, onOpenChange } = props;

  const body = <ComposerBody key={open ? "open" : "closed"} {...props} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(longSheetContentClass, "rounded-t-[18px] border-border bg-card pb-0 [&>button:last-child]:hidden")}
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(longDialogContentClass, "max-w-[540px] rounded-xl border-border bg-card")}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

function ComposerBody({
  onOpenChange,
  mode = "create",
  place,
  source = null,
  peerId = null,
  peerName = "",
  members = [],
  initial,
  lockedRecipientLabel,
  presenceNote,
  allowTravel,
  onCreateMine,
  onPropose,
  onSave,
  onCreated,
}: TaskComposerProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const selfId = user?.id;
  const today = todayIso();
  const { isSubmitting, guard } = useSubmitGuard();
  const isEdit = mode !== "create";

  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [choice, setChoice] = useState<RecipientChoice>(() => (isEdit ? "me" : initialChoice(place)));
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [isSourceOpen, setIsSourceOpen] = useState<boolean>(source?.defaultOpen ?? false);
  const [openBlock, setOpenBlock] = useState<Record<"event" | "presence" | "note", boolean>>(() => ({
    event: isEdit && (initial?.startAt ?? null) !== null,
    presence: isEdit && (initial?.requiresPresence ?? false),
    note: isEdit && (initial?.description ?? "").trim() !== "",
  }));
  const [customTravel, setCustomTravel] = useState<string>("");
  // AVORA-53 · 4.2 / 4.3: own-task extras. `remind` stays "auto" until touched: none without a time, 10′ with one.
  const [remind, setRemind] = useState<number | null | "auto">("auto");
  const [isImportant, setIsImportant] = useState<boolean>(false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);

  const patch = (part: Partial<Draft>): void => setDraft((current) => ({ ...current, ...part }));
  const noteKeyDown = useAutoList((next) => patch({ description: next }));

  const eligibleIds = useMemo(() => members.map((member) => member.userId), [members]);
  const nameOf = (userId: string): string =>
    userId === peerId ? peerName : memberName(members, userId, peerName || "Thành viên");

  const recipients: Recipients = isEdit
    ? mode === "edit-task"
      ? { includesSelf: true, others: [] }
      : { includesSelf: false, others: ["__locked__"] }
    : resolveRecipients({ place, choice, selfId, peerId, eligibleIds, pickedIds });
  const chosen = hasRecipients(recipients);
  const onlyMe = recipients.others.length === 0 && recipients.includesSelf;
  const travelAllowed = allowTravel ?? (!isEdit && onlyMe);
  /** Reminders and the private reading belong to whoever does the work: only on one's own new task. */
  const showOwnExtras = !isEdit && onlyMe;
  const effectiveRemind: number | null = remind === "auto" ? (draft.deadlineTime === "" ? null : 10) : remind;

  const copy = isEdit
    ? {
        title: mode === "edit-task" ? "Sửa nhiệm vụ" : "Sửa gợi ý",
        description:
          mode === "edit-task"
            ? "Chỉnh theo cách của bạn."
            : `Chỉnh lời đề nghị trong khi ${lockedRecipientLabel ?? "người kia"} chưa trả lời.`,
        submitLabel: "Lưu thay đổi",
      }
    : composerCopy({ place, recipients, peerName, nameOf });

  const missing = missingFields({
    title: draft.title,
    deadline: draft.deadline,
    startAt: draft.startAt,
    endAt: draft.endAt,
    location: draft.location,
    requiresPresence: draft.requiresPresence,
  });
  const missingText = chosen ? missingLine(missing) : null;
  const canSubmit = chosen && missing.length === 0 && !isSubmitting;

  const startIso = fromLocalInput(draft.startAt);
  const hasStart = startIso !== null;
  const eventLine = eventSummary(startIso, fromLocalInput(draft.endAt), draft.location.trim() || null);
  const presenceLine = presenceSummary(draft.requiresPresence && hasStart, startIso, travelAllowed ? draft.travelMinutes : null, draft.reminderOffset);
  const noteLine = noteSummary(draft.description);
  const firstOtherName = recipients.others.length === 1 && !isEdit ? nameOf(recipients.others[0]) : lockedRecipientLabel ?? "người nhận";

  // Leaving presence with no start would be refused; keep the two in step.
  useEffect(() => {
    if (!hasStart && draft.requiresPresence) patch({ requiresPresence: false, travelMinutes: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStart]);

  const values = (): ComposerValues | null => {
    const clean = validateTaskDraft(
      { title: draft.title, description: draft.description, deadline: draft.deadline, deadlineTime: draft.deadlineTime },
      today,
    );
    if (!clean.value) {
      toast.error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
      return null;
    }
    const presence = hasStart && draft.requiresPresence;
    return {
      title: clean.value.title,
      description: clean.value.description,
      deadline: clean.value.deadline,
      deadlineTime: clean.value.deadlineTime,
      startAt: startIso,
      endAt: hasStart ? fromLocalInput(draft.endAt) : null,
      location: hasStart && draft.location.trim() !== "" ? draft.location.trim() : null,
      requiresPresence: presence,
      travelMinutes: presence && travelAllowed ? draft.travelMinutes : null,
      reminderOffsetMinutes: draft.reminderOffset,
      ...(showOwnExtras
        ? { remindBeforeMinutes: effectiveRemind, isImportant, durationMinutes }
        : {}),
    };
  };

  const submit = async (): Promise<void> => {
    const clean = values();
    if (clean === null) return;
    if (isEdit) {
      try {
        await onSave?.(clean);
        toast.success(mode === "edit-task" ? "Đã lưu thay đổi." : "Đã lưu gợi ý mới.");
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không lưu được. Vui lòng thử lại.");
      }
      return;
    }
    const result = await sendToRecipients({
      recipients,
      createMine: async () => {
        if (onCreateMine === undefined) throw new Error("Nơi này chưa tạo được việc cho bạn.");
        await onCreateMine(clean);
      },
      proposeTo: async (assigneeId) => {
        if (onPropose === undefined) throw new Error("Nơi này chưa gửi được gợi ý.");
        await onPropose(assigneeId, clean);
      },
    });
    if (result.error !== null) {
      toast.error(composerPartialFailure(result.done, result.total, result.error.message));
      return;
    }
    toast.success(composerSuccess(recipients, nameOf));
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
    setOpenBlock((current) => ({ ...current, note: true }));
  };

  const toggleBlock = (block: "event" | "presence" | "note"): void =>
    setOpenBlock((current) => ({ ...current, [block]: !current[block] }));

  const clearEvent = (): void => {
    patch({ startAt: "", endAt: "", location: "", requiresPresence: false, travelMinutes: null });
    setOpenBlock((current) => ({ ...current, event: false, presence: false }));
  };

  const Title = isMobile ? SheetTitle : DialogTitle;
  const Description = isMobile ? SheetDescription : DialogDescription;
  const start = splitLocalDateTime(draft.startAt);
  const end = splitLocalDateTime(draft.endAt);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void guard(submit);
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 pb-3.5 pt-5 sm:px-6">
        <div className="min-w-0">
          <Title className="text-[20px] font-semibold tracking-tight text-foreground">{copy.title}</Title>
          <Description className="mt-1 text-[13px] leading-5 text-muted-foreground">{copy.description}</Description>
        </div>
        <button
          type="button"
          aria-label="Đóng"
          disabled={isSubmitting}
          onClick={() => onOpenChange(false)}
          className="press -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
        >
          <X className="h-5 w-5" strokeWidth={1.6} />
        </button>
      </div>

      {/* Scrolls inside the box; the footer never moves. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
        {source !== null ? (
          <div className="rounded-[10px] border border-border bg-secondary/40">
            <button
              type="button"
              aria-expanded={isSourceOpen}
              disabled={source.render === undefined}
              onClick={() => setIsSourceOpen((current) => !current)}
              className="press flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] disabled:cursor-default"
            >
              <span className="text-muted-foreground">Nguồn ·</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{source.label}</span>
              {source.render !== undefined ? (
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isSourceOpen && "rotate-180")}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : null}
            </button>
            {isSourceOpen && source.render !== undefined ? (
              <FadeIn className="border-t border-border px-3 pb-3 pt-2.5">{source.render({ appendNote })}</FadeIn>
            ) : null}
          </div>
        ) : null}

        <RecipientPicker
          id="composer-recipients"
          place={place}
          choice={choice}
          onChoice={setChoice}
          peerName={peerName}
          members={members}
          selfId={selfId}
          pickedIds={pickedIds}
          onPickedIds={setPickedIds}
          summary={isEdit ? null : recipientSummary(recipients, choice, nameOf)}
          lockedLabel={isEdit ? (lockedRecipientLabel ?? "Chỉ bạn") : undefined}
        />

        <div>
          <label htmlFor="composer-title" className="mb-1 block text-[12px] font-medium text-muted-foreground">
            Tên việc
          </label>
          <input
            id="composer-title"
            value={draft.title}
            maxLength={200}
            autoFocus={!isMobile}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Việc cần làm là gì?"
            className={cn(FIELD, "h-12")}
          />
        </div>

        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="composer-deadline" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Hạn
            </label>
            <DateField
              id="composer-deadline"
              value={draft.deadline}
              onChange={(day) => patch({ deadline: day })}
              label="Hạn hoàn thành"
              title="Chọn ngày hạn"
              required
              allow="future"
              min={today}
            />
          </div>
          <div className="w-[128px] shrink-0">
            <label htmlFor="composer-time" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Giờ
            </label>
            <TimeField id="composer-time" value={draft.deadlineTime} onChange={(next) => patch({ deadlineTime: next })} />
          </div>
        </div>

        {showOwnExtras ? (
          <div className="space-y-3">
            {/* AVORA-53 · 4.3: a reminder for every task, not only for an Event with presence. */}
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Nhắc</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nhắc">
                {REMIND_CHOICES.map((option) => (
                  <Chip key={option.label} isActive={effectiveRemind === option.minutes} onClick={() => setRemind(option.minutes)}>
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>
            {/* AVORA-53 · 4.2: what the Quan trọng and Theo độ nặng views read. Only you see it. */}
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Kế hoạch · chỉ bạn thấy</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip isActive={isImportant} onClick={() => setIsImportant((current) => !current)}>
                  ★ Quan trọng
                </Chip>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                {DURATION_CHOICES.map((option) => (
                  <Chip
                    key={option.minutes}
                    isActive={durationMinutes === option.minutes}
                    onClick={() => setDurationMinutes((current) => (current === option.minutes ? null : option.minutes))}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
          {/* Sự kiện */}
          <FoldRow
            label="Sự kiện"
            icon={<CalendarClock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            summary={eventLine}
            isOpen={openBlock.event}
            onToggle={() => toggleBlock("event")}
          >
            <DateRangeField
              id="composer-event"
              from={start.date}
              to={end.date === "" ? start.date : end.date}
              label="Thời gian sự kiện"
              title="Chọn ngày sự kiện"
              allow="any"
              onChange={(range) => {
                const nextStart = joinLocalDateTime(range.from, start.time);
                const candidate = draft.endAt === "" ? "" : joinLocalDateTime(range.to, end.time, start.time || "09:00");
                patch({
                  startAt: nextStart,
                  endAt:
                    candidate !== "" && candidate > nextStart
                      ? candidate
                      : eventEndFor(nextStart, draft.startAt, draft.endAt),
                });
              }}
              times={{
                start: start.time,
                end: end.time,
                // Same-day Event: an end before the start cannot be picked (Đợt gộp 2 · A12).
                endAfterStart: end.date === "" || end.date === start.date,
                durationLabel: eventDurationLabel(draft.startAt, draft.endAt),
                onChange: (next) => {
                  // No day yet: the Event's day defaults to the deadline's (or today).
                  const day = start.date !== "" ? start.date : draft.deadline !== "" ? draft.deadline : today;
                  const nextStart = joinLocalDateTime(day, next.start);
                  if (next.start !== start.time || start.date === "") {
                    // A new start: +60 min with no valid end, else the same length.
                    patch({ startAt: nextStart, endAt: eventEndFor(nextStart, draft.startAt, draft.endAt) });
                    return;
                  }
                  if (next.end === "") {
                    patch({ startAt: nextStart, endAt: "" });
                    return;
                  }
                  const nextEnd = joinLocalDateTime(end.date === "" ? day : end.date, next.end);
                  patch({ startAt: nextStart, endAt: nextEnd > nextStart ? nextEnd : eventEndFor(nextStart, "", "") });
                },
              }}
            />
            <div className="mt-3">
              <label htmlFor="composer-location" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Địa điểm hoặc link
              </label>
              <input
                id="composer-location"
                value={draft.location}
                maxLength={300}
                onChange={(event) => patch({ location: event.target.value })}
                placeholder="Văn phòng, quán cà phê, hoặc link họp"
                className={cn(FIELD, "h-11 text-[14px]")}
              />
            </div>
            {draft.startAt !== "" || draft.location !== "" ? (
              <button
                type="button"
                onClick={clearEvent}
                className="press mt-2.5 text-[12.5px] font-medium text-muted-foreground hover:text-destructive"
              >
                Bỏ sự kiện
              </button>
            ) : null}
          </FoldRow>

          {/* Hiện diện */}
          <FoldRow
            label="Hiện diện"
            icon={<MapPin className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            summary={presenceLine}
            isOpen={openBlock.presence && hasStart}
            disabledNote={hasStart ? null : "Cần giờ bắt đầu của Sự kiện"}
            onToggle={() => toggleBlock("presence")}
          >
            {presenceNote !== undefined ? <p className="mb-2 text-[12px] text-muted-foreground">{presenceNote}</p> : null}
            <label className="flex min-h-11 items-center justify-between gap-3 text-[14px] text-foreground">
              {onlyMe || mode === "edit-task" ? "Tôi cần có mặt" : "Cần bạn có mặt"}
              <Switch
                checked={draft.requiresPresence}
                onCheckedChange={(checked) => patch({ requiresPresence: checked, travelMinutes: checked ? draft.travelMinutes : null })}
                aria-label="Cần có mặt trực tiếp"
              />
            </label>

            {draft.requiresPresence && !travelAllowed && draft.location.trim() === "" ? (
              <div className="mt-2">
                <label htmlFor="composer-presence-location" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                  Địa điểm
                </label>
                <input
                  id="composer-presence-location"
                  value={draft.location}
                  maxLength={300}
                  onChange={(event) => patch({ location: event.target.value })}
                  placeholder={`Ghi địa điểm để ${firstOtherName} khỏi phải hỏi lại`}
                  className={cn(FIELD, "h-11 text-[14px]")}
                />
              </div>
            ) : null}

            {draft.requiresPresence && travelAllowed ? (
              <div className="mt-2 space-y-3">
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Thời gian di chuyển</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TRAVEL_CHIPS.map((minutes) => (
                      <Chip
                        key={minutes}
                        isActive={draft.travelMinutes === minutes}
                        onClick={() => patch({ travelMinutes: draft.travelMinutes === minutes ? null : minutes })}
                      >
                        {minutes} phút
                      </Chip>
                    ))}
                    <input
                      inputMode="numeric"
                      aria-label="Số phút khác"
                      value={customTravel}
                      onChange={(event) => {
                        const raw = event.target.value.replace(/\D/g, "").slice(0, 4);
                        setCustomTravel(raw);
                        const minutes = Number.parseInt(raw, 10);
                        patch({ travelMinutes: Number.isFinite(minutes) && minutes <= 1440 ? minutes : null });
                      }}
                      placeholder="Khác"
                      className="h-10 w-[72px] rounded-full border border-border bg-card px-3 text-center text-[13px] outline-none focus:border-muted-foreground"
                    />
                  </div>
                </div>
                {draft.travelMinutes !== null ? (
                  <div>
                    <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Nhắc trước khi lên đường</p>
                    <div className="flex flex-wrap gap-1.5">
                      {REMINDER_CHIPS.map((chip) => (
                        <Chip key={chip.minutes} isActive={draft.reminderOffset === chip.minutes} onClick={() => patch({ reminderOffset: chip.minutes })}>
                          {chip.label}
                        </Chip>
                      ))}
                    </div>
                    <p className="mt-2 text-[13px] font-medium text-foreground">
                      {departureLine(startIso, draft.travelMinutes, draft.reminderOffset)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </FoldRow>

          {/* Ghi chú */}
          <FoldRow
            label="Ghi chú"
            icon={<FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            summary={noteLine}
            isOpen={openBlock.note}
            onToggle={() => toggleBlock("note")}
          >
            <textarea
              id="composer-note"
              value={draft.description}
              rows={4}
              maxLength={2000}
              onChange={(event) => patch({ description: event.target.value })}
              onKeyDown={noteKeyDown}
              placeholder="Điều cần nhớ, cần làm… Gõ “- ” để gạch đầu dòng"
              className={cn(FIELD, "resize-y py-2.5 text-[14px] leading-6")}
            />
          </FoldRow>
        </div>
      </div>

      {/* Always at the bottom. */}
      <div className="shrink-0 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
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
            className="press h-12 rounded-[10px] border border-border px-5 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-40"
          >
            Huỷ
          </button>
          {copy.submitLabel !== null ? (
            <button
              type="submit"
              disabled={!canSubmit}
              className="press flex h-12 items-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {copy.submitLabel}
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** One folded block: label + "+" when empty, a one-line summary when filled, opens below. */
function FoldRow({
  label,
  icon,
  summary,
  isOpen,
  onToggle,
  disabledNote = null,
  children,
}: {
  label: string;
  icon: ReactNode;
  summary: string | null;
  isOpen: boolean;
  onToggle: () => void;
  disabledNote?: string | null;
  children: ReactNode;
}) {
  const isDisabled = disabledNote !== null;
  return (
    <div className="bg-card">
      <button
        type="button"
        aria-expanded={isOpen}
        disabled={isDisabled}
        onClick={onToggle}
        className="press flex min-h-12 w-full items-center gap-2.5 px-3.5 text-left disabled:cursor-not-allowed"
      >
        <span className={cn("shrink-0", summary !== null ? "text-primary" : "text-muted-foreground", isDisabled && "opacity-50")}>{icon}</span>
        <span className={cn("min-w-0 flex-1 truncate text-[14px]", isDisabled ? "text-muted-foreground/70" : "text-foreground")}>
          {isDisabled ? (
            <>
              {label} <span className="text-[12.5px]">· {disabledNote}</span>
            </>
          ) : summary !== null && !isOpen ? (
            summary
          ) : (
            <span className="font-medium">{label}</span>
          )}
        </span>
        {isDisabled ? null : isOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        ) : summary === null ? (
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {isOpen ? <FadeIn className="px-3.5 pb-3.5">{children}</FadeIn> : null}
    </div>
  );
}

/** AVORA-53 · 4.3 — `Không nhắc · Đúng giờ · 10′ · 30′ · 1 giờ · 1 ngày trước`. */
export const REMIND_CHOICES: readonly { label: string; minutes: number | null }[] = [
  { label: "Không nhắc", minutes: null },
  { label: "Đúng giờ", minutes: 0 },
  { label: "10′", minutes: 10 },
  { label: "30′", minutes: 30 },
  { label: "1 giờ", minutes: 60 },
  { label: "1 ngày trước", minutes: 24 * 60 },
];

/** AVORA-53 · 4.2 — `15′ · 30′ · 1 giờ · 2 giờ · Nửa ngày`. */
export const DURATION_CHOICES: readonly { label: string; minutes: number }[] = [
  { label: "15′", minutes: 15 },
  { label: "30′", minutes: 30 },
  { label: "1 giờ", minutes: 60 },
  { label: "2 giờ", minutes: 120 },
  { label: "Nửa ngày", minutes: 240 },
];

function Chip({ isActive, onClick, children }: { isActive: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "press h-10 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        isActive ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}
