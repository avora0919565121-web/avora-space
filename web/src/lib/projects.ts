import { supabase } from "@/integrations/supabase/client";

/**
 * A project: the three-tier spine of Objective → Deliverable → Task.
 *
 * A project LIVES INSIDE a conversation rather than beside one, and that is the whole
 * permission model. The conversation it sits in decides who it belongs to — a journal makes a
 * private project, a 1-1 thread makes a two-person one, a group makes the group's. There is no
 * "project type" column and no project membership list: the people already in the room are the
 * people who see it, which is the same rule tasks have always followed.
 */
export type ProjectStatus = "active" | "done" | "archived";

/**
 * The four charter questions, all optional.
 *
 * People open a project when they have an intention, not a scope document. Requiring these at
 * creation would turn a ten-second action into an essay, so the create form keeps them
 * collapsed and the database lets every one of them be empty.
 */
export type Project = {
  id: string;
  conversationId: string;
  createdBy: string;
  title: string;
  purpose: string | null;
  scope: string | null;
  successCriteria: string | null;
  assumptions: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type Objective = {
  id: string;
  projectId: string | null;
  conversationId: string;
  createdBy: string;
  title: string;
  status: ProjectStatus;
  sortOrder: number;
};

export type Deliverable = {
  id: string;
  objectiveId: string;
  title: string;
  status: ProjectStatus;
  sortOrder: number;
  /** Who signed this off, and when. Both null together, or both set together. */
  confirmedBy: string | null;
  confirmedAt: string | null;
};

/** One row of the join table: this task belongs to that deliverable. */
export type ProjectTaskLink = {
  taskId: string;
  projectId: string;
  deliverableId: string;
  linkedBy: string;
};

type ProjectRow = {
  id: string;
  conversation_id: string;
  created_by: string;
  title: string;
  purpose: string | null;
  scope: string | null;
  success_criteria: string | null;
  assumptions: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type ObjectiveRow = {
  id: string;
  project_id: string | null;
  conversation_id: string;
  created_by: string;
  title: string;
  status: string;
  sort_order: number;
};

type DeliverableRow = {
  id: string;
  objective_id: string;
  title: string;
  status: string;
  sort_order: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

type ProjectTaskRow = {
  task_id: string;
  project_id: string;
  deliverable_id: string;
  linked_by: string;
};

export const projectKeys = {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  tree: (projectId: string) => ["projects", "tree", projectId] as const,
};

function toStatus(value: string): ProjectStatus {
  // An unreadable status reads as 'active' rather than throwing: a row that exists is worth
  // showing, and 'active' is the one value that claims no progress has been made.
  return value === "done" || value === "archived" ? value : "active";
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    createdBy: row.created_by,
    title: row.title,
    purpose: row.purpose,
    scope: row.scope,
    successCriteria: row.success_criteria,
    assumptions: row.assumptions,
    status: toStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toObjective(row: ObjectiveRow): Objective {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    createdBy: row.created_by,
    title: row.title,
    status: toStatus(row.status),
    sortOrder: row.sort_order,
  };
}

function toDeliverable(row: DeliverableRow): Deliverable {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    title: row.title,
    status: toStatus(row.status),
    sortOrder: row.sort_order,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
  };
}

function toProjectTaskLink(row: ProjectTaskRow): ProjectTaskLink {
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    deliverableId: row.deliverable_id,
    linkedBy: row.linked_by,
  };
}

/** Raised when somebody who did not open the project tries to sign off a deliverable. */
export const NOT_PROJECT_OWNER = "avora_project_not_owner";

/** The database's refusals, in words the person reading them can act on. */
export function toVietnameseProjectError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes(NOT_PROJECT_OWNER))
    return "Chỉ người mở dự án mới xác nhận được kết quả này.";
  if (normalized.includes("dự án cần một tiêu đề")) return "Dự án cần một tiêu đề.";
  if (normalized.includes("dự án cần mục tiêu đầu tiên")) return "Hãy đặt mục tiêu đầu tiên.";
  if (normalized.includes("mục tiêu cần một tiêu đề")) return "Mục tiêu cần một tiêu đề.";
  if (normalized.includes("kết quả cần một tiêu đề")) return "Kết quả cần một tiêu đề.";
  if (normalized.includes("chỉ mở được dự án trong cuộc trò chuyện"))
    return "Bạn không còn trong cuộc trò chuyện này.";
  if (normalized.includes("bạn không còn trong cuộc trò chuyện"))
    return "Bạn không còn trong cuộc trò chuyện của dự án này.";
  if (normalized.includes("việc riêng chỉ nối được vào dự án riêng"))
    return "Việc riêng chỉ nối được vào dự án riêng của bạn.";
  if (normalized.includes("việc phải cùng cuộc trò chuyện"))
    return "Việc này thuộc cuộc trò chuyện khác.";
  if (normalized.includes("việc phải được nối vào kết quả của chính dự án"))
    return "Kết quả này không thuộc dự án đang mở.";
  if (normalized.includes("mục tiêu phải thuộc cùng cuộc trò chuyện"))
    return "Mục tiêu này thuộc cuộc trò chuyện khác.";
  if (normalized.includes("không tìm thấy dự án")) return "Dự án này không còn nữa.";
  if (normalized.includes("không tìm thấy mục tiêu")) return "Mục tiêu này không còn nữa.";
  if (normalized.includes("không tìm thấy kết quả")) return "Kết quả này không còn nữa.";
  if (normalized.includes("không tìm thấy việc")) return "Việc này không còn nữa.";
  if (normalized.includes("chưa đăng nhập"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với dự án này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

/** Whether a failure was the ownership rule, so the screen can explain instead of just warning. */
export function isNotOwnerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Chỉ người mở dự án");
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[projects] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseProjectError(code, message));
}

