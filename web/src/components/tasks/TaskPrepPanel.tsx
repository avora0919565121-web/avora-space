import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import { inviteTaskParticipant, withdrawTaskInvitation } from "@/lib/task-collab-api";
import { isSharedTask, type TaskItem } from "@/lib/tasks";
import { taskCollabKeys, useResourceActions, useResources, useTaskParticipants } from "@/lib/use-task-collab";
import { cn } from "@/lib/utils";

const FIELD =
  "mt-1 w-full rounded-[8px] border border-input bg-card px-3 py-2 text-[16px] md:text-[14px] text-foreground outline-none focus:border-muted-foreground";
const LABEL = "text-[12px] font-medium text-muted-foreground";

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
 * `⋯ › Thêm` of the task card (AVORA-104 · PHẦN 2): what a task carries beside the ten rows —
 * the things to bring and who else is coming along. Các bước moved into the card itself.
 */
export function TaskPrepPanel({
  task,
  canEdit,
  showPrivate = true,
}: {
  task: TaskItem;
  canEdit: boolean;
  /**
   * False for the proposer of a task that came from a suggestion (D3): Mang theo is the
   * assignee's own and the server does not return it to anyone else.
   */
  showPrivate?: boolean;
}) {
  const shared = isSharedTask(task);
  return (
    <div className="space-y-3">
      {showPrivate ? <ResourcesBlock task={task} canEdit={canEdit} /> : null}
      {shared ? <ParticipantsBlock task={task} /> : null}
    </div>
  );
}
