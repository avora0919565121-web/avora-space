import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, MapPin, Plus, Trash2, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import { checklistProgress, nextChecklistPosition } from "@/lib/task-collab";
import { inviteTaskParticipant, withdrawTaskInvitation } from "@/lib/task-collab-api";
import { formatDuration, parseDurationInput } from "@/lib/task-flags";
import {
  isSharedTask,
  taskKeys,
  updatePersonalTaskSchedule,
  updateSharedTaskSchedule,
  type TaskItem,
  type TaskSchedulePatch,
} from "@/lib/tasks";
import {
  taskCollabKeys,
  useChecklist,
  useChecklistActions,
  useResourceActions,
  useResources,
  useTaskParticipants,
} from "@/lib/use-task-collab";
import { cn } from "@/lib/utils";

const FIELD =
  "mt-1 w-full rounded-[8px] border border-input bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-muted-foreground";
const LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value.length === 0 ? null : new Date(value).toISOString();
}

function showError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra. Bạn thử lại nhé.");
}

/** A section header with its one-line description, as every new surface carries. */
function Heading({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <p className={LABEL}>{title}</p>
      <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * Duration and, when it asks you to be present, the Event's when and where.
 *
 * Personal tasks write straight to their row; shared tasks go through the same party rule as
 * rewording (creator + assignee, while pending or confirmed), re-checked on the server.
 */
function ScheduleBlock({ task }: { task: TaskItem }) {
  const shared = isSharedTask(task);
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<string>(task.estimatedDurationMinutes?.toString() ?? "");
  const [isEvent, setIsEvent] = useState<boolean>(task.requiresPresence);
  const [startAt, setStartAt] = useState<string>(toLocalInput(task.startAt));
  const [endAt, setEndAt] = useState<string>(toLocalInput(task.endAt));
  const [location, setLocation] = useState<string>(task.location ?? "");
  const [travel, setTravel] = useState<string>(task.travelDurationMinutes?.toString() ?? "");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const travelMinutes = parseDurationInput(travel);
    const start = isEvent ? fromLocalInput(startAt) : null;
    const patch: TaskSchedulePatch = {
      estimatedDurationMinutes: parseDurationInput(duration),
      requiresPresence: isEvent,
      startAt: start,
      endAt: isEvent ? fromLocalInput(endAt) : null,
      location: isEvent && location.trim() !== "" ? location.trim() : null,
      travelDurationMinutes: isEvent ? travelMinutes : null,
      // Leave on time: the start minus the travel, only when both are known.
      departureReminderAt:
        isEvent && start !== null && travelMinutes !== null
          ? new Date(new Date(start).getTime() - travelMinutes * 60_000).toISOString()
          : null,
    };
    setIsSaving(true);
    try {
      if (shared) {
        await updateSharedTaskSchedule(task.id, {
          estimatedDurationMinutes: patch.estimatedDurationMinutes ?? null,
          requiresPresence: patch.requiresPresence ?? false,
          startAt: patch.startAt ?? null,
          endAt: patch.endAt ?? null,
          location: patch.location ?? null,
          travelDurationMinutes: patch.travelDurationMinutes ?? null,
        });
      } else {
        await updatePersonalTaskSchedule(task.id, patch);
      }
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      toast.success("Đã lưu lịch.");
    } catch (error) {
      showError(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-[10px] border border-border bg-card p-3">
      <Heading
        title="Thời lượng & lịch"
        note={
          shared
            ? "Lịch chung của việc này — người giao và người nhận đều sửa được, hai bên cùng thấy."
            : "Ước lượng việc mất bao lâu — tách hẳn khỏi hạn hoàn thành."
        }
      />
      <div>
        <label htmlFor="prep-duration" className="text-[12.5px] text-muted-foreground">
          Dự kiến mất (phút)
        </label>
        <input id="prep-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Ví dụ: 45" className={FIELD} />
      </div>

      <label className="flex min-h-11 items-center gap-2 text-[14px] text-foreground">
        <input type="checkbox" checked={isEvent} onChange={(e) => setIsEvent(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
        Việc này cần tôi có mặt
      </label>

      {isEvent ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="prep-start" className="text-[12.5px] text-muted-foreground">Bắt đầu</label>
            <input id="prep-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={FIELD} required />
          </div>
          <div>
            <label htmlFor="prep-end" className="text-[12.5px] text-muted-foreground">Kết thúc</label>
            <input id="prep-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={FIELD} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="prep-location" className="text-[12.5px] text-muted-foreground">Địa điểm</label>
            <input id="prep-location" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} placeholder="Quán cà phê, văn phòng…" className={FIELD} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="prep-travel" className="text-[12.5px] text-muted-foreground">Thời gian di chuyển (phút)</label>
            <input id="prep-travel" inputMode="numeric" value={travel} onChange={(e) => setTravel(e.target.value)} placeholder="Ví dụ: 20" className={FIELD} />
            <p className="mt-1 text-[12px] text-muted-foreground">Có giờ bắt đầu và thời gian đi, AVORA tính luôn giờ nên lên đường.</p>
          </div>
        </div>
      ) : null}

      <button type="submit" disabled={isSaving} className="press flex h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-medium text-foreground hover:bg-secondary disabled:opacity-50">
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
        Lưu lịch
      </button>
    </form>
  );
}

/** A read-only line of the schedule, for anyone not allowed to edit it (bystanders, closed work). */
function ScheduleSummary({ task }: { task: TaskItem }) {
  const duration = formatDuration(task.estimatedDurationMinutes);
  if (duration === null && !task.requiresPresence) return null;
  return (
    <div className="rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-foreground">
      {duration !== null ? <p>Dự kiến mất {duration}</p> : null}
      {task.requiresPresence && task.startAt !== null ? (
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          Có mặt lúc {new Date(task.startAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
          {task.location !== null ? ` · ${task.location}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function ChecklistBlock({ task, canEdit }: { task: TaskItem; canEdit: boolean }) {
  const { data: items } = useChecklist(task.id);
  const actions = useChecklistActions(task.id);
  const [draft, setDraft] = useState<string>("");
  const list = items ?? [];
  const progress = checklistProgress(list);

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft.trim() === "") return;
    actions.add.mutate(
      { content: draft, position: nextChecklistPosition(list) },
      { onSuccess: () => setDraft(""), onError: showError },
    );
  };

  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <Heading title="Các bước" note="Chia việc thành từng bước nhỏ — chạm ô để đánh dấu xong." />
        {progress !== null ? <span className="tabular shrink-0 text-[12px] text-muted-foreground">{progress.done}/{progress.total}</span> : null}
      </div>
      {list.length === 0 ? <p className="text-[13px] text-muted-foreground">Chưa có bước nào.</p> : null}
      <ul className="space-y-0.5">
        {list.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              aria-label={item.content}
              checked={item.completed}
              disabled={!canEdit}
              onChange={(e) => actions.toggle.mutate({ itemId: item.id, completed: e.target.checked }, { onError: showError })}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span className={cn("flex-1 text-[14px]", item.completed ? "text-muted-foreground line-through" : "text-foreground")}>{item.content}</span>
            {canEdit ? (
              <button type="button" aria-label={`Xoá bước ${item.content}`} onClick={() => actions.remove.mutate(item.id, { onError: showError })} className="press flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className="flex gap-2">
          <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="Thêm một bước" aria-label="Thêm một bước" className={cn(FIELD, "mt-0")} />
          <button type="submit" aria-label="Thêm bước" className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border hover:bg-secondary">
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ResourcesBlock({ task, canEdit }: { task: TaskItem; canEdit: boolean }) {
  const { data: resources } = useResources(task.id);
  const actions = useResourceActions(task.id);
  const [draft, setDraft] = useState<string>("");
  const list = resources ?? [];

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft.trim() === "") return;
    actions.add.mutate(draft, { onSuccess: () => setDraft(""), onError: showError });
  };

  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-card p-3">
      <Heading title="Cần mang theo" note="Tài liệu, đồ dùng cần chuẩn bị — khác với các bước phải làm." />
      {list.length === 0 ? <p className="text-[13px] text-muted-foreground">Chưa ghi gì cần chuẩn bị.</p> : null}
      <ul className="space-y-0.5">
        {list.map((resource) => (
          <li key={resource.id} className="flex min-h-10 items-center gap-2 text-[14px] text-foreground">
            <span className="flex-1">• {resource.content}</span>
            {canEdit ? (
              <button type="button" aria-label={`Xoá ${resource.content}`} onClick={() => actions.remove.mutate(resource.id, { onError: showError })} className="press flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className="flex gap-2">
          <input value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Ví dụ: hợp đồng bản in" aria-label="Thêm thứ cần mang theo" className={cn(FIELD, "mt-0")} />
          <button type="submit" aria-label="Thêm" className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border hover:bg-secondary">
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </form>
      ) : null}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { pending: "Đang chờ", accepted: "Đã nhận", declined: "Đã từ chối" };

/** Who else is coming along. Only the task's creator invites; nobody is invited automatically. */
function ParticipantsBlock({ task }: { task: TaskItem }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isCreator = user?.id === task.creatorId;
  const { data: participants } = useTaskParticipants();
  const rows = (participants ?? []).filter((row) => row.taskId === task.id);
  const { data: members } = useQuery({
    queryKey: groupKeys.members(task.conversationId ?? ""),
    queryFn: () => fetchGroupMembers(task.conversationId ?? ""),
    enabled: isCreator && task.type === "group-shared" && task.conversationId !== null,
  });
  const nameOf = (id: string): string => members?.find((m) => m.userId === id)?.displayName ?? "Thành viên";
  const invitable = (members ?? []).filter(
    (m) => m.userId !== user?.id && m.userId !== task.assigneeId && !rows.some((row) => row.userId === m.userId && row.status !== "declined"),
  );

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: taskCollabKeys.participants });

  if (rows.length === 0 && !isCreator) return null;

  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-card p-3">
      <Heading title="Cùng tham gia" note="Mời thêm người cùng làm, bên cạnh người nhận việc chính." />
      {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Chưa mời ai.</p> : null}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.id} className="flex min-h-10 items-center gap-2 text-[14px]">
            <span className="flex-1 text-foreground">{row.userId === user?.id ? "Bạn" : nameOf(row.userId)}</span>
            <span className="text-[12px] text-muted-foreground">{STATUS_TEXT[row.status]}</span>
            {isCreator ? (
              <button type="button" onClick={() => void withdrawTaskInvitation(row.id).then(refresh).catch(showError)} className="press h-9 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground">
                Rút lại
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {isCreator && invitable.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {invitable.map((member) => (
            <button
              key={member.userId}
              type="button"
              onClick={() =>
                void inviteTaskParticipant(task.id, member.userId)
                  .then(() => {
                    refresh();
                    toast.success(`Đã mời ${member.displayName ?? "thành viên"}.`);
                  })
                  .catch(showError)
              }
              className="press flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-foreground hover:bg-secondary"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {member.displayName ?? "Thành viên"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What a task carries beside itself: how long and where (Phần 4–5), the steps and the things to
 * bring (Phần 6), and who is coming along. Each part says in one line what it is for.
 */
export function TaskPrepPanel({ task, canEdit }: { task: TaskItem; canEdit: boolean }) {
  const shared = isSharedTask(task);
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        Chuẩn bị & cùng làm — muốn tránh trùng giờ, xem lịch ở góc phải trên.
      </p>
      {canEdit ? <ScheduleBlock key={task.id} task={task} /> : <ScheduleSummary task={task} />}
      <ChecklistBlock task={task} canEdit={canEdit} />
      <ResourcesBlock task={task} canEdit={canEdit} />
      {shared ? <ParticipantsBlock task={task} /> : null}
    </div>
  );
}