// ------------------------------------------------------------------ progress

/**
 * Percent complete is COMPUTED, never stored.
 *
 * A stored percentage is a second source of truth that drifts the moment a task is linked,
 * unlinked or reopened — and it would need a trigger on `tasks`, which this module is not
 * allowed to touch. Deriving it on read costs nothing at these sizes and cannot go stale.
 */
export type ProjectTree = {
  project: Project;
  objectives: Objective[];
  deliverables: Deliverable[];
  links: ProjectTaskLink[];
};

/** A task counts toward progress once it is fully closed — claimed AND accepted. */
export function isTaskComplete(status: string): boolean {
  return status === "done";
}

function percent(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

/**
 * How far one deliverable has come: finished tasks over linked tasks.
 *
 * A signed-off deliverable reads 100% whatever its tasks say. Confirmation is a person's
 * judgement that the result was delivered, and it outranks the checklist that led there —
 * otherwise a deliverable could be accepted and still show as unfinished forever.
 */
export function deliverableProgress(
  deliverable: Deliverable,
  links: readonly ProjectTaskLink[],
  taskStatusById: ReadonlyMap<string, string>,
): number {
  if (deliverable.confirmedAt !== null || deliverable.status === "done") return 100;

  const mine = links.filter((link) => link.deliverableId === deliverable.id);
  const done = mine.filter((link) => isTaskComplete(taskStatusById.get(link.taskId) ?? "")).length;
  return percent(done, mine.length);
}

/**
 * An objective's progress is the plain average of its deliverables.
 *
 * Unweighted on purpose: weighting would need someone to estimate effort per deliverable, and
 * a made-up weight reads as precision the number does not have.
 */
export function objectiveProgress(
  objective: Objective,
  tree: Pick<ProjectTree, "deliverables" | "links">,
  taskStatusById: ReadonlyMap<string, string>,
): number {
  const mine = tree.deliverables.filter((item) => item.objectiveId === objective.id);
  if (mine.length === 0) return 0;
  const total = mine.reduce(
    (sum, item) => sum + deliverableProgress(item, tree.links, taskStatusById),
    0,
  );
  return Math.round(total / mine.length);
}

/** And the project is the average of its objectives, by the same reasoning. */
export function projectProgress(
  tree: ProjectTree,
  taskStatusById: ReadonlyMap<string, string>,
): number {
  if (tree.objectives.length === 0) return 0;
  const total = tree.objectives.reduce(
    (sum, objective) => sum + objectiveProgress(objective, tree, taskStatusById),
    0,
  );
  return Math.round(total / tree.objectives.length);
}

/** The deliverables of one objective, in the order they were thought of. */
export function deliverablesOf(
  tree: Pick<ProjectTree, "deliverables">,
  objectiveId: string,
): Deliverable[] {
  return tree.deliverables
    .filter((item) => item.objectiveId === objectiveId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/** The ids of the tasks linked to one deliverable. */
export function taskIdsOf(tree: Pick<ProjectTree, "links">, deliverableId: string): string[] {
  return tree.links
    .filter((link) => link.deliverableId === deliverableId)
    .map((link) => link.taskId);
}

/** Only the person who opened a project signs off its deliverables. */
export function canConfirmDeliverable(project: Project, viewerId: string | undefined): boolean {
  return viewerId !== undefined && project.createdBy === viewerId;
}

// ------------------------------------------------------------------ reading

/** Every project the viewer can see. RLS returns the ones in their conversations. */
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toProject(row as ProjectRow));
}

/**
 * One project with its objectives, deliverables and task links.
 *
 * Four small queries rather than one nested select: each is a plain indexed lookup that RLS
 * can answer directly, and a failure names the tier it happened on instead of collapsing the
 * whole screen into one unreadable error.
 */
export async function fetchProjectTree(projectId: string): Promise<ProjectTree | null> {
  const projectResult = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (projectResult.error) throw fail(projectResult.error.code, projectResult.error.message);
  if (projectResult.data === null) return null;

  const objectivesResult = await supabase
    .from("objectives")
    .select("id, project_id, conversation_id, created_by, title, status, sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (objectivesResult.error) throw fail(objectivesResult.error.code, objectivesResult.error.message);

  const objectives = (objectivesResult.data ?? []).map((row) => toObjective(row as ObjectiveRow));
  const objectiveIds = objectives.map((item) => item.id);

  const deliverables: Deliverable[] = [];
  if (objectiveIds.length > 0) {
    const deliverablesResult = await supabase
      .from("deliverables")
      .select("id, objective_id, title, status, sort_order, confirmed_by, confirmed_at")
      .in("objective_id", objectiveIds)
      .order("sort_order", { ascending: true });
    if (deliverablesResult.error)
      throw fail(deliverablesResult.error.code, deliverablesResult.error.message);
    for (const row of deliverablesResult.data ?? []) {
      deliverables.push(toDeliverable(row as DeliverableRow));
    }
  }

  const linksResult = await supabase
    .from("project_tasks")
    .select("task_id, project_id, deliverable_id, linked_by")
    .eq("project_id", projectId);
  if (linksResult.error) throw fail(linksResult.error.code, linksResult.error.message);

  return {
    project: toProject(projectResult.data as ProjectRow),
    objectives,
    deliverables,
    links: (linksResult.data ?? []).map((row) => toProjectTaskLink(row as ProjectTaskRow)),
  };
}

/** Which projects a task belongs to, so a task row can point back at its project. */
export async function fetchTaskProjectLinks(): Promise<ProjectTaskLink[]> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("task_id, project_id, deliverable_id, linked_by");

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toProjectTaskLink(row as ProjectTaskRow));
}

