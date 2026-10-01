import { isSharedTask, isTaskAssignee, type TaskItem } from "@/lib/tasks";

/** The neutral name for someone AVORA cannot name (never an email). */
export const UNKNOWN_PERSON = "Người dùng AVORA";

export type TaskOwnership = {
  /** `Của tôi` · `Của tôi · từ Lan` · `Giao Lan · chờ nhận` · `Giao Lan` · `Lan → Minh`. */
  line: string;
  /** The viewer is the one who has to do it — the 3px orange stripe and a tappable circle. */
  isMine: boolean;
};

/**
 * Whose task this is, in one short line (AVORA-59 · B).
 *
 * `nameOf` resolves a user id to a display name (never an email); `peerOf` names the other side
 * of a 1-1 for rows written before the assignee was recorded.
 */
export function taskOwnership(
  task: Pick<TaskItem, "type" | "creatorId" | "assigneeId" | "status" | "conversationId">,
  userId: string | undefined,
  nameOf: (id: string | null) => string,
  peerOf: (conversationId: string | null) => string | null = () => null,
): TaskOwnership {
  const full = task as TaskItem;
  if (!isSharedTask(full)) {
    return task.creatorId === userId
      ? { line: "Của tôi", isMine: true }
      : { line: `Của ${nameOf(task.creatorId)}`, isMine: false };
  }

  const assigneeId: string | null =
    task.assigneeId ??
    (task.type === "1-1-shared" ? (task.creatorId === userId ? peerOf(task.conversationId) : (userId ?? null)) : null);

  if (isTaskAssignee(full, userId)) {
    return task.creatorId === userId
      ? { line: "Của tôi", isMine: true }
      : { line: `Của tôi · từ ${nameOf(task.creatorId)}`, isMine: true };
  }
  if (task.creatorId === userId) {
    const who = assigneeId === null ? "cả nhóm" : nameOf(assigneeId);
    return { line: task.status === "pending_confirmation" ? `Giao ${who} · chờ nhận` : `Giao ${who}`, isMine: false };
  }
  return {
    line: `${nameOf(task.creatorId)} → ${assigneeId === null ? "cả nhóm" : nameOf(assigneeId)}`,
    isMine: false,
  };
}
