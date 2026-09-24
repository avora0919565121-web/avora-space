import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";
import type { Project } from "@/lib/projects";
import { todayIso } from "@/lib/tasks";
import type { ThinkRecord } from "@/lib/think-hub";
import { useProjectActions } from "@/lib/use-projects";

const fieldClass =
  "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";
const labelClass = "text-[13px] font-medium text-muted-foreground";

/** The "no Hạng mục" choice in the picker — ad-hoc work that came up in the project. */
const AD_HOC = "";

/**
 * Hands out one Task from the project screen.
 *
 * Choosing a Hạng mục is optional: left empty, the task is ad-hoc and still shows in the
 * project's own list. The task goes through the same two-step handshake as one raised in chat —
 * nothing starts until the person asked confirms it there.
 */
export function ProjectTaskDialog({
  open,
  onOpenChange,
  project,
  groupName,
  members,
  selfId,
  records,
  initialRecordId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Pick<Project, "id" | "conversationId" | "targetEndDate">;
  groupName: string;
  members: readonly GroupMember[];
  selfId: string | undefined;
  records: readonly ThinkRecord[];
  /** Pre-selects a Hạng mục when opened from under one; null opens as ad-hoc. */
  initialRecordId: string | null;
}) {
  const { createTask, isWorking } = useProjectActions();
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [recordId, setRecordId] = useState<string>(AD_HOC);
  const [notice, setNotice] = useState<string | null>(null);

  const candidates = useMemo(() => members.filter((member) => member.userId !== selfId), [members, selfId]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setDeadline("");
    setAssigneeId("");
    setRecordId(initialRecordId ?? AD_HOC);
    setNotice(null);
  }, [open, initialRecordId]);

  const isLate = deadline.length > 0 && deadline > project.targetEndDate;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (assigneeId.length === 0) {
      setNotice("Hãy chọn người nhận việc.");
      return;
    }
    setNotice(null);
    try {
      await createTask({
        project,
        groupName,
        recordId: recordId === AD_HOC ? null : recordId,
        assigneeId,
        title,
        description,
        deadline,
      });
      onOpenChange(false);
      toast.success("Đã giao việc. Việc bắt đầu khi người nhận xác nhận trong nhóm.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không giao được việc.");
    }
  }, [assigneeId, createTask, project, groupName, recordId, title, description, deadline, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Giao việc trong dự án</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Việc được gửi vào {groupName} để người nhận xác nhận.
        </DialogDescription>

        <div className="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <label htmlFor="project-task-record" className={labelClass}>
              Thuộc Hạng mục
            </label>
            <select
              id="project-task-record"
              value={recordId}
              onChange={(event) => setRecordId(event.target.value)}
              className={fieldClass}
            >
              <option value={AD_HOC}>Không thuộc Hạng mục nào (việc phát sinh)</option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="project-task-title" className={labelClass}>
              Việc cần làm
            </label>
            <input
              id="project-task-title"
              value={title}
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="project-task-description" className={labelClass}>
              Mô tả
            </label>
            <textarea
              id="project-task-description"
              value={description}
              rows={3}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Cần làm gì, xong thì trông như thế nào"
              className={fieldClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="project-task-assignee" className={labelClass}>
                Người nhận
              </label>
              <select
                id="project-task-assignee"
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
            <div>
              <label htmlFor="project-task-deadline" className={labelClass}>
                Hạn
              </label>
              <input
                id="project-task-deadline"
                type="date"
                value={deadline}
                min={todayIso()}
                onChange={(event) => setDeadline(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          {isLate ? (
            <p className="text-[12.5px] text-[hsl(var(--task-important))]">
              Hạn này sau ngày kết thúc dự kiến ({project.targetEndDate}). Dự án chưa đóng được khi còn việc như vậy.
            </p>
          ) : null}

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
          <Button type="button" disabled={isWorking} onClick={() => void handleSubmit()}>
            {isWorking ? "Đang giao…" : "Giao việc"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