// ------------------------------------------------------------------ writing

export type ProjectCharter = {
  purpose?: string;
  scope?: string;
  successCriteria?: string;
  assumptions?: string;
};

/**
 * Opens a project together with its first objective.
 *
 * The two titles travel together because a project with no objective is an empty name: the
 * detail screen would open onto three blank tiers with nothing to suggest a next step.
 */
export async function createProject(input: {
  conversationId: string;
  title: string;
  firstObjectiveTitle: string;
  charter?: ProjectCharter;
}): Promise<Project> {
  const title = input.title.trim();
  const objectiveTitle = input.firstObjectiveTitle.trim();
  if (title.length === 0) throw new Error("Dự án cần một tiêu đề.");
  if (objectiveTitle.length === 0) throw new Error("Hãy đặt mục tiêu đầu tiên.");

  const { data, error } = await supabase.rpc("create_project", {
    p_conversation_id: input.conversationId,
    p_title: title,
    p_first_objective_title: objectiveTitle,
    p_purpose: input.charter?.purpose?.trim() ?? undefined,
    p_scope: input.charter?.scope?.trim() ?? undefined,
    p_success_criteria: input.charter?.successCriteria?.trim() ?? undefined,
    p_assumptions: input.charter?.assumptions?.trim() ?? undefined,
  });

  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

/** Adds an objective. Anyone in the conversation can — objectives are what a room notices. */
export async function addObjective(projectId: string, title: string): Promise<Objective> {
  const clean = title.trim();
  if (clean.length === 0) throw new Error("Mục tiêu cần một tiêu đề.");

  const { data, error } = await supabase.rpc("add_objective", {
    p_project_id: projectId,
    p_title: clean,
  });

  if (error) throw fail(error.code, error.message);
  return toObjective(data as unknown as ObjectiveRow);
}

/** Adds a deliverable under an objective. */
export async function addDeliverable(objectiveId: string, title: string): Promise<Deliverable> {
  const clean = title.trim();
  if (clean.length === 0) throw new Error("Kết quả cần một tiêu đề.");

  const { data, error } = await supabase.rpc("add_deliverable", {
    p_objective_id: objectiveId,
    p_title: clean,
  });

  if (error) throw fail(error.code, error.message);
  return toDeliverable(data as unknown as DeliverableRow);
}

/**
 * Points an existing task at a deliverable.
 *
 * Never creates a task: tasks are born in the journal or in a chat, with their own context and
 * confirmation handshake. Linking again moves the task rather than failing — replanning is
 * ordinary, not an error.
 */
export async function linkTaskToProject(
  taskId: string,
  deliverableId: string,
): Promise<ProjectTaskLink> {
  const { data, error } = await supabase.rpc("link_task_to_project", {
    p_task_id: taskId,
    p_deliverable_id: deliverableId,
  });

  if (error) throw fail(error.code, error.message);
  return toProjectTaskLink(data as unknown as ProjectTaskRow);
}

/**
 * Takes a task back out of a project.
 *
 * Deletes the join row only — the task itself, its history and its confirmations are untouched.
 * That separation is the reason the join table exists instead of a column on `tasks`.
 */
export async function unlinkTaskFromProject(taskId: string): Promise<void> {
  const { error } = await supabase.from("project_tasks").delete().eq("task_id", taskId);
  if (error) throw fail(error.code, error.message);
}

/** Signs off a deliverable. The server refuses anyone but the project's owner. */
export async function confirmDeliverable(deliverableId: string): Promise<Deliverable> {
  const { data, error } = await supabase.rpc("confirm_deliverable", {
    p_deliverable_id: deliverableId,
  });

  if (error) throw fail(error.code, error.message);
  return toDeliverable(data as unknown as DeliverableRow);
}

/** Rewrites the charter, or the title. Owner only, enforced by RLS. */
export async function updateProjectDetails(input: {
  projectId: string;
  title?: string;
  charter?: ProjectCharter;
}): Promise<void> {
  // Typed field by field rather than as a loose record: the columns writable in place are
  // exactly the five below, and an index signature would let a typo compile into a silent no-op.
  const patch: {
    title?: string;
    purpose?: string | null;
    scope?: string | null;
    success_criteria?: string | null;
    assumptions?: string | null;
  } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) throw new Error("Dự án cần một tiêu đề.");
    patch.title = trimmed;
  }
  if (input.charter?.purpose !== undefined)
    patch.purpose = input.charter.purpose.trim() || null;
  if (input.charter?.scope !== undefined) patch.scope = input.charter.scope.trim() || null;
  if (input.charter?.successCriteria !== undefined)
    patch.success_criteria = input.charter.successCriteria.trim() || null;
  if (input.charter?.assumptions !== undefined)
    patch.assumptions = input.charter.assumptions.trim() || null;

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("projects").update(patch).eq("id", input.projectId);
  if (error) throw fail(error.code, error.message);
}

/** Renames an objective or a deliverable in place. Any member of the conversation may. */
export async function renameObjective(objectiveId: string, title: string): Promise<void> {
  const clean = title.trim();
  if (clean.length === 0) throw new Error("Mục tiêu cần một tiêu đề.");
  const { error } = await supabase.from("objectives").update({ title: clean }).eq("id", objectiveId);
  if (error) throw fail(error.code, error.message);
}

export async function renameDeliverable(deliverableId: string, title: string): Promise<void> {
  const clean = title.trim();
  if (clean.length === 0) throw new Error("Kết quả cần một tiêu đề.");
  const { error } = await supabase
    .from("deliverables")
    .update({ title: clean })
    .eq("id", deliverableId);
  if (error) throw fail(error.code, error.message);
}

/** Where a project lives. */
export function projectLink(projectId: string): string {
  return `/du-an/${projectId}`;
}
