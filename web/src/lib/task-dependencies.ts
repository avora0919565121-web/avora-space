import { supabase } from "@/integrations/supabase/client";
import { toVietnameseTaskError, type TaskItem } from "@/lib/tasks";

/**
 * "This cannot really start until that is done."
 *
 * A plain edge between two tasks, kept deliberately thin: it records that somebody said one
 * piece of work waits on another, and nothing else. It does not block completion, reorder
 * lists, or change any deadline — a stated dependency is a note about reality, not a rule the
 * app enforces on the person who wrote it.
 */
export const dependencyKeys = {
  all: ["task-dependencies"] as const,
  list: ["task-dependencies", "list"] as const,
};

export type TaskDependency = {
  taskId: string;
  dependsOnTaskId: string;
  createdBy: string;
  createdAt: string;
};

type DependencyRow = {
  task_id: string;
  depends_on_task_id: string;
  created_by: string;
  created_at: string;
};

const DEPENDENCY_COLUMNS = "task_id, depends_on_task_id, created_by, created_at";

/** Maps Postgres failures on the dependency table to short Vietnamese messages. */
export function toVietnameseDependencyError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("task_dependencies_not_self"))
    return "Một nhiệm vụ không thể chờ chính nó.";
  if (normalized.includes("duplicate key") || code === "23505")
    return "Liên kết này đã có rồi.";
  if (normalized.includes("row-level security"))
    return "Chỉ người giao và người nhận nhiệm vụ này mới gắn được phụ thuộc.";
  return toVietnameseTaskError(code, message);
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[task-dependencies] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseDependencyError(code, message));
}

function toDependency(row: DependencyRow): TaskDependency {
  return {
    taskId: row.task_id,
    dependsOnTaskId: row.depends_on_task_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Every link this person can see both ends of.
 *
 * A link whose other end is a task they cannot read is simply absent — not shown as a blank
 * row. Somebody may declare their work waits on something private, and the existence of that
 * private task is not theirs to leak.
 */
export async function fetchTaskDependencies(): Promise<TaskDependency[]> {
  const { data, error } = await supabase.from("task_dependencies").select(DEPENDENCY_COLUMNS);
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toDependency(row as DependencyRow));
}

export async function linkTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  userId: string,
): Promise<TaskDependency> {
  const { data, error } = await supabase
    .from("task_dependencies")
    .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId, created_by: userId })
    .select(DEPENDENCY_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);
  return toDependency(data as DependencyRow);
}

export async function unlinkTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
): Promise<void> {
  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("task_id", taskId)
    .eq("depends_on_task_id", dependsOnTaskId);

  if (error) throw fail(error.code, error.message);
}

/** What this task is waiting on. */
export function dependenciesOf(
  links: readonly TaskDependency[],
  taskId: string,
): TaskDependency[] {
  return links.filter((link) => link.taskId === taskId);
}

/** What is waiting on this task — the same relation read from the other end. */
export function dependentsOf(
  links: readonly TaskDependency[],
  taskId: string,
): TaskDependency[] {
  return links.filter((link) => link.dependsOnTaskId === taskId);
}

/**
 * Whether a proposed link would make a task wait on itself, directly or through a chain.
 *
 * Checked here as well as by the database because the constraint only catches the direct
 * case: A→B→A is two perfectly legal rows that together describe work that can never start.
 * Refusing it at the point somebody asks for it is kinder than storing a deadlock.
 */
export function wouldCycle(
  links: readonly TaskDependency[],
  taskId: string,
  dependsOnTaskId: string,
): boolean {
  if (taskId === dependsOnTaskId) return true;
  const seen = new Set<string>();
  const queue: string[] = [dependsOnTaskId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (current === taskId) return true;
    for (const link of links) {
      if (link.taskId === current) queue.push(link.dependsOnTaskId);
    }
  }
  return false;
}

/**
 * Which tasks may be offered as "waits on" for this one.
 *
 * Itself, anything already linked, and anything that would close a loop are left out. Tasks
 * already finished stay on the list on purpose: recording that work waited on something that
 * has since been delivered is exactly the history this is for.
 */
export function dependencyCandidates(
  tasks: readonly TaskItem[],
  links: readonly TaskDependency[],
  taskId: string,
): TaskItem[] {
  const existing = new Set(dependenciesOf(links, taskId).map((link) => link.dependsOnTaskId));
  return tasks.filter(
    (task) =>
      task.id !== taskId && !existing.has(task.id) && !wouldCycle(links, taskId, task.id),
  );
}

/** Replaces or adds one link in a cached list. Same reference when nothing changed. */
export function upsertDependency(
  list: readonly TaskDependency[],
  incoming: TaskDependency,
): TaskDependency[] {
  const exists = list.some(
    (link) => link.taskId === incoming.taskId && link.dependsOnTaskId === incoming.dependsOnTaskId,
  );
  return exists ? [...list] : [...list, incoming];
}

/** Drops one link from a cached list. */
export function removeDependency(
  list: readonly TaskDependency[],
  taskId: string,
  dependsOnTaskId: string,
): TaskDependency[] {
  return list.filter(
    (link) => !(link.taskId === taskId && link.dependsOnTaskId === dependsOnTaskId),
  );
}
