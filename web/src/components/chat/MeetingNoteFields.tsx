import { CalendarClock, ChevronRight, ListChecks, MapPin, Plus, X } from "lucide-react";
import { useState } from "react";

import { useAutoList } from "@/hooks/use-auto-list";
import { peerLabel } from "@/lib/initials";
import type { GroupMember } from "@/lib/groups";
import {
  actionItemBlocker,
  emptyActionItem,
  groupActionItemsByAgenda,
  hasAnyDetail,
  MEETING_DECISIONS_MAX_LENGTH,
  MEETING_LOCATION_MAX_LENGTH,
  MEETING_MAX_ACTION_ITEMS,
  MEETING_MAX_AGENDA_ITEMS,
  MEETING_MAX_LINKS,
  MEETING_OBJECTIVE_MAX_LENGTH,
  MEETING_RISKS_MAX_LENGTH,
  MEETING_TYPE_MAX_LENGTH,
  meetingStage,
  removeAgendaItem,
  type ActionItem,
  type MeetingNoteDetails,
} from "@/lib/meeting-notes";
import { cn } from "@/lib/utils";

/** `1 thg 10, 09:00` — a meeting time, said the short way. */
export function formatMeetingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${day} thg ${month}, ${hours}:${minutes}`;
}

/** `datetime-local` wants local wall-clock time, not UTC. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One labelled block of a finished note. Absent fields are left out, not shown empty. */
function SummaryBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-[13px] leading-[1.5] text-foreground/90">{children}</div>
    </div>
  );
}

/** One decided line, read back: what, who, by when, and whether the work exists yet. */
function ActionSummaryLine({
  item,
  number,
  memberName,
}: {
  item: ActionItem;
  number: string;
  memberName: (userId: string) => string;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="tabular text-[12px] font-medium text-muted-foreground">{number}</span>
      <span>{item.description}</span>
      {item.assigneeId !== null ? (
        <span className="text-[12px] text-muted-foreground">— {memberName(item.assigneeId)}</span>
      ) : null}
      {item.deadline !== null ? (
        <span className="text-[12px] text-muted-foreground">· hạn {item.deadline}</span>
      ) : null}
      {item.taskId !== null ? (
        <span className="text-[12px] font-medium text-primary">· đã tạo việc</span>
      ) : item.createTask ? (
        <span className="text-[12px] text-muted-foreground">· tạo việc khi khoá</span>
      ) : null}
    </li>
  );
}

/**
 * A note's structure once it is written, rather than being written.
 *
 * The opposite rule to the form: here an empty field is simply absent. In stage 2 each agenda
 * line reads with the decisions taken under it, so the note reads in the order the meeting ran.
 */
export function MeetingNoteSummary({
  details,
  memberName,
}: {
  details: MeetingNoteDetails | undefined;
  memberName: (userId: string) => string;
}) {
  if (details === undefined || !hasAnyDetail(details)) return null;
  const { byAgenda, loose } = groupActionItemsByAgenda(details);
  const started = meetingStage(details) === 2;

  return (
    <div className="mt-2.5 space-y-2.5 rounded-[10px] border border-border bg-background/40 px-2.5 py-2.5">
      {details.meetingType.trim() !== "" || details.objective.trim() !== "" ? (
        <SummaryBlock label={details.meetingType.trim() !== "" ? details.meetingType : "Mục tiêu"}>
          {details.objective.trim() !== "" ? details.objective : "—"}
        </SummaryBlock>
      ) : null}

      {details.scheduledAt !== null || details.location.trim() !== "" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          {details.scheduledAt !== null ? (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              {formatMeetingTime(details.scheduledAt)}
            </span>
          ) : null}
          {details.location.trim() !== "" ? (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              {details.location}
            </span>
          ) : null}
        </p>
      ) : null}

      {details.attendeeIds.length > 0 ? (
        <SummaryBlock label={`${started ? "Tham dự" : "Thành phần mời"} (${details.attendeeIds.length})`}>
          {details.attendeeIds.map((id) => memberName(id)).join(", ")}
        </SummaryBlock>
      ) : null}

      {details.absenteeIds.length > 0 ? (
        <SummaryBlock label={`Vắng mặt (${details.absenteeIds.length})`}>
          {details.absenteeIds.map((id) => memberName(id)).join(", ")}
        </SummaryBlock>
      ) : null}

      {details.agendaItems.length > 0 ? (
        <SummaryBlock label={started ? "Nội dung họp" : "Nội dung dự kiến"}>
          <ol className="space-y-1.5">
            {details.agendaItems.map((line, agendaIndex) => (
              <li key={agendaIndex}>
                <p className="font-medium text-foreground">
                  <span className="tabular mr-1.5 text-muted-foreground">{agendaIndex + 1}.</span>
                  {line}
                </p>
                {byAgenda[agendaIndex].length > 0 ? (
                  <ul className="mt-0.5 space-y-0.5 border-l border-border pl-3">
                    {byAgenda[agendaIndex].map((entry, position) => (
                      <ActionSummaryLine
                        key={entry.index}
                        item={entry.item}
                        number={`${agendaIndex + 1}.${position + 1}`}
                        memberName={memberName}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </SummaryBlock>
      ) : null}

      {loose.length > 0 ? (
        <SummaryBlock label={details.agendaItems.length > 0 ? "Việc phát sinh ngoài nội dung" : "Việc cần làm"}>
          <ul className="space-y-1">
            {loose.map((entry, position) => (
              <ActionSummaryLine
                key={entry.index}
                item={entry.item}
                number={`${position + 1}.`}
                memberName={memberName}
              />
            ))}
          </ul>
        </SummaryBlock>
      ) : null}

      {details.decisionsMade.trim() !== "" ? (
        <SummaryBlock label="Kết luận chung">
          <span className="whitespace-pre-wrap">{details.decisionsMade}</span>
        </SummaryBlock>
      ) : null}

      {details.risksIssues.trim() !== "" ? (
        <SummaryBlock label="Vấn đề tồn đọng">
          <span className="whitespace-pre-wrap">{details.risksIssues}</span>
        </SummaryBlock>
      ) : null}

      {details.nextMeetingAt !== null ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          Họp lần sau: {formatMeetingTime(details.nextMeetingAt)}
        </p>
      ) : null}

      {details.referenceLinks.length > 0 ? (
        <SummaryBlock label="Liên kết">
          <ul className="space-y-0.5">
            {details.referenceLinks.map((link, index) => (
              <li key={index} className="truncate">
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline decoration-primary/40 underline-offset-2"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </SummaryBlock>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-[8px] border border-border bg-card px-2.5 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60";

/** A field's name, always shown — including when the field is empty. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-medium text-primary"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press shrink-0 rounded-[8px] border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/40"
    >
      <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** A list of short lines (links). Empty lines are dropped on save. */
function LineList({
  label,
  values,
  placeholder,
  max,
  onChange,
}: {
  label: string;
  values: readonly string[];
  placeholder: string;
  max: number;
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-1.5">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              value={value}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                onChange(next);
              }}
              placeholder={`${placeholder} ${index + 1}`}
              className={cn(INPUT_CLASS, "min-w-0 flex-1")}
            />
            <RemoveButton
              label={`Bỏ ${placeholder.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        {values.length < max ? (
          <AddButton label={`Thêm ${placeholder.toLowerCase()}`} onClick={() => onChange([...values, ""])} />
        ) : null}
      </div>
    </div>
  );
}

