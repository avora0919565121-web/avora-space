import { Check, ChevronRight, MapPin, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { PERSONAL_BUBBLE_STATE, TaskBubble } from "@/components/TaskBubble";
import { ownerStripeClass, TaskOwnerLine } from "@/components/tasks/TaskOwner";
import { useTaskOwnership } from "@/lib/use-task-owner";
import { celebrate } from "@/lib/confetti";
import { localDayOf } from "@/lib/space-blocks";
import { useTaskFlagIndex } from "@/lib/use-task-flags";
import {
  calendarProjection,
  dayLabelOf,
  invitationRows,
  myDayCardNote,
  tasksForSection,
  type MyDayCardNote,
  type TaskHubSection,
} from "@/lib/task-hub";
import { deadlineLabel, type TaskItem } from "@/lib/tasks";
import { useRespondInvitation, useTaskParticipants } from "@/lib/use-task-collab";
import { useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(day: string, today: string): string {
  return dayLabelOf(day, today);
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">{text}</p>;
}

/**
 * AVORA-53 · 4.5 — the circle that finishes a personal task right from the list, with Hoàn tác.
 * Shared work is closed in its conversation, so it keeps only the chevron.
 */
function DoneCircle({ task }: { task: TaskItem }) {
  const { togglePersonalDone } = useTaskActions();
  const done = task.status === "done";
  const toggle = (): void => {
    void togglePersonalDone
      .mutateAsync({ taskId: task.id, done: !done })
      .then(() => {
        if (done) return;
        celebrate(task.isMilestone ? "milestone" : "task", { taskId: task.id });
        toast.success("Đã xong", {
          action: { label: "Hoàn tác", onClick: () => void togglePersonalDone.mutateAsync({ taskId: task.id, done: false }) },
        });
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa lưu được."));
  };
  return (
    <span className="flex h-12 w-10 shrink-0 items-center justify-center pl-2">
      <TaskBubble state={PERSONAL_BUBBLE_STATE[task.status]} onClick={toggle} label={done ? "Mở lại nhiệm vụ" : "Đánh dấu hoàn thành"} />
    </span>
  );
}

function TaskLine({ task, today, onOpen, trailing, canComplete = true, dayNote }: { task: TaskItem; today: string; onOpen: (task: TaskItem) => void; trailing?: string; canComplete?: boolean; dayNote?: MyDayCardNote | null }) {
  const meta =
    task.startAt !== null
      ? `${dayLabel(localDayOf(task.startAt), today)} · ${task.requiresPresence ? "Có mặt lúc" : "Lúc"} ${clock(task.startAt)}${task.location !== null ? ` · ${task.location}` : ""}`
      : deadlineLabel(task.deadline, today) ?? "Không có hạn";
  const canFinish = canComplete && task.type === "personal" && trailing === undefined;
  const owner = useTaskOwnership(task);
  return (
    <div data-task-mine={owner.isMine ? "true" : "false"} className={cn("flex items-center border-t border-border first:border-t-0", ownerStripeClass(owner.isMine))}>
    {canFinish ? <DoneCircle task={task} /> : null}
    <button type="button" onClick={() => onOpen(task)} className={cn("press flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30", canFinish && "pl-2")}>
      {task.requiresPresence ? <MapPin className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-foreground">{task.title}</span>
        {/* AVORA-55 · 4: inside Hôm nay the line says why the task is here and when its own
            time really is — an Event's hour, a deadline already carrying it, an overdue day. */}
        <span className={cn("block text-[12px]", dayNote?.tone === "overdue" ? "font-medium text-task-overdue" : "text-muted-foreground")}>
          {dayNote?.text ?? trailing ?? meta}
        </span>
        <TaskOwnerLine task={task} ownership={owner} className="mt-0.5" />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
    </button>
    </div>
  );
}

/** Upcoming: seven days, projected from tasks. An Event is a block; a plain task is a thin marker. */
function UpcomingCalendar({ tasks, userId, today, onOpen, empty }: { tasks: readonly TaskItem[]; userId: string | undefined; today: string; onOpen: (task: TaskItem) => void; empty: string }) {
  const days = useMemo(() => calendarProjection(tasks, userId, today, 7), [tasks, userId, today]);
  if (days.every((day) => day.entries.length === 0)) return <Empty text={empty} />;
  return (
    <ol className="space-y-3">
      {days.map((day) => (
        <li key={day.day} className="rounded-[12px] border border-border bg-card p-3">
          <p className={cn("text-[12.5px] font-semibold", day.day === today ? "text-primary" : "text-muted-foreground")}>{dayLabel(day.day, today)}</p>
          {day.entries.length === 0 ? <p className="mt-1 text-[12.5px] text-task-idle">Trống</p> : null}
          <ul className="mt-2 space-y-1.5">
            {day.entries.map((entry) =>
              entry.kind === "block" ? (
                <li key={entry.task.id}>
                  <button type="button" onClick={() => onOpen(entry.task)} data-calendar-kind="block" className="press flex min-h-14 w-full flex-col justify-center rounded-[8px] border border-primary/30 bg-primary/10 px-3 py-2 text-left">
                    <span className="text-[12px] font-medium text-primary">
                      {clock(entry.startAt)}
                      {entry.endAt !== null ? ` – ${clock(entry.endAt)}` : ""}
                    </span>
                    <span className="truncate text-[14px] font-medium text-foreground">{entry.task.title}</span>
                    {entry.task.location !== null ? <span className="truncate text-[12px] text-muted-foreground">{entry.task.location}</span> : null}
                  </button>
                </li>
              ) : (
                <li key={entry.task.id}>
                  <button type="button" onClick={() => onOpen(entry.task)} data-calendar-kind="marker" className="press flex min-h-10 w-full items-center gap-2 border-l-2 border-task-due-soon pl-3 text-left">
                    <span className="tabular w-11 shrink-0 text-[12px] text-muted-foreground">{entry.time ?? "Hạn"}</span>
                    <span className="truncate text-[14px] text-foreground">{entry.task.title}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function InvitationsList({ tasks, userId, today, onOpen, empty }: { tasks: readonly TaskItem[]; userId: string | undefined; today: string; onOpen: (task: TaskItem) => void; empty: string }) {
  const { data: participants } = useTaskParticipants();
  const respond = useRespondInvitation();
  const rows = useMemo(() => invitationRows(participants ?? [], tasks, userId), [participants, tasks, userId]);
  if (rows.length === 0) return <Empty text={empty} />;
  const answer = (participantId: string, accept: boolean): void => {
    respond.mutate(
      { participantId, accept },
      {
        onSuccess: () => toast.success(accept ? "Đã đồng ý lời mời." : "Đã từ chối lời mời."),
        onError: (error) => toast.error(error.message),
      },
    );
  };
  return (
    <ul className="overflow-hidden rounded-[12px] border border-border bg-card">
      {rows.map(({ participant, task }) => (
        <li key={participant.id} className="border-t border-border px-4 py-3 first:border-t-0">
          {task !== null ? (
            <button type="button" onClick={() => onOpen(task)} className="text-left text-[14.5px] font-medium text-foreground hover:underline">
              {task.title}
            </button>
          ) : (
            <p className="text-[14.5px] font-medium text-foreground">Một việc chung</p>
          )}
          <p className="text-[12px] text-muted-foreground">{task !== null ? deadlineLabel(task.deadline, today) ?? "" : ""}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={respond.isPending} onClick={() => answer(participant.id, true)} className="press flex h-11 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">
              <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Đồng ý
            </button>
            <button type="button" disabled={respond.isPending} onClick={() => answer(participant.id, false)} className="press flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-4 text-[13px] font-medium text-foreground disabled:opacity-50">
              <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Từ chối
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TrashList({ tasks, userId, today, onOpen, empty }: { tasks: readonly TaskItem[]; userId: string | undefined; today: string; onOpen: (task: TaskItem) => void; empty: string }) {
  const { restoreShared, binPersonal } = useTaskActions();
  const list = useMemo(() => tasksForSection("trash", tasks, userId, today), [tasks, userId, today]);
  if (list.length === 0) return <Empty text={empty} />;
  const restore = (task: TaskItem): void => {
    const request = task.type === "personal" ? binPersonal.mutateAsync({ taskId: task.id, deleted: false }) : restoreShared.mutateAsync(task.id);
    void request.then(() => toast.success("Đã khôi phục.")).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không khôi phục được."));
  };
  return (
    <ul className="overflow-hidden rounded-[12px] border border-border bg-card">
      {list.map((task) => (
        <li key={task.id} data-task-id={task.id} className="flex items-center gap-2 border-t border-border pr-3 first:border-t-0">
          <div className="min-w-0 flex-1">
            <TaskLine task={task} today={today} onOpen={onOpen} canComplete={false} />
          </div>
          <button type="button" onClick={() => restore(task)} className="press h-10 shrink-0 rounded-[8px] border border-border px-3 text-[13px] font-medium text-foreground hover:bg-secondary">
            Khôi phục
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Every Task Hub section other than "Tasks", which keeps the existing four readings. */
export function TaskHubSectionView({ section, tasks, userId, today, onOpen }: { section: TaskHubSection; tasks: readonly TaskItem[]; userId: string | undefined; today: string; onOpen: (task: TaskItem) => void }) {
  const flags = useTaskFlagIndex();
  const list = useMemo(() => tasksForSection(section.id, tasks, userId, today, flags), [section.id, tasks, userId, today, flags]);

  if (section.isComingSoon) return <Empty text={section.empty} />;
  if (section.id === "upcoming") return <UpcomingCalendar tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (section.id === "invitations") return <InvitationsList tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (section.id === "trash") return <TrashList tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (list.length === 0) return <Empty text={section.empty} />;
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-card">
      {list.map((task) => (
        <TaskLine
          key={task.id}
          task={task}
          today={today}
          onOpen={onOpen}
          dayNote={section.id === "my_day" ? myDayCardNote(task, today) : null}
        />
      ))}
    </div>
  );
}
