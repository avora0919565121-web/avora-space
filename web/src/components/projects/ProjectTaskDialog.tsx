import { useMemo, useState } from "react";

import { TaskComposer } from "@/components/tasks/TaskComposer";
import { useAuth } from "@/lib/auth";
import type { GroupMember } from "@/lib/groups";
import type { Project } from "@/lib/projects";
import { buildContextSnapshot } from "@/lib/task-context";
import type { ThinkRecord } from "@/lib/think-hub";
import { useComposerActions, useTaskRecipientIds, type ComposerValues } from "@/lib/use-task-composer";

/**
 * Tạo việc from the project screen — the one task form (ADR-030), place "group".
 *
 * The Nguồn line names the project and holds the optional Hạng mục. Everything goes through the
 * suggestion path with the project (and Hạng mục) attached, so the task is filed there the moment
 * it is accepted — "Cho tôi" is accepted at once (the group's self-take path).
 */
export function ProjectTaskDialog({
  open,
  onOpenChange,
  project,
  groupName,
  members,
  records,
  initialRecordId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Pick<Project, "id" | "conversationId" | "title">;
  groupName: string;
  members: readonly GroupMember[];
  /** Kept for callers; the form resolves "you" from the session. */
  selfId?: string | undefined;
  records: readonly ThinkRecord[];
  /** Pre-selects a Hạng mục when opened from under one; null opens as ad-hoc. */
  initialRecordId: string | null;
}) {
  const { user } = useAuth();
  const { proposeOne } = useComposerActions();
  const [recordId, setRecordId] = useState<string | null>(initialRecordId);
  const recipientIds = useTaskRecipientIds(open ? project.conversationId : null);
  const reachable = useMemo(() => {
    const allowed = new Set<string>(recipientIds.data ?? []);
    return members.filter((member) => allowed.has(member.userId));
  }, [members, recipientIds.data]);
  const record = records.find((entry) => entry.id === recordId) ?? null;

  const send = async (assigneeId: string, values: ComposerValues, isSelf: boolean): Promise<void> => {
    await proposeOne(
      {
        conversationId: project.conversationId,
        assigneeId,
        messageId: null,
        contextSnapshot: buildContextSnapshot({
          conversationType: "group",
          conversationId: project.conversationId,
          conversationName: groupName,
          message: null,
          senderName: "",
          userResponse: record === null ? `Dự án: ${project.title}` : `Hạng mục: ${record.title}`,
        }),
        projectId: project.id,
        recordId,
      },
      values,
      isSelf,
    );
  };

  return (
    <TaskComposer
      open={open}
      onOpenChange={onOpenChange}
      place="group"
      members={reachable}
      source={{
        label: `Dự án ${project.title}${record !== null ? ` · Hạng mục ${record.title}` : ""}`,
        defaultOpen: records.length > 0 && initialRecordId === null,
        render: () => (
          <div>
            <label htmlFor="composer-project-record" className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Hạng mục (không bắt buộc)
            </label>
            <select
              id="composer-project-record"
              value={recordId ?? ""}
              onChange={(event) => setRecordId(event.target.value === "" ? null : event.target.value)}
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[14px] text-foreground outline-none focus:border-muted-foreground"
            >
              <option value="">Không thuộc Hạng mục nào (việc phát sinh)</option>
              {records.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </div>
        ),
      }}
      onCreateMine={async (values) => {
        if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        await send(user.id, values, true);
      }}
      onPropose={(assigneeId, values) => send(assigneeId, values, false)}
    />
  );
}
