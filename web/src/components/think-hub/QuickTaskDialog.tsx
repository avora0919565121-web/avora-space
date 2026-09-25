import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { useAuth } from "@/lib/auth";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import { createProjectTask, projectKeys, type Project } from "@/lib/projects";
import { browserTimezone } from "@/lib/task-schedule";
import { taskKeys, todayIso } from "@/lib/tasks";
import { createRecordTask, thinkHubKeys, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";

const fieldClass =
  "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";
const labelClass = "text-[13px] font-medium text-muted-foreground";

/**
 * "Tạo tác vụ" from one Hạng mục: title, a line of description, a deadline, and — in a group —
 * who takes it. The task is filed under this Hạng mục automatically.
 *
 * Where it goes follows the table: a Diary table makes a personal task; a 1-1 table asks the
 * other person; a group or project table asks the member chosen. Shared tasks wait for the
 * assignee to confirm in the conversation, exactly as if they had been raised there.
 */
export function QuickTaskDialog({
  record,
  table,
  project,
  conversationKind,
  conversationName,
  onOpenChange,
}: {
  record: ThinkRecord | null;
  table: ThinkTable | undefined;
  /** Set when the table belongs to a project. */
  project: Project | undefined;
  /** For a table shared in a conversation: which kind, so the right assignee field shows. */
  conversationKind: "direct" | "group" | null;
  conversationName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isSubmitting, guard } = useSubmitGuard();
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  const groupConversationId: string | null =
    project !== undefined ? project.conversationId : conversationKind === "group" ? (table?.conversationId ?? null) : null;

  const membersQuery = useQuery({
    queryKey: groupKeys.members(groupConversationId ?? ""),
    queryFn: () => fetchGroupMembers(groupConversationId as string),
    enabled: record !== null && groupConversationId !== null,
  });
  const candidates = useMemo(
    () => (membersQuery.data ?? []).filter((member) => member.userId !== user?.id),
    [membersQuery.data, user?.id],
  );

  useEffect(() => {
    if (record === null) return;
    setTitle(record.title);
    setDescription("");
    setDeadline(record.nextActionDate !== null && record.nextActionDate >= todayIso() ? record.nextActionDate : "");
    setAssigneeId("");
    setNotice(null);
  }, [record]);

  const needsAssignee = groupConversationId !== null;
  const where =
    project !== undefined
      ? `Việc được gửi vào nhóm dự án ${project.title} để người nhận xác nhận.`
      : conversationKind === "group"
        ? `Việc được gửi vào ${conversationName} để người nhận xác nhận.`
        : conversationKind === "direct"
          ? `Việc được gửi cho ${conversationName} để xác nhận.`
          : "Việc riêng của bạn, hiện ở Nhiệm vụ.";

  const submit = useCallback(async (): Promise<void> => {
    if (record === null || table === undefined) return;
    if (needsAssignee && assigneeId.length === 0) {
      setNotice("Hãy chọn người nhận việc.");
      return;
    }
    setNotice(null);
    await guard(async () => {
      try {
        if (project !== undefined) {
          await createProjectTask({
            project,
            groupName: conversationName,
            recordId: record.id,
            assigneeId,
            title,
            description,
            deadline,
          });
          void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        } else {
          await createRecordTask({
            recordId: record.id,
            title,
            description,
            deadline,
            assigneeId: needsAssignee ? assigneeId : null,
            deadlineTz: browserTimezone(),
          });
          void queryClient.invalidateQueries({ queryKey: thinkHubKeys.recordTasks });
        }
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
        toast.success(needsAssignee || conversationKind === "direct" ? "Đã giao việc, chờ người nhận xác nhận." : "Đã tạo việc.");
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không tạo được tác vụ.");
      }
    });
  }, [
    record,
    table,
    needsAssignee,
    assigneeId,
    guard,
    project,
    conversationName,
    title,
    description,
    deadline,
    queryClient,
    conversationKind,
    onOpenChange,
  ]);

  return (
    <Dialog open={record !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Tạo tác vụ</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Gắn vào Hạng mục “{record?.title ?? ""}”. {where}
        </DialogDescription>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="quick-task-title" className={labelClass}>
              Việc cần làm
            </label>
            <input
              id="quick-task-title"
              value={title}
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="quick-task-description" className={labelClass}>
              Mô tả
            </label>
            <textarea
              id="quick-task-description"
              value={description}
              rows={2}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Cần làm gì, xong thì trông như thế nào"
              className={fieldClass}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {needsAssignee ? (
              <div>
                <label htmlFor="quick-task-assignee" className={labelClass}>
                  Người nhận
                </label>
                <select
                  id="quick-task-assignee"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Chọn thành viên</option>
                  {candidates.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {memberLabel(member)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label htmlFor="quick-task-deadline" className={labelClass}>
                Hạn
              </label>
              <input
                id="quick-task-deadline"
                type="date"
                value={deadline}
                min={todayIso()}
                onChange={(event) => setDeadline(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Để sau
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? "Đang tạo…" : "Tạo tác vụ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
