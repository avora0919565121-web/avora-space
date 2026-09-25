import { supabase } from "@/integrations/supabase/client";
import { buildContextSnapshot, snapshotToJson } from "@/lib/task-context";
import { browserTimezone } from "@/lib/task-schedule";
import { todayIso, validateTaskDraft } from "@/lib/tasks";

/**
 * A project: group work with a charter, measured against success criteria, carried out as Tasks.
 *
 * A project lives inside one group conversation (ADR-002) and the people in that group are the
 * people who see it. Its thinking lives in exactly one root Think Hub table, made together with
 * the project; each record ("Hạng mục") there can carry Tasks. A Task with no record is ad-hoc
 * work that came up in the project's chat — ordinary, and still counted.
 *
 * There is no Objective/Deliverable tier any more (ADR-005): structure is Record → Task only.
 */
/** `done` = closed with every criterion met; `closed_early` = stopped before that, with a private reason. */
export type ProjectStatus = "active" | "done" | "closed_early" | "archived";

export type Project = {
  id: string;
  /** The project's own sub-group — its chat and its members. */
  conversationId: string;
  /** The group the project was opened from (the sub-group's parent), when known. */
  parentGroupId: string | null;
  createdBy: string;
  title: string;
  /** Kim chỉ nam — the direction the work serves. Required at creation. */
  valueOrientation: string;
  /** Mục tiêu — what this project sets out to achieve. Required at creation. */
  objective: string;
  scope: string | null;
  assumptions: string | null;
  /** Chosen by the person opening the project; never defaulted to today. */
  startDate: string;
  targetEndDate: string;
  status: ProjectStatus;
  closedAt: string | null;
  /** The leader's own thank-you, posted once into the project chat and pinned. */
  thanksMessageId: string | null;
  /** Set only on rows read from the bin (`list_deleted_projects`). */
  deletedAt: string | null;
  deleteReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The private look back after closing early — only the project's opener can read it. */
export type CheckAdjust = {
  projectId: string;
  closeReason: string;
  note: string | null;
};

export type MeasurementType = "percentage" | "meeting_confirmation";

export type SuccessCriterion = {
  id: string;
  projectId: string;
  description: string;
  measurementType: MeasurementType;
  targetPercent: number | null;
  actualPercent: number | null;
  /** A finalized meeting note in the project's group, for `meeting_confirmation`. */
  meetingNoteId: string | null;
  createdAt: string;
};

/** One row of the join table: this task belongs to that project, under that record or none. */
export type ProjectTaskLink = {
  taskId: string;
  projectId: string;
  /** Null = ad-hoc task. */
  recordId: string | null;
  linkedBy: string;
};

export type ProjectDetail = {
  project: Project;
  criteria: SuccessCriterion[];
  links: ProjectTaskLink[];
};

type ProjectRow = {
  id: string;
  conversation_id: string;
  created_by: string;
  title: string;
  value_orientation: string;
  objective: string;
  scope: string | null;
  assumptions: string | null;
  start_date: string;
  target_end_date: string;
  status: string;
  closed_at?: string | null;
  thanks_message_id?: string | null;
  deleted_at?: string | null;
  delete_reason?: string | null;
  conversation?: { parent_group_id: string | null } | null;
  created_at: string;
  updated_at: string;
};

type CriterionRow = {
  id: string;
  project_id: string;
  description: string;
  measurement_type: string;
  target_percent: number | string | null;
  actual_percent: number | string | null;
  meeting_note_id: string | null;
  created_at: string;
};

type ProjectTaskRow = {
  task_id: string;
  project_id: string;
  record_id: string | null;
  linked_by: string;
};

export const projectKeys = {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  taskLinks: ["projects", "task-links"] as const,
};

function toStatus(value: string): ProjectStatus {
  // An unreadable status reads as 'active': a row that exists is worth showing, and 'active'
  // is the one value that claims no progress has been made.
  return value === "done" || value === "closed_early" || value === "archived" ? value : "active";
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentGroupId: row.conversation?.parent_group_id ?? null,
    createdBy: row.created_by,
    title: row.title,
    valueOrientation: row.value_orientation,
    objective: row.objective,
    scope: row.scope,
    assumptions: row.assumptions,
    startDate: row.start_date,
    targetEndDate: row.target_end_date,
    status: toStatus(row.status),
    closedAt: row.closed_at ?? null,
    thanksMessageId: row.thanks_message_id ?? null,
    deletedAt: row.deleted_at ?? null,
    deleteReason: row.delete_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Whether a project still takes changes. Closed projects stay readable, not writable. */
export function isProjectOpen(project: Pick<Project, "status">): boolean {
  return project.status === "active";
}

/** A short status word for lists and headers. */
export function projectStatusLabel(status: ProjectStatus): string | null {
  if (status === "done") return "Đã đóng";
  if (status === "closed_early") return "Đã dừng sớm";
  if (status === "archived") return "Đã lưu trữ";
  return null;
}

function toCriterion(row: CriterionRow): SuccessCriterion {
  return {
    id: row.id,
    projectId: row.project_id,
    description: row.description,
    measurementType: row.measurement_type === "meeting_confirmation" ? "meeting_confirmation" : "percentage",
    targetPercent: toNumber(row.target_percent),
    actualPercent: toNumber(row.actual_percent),
    meetingNoteId: row.meeting_note_id,
    createdAt: row.created_at,
  };
}

function toProjectTaskLink(row: ProjectTaskRow): ProjectTaskLink {
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    recordId: row.record_id,
    linkedBy: row.linked_by,
  };
}

// ------------------------------------------------------------------ errors

/** The database's refusals, in words the person reading them can act on. */
export function toVietnameseProjectError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("avora_project_not_owner"))
    return "Chỉ người mở dự án mới làm được việc này.";
  if (normalized.includes("avora_project_title_required")) return "Dự án cần một tiêu đề.";
  if (normalized.includes("avora_project_value_required")) return "Hãy viết Kim chỉ nam của dự án.";
  if (normalized.includes("avora_project_objective_required")) return "Hãy viết Mục tiêu của dự án.";
  if (normalized.includes("avora_project_dates_required"))
    return "Hãy chọn ngày bắt đầu và ngày kết thúc dự kiến.";
  if (normalized.includes("avora_project_dates_order"))
    return "Ngày kết thúc dự kiến không được trước ngày bắt đầu.";
  if (normalized.includes("avora_project_group_only")) return "Dự án chỉ mở được trong Nhóm.";
  if (normalized.includes("avora_project_closed")) return "Dự án đã đóng, không thay đổi được nữa.";
  if (normalized.includes("avora_project_criteria_open"))
    return "Còn tiêu chí thành công chưa có kết quả. Ghi kết quả hoặc bỏ tiêu chí trước khi đóng.";
  if (normalized.includes("avora_project_task_past_end"))
    return "Còn nhiệm vụ có hạn sau ngày kết thúc dự kiến.";
  if (normalized.includes("avora_project_record_foreign"))
    return "Hạng mục này không thuộc dự án đang mở.";
  if (normalized.includes("avora_project_task_foreign_conversation"))
    return "Nhiệm vụ này thuộc cuộc trò chuyện khác.";
  if (normalized.includes("avora_project_missing")) return "Dự án này không còn nữa.";
  if (normalized.includes("avora_group_sub_not_allowed"))
    return "Chỉ Owner hoặc Admin của nhóm mới mở được dự án.";
  if (normalized.includes("avora_group_depth_limit"))
    return "Nhóm này đã ở tầng thứ 3. Hãy mở dự án từ một nhóm tầng trên, hoặc tạo một nhóm gốc mới.";
  if (normalized.includes("avora_project_close_reason_required")) return "Hãy ghi lý do đóng sớm.";
  if (normalized.includes("avora_project_close_reason_too_long")) return "Lý do quá dài.";
  if (normalized.includes("avora_project_thanks_already")) return "Lời cảm ơn đã được gửi rồi.";
  if (normalized.includes("avora_project_thanks_empty")) return "Hãy viết vài dòng trước khi gửi.";
  if (normalized.includes("avora_project_thanks_not_closed")) return "Chỉ gửi lời cảm ơn sau khi dự án đã đóng.";
  if (normalized.includes("avora_project_delete_root_owner_only"))
    return "Chỉ Owner của nhóm gốc mới xoá hoặc khôi phục được dự án.";
  if (normalized.includes("avora_project_delete_title_mismatch")) return "Tên gõ lại chưa khớp đúng tên dự án.";
  if (normalized.includes("avora_project_delete_reason_required")) return "Hãy ghi lý do xoá.";
  if (normalized.includes("avora_project_chat_closed"))
    return "Dự án đã đóng nên cuộc trò chuyện chỉ còn để đọc.";
  if (normalized.includes("avora_criterion_description_required"))
    return "Tiêu chí cần một dòng mô tả.";
  if (normalized.includes("avora_criterion_type_invalid")) return "Cách đo này không hợp lệ.";
  if (normalized.includes("avora_criterion_evidence_mismatch"))
    return "Kết quả không khớp với cách đo của tiêu chí.";
  if (normalized.includes("avora_criterion_meeting_note_invalid"))
    return "Chỉ gắn được biên bản họp đã chốt của nhóm này.";
  if (normalized.includes("avora_task_assignee_required") || normalized.includes("avora_task_assignee_not_participant"))
    return "Hãy chọn một thành viên của nhóm để giao việc.";
  if (normalized.includes("avora_task_self_assign")) return "Việc giao đi cần một người khác nhận.";
  if (normalized.includes("avora_task_deadline_past")) return "Hạn không được ở quá khứ.";
  if (normalized.includes("avora_not_a_participant"))
    return "Bạn không còn trong cuộc trò chuyện này.";
  if (normalized.includes("avora_not_signed_in"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với dự án này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[projects] ${code ?? "unknown"}`);
  return new Error(toVietnameseProjectError(code, message));
}

// ------------------------------------------------------------------ charter

export type CharterDraft = {
  title: string;
  valueOrientation: string;
  objective: string;
  startDate: string;
  targetEndDate: string;
  scope: string;
  assumptions: string;
};

export const EMPTY_CHARTER: CharterDraft = {
  title: "",
  valueOrientation: "",
  objective: "",
  startDate: "",
  targetEndDate: "",
  scope: "",
  assumptions: "",
};

/**
 * The first thing still missing from a charter, or null when it can be opened. The same four
 * fields and the same date rule the server enforces — the button explains before the server refuses.
 */
export function charterProblem(draft: CharterDraft): string | null {
  if (draft.title.trim().length === 0) return "Dự án cần một tiêu đề.";
  if (draft.valueOrientation.trim().length === 0) return "Hãy viết Kim chỉ nam của dự án.";
  if (draft.objective.trim().length === 0) return "Hãy viết Mục tiêu của dự án.";
  if (draft.startDate.length === 0) return "Hãy chọn ngày bắt đầu.";
  if (draft.targetEndDate.length === 0) return "Hãy chọn ngày kết thúc dự kiến.";
  if (draft.targetEndDate < draft.startDate) return "Ngày kết thúc dự kiến không được trước ngày bắt đầu.";
  return null;
}

// ------------------------------------------------------------------ progress and closing

/** A task counts toward progress once it is fully closed — claimed AND accepted. */
export function isTaskComplete(status: string): boolean {
  return status === "done";
}

/** Skipped work is neither progress nor a blocker. */
function isCounted(status: string | undefined): boolean {
  return status !== undefined && status !== "skipped";
}

function percent(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

/** The task ids filed under one record, or the ad-hoc ones when `recordId` is null. */
export function taskIdsOf(links: readonly ProjectTaskLink[], recordId: string | null): string[] {
  return links.filter((link) => link.recordId === recordId).map((link) => link.taskId);
}

/**
 * Finished over counted tasks — computed on read, never stored, so it cannot drift from the
 * tasks themselves. Skipped work leaves the count.
 */
export function taskProgress(
  taskIds: readonly string[],
  statusById: ReadonlyMap<string, string>,
): number {
  const counted = taskIds.filter((id) => isCounted(statusById.get(id)));
  const done = counted.filter((id) => isTaskComplete(statusById.get(id) ?? "")).length;
  return percent(done, counted.length);
}

/** The whole project: every linked task, records and ad-hoc alike, counts once. */
export function projectProgress(
  links: readonly ProjectTaskLink[],
  statusById: ReadonlyMap<string, string>,
): number {
  return taskProgress(
    links.map((link) => link.taskId),
    statusById,
  );
}

/** Whether a criterion has its evidence: a measured number, or a finalized meeting note. */
export function isCriterionRecorded(criterion: SuccessCriterion): boolean {
  return criterion.measurementType === "percentage"
    ? criterion.actualPercent !== null
    : criterion.meetingNoteId !== null;
}

export type CloseBlockers = {
  openCriteria: number;
  lateTasks: number;
};

/**
 * What still stands between a project and "done" — the same two rules `close_project` checks:
 * every live criterion has its evidence, and no counted task is due after the target end date.
 */
export function closeBlockers(
  detail: Pick<ProjectDetail, "project" | "criteria" | "links">,
  taskById: ReadonlyMap<string, { status: string; deadline: string | null }>,
): CloseBlockers {
  const openCriteria = detail.criteria.filter((criterion) => !isCriterionRecorded(criterion)).length;
  let lateTasks = 0;
  for (const link of detail.links) {
    const task = taskById.get(link.taskId);
    if (task === undefined || task.status === "skipped" || task.deadline === null) continue;
    if (task.deadline > detail.project.targetEndDate) lateTasks += 1;
  }
  return { openCriteria, lateTasks };
}

export function canClose(blockers: CloseBlockers): boolean {
  return blockers.openCriteria === 0 && blockers.lateTasks === 0;
}

/** The one line under a disabled "Đóng dự án" button. */
export function closeBlockerSentence(blockers: CloseBlockers): string | null {
  const parts: string[] = [];
  if (blockers.openCriteria > 0) parts.push(`${blockers.openCriteria} tiêu chí chưa có kết quả`);
  if (blockers.lateTasks > 0) parts.push(`${blockers.lateTasks} nhiệm vụ có hạn sau ngày kết thúc`);
  return parts.length === 0 ? null : `Còn ${parts.join(" và ")}.`;
}

/** Only the person who opened a project records results, adds criteria and closes it. */
export function isProjectOwner(project: Pick<Project, "createdBy">, viewerId: string | undefined): boolean {
  return viewerId !== undefined && project.createdBy === viewerId;
}

// ------------------------------------------------------------------ reading

/** Every project the viewer can see. RLS returns the ones in their groups. */
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*, conversation:conversations(parent_group_id)")
    .order("created_at", { ascending: false });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toProject(row as unknown as ProjectRow));
}

/** One project with its live success criteria and task links. */
export async function fetchProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await supabase
    .from("projects")
    .select("*, conversation:conversations(parent_group_id)")
    .eq("id", projectId)
    .maybeSingle();
  if (projectResult.error) throw fail(projectResult.error.code, projectResult.error.message);
  if (projectResult.data === null) return null;

  const [criteriaResult, linksResult] = await Promise.all([
    supabase
      .from("project_success_criteria")
      .select("id, project_id, description, measurement_type, target_percent, actual_percent, meeting_note_id, created_at")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase.from("project_tasks").select("task_id, project_id, record_id, linked_by").eq("project_id", projectId),
  ]);
  if (criteriaResult.error) throw fail(criteriaResult.error.code, criteriaResult.error.message);
  if (linksResult.error) throw fail(linksResult.error.code, linksResult.error.message);

  return {
    project: toProject(projectResult.data as unknown as ProjectRow),
    criteria: (criteriaResult.data ?? []).map((row) => toCriterion(row as CriterionRow)),
    links: (linksResult.data ?? []).map((row) => toProjectTaskLink(row as ProjectTaskRow)),
  };
}

/** Which project each task belongs to, so a task row can point back at its project. */
export async function fetchTaskProjectLinks(): Promise<ProjectTaskLink[]> {
  const { data, error } = await supabase.from("project_tasks").select("task_id, project_id, record_id, linked_by");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toProjectTaskLink(row as ProjectTaskRow));
}

// ------------------------------------------------------------------ writing

/** Opens a project in a group, with its charter and its one root table. */
export async function createProject(conversationId: string, draft: CharterDraft): Promise<Project> {
  const problem = charterProblem(draft);
  if (problem !== null) throw new Error(problem);

  const { data, error } = await supabase.rpc("create_project", {
    p_conversation_id: conversationId,
    p_title: draft.title.trim(),
    p_value_orientation: draft.valueOrientation.trim(),
    p_objective: draft.objective.trim(),
    p_start_date: draft.startDate,
    p_target_end_date: draft.targetEndDate,
    p_scope: draft.scope.trim() || undefined,
    p_assumptions: draft.assumptions.trim() || undefined,
  });

  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

/** Rewords the charter. Owner only (RLS); dates and status are not writable here. */
export async function updateProjectCharter(
  projectId: string,
  patch: { title?: string; valueOrientation?: string; objective?: string; scope?: string; assumptions?: string },
): Promise<void> {
  const body: {
    title?: string;
    value_orientation?: string;
    objective?: string;
    scope?: string | null;
    assumptions?: string | null;
  } = {};
  if (patch.title !== undefined) {
    if (patch.title.trim().length === 0) throw new Error("Dự án cần một tiêu đề.");
    body.title = patch.title.trim();
  }
  if (patch.valueOrientation !== undefined) {
    if (patch.valueOrientation.trim().length === 0) throw new Error("Hãy viết Kim chỉ nam của dự án.");
    body.value_orientation = patch.valueOrientation.trim();
  }
  if (patch.objective !== undefined) {
    if (patch.objective.trim().length === 0) throw new Error("Hãy viết Mục tiêu của dự án.");
    body.objective = patch.objective.trim();
  }
  if (patch.scope !== undefined) body.scope = patch.scope.trim() || null;
  if (patch.assumptions !== undefined) body.assumptions = patch.assumptions.trim() || null;
  if (Object.keys(body).length === 0) return;

  const { error } = await supabase.from("projects").update(body).eq("id", projectId);
  if (error) throw fail(error.code, error.message);
}

export async function addSuccessCriterion(input: {
  projectId: string;
  description: string;
  measurementType: MeasurementType;
  targetPercent: number | null;
}): Promise<void> {
  if (input.description.trim().length === 0) throw new Error("Tiêu chí cần một dòng mô tả.");
  const { error } = await supabase.rpc("add_project_success_criterion", {
    p_project_id: input.projectId,
    p_description: input.description.trim(),
    p_measurement_type: input.measurementType,
    p_target_percent: input.measurementType === "percentage" ? (input.targetPercent ?? undefined) : undefined,
  });
  if (error) throw fail(error.code, error.message);
}

/**
 * Records the evidence for a criterion. Always a person's own action — the owner types the
 * number or picks the meeting note; nothing records it on their behalf.
 */
export async function recordSuccessCriterion(input: {
  criterionId: string;
  actualPercent?: number | null;
  meetingNoteId?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("record_project_success_criterion", {
    p_criterion_id: input.criterionId,
    p_actual_percent: input.actualPercent ?? undefined,
    p_meeting_note_id: input.meetingNoteId ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
}

/** Soft-deletes a criterion: it leaves the list and the close check, the row stays. */
export async function deleteSuccessCriterion(criterionId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_project_success_criterion", { p_criterion_id: criterionId });
  if (error) throw fail(error.code, error.message);
}

/** Closes a project. The server re-checks every blocker and refuses anyone but the owner. */
export async function closeProject(projectId: string): Promise<Project> {
  const { data, error } = await supabase.rpc("close_project", { p_project_id: projectId });
  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

export type ProjectTaskInput = {
  project: Pick<Project, "id" | "conversationId">;
  groupName: string;
  /** Null files it as ad-hoc work. */
  recordId: string | null;
  assigneeId: string;
  title: string;
  description: string;
  deadline: string;
  deadlineTime?: string;
};

/**
 * Hands out a Task from the project screen. Same path as a group task raised in chat —
 * pending until the assignee confirms — then filed under the chosen record, or ad-hoc.
 */
export async function createProjectTask(input: ProjectTaskInput, today: string = todayIso()): Promise<string> {
  const clean = validateTaskDraft(
    {
      title: input.title,
      description: input.description,
      deadline: input.deadline,
      deadlineTime: input.deadlineTime,
    },
    today,
  );
  if (!clean.value) throw new Error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");

  const snapshot = buildContextSnapshot({
    conversationType: "group",
    conversationId: input.project.conversationId,
    conversationName: input.groupName,
    message: null,
    senderName: "",
    userResponse: clean.value.description,
  });

  const taskId = crypto.randomUUID();
  const { error } = await supabase.rpc("create_project_task", {
    p_project_id: input.project.id,
    p_record_id: input.recordId ?? undefined,
    p_task_id: taskId,
    p_title: clean.value.title,
    p_description: clean.value.description,
    p_deadline: clean.value.deadline,
    p_assignee_id: input.assigneeId,
    p_deadline_time: clean.value.deadlineTime ?? undefined,
    p_deadline_tz: browserTimezone(),
    p_context_snapshot: snapshotToJson(snapshot),
  });
  if (error) throw fail(error.code, error.message);
  return taskId;
}

/** Moves an existing task under another record of the same project, or back to ad-hoc. */
export async function linkTaskToProject(
  taskId: string,
  projectId: string,
  recordId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("link_task_to_project", {
    p_task_id: taskId,
    p_project_id: projectId,
    p_record_id: recordId ?? undefined,
  });
  if (error) throw fail(error.code, error.message);
}

/** The leader's own thank-you, posted into the project chat and pinned. Once only. */
export async function postProjectThanks(projectId: string, body: string): Promise<Project> {
  const { data, error } = await supabase.rpc("post_project_thanks", { p_project_id: projectId, p_body: body.trim() });
  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

/** Stops a project before its criteria are met. Nothing is posted; the reason stays private. */
export async function closeProjectEarly(projectId: string, reason: string): Promise<Project> {
  if (reason.trim().length === 0) throw new Error("Hãy ghi lý do đóng sớm.");
  const { data, error } = await supabase.rpc("close_project_early", { p_project_id: projectId, p_reason: reason.trim() });
  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

export async function reopenProject(projectId: string): Promise<Project> {
  const { data, error } = await supabase.rpc("reopen_project", { p_project_id: projectId });
  if (error) throw fail(error.code, error.message);
  return toProject(data as unknown as ProjectRow);
}

/** The private Check-Adjust record, or null when the viewer is not its owner or it does not exist. */
export async function fetchCheckAdjust(projectId: string): Promise<CheckAdjust | null> {
  const { data, error } = await supabase
    .from("project_check_adjust")
    .select("project_id, close_reason, note")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw fail(error.code, error.message);
  if (data === null) return null;
  return { projectId: data.project_id, closeReason: data.close_reason, note: data.note };
}

export async function saveCheckAdjustNote(projectId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("save_project_check_adjust_note", { p_project_id: projectId, p_note: note });
  if (error) throw fail(error.code, error.message);
}

/** Moves a project to the bin (Inner tier). Root-group owner only; the title must be typed exactly. */
export async function deleteProject(projectId: string, confirmTitle: string, reason: string): Promise<void> {
  if (reason.trim().length === 0) throw new Error("Hãy ghi lý do xoá.");
  const { error } = await supabase.rpc("delete_project", {
    p_project_id: projectId,
    p_confirm_title: confirmTitle.trim(),
    p_reason: reason.trim(),
  });
  if (error) throw fail(error.code, error.message);
}

export async function restoreProject(projectId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_project", { p_project_id: projectId });
  if (error) throw fail(error.code, error.message);
}

/** Projects in the bin that the viewer, as a root-group owner, may bring back. */
export async function fetchDeletedProjects(): Promise<Project[]> {
  const { data, error } = await supabase.rpc("list_deleted_projects");
  if (error) throw fail(error.code, error.message);
  return ((data ?? []) as unknown as ProjectRow[]).map(toProject);
}

export async function fetchIsProjectRootOwner(projectId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_project_root_owner", { p_project_id: projectId });
  if (error) throw fail(error.code, error.message);
  return data === true;
}

/** Whether the title typed into the delete dialog matches exactly (spaces at the ends aside). */
export function deleteConfirmMatches(project: Pick<Project, "title">, typed: string): boolean {
  return typed.trim() === project.title;
}

/** Where a project's own page lives (charter, criteria, Hạng mục). */
export function projectLink(projectId: string): string {
  return `/du-an/${projectId}`;
}

/** A project is discussed in its own sub-group: opening it opens that chat. */
export function projectChatLink(project: Pick<Project, "conversationId">): string {
  return `/tin-nhan/${project.conversationId}`;
}
