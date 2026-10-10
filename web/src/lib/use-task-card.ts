import { checklistProgress } from "@/lib/task-collab";
import { useTaskFiles } from "@/lib/task-files";
import { useChecklist } from "@/lib/use-task-collab";

/** AVORA-104 · PHẦN 2 — the folded-group lines of a live task card. */

/** `1/2` for a live task's steps, or null. */
export function useLiveStepsLine(taskId: string | null): string | null {
  const { data } = useChecklist(taskId);
  const progress = checklistProgress(data ?? []);
  return progress === null ? null : `${progress.done}/${progress.total}`;
}

/** How many files a live task carries (for the folded `TỆP` line). */
export function useLiveFilesLine(taskId: string | null, messageIds: readonly string[]): string | null {
  const { data } = useTaskFiles(taskId, messageIds);
  const count = data?.length ?? 0;
  return count === 0 ? null : `${count} tệp`;
}