/** People picked from the room, never typed. */
function PeoplePicker({
  label,
  members,
  selected,
  onToggle,
  trailing,
}: {
  label: string;
  members: readonly GroupMember[];
  selected: readonly string[];
  onToggle: (userId: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        {trailing}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((member) => {
          const active = selected.includes(member.userId);
          return (
            <button
              key={member.userId}
              type="button"
              onClick={() => onToggle(member.userId)}
              aria-pressed={active}
              className={cn(
                "press rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                active
                  ? "border-foreground/25 bg-accent text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent/40",
              )}
            >
              {peerLabel(member.displayName, member.email)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One decision taken in the meeting: what, by when, who carries it, and whether it becomes work.
 *
 * "Tạo việc" is a request honoured when the note is locked, not when it is typed — a draft is
 * still being argued with. A ticked line missing a person or a date says so here rather than
 * being dropped in silence at lock time.
 */
function ActionItemRow({
  item,
  number,
  members,
  onChange,
  onRemove,
}: {
  item: ActionItem;
  number: string;
  members: readonly GroupMember[];
  onChange: (next: ActionItem) => void;
  onRemove: () => void;
}) {
  const blocker = actionItemBlocker(item);
  const alreadyTask = item.taskId !== null;

  return (
    <li
      className={cn(
        "rounded-[10px] border px-2.5 py-2.5",
        blocker !== null ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="tabular mt-2 min-w-[1.75rem] shrink-0 text-right text-[12px] font-medium text-muted-foreground"
        >
          {number}
        </span>
        <input
          value={item.description}
          onChange={(event) => onChange({ ...item, description: event.target.value })}
          placeholder="Quyết định / việc cần làm"
          aria-label={`Quyết định ${number}`}
          className={cn(INPUT_CLASS, "min-w-0 flex-1")}
        />
        <RemoveButton label={`Bỏ quyết định ${number}`} onClick={onRemove} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
        <input
          type="date"
          value={item.deadline ?? ""}
          onChange={(event) => onChange({ ...item, deadline: event.target.value === "" ? null : event.target.value })}
          aria-label="Thời gian"
          className={cn(INPUT_CLASS, "h-9 w-auto py-0")}
        />
        <select
          value={item.assigneeId ?? ""}
          onChange={(event) =>
            onChange({ ...item, assigneeId: event.target.value === "" ? null : event.target.value })
          }
          aria-label="Người đảm trách"
          className={cn(INPUT_CLASS, "h-9 w-auto min-w-[150px] py-0")}
        >
          <option value="">Người đảm trách…</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {peerLabel(member.displayName, member.email)}
            </option>
          ))}
        </select>

        <label
          className={cn(
            "press flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
            item.createTask
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent/40",
            alreadyTask && "cursor-default opacity-70",
          )}
        >
          <input
            type="checkbox"
            checked={item.createTask}
            disabled={alreadyTask}
            onChange={(event) => onChange({ ...item, createTask: event.target.checked })}
            className="h-3.5 w-3.5 accent-current"
          />
          Tạo việc
        </label>
      </div>

      {alreadyTask ? (
        <p className="mt-1.5 pl-9 text-[11.5px] text-muted-foreground">Đã tạo việc từ dòng này.</p>
      ) : blocker !== null ? (
        <p className="mt-1.5 pl-9 text-[11.5px] text-destructive">{blocker}</p>
      ) : item.createTask ? (
        <p className="mt-1.5 pl-9 text-[11.5px] text-muted-foreground">
          Việc được tạo khi biên bản được khoá, không phải ngay bây giờ.
        </p>
      ) : null}
    </li>
  );
}

/**
 * The structured half of a meeting note, in two stages.
 *
 * Stage 1 — Kế hoạch họp: what the meeting is for, who is invited, when and where, what will be
 * discussed. Stage 2 — after "Bắt đầu họp": the plan folds into one line and each agenda point
 * opens with the decisions taken under it, so the minutes are written in the order the meeting
 * actually runs instead of in two unrelated lists.
 */
export function MeetingNoteFields({
  details,
  members,
  suggestedAttendees,
  onChange,
  startExpanded = false,
}: {
  details: MeetingNoteDetails;
  members: readonly GroupMember[];
  /** Everyone currently in the room, offered as a starting point to correct. */
  suggestedAttendees: readonly string[];
  onChange: (next: MeetingNoteDetails) => void;
  startExpanded?: boolean;
}) {
  const stage = meetingStage(details);
  /** In stage 2 the plan folds away; in stage 1 the extras (absent, issues, links…) do. */
  const [expanded, setExpanded] = useState<boolean>(startExpanded);
  const [planOpen, setPlanOpen] = useState<boolean>(false);

  const patch = (part: Partial<MeetingNoteDetails>): void => onChange({ ...details, ...part });

  const decisionsKeyDown = useAutoList((next) =>
    patch({ decisionsMade: next.slice(0, MEETING_DECISIONS_MAX_LENGTH) }),
  );
  const objectiveKeyDown = useAutoList((next) =>
    patch({ objective: next.slice(0, MEETING_OBJECTIVE_MAX_LENGTH) }),
  );
  const risksKeyDown = useAutoList((next) => patch({ risksIssues: next.slice(0, MEETING_RISKS_MAX_LENGTH) }));

  const toggleAttendee = (userId: string): void => {
    const present = details.attendeeIds.includes(userId);
    patch({
      attendeeIds: present ? details.attendeeIds.filter((id) => id !== userId) : [...details.attendeeIds, userId],
      absenteeIds: present ? details.absenteeIds : details.absenteeIds.filter((id) => id !== userId),
    });
  };

  const toggleAbsentee = (userId: string): void => {
    const absent = details.absenteeIds.includes(userId);
    patch({
      absenteeIds: absent ? details.absenteeIds.filter((id) => id !== userId) : [...details.absenteeIds, userId],
      attendeeIds: absent ? details.attendeeIds : details.attendeeIds.filter((id) => id !== userId),
    });
  };

  const setAgendaLine = (index: number, value: string): void => {
    const next = [...details.agendaItems];
    next[index] = value;
    patch({ agendaItems: next });
  };

  const setActionItem = (index: number, next: ActionItem): void => {
    const items = [...details.actionItems];
    items[index] = next;
    patch({ actionItems: items });
  };

  const removeActionItem = (index: number): void =>
    patch({ actionItems: details.actionItems.filter((_, i) => i !== index) });

  const addActionItem = (agendaIndex: number | null): void => {
    if (details.actionItems.length >= MEETING_MAX_ACTION_ITEMS) return;
    patch({ actionItems: [...details.actionItems, emptyActionItem(agendaIndex)] });
  };

  const selectAllButton =
    details.attendeeIds.length === 0 && suggestedAttendees.length > 0 ? (
      <button
        type="button"
        onClick={() => patch({ attendeeIds: [...suggestedAttendees] })}
        className="press mb-1 text-[11.5px] font-medium text-primary"
      >
        Chọn cả nhóm
      </button>
    ) : null;

  const planFields = (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <FieldLabel>Loại họp</FieldLabel>
          <input
            value={details.meetingType}
            onChange={(event) => patch({ meetingType: event.target.value.slice(0, MEETING_TYPE_MAX_LENGTH) })}
            placeholder="Họp tuần, review, đột xuất…"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <FieldLabel>Thời gian</FieldLabel>
          <input
            type="datetime-local"
            value={toLocalInput(details.scheduledAt)}
            onChange={(event) => patch({ scheduledAt: fromLocalInput(event.target.value) })}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div>
        <FieldLabel>Địa điểm</FieldLabel>
        <input
          value={details.location}
          onChange={(event) => patch({ location: event.target.value.slice(0, MEETING_LOCATION_MAX_LENGTH) })}
          placeholder="Phòng họp, địa chỉ hoặc link họp online"
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <FieldLabel>Mục tiêu</FieldLabel>
        <textarea
          value={details.objective}
          onChange={(event) => patch({ objective: event.target.value.slice(0, MEETING_OBJECTIVE_MAX_LENGTH) })}
          onKeyDown={objectiveKeyDown}
          rows={2}
          placeholder="Buổi họp này để làm gì?"
          className={cn(INPUT_CLASS, "resize-none")}
        />
      </div>

      {stage === 1 ? (
        <PeoplePicker
          label="Thành phần tham dự"
          members={members}
          selected={details.attendeeIds}
          onToggle={toggleAttendee}
          trailing={selectAllButton}
        />
      ) : null}

      {stage === 1 ? (
        <div>
          <FieldLabel>Nội dung dự kiến</FieldLabel>
          <div className="space-y-1.5">
            {details.agendaItems.map((line, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <span className="tabular w-5 shrink-0 text-right text-[12px] font-medium text-muted-foreground">
                  {index + 1}.
                </span>
                <input
                  value={line}
                  onChange={(event) => setAgendaLine(index, event.target.value)}
                  placeholder={`Nội dung ${index + 1}`}
                  className={cn(INPUT_CLASS, "min-w-0 flex-1")}
                />
                <RemoveButton
                  label={`Bỏ nội dung ${index + 1}`}
                  onClick={() => onChange(removeAgendaItem(details, index))}
                />
              </div>
            ))}
            {details.agendaItems.length < MEETING_MAX_AGENDA_ITEMS ? (
              <AddButton label="Thêm nội dung" onClick={() => patch({ agendaItems: [...details.agendaItems, ""] })} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  const extras = (
    <div className="space-y-3">
      {stage === 2 ? (
        <PeoplePicker label="Vắng mặt" members={members} selected={details.absenteeIds} onToggle={toggleAbsentee} />
      ) : null}
      {stage === 2 ? (
        <div>
          <FieldLabel>Kết luận chung</FieldLabel>
          <textarea
            value={details.decisionsMade}
            onChange={(event) => patch({ decisionsMade: event.target.value.slice(0, MEETING_DECISIONS_MAX_LENGTH) })}
            onKeyDown={decisionsKeyDown}
            rows={2}
            placeholder="Điều cả buổi thống nhất. Gõ “- ” để gạch đầu dòng"
            className={cn(INPUT_CLASS, "resize-none")}
          />
        </div>
      ) : null}
      <div>
        <FieldLabel>Vấn đề tồn đọng</FieldLabel>
        <textarea
          value={details.risksIssues}
          onChange={(event) => patch({ risksIssues: event.target.value.slice(0, MEETING_RISKS_MAX_LENGTH) })}
          onKeyDown={risksKeyDown}
          rows={2}
          placeholder="Điều gì chưa giải quyết, có thể chệch hướng?"
          className={cn(INPUT_CLASS, "resize-none")}
        />
      </div>
      <div>
        <FieldLabel>Họp lần sau</FieldLabel>
        <input
          type="datetime-local"
          value={toLocalInput(details.nextMeetingAt)}
          onChange={(event) => patch({ nextMeetingAt: fromLocalInput(event.target.value) })}
          className={cn(INPUT_CLASS, "sm:w-auto")}
        />
      </div>
      <LineList
        label="Liên kết tham chiếu"
        values={details.referenceLinks}
        placeholder="Liên kết"
        max={MEETING_MAX_LINKS}
        onChange={(next) => patch({ referenceLinks: next })}
      />
    </div>
  );

  if (stage === 1) {
    return (
      <div className="mt-2 space-y-3">
        <div className="rounded-[12px] border border-border bg-background/50 p-3">
          <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-foreground/80">
            Kế hoạch họp
          </p>
          {planFields}
        </div>
        <Disclosure
          open={expanded}
          onToggle={() => setExpanded(!expanded)}
          label="Vấn đề tồn đọng · Họp lần sau · Liên kết"
        >
          {extras}
        </Disclosure>
      </div>
    );
  }

  const { byAgenda, loose } = groupActionItemsByAgenda(details);
  const canAddAction = details.actionItems.length < MEETING_MAX_ACTION_ITEMS;
  const planLine = [
    details.meetingType.trim(),
    details.scheduledAt !== null ? formatMeetingTime(details.scheduledAt) : "",
    details.location.trim(),
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <div className="mt-2 space-y-3">
      <Disclosure
        open={planOpen}
        onToggle={() => setPlanOpen(!planOpen)}
        label={planLine === "" ? "Kế hoạch họp" : `Kế hoạch họp — ${planLine}`}
      >
        {planFields}
      </Disclosure>

      <PeoplePicker
        label="Người tham dự"
        members={members}
        selected={details.attendeeIds}
        onToggle={toggleAttendee}
        trailing={selectAllButton}
      />

      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <FieldLabel>Nội dung họp</FieldLabel>
        </div>
        <ol className="space-y-2.5">
          {details.agendaItems.map((line, agendaIndex) => (
            <li key={agendaIndex} className="rounded-[12px] border border-border bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="tabular w-5 shrink-0 text-right text-[13px] font-semibold text-foreground/70">
                  {agendaIndex + 1}.
                </span>
                <input
                  value={line}
                  onChange={(event) => setAgendaLine(agendaIndex, event.target.value)}
                  placeholder={`Nội dung ${agendaIndex + 1}`}
                  className={cn(INPUT_CLASS, "min-w-0 flex-1 font-medium")}
                />
                <RemoveButton
                  label={`Bỏ nội dung ${agendaIndex + 1}`}
                  onClick={() => onChange(removeAgendaItem(details, agendaIndex))}
                />
              </div>
              {byAgenda[agendaIndex].length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {byAgenda[agendaIndex].map((entry, position) => (
                    <ActionItemRow
                      key={entry.index}
                      item={entry.item}
                      number={`${agendaIndex + 1}.${position + 1}`}
                      members={members}
                      onChange={(next) => setActionItem(entry.index, next)}
                      onRemove={() => removeActionItem(entry.index)}
                    />
                  ))}
                </ul>
              ) : null}
              {canAddAction ? (
                <div className="mt-1 pl-6">
                  <AddButton label="Thêm quyết định" onClick={() => addActionItem(agendaIndex)} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {details.agendaItems.length < MEETING_MAX_AGENDA_ITEMS ? (
          <AddButton
            label="Thêm nội dung phát sinh"
            onClick={() => patch({ agendaItems: [...details.agendaItems, ""] })}
          />
        ) : null}
      </div>

      <div>
        <FieldLabel>Việc ngoài nội dung họp</FieldLabel>
        {loose.length > 0 ? (
          <ul className="space-y-1.5">
            {loose.map((entry, position) => (
              <ActionItemRow
                key={entry.index}
                item={entry.item}
                number={`${position + 1}.`}
                members={members}
                onChange={(next) => setActionItem(entry.index, next)}
                onRemove={() => removeActionItem(entry.index)}
              />
            ))}
          </ul>
        ) : null}
        {canAddAction ? <AddButton label="Thêm việc rời" onClick={() => addActionItem(null)} /> : null}
      </div>

      <Disclosure
        open={expanded}
        onToggle={() => setExpanded(!expanded)}
        label="Vắng mặt · Kết luận chung · Vấn đề tồn đọng · Họp lần sau · Liên kết"
      >
        {extras}
      </Disclosure>
    </div>
  );
}

/** A named group of fields, folded until wanted — the label always says what is inside. */
function Disclosure({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="press flex min-h-10 w-full items-center gap-2 rounded-[8px] border border-dashed border-border px-2.5 py-2 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.2}
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{label}</span>
      </button>
      {open ? (
        <div className="rise-in mt-2 rounded-[10px] border border-border bg-background/40 p-2.5">{children}</div>
      ) : null}
    </div>
  );
}
