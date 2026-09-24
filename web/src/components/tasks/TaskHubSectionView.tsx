import { Check, ChevronRight, MapPin, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { localDayOf } from "@/lib/space-blocks";
import { calendarProjection, invitationRows, tasksForSection, type TaskHubSection } from "@/lib/task-hub";
import { deadlineLabel, type TaskItem } from "@/lib/tasks";
import { useRespondInvitation, useTaskParticipants } from "@/lib/use-task-collab";
import { useTaskActions } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const WEEKDAYS: readonly string[] = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00`);
  const prefix = day === today ? "Hôm nay" : WEEKDAYS[date.getDay()];
  return `${prefix} · ${date.getDate()}/${date.getMonth() + 1}`;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">{text}</p>;
}

function TaskLine({ task, today, onOpen, trailing }: { task: TaskItem; today: string; onOpen: (task: TaskItem) => void; trailing?: string }) {
  const meta =
    task.requiresPresence && task.startAt !== null
      ? `${dayLabel(localDayOf(task.startAt), today)} · ${clock(task.startAt)}${task.location !== null ? ` · ${task.location}` : ""}`
      : deadlineLabel(task.deadline, today) ?? "Không có hạn";
  return (
    <button type="button" onClick={() => onOpen(task)} className="press flex min-h-12 w-full items-center gap-3 border-t border-border px-4 py-2.5 text-left first:border-t-0 hover:bg-accent/30">
      {task.requiresPresence ? <MapPin className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-foreground">{task.title}</span>
        <span className="block text-[12px] text-muted-foreground">{trailing ?? meta}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
    </button>
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
        onSuccess: () => toast.success(accept ? "Đã nhận lời mời." : "Đã từ chối lời mời."),
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
              Nhận
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
        <li key={task.id} className="flex items-center gap-2 border-t border-border pr-3 first:border-t-0">
          <div className="min-w-0 flex-1">
            <TaskLine task={task} today={today} onOpen={onOpen} />
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
  const list = useMemo(() => tasksForSection(section.id, tasks, userId, today), [section.id, tasks, userId, today]);

  if (section.isComingSoon) return <Empty text={section.empty} />;
  if (section.id === "upcoming") return <UpcomingCalendar tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (section.id === "invitations") return <InvitationsList tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (section.id === "trash") return <TrashList tasks={tasks} userId={userId} today={today} onOpen={onOpen} empty={section.empty} />;
  if (list.length === 0) return <Empty text={section.empty} />;
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-card">
      {list.map((task) => (
        <TaskLine key={task.id} task={task} today={today} onOpen={onOpen} />
      ))}
    </div>
  );
}
