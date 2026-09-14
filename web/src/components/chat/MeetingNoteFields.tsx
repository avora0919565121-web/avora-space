import { CalendarClock, ChevronRight, ListChecks, Plus, X } from "lucide-react";
import { useState } from "react";

import { peerLabel } from "@/lib/initials";
import type { GroupMember } from "@/lib/groups";
import {
  actionItemBlocker,
  emptyActionItem,
  hasAnyDetail,
  MEETING_DECISIONS_MAX_LENGTH,
  MEETING_MAX_ACTION_ITEMS,
  MEETING_MAX_AGENDA_ITEMS,
  MEETING_MAX_LINKS,
  MEETING_OBJECTIVE_MAX_LENGTH,
  MEETING_RISKS_MAX_LENGTH,
  MEETING_TYPE_MAX_LENGTH,
  type ActionItem,
  type MeetingNoteDetails,
} from "@/lib/meeting-notes";
import { cn } from "@/lib/utils";

/** `1 thg 10, 09:00` — a meeting time, said the short way. */
function formatMeetingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${day} thg ${month}, ${hours}:${minutes}`;
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

/**
 * A note's structure once it is written, rather than being written.
 *
 * The opposite rule to the form: here an empty field is simply absent. Labels exist in the
 * editor to remind a secretary what to capture; in a finished record a row of blank headings
 * would only make the note look unfinished when it is complete.
 */
export function MeetingNoteSummary({
  details,
  memberName,
}: {
  details: MeetingNoteDetails | undefined;
  memberName: (userId: string) => string;
}) {
  if (details === undefined || !hasAnyDetail(details)) return null;

  return (
    <div className="mt-2.5 space-y-2.5 rounded-[10px] border border-border bg-background/40 px-2.5 py-2.5">
      {details.meetingType.trim() !== "" || details.objective.trim() !== "" ? (
        <SummaryBlock label={details.meetingType.trim() !== "" ? details.meetingType : "Mục tiêu"}>
          {details.objective.trim() !== "" ? details.objective : "—"}
        </SummaryBlock>
      ) : null}

      {details.decisionsMade.trim() !== "" ? (
        <SummaryBlock label="Điều đã thống nhất">
          <span className="whitespace-pre-wrap">{details.decisionsMade}</span>
        </SummaryBlock>
      ) : null}

      {details.attendeeIds.length > 0 ? (
        <SummaryBlock label={`Tham dự (${details.attendeeIds.length})`}>
          {details.attendeeIds.map((id) => memberName(id)).join(", ")}
        </SummaryBlock>
      ) : null}

      {details.absenteeIds.length > 0 ? (
        <SummaryBlock label={`Vắng mặt (${details.absenteeIds.length})`}>
          {details.absenteeIds.map((id) => memberName(id)).join(", ")}
        </SummaryBlock>
      ) : null}

      {details.agendaItems.length > 0 ? (
        <SummaryBlock label="Nội dung họp">
          <ol className="list-inside list-decimal space-y-0.5">
            {details.agendaItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </SummaryBlock>
      ) : null}

      {details.actionItems.length > 0 ? (
        <SummaryBlock label="Việc cần làm">
          <ul className="space-y-1">
            {details.actionItems.map((item, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-1.5">
                <span>{item.description}</span>
                {item.assigneeId !== null ? (
                  <span className="text-[12px] text-muted-foreground">
                    — {memberName(item.assigneeId)}
                  </span>
                ) : null}
                {item.deadline !== null ? (
                  <span className="text-[12px] text-muted-foreground">· hạn {item.deadline}</span>
                ) : null}
                {/* Says the work actually exists, not merely that a box was ticked. */}
                {item.taskId !== null ? (
                  <span className="text-[12px] font-medium text-primary">· đã tạo nhiệm vụ</span>
                ) : null}
              </li>
            ))}
          </ul>
        </SummaryBlock>
      ) : null}

      {details.risksIssues.trim() !== "" ? (
        <SummaryBlock label="Rủi ro / vướng mắc">
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

/** A list of short lines: agenda points, links. Empty lines are dropped on save. */
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
            <button
              type="button"
              aria-label={`Bỏ ${placeholder.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="press shrink-0 rounded-[8px] border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ))}
        {values.length < max ? (
          <button
            type="button"
            onClick={() => onChange([...values, ""])}
            className="press inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Thêm {placeholder.toLowerCase()}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Who was there, and who was not. Both are picked from the room, never typed. */
function PeoplePicker({
  label,
  members,
  selected,
  onToggle,
}: {
  label: string;
  members: readonly GroupMember[];
  selected: readonly string[];
  onToggle: (userId: string) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
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
 * One thing someone is expected to do after the meeting.
 *
 * The "Tạo Task" tick is a request that is honoured when the note is locked, not when it is
 * typed — a draft is still being argued with, and creating tasks from one would send people
 * work the meeting had not finished agreeing. So the row says plainly what it will do, and
 * says just as plainly when it cannot: a ticked line missing a person or a date is named here
 * rather than dropped in silence at finalize time.
 */
function ActionItemRow({
  item,
  index,
  members,
  onChange,
  onRemove,
}: {
  item: ActionItem;
  index: number;
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
        blocker !== null ? "border-destructive/40 bg-destructive/5" : "border-border bg-background/50",
      )}
    >
      <div className="flex items-start gap-2">
        <input
          value={item.description}
          onChange={(event) => onChange({ ...item, description: event.target.value })}
          placeholder={`Việc cần làm ${index + 1}`}
          className={cn(INPUT_CLASS, "min-w-0 flex-1")}
        />
        <button
          type="button"
          aria-label={`Bỏ việc cần làm ${index + 1}`}
          onClick={onRemove}
          className="press shrink-0 rounded-[8px] border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/40"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <select
          value={item.assigneeId ?? ""}
          onChange={(event) =>
            onChange({ ...item, assigneeId: event.target.value === "" ? null : event.target.value })
          }
          aria-label="Người phụ trách"
          className={cn(INPUT_CLASS, "h-9 w-auto min-w-[140px] py-0")}
        >
          <option value="">Chưa có người phụ trách</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {peerLabel(member.displayName, member.email)}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={item.deadline ?? ""}
          onChange={(event) =>
            onChange({ ...item, deadline: event.target.value === "" ? null : event.target.value })
          }
          aria-label="Hạn hoàn thành"
          className={cn(INPUT_CLASS, "h-9 w-auto py-0")}
        />

        <label
          className={cn(
            "press flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
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
          Tạo Task
        </label>
      </div>

      {alreadyTask ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Đã tạo nhiệm vụ từ dòng này — khoá biên bản lần nữa sẽ không tạo thêm.
        </p>
      ) : blocker !== null ? (
        <p className="mt-1.5 text-[11.5px] text-destructive">{blocker}</p>
      ) : item.createTask ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Nhiệm vụ được tạo khi bạn khoá biên bản, không phải ngay bây giờ.
        </p>
      ) : null}
    </li>
  );
}

/**
 * The structured half of a meeting note, collapsed by default.
 *
 * Only the four basics — title, when, what was agreed, who was there — sit in the open. The
 * rest lives behind one disclosure whose label is always readable, so a secretary knows the
 * fields exist without a long form standing between them and writing the note down.
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
  const [expanded, setExpanded] = useState<boolean>(startExpanded);

  const patch = (part: Partial<MeetingNoteDetails>): void => onChange({ ...details, ...part });

  const toggleAttendee = (userId: string): void => {
    const present = details.attendeeIds.includes(userId);
    patch({
      attendeeIds: present
        ? details.attendeeIds.filter((id) => id !== userId)
        : [...details.attendeeIds, userId],
      // Someone cannot be in both lists at once; marking them present clears the absence.
      absenteeIds: present ? details.absenteeIds : details.absenteeIds.filter((id) => id !== userId),
    });
  };

  const toggleAbsentee = (userId: string): void => {
    const absent = details.absenteeIds.includes(userId);
    patch({
      absenteeIds: absent
        ? details.absenteeIds.filter((id) => id !== userId)
        : [...details.absenteeIds, userId],
      attendeeIds: absent ? details.attendeeIds : details.attendeeIds.filter((id) => id !== userId),
    });
  };

  return (
    <div className="mt-2 space-y-3">
      {/* Always open: what was agreed, and who was in the room. */}
      <div>
        <FieldLabel>Điều đã thống nhất</FieldLabel>
        <textarea
          value={details.decisionsMade}
          onChange={(event) =>
            patch({ decisionsMade: event.target.value.slice(0, MEETING_DECISIONS_MAX_LENGTH) })
          }
          rows={3}
          placeholder="Nhóm đã quyết điều gì?"
          className={cn(INPUT_CLASS, "resize-none")}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <FieldLabel>Người tham dự</FieldLabel>
          {details.attendeeIds.length === 0 && suggestedAttendees.length > 0 ? (
            <button
              type="button"
              onClick={() => patch({ attendeeIds: [...suggestedAttendees] })}
              className="press mb-1 text-[11.5px] font-medium text-primary"
            >
              Chọn cả nhóm
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {members.map((member) => {
            const active = details.attendeeIds.includes(member.userId);
            return (
              <button
                key={member.userId}
                type="button"
                onClick={() => toggleAttendee(member.userId)}
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

      {/* Everything else: named, but out of the way until wanted. */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="press flex w-full items-center gap-2 rounded-[8px] border border-dashed border-border px-2.5 py-2 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.2}
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
          Loại họp · Mục tiêu · Vắng mặt · Nội dung họp · Việc cần làm · Rủi ro · Họp lần sau · Liên
          kết
        </span>
      </button>

      {expanded ? (
        <div className="rise-in space-y-3 rounded-[10px] border border-border bg-background/40 p-2.5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <FieldLabel>Loại họp</FieldLabel>
              <input
                value={details.meetingType}
                onChange={(event) =>
                  patch({ meetingType: event.target.value.slice(0, MEETING_TYPE_MAX_LENGTH) })
                }
                placeholder="Họp tuần, review, đột xuất…"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <FieldLabel>Họp lần sau</FieldLabel>
              <input
                type="datetime-local"
                value={details.nextMeetingAt === null ? "" : details.nextMeetingAt.slice(0, 16)}
                onChange={(event) =>
                  patch({
                    nextMeetingAt:
                      event.target.value === ""
                        ? null
                        : new Date(event.target.value).toISOString(),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Mục tiêu buổi họp</FieldLabel>
            <textarea
              value={details.objective}
              onChange={(event) =>
                patch({ objective: event.target.value.slice(0, MEETING_OBJECTIVE_MAX_LENGTH) })
              }
              rows={2}
              placeholder="Buổi họp này để làm gì?"
              className={cn(INPUT_CLASS, "resize-none")}
            />
          </div>

          <PeoplePicker
            label="Vắng mặt"
            members={members}
            selected={details.absenteeIds}
            onToggle={toggleAbsentee}
          />

          <LineList
            label="Nội dung họp"
            values={details.agendaItems}
            placeholder="Nội dung"
            max={MEETING_MAX_AGENDA_ITEMS}
            onChange={(next) => patch({ agendaItems: next })}
          />

          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              <FieldLabel>Việc cần làm</FieldLabel>
            </div>
            {details.actionItems.length > 0 ? (
              <ul className="space-y-1.5">
                {details.actionItems.map((item, index) => (
                  <ActionItemRow
                    key={index}
                    item={item}
                    index={index}
                    members={members}
                    onChange={(next) => {
                      const items = [...details.actionItems];
                      items[index] = next;
                      patch({ actionItems: items });
                    }}
                    onRemove={() =>
                      patch({ actionItems: details.actionItems.filter((_, i) => i !== index) })
                    }
                  />
                ))}
              </ul>
            ) : null}
            {details.actionItems.length < MEETING_MAX_ACTION_ITEMS ? (
              <button
                type="button"
                onClick={() => patch({ actionItems: [...details.actionItems, emptyActionItem()] })}
                className="press mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Thêm việc cần làm
              </button>
            ) : null}
          </div>

          <div>
            <FieldLabel>Rủi ro / vướng mắc</FieldLabel>
            <textarea
              value={details.risksIssues}
              onChange={(event) =>
                patch({ risksIssues: event.target.value.slice(0, MEETING_RISKS_MAX_LENGTH) })
              }
              rows={2}
              placeholder="Điều gì có thể chệch hướng?"
              className={cn(INPUT_CLASS, "resize-none")}
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
      ) : null}
    </div>
  );
}
