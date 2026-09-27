import { MessageSquareQuote, PanelRightOpen, X } from "lucide-react";
import { memo, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";

import { conversationTitle, type ConversationSummary } from "@/lib/chat";
import { hereFrom, withReturn } from "@/lib/return-to";
import { contextLink } from "@/lib/task-context";
import { deadlineLabel, todayIso, type TaskItem } from "@/lib/tasks";
import { useProjects, useTaskProjectLinks } from "@/lib/use-projects";
import { useThinkRecords } from "@/lib/use-think-hub";

/**
 * "Why am I here" (AVORA-39 / Phần 1 · B1–B2).
 *
 * Arriving in a chat from a task link, this strip names the task and where it belongs — project,
 * Hạng mục, the group it was agreed in when that is not this chat, its deadline — with a way to
 * open it, a way to its original message when that lives elsewhere, and a way to dismiss it.
 * It never opens the keyboard: the person came to read, not to type.
 */
export const TaskContextStrip = memo(function TaskContextStrip({
  task,
  conversationId,
  conversations,
  threadTitle,
  onOpenDetail,
  onDismiss,
}: {
  task: TaskItem;
  conversationId: string;
  conversations: readonly ConversationSummary[];
  threadTitle: string;
  onOpenDetail: () => void;
  onDismiss: () => void;
}) {
  const location = useLocation();
  const projectLinks = useTaskProjectLinks();
  const { data: projects } = useProjects();
  const { data: records } = useThinkRecords();

  const parts: string[] = useMemo(() => {
    const out: string[] = [];
    const link = projectLinks.get(task.id);
    const project =
      (link !== undefined ? (projects ?? []).find((entry) => entry.id === link.projectId) : undefined) ??
      (projects ?? []).find((entry) => entry.conversationId === conversationId && task.conversationId === conversationId);
    if (project !== undefined) out.push(`Dự án ${project.title}`);
    if (link?.recordId != null) {
      const record = (records ?? []).find((entry) => entry.id === link.recordId);
      if (record !== undefined) out.push(`Hạng mục ${record.title}`);
    }
    if (task.conversationId !== null && task.conversationId !== conversationId) {
      const origin = conversations.find((entry) => entry.conversationId === task.conversationId);
      if (origin !== undefined) out.push(`Thống nhất ở ${conversationTitle(origin)}`);
    }
    const due = deadlineLabel(task.deadline, todayIso());
    if (due !== null) out.push(task.deadlineTime !== null ? `${due} · ${task.deadlineTime.slice(0, 5)}` : due);
    return out;
  }, [projectLinks, projects, records, conversations, task, conversationId]);

  // The original message lives in another chat only when the task was agreed there.
  const originalElsewhere: string | null =
    task.contextSnapshot !== null && task.contextSnapshot.conversationId !== conversationId
      ? task.contextSnapshot.conversationId
      : task.contextSnapshot === null && task.conversationId !== null && task.conversationId !== conversationId
        ? task.conversationId
        : null;

  return (
    <div role="region" aria-label="Việc bạn đang xem" className="border-b border-primary/25 bg-primary/[0.05] px-5 py-2.5 md:px-10">
      <div className="mx-auto flex max-w-2xl items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-foreground">{task.title}</p>
          {parts.length > 0 ? (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{parts.join(" · ")}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenDetail}
              className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              Mở chi tiết
            </button>
            {originalElsewhere !== null ? (
              <Link
                to={withReturn(contextLink(originalElsewhere, task.id), hereFrom(location, threadTitle))}
                className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                <MessageSquareQuote className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                Tin nhắn gốc
              </Link>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Ẩn dải việc đang xem"
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});
