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
import { eventSummary } from "@/lib/task-composer";

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
 * The schedule as one read-only block (ADR-030): Sự kiện, Hiện diện, duration. Editing happens in
 * the one task form ("Sửa"), so there is no separate "Lưu lịch" any more. Empty blocks are hidden.
 */
function ScheduleSummary({ task }: { task: TaskItem }) {
  const duration = formatDuration(task.estimatedDurationMinutes);
  const event = eventSummary(task.startAt, task.endAt, task.location);
  if (duration === null && event === null) return null;
  return (
    <div className="space-y-0.5 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-foreground">
      {event !== null ? (
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          {event}
        </p>
      ) : null}
      {task.requiresPresence && task.startAt !== null ? <p className="pl-5 text-muted-foreground">Có mặt trực tiếp</p> : null}
      {duration !== null ? <p className="text-muted-foreground">Dự kiến mất {duration}</p> : null}
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
export function TaskPrepPanel({
  task,
  canEdit,
  showPrivate = true,
}: {
  task: TaskItem;
  canEdit: boolean;
  /**
   * False for the proposer of a task that came from a suggestion (D3): Các bước and Mang theo are
   * the assignee's own and the server does not return them to anyone else.
   */
  showPrivate?: boolean;
}) {
  const shared = isSharedTask(task);
  return (
    <div className="space-y-3">
      <ScheduleSummary task={task} />
      {showPrivate ? <ChecklistBlock task={task} canEdit={canEdit} /> : null}
      {showPrivate ? <ResourcesBlock task={task} canEdit={canEdit} /> : null}
      {shared ? <ParticipantsBlock task={task} /> : null}
    </div>
  );
}
