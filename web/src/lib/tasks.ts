import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toIsoTimestamp } from "@/lib/chat";
import {
  parseContextSnapshot,
  snapshotToJson,
  type TaskContextSnapshot,
} from "@/lib/task-context";
import {
  browserTimezone,
  validateDeadlineTime,
  normalizeDeadlineTime,
  type RecurrencePattern,
  type ReminderPresetId,
  type TaskRecurrence,
} from "@/lib/task-schedule";

/** Query keys live here so the realtime provider can patch the cache without importing hooks. */
export const taskKeys = {
  all: ["tasks"] as const,
  list: ["tasks", "list"] as const,
};

/**
 * A 1-1 shared task is closed by two people, never one:
 *   pending_confirmation -> confirmed -> done_pending_review -> done
 * The peer accepts the task, the peer claims it finished, and the creator reviews that claim.
 * Personal tasks skip both handshakes and only ever sit at 'confirmed' or 'done'.
 *
 * 'skipped' is the fourth answer to a suggestion: the person asked declined it. It is a state,
 * not a deletion — the request was made, seen and answered, and erasing the row would leave
 * the person who asked unable to tell whether it ever arrived.
 */
export type TaskStatus =
  | "pending_confirmation"
  | "confirmed"
  | "done_pending_review"
  | "done"
  | "skipped";

/**
 * A task is one of three things: your own, something between two people, or something one
 * member of a group was asked for. The last two behave identically — the only difference is
 * that a group has to name who is carrying it, because "the other person" is not a thing a
 * group has.
 */
export type TaskType = "personal" | "1-1-shared" | "group-shared";

export type SharedTaskType = "1-1-shared" | "group-shared";

/** True for both kinds of two-party task, so no rule has to list them one by one. */
export function isSharedTask(task: TaskItem): boolean {
  return task.type === "1-1-shared" || task.type === "group-shared";
}

export type TaskItem = {
  id: string;
  type: TaskType;
  creatorId: string;
  /**
   * The one person carrying a shared task. Null on 1-1 rows written before it was recorded,
   * where the assignee is simply whoever is not the creator, and on personal tasks.
   */
  assigneeId: string | null;
  /** The conversation this task was born in, copied at creation and never editable after. */
  contextSnapshot: TaskContextSnapshot | null;
  conversationId: string | null;
  title: string;
  /** What is actually being asked for. Required: a task without it is only a note. */
  description: string;
  status: TaskStatus;
  confirmedAt: string | null;
  /** When the assignee claimed the work was finished. */
  doneAt: string | null;
  /** When the creator accepted that claim. Shared tasks only. */
  completedConfirmedAt: string | null;
  /** When the person asked declined the suggestion. Null unless the task is `skipped`. */
  skippedAt: string | null;
  /**
   * Whether that decline was made without sending a word.
   *
   * Recorded rather than inferred: "declined, said nothing" and "declined, sent a note" are
   * indistinguishable on the row otherwise, and the thread needs to know which happened to
   * decide whether a quiet annotation belongs in it.
   */
  skippedSilently: boolean;
  /**
   * Calendar day the work is due, `YYYY-MM-DD`. Required on every new task; the nullable type
   * is kept only so rows written before the rule still render instead of crashing the list.
   */
  deadline: string | null;
  /**
   * Clock the work is due at, `HH:MM`, or null for "any time that day" — which is what every
   * task written before Phase 3B means, and is treated as the END of the day rather than
   * 09:00, so nothing silently became overdue when the column arrived.
   */
  deadlineTime: string | null;
  /** The zone the date and time were written in. A Vietnamese 09:00 must stay 09:00. */
  deadlineTz: string;
  /** The creator's own shelf. Null on a task the peer is looking at, whose labels are private. */
  categoryId: string | null;
  /**
   * Legacy single-flag column, kept so old rows still parse. Superseded by `task_flags`:
   * whether a task is important is now each person's own reading, so nothing should decide
   * anything from this field. Read `TaskFlagIndex` instead.
   *
   * @deprecated Use the viewer's own flag from `task_flags`.
   */
  isImportant: boolean;
  /**
   * Whether finishing this is an event worth marking, not just another item crossed off.
   * Never required: most work is ordinary, and a plan where everything is a milestone has
   * no milestones in it.
   */
  isMilestone: boolean;
  /**
   * How far along the work is, 0-100, or null for "not tracked".
   *
   * Null is the resting state and means something different from 0: a task nobody has
   * estimated is not a task reported as untouched.
   */
  progressPercent: number | null;
  /**
   * What the work brought: the concrete result named once, when the task was completed.
   *
   * Optional — a task completed without naming its output stays null, which is not the same
   * as an empty one. Written at completion and never after: once the creator has reviewed a
   * shared claim, the record is closed and the text does not change again.
   */
  outputValue: string | null;
  recurrence: TaskRecurrence;
  recurrencePattern: RecurrencePattern | null;
  /** Set once this task has produced its successor, so a repeat cannot fork. */
  recurrenceSpawnedAt: string | null;
  /** Each side of a shared task has its own bin; the row only leaves the database when both are set. */
  deletedByCreator: boolean;
  deletedByPeer: boolean;
  createdAt: string;
};

/**
 * How much of a claim a task has on someone, from the outside in.
 *
 *   1 — someone else asked this person for it
 *   2 — this person asked someone else for it
 *   3 — this person's own to-do
 *
 * Work other people are waiting on ranks above private work, which is why this breaks ties
 * inside a shared moment. It never crosses a deadline: an earlier date always wins.
 */
export type TaskTier = 1 | 2 | 3;

export function taskTier(task: TaskItem, userId: string | undefined): TaskTier {
  if (task.type === "personal") return 3;
  if (userId !== undefined && task.creatorId !== userId) return 1;
  return 2;
}

/**
 * Whether this person is the one being asked. Mirrors the database rule exactly: a named
 * assignee decides it outright, and only a 1-1 task may fall back to "not the creator",
 * because a group task has other people in the room who were not asked for anything.
 */
export function isTaskAssignee(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined || !isSharedTask(task)) return false;
  if (task.assigneeId !== null) return task.assigneeId === userId;
  return task.type === "1-1-shared" && task.creatorId !== userId;
}

/** A group member who can read a task but was not asked for it and did not raise it. */
export function isTaskBystander(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined || !isSharedTask(task)) return false;
  return task.creatorId !== userId && !isTaskAssignee(task, userId);
}

/**
 * Whether a task is the viewer's own business: they were asked for it, or they asked for it.
 *
 * This is what separates the panel inside a group chat from the group's full list. A room of
 * twelve people generates work that has nothing to do with you, and reading it every time you
 * open the chat is noise. What remains is what you are carrying and what you are waiting on —
 * the second half matters, because the creator is the only person who can close a task.
 */
export function involvesViewer(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined) return false;
  if (!isSharedTask(task)) return task.creatorId === userId;
  return task.creatorId === userId || isTaskAssignee(task, userId);
}

export const TIER_LABELS: Record<TaskTier, string> = {
  1: "Người khác giao",
  2: "Bạn giao",
  3: "Cá nhân",
};

export type SharedTaskGroup = {
  conversationId: string;
  tasks: TaskItem[];
};

export type TitleValidation = {
  title: string | null;
  error: string | null;
};

export const TASK_TITLE_MAX_LEN = 200;
export const TASK_DESCRIPTION_MAX_LEN = 2000;
/** Same bar as the description: room to say what the work brought, no room for an essay. */
export const TASK_OUTPUT_MAX_LEN = 2000;

/**
 * Normalises what the completion prompt collected: trimmed, blank means "none this time".
 * Returns null for over-length too — callers check `isTaskOutputTooLong` first so the person
 * is told why, rather than watching a long answer silently become nothing.
 */
export function normalizeTaskOutput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > TASK_OUTPUT_MAX_LEN) return null;
  return trimmed;
}

/** Whether the output box holds something the server would refuse, so the button can say so. */
export function isTaskOutputTooLong(raw: string): boolean {
  return raw.trim().length > TASK_OUTPUT_MAX_LEN;
}

/** Maps Postgres/PostgREST failures on the tasks tables to short Vietnamese messages. */
export function toVietnameseTaskError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_task_title_blank")) return "Tên nhiệm vụ không được để trống.";
  if (normalized.includes("avora_task_title_max_len"))
    return `Tên nhiệm vụ quá dài (tối đa ${TASK_TITLE_MAX_LEN} ký tự).`;
  if (normalized.includes("avora_task_self_confirm")) return "Bạn không thể tự xác nhận nhiệm vụ của chính mình.";
  if (normalized.includes("avora_task_not_confirmed"))
    return "Nhiệm vụ chưa được xác nhận nên chưa thể hoàn thành.";
  if (normalized.includes("avora_task_only_assignee_marks_done"))
    return "Chỉ người nhận việc mới báo xong được. Bạn là người duyệt.";
  if (normalized.includes("avora_task_only_creator_reviews"))
    return "Chỉ người giao việc mới duyệt hoàn thành được.";
  if (normalized.includes("avora_task_only_creator_returns"))
    return "Chỉ người giao việc mới trả việc được.";
  if (normalized.includes("avora_task_assignee_delete_requires_done"))
    return "Chỉ có thể xoá khi người giao xác nhận việc đã hoàn thành.";
  if (normalized.includes("avora_task_description_required"))
    return "Mô tả cụ thể là bắt buộc: bạn cần gì, kết quả dự kiến là gì?";
  if (normalized.includes("avora_task_description_max_len"))
    return `Mô tả quá dài (tối đa ${TASK_DESCRIPTION_MAX_LEN} ký tự).`;
  if (normalized.includes("avora_task_deadline_required")) return "Nhiệm vụ phải có hạn hoàn thành.";
  if (normalized.includes("avora_task_deadline_past"))
    return "Hạn hoàn thành không thể là ngày đã qua.";
  if (normalized.includes("avora_task_timezone_invalid")) return "Múi giờ không hợp lệ.";
  if (normalized.includes("avora_task_category_foreign"))
    return "Hạng mục này không thuộc về bạn.";
  if (normalized.includes("avora_task_not_shared")) return "Nhiệm vụ này không phải nhiệm vụ chung.";
  if (normalized.includes("avora_task_not_assignee"))
    return "Chỉ người được giao nhiệm vụ này mới thao tác được.";
  if (normalized.includes("avora_task_skip_not_pending"))
    return "Nhiệm vụ này đã được nhận nên không bỏ qua được nữa.";
  if (normalized.includes("avora_task_skip_needs_message"))
    return "Trong nhóm, hãy gửi một lời nhắn khi bỏ qua — cả nhóm đang chờ phản hồi.";
  if (normalized.includes("avora_task_context_required"))
    return "Nhiệm vụ chia sẻ cần gắn với cuộc trò chuyện nó sinh ra.";
  if (normalized.includes("avora_task_assignee_required"))
    return "Hãy chọn một thành viên đảm trách nhiệm vụ này.";
  if (normalized.includes("avora_task_assignee_not_participant"))
    return "Người này không còn trong cuộc trò chuyện.";
  if (normalized.includes("avora_task_self_assign"))
    return "Việc bạn tự làm là nhiệm vụ cá nhân — hãy thêm ở tab Nhiệm vụ.";
  if (normalized.includes("avora_task_wrong_conversation"))
    return "Loại nhiệm vụ không khớp với cuộc trò chuyện này.";
  if (normalized.includes("avora_context_snapshot_immutable"))
    return "Ngữ cảnh của nhiệm vụ đã lưu thì không sửa được.";
  if (normalized.includes("avora_context_snapshot"))
    return "Không lưu được ngữ cảnh cuộc trò chuyện. Thử lại nhé.";
  if (normalized.includes("avora_task_not_awaiting_review"))
    return "Nhiệm vụ chưa được báo xong nên chưa có gì để duyệt.";
  if (normalized.includes("avora_task_not_party"))
    return "Chỉ người giao và người nhận nhiệm vụ này mới sửa được.";
  if (normalized.includes("avora_task_edit_closed"))
    return "Nhiệm vụ đã báo xong nên không sửa được nữa.";
  if (
    normalized.includes("avora_task_progress_range") ||
    normalized.includes("tasks_progress_percent_range")
  )
    return "Tiến độ phải nằm trong khoảng 0 đến 100.";
  if (normalized.includes("tasks_output_value_max_len"))
    return `Kết quả quá dài (tối đa ${TASK_OUTPUT_MAX_LEN} ký tự).`;
  if (normalized.includes("avora_task_not_found")) return "Không tìm thấy nhiệm vụ này.";
  if (normalized.includes("avora_not_a_participant")) return "Bạn không có quyền trong cuộc trò chuyện này.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với nhiệm vụ này.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[tasks] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseTaskError(code, message));
}

/** Trims and bounds a task title; returns the error to show when it is unusable. */
export function validateTaskTitle(raw: string): TitleValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { title: null, error: "Tên nhiệm vụ không được để trống." };
  if (trimmed.length > TASK_TITLE_MAX_LEN)
    return { title: null, error: `Tên nhiệm vụ quá dài (tối đa ${TASK_TITLE_MAX_LEN} ký tự).` };
  return { title: trimmed, error: null };
}

/**
 * A task is what someone needs, plus when they need it. Both are required, so the description
 * is validated exactly as strictly as the title — an empty one is rejected, not silently stored.
 */
export function validateTaskDescription(raw: string): { description: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return { description: null, error: "Mô tả cụ thể là bắt buộc: bạn cần gì, kết quả dự kiến là gì?" };
  if (trimmed.length > TASK_DESCRIPTION_MAX_LEN)
    return {
      description: null,
      error: `Mô tả quá dài (tối đa ${TASK_DESCRIPTION_MAX_LEN} ký tự).`,
    };
  return { description: trimmed, error: null };
}

/**
 * A deadline is required and cannot already have passed. Today is allowed: work promised for
 * today is ordinary, and deadlines here are calendar days rather than instants, so "today"
 * means the same thing at 08:00 and at 23:00.
 */
export function validateTaskDeadline(
  raw: string | null | undefined,
  today: string,
): { deadline: string | null; error: string | null } {
  const normalized = normalizeDeadline(raw);
  if (normalized === null) return { deadline: null, error: "Nhiệm vụ phải có hạn hoàn thành." };
  const days = daysUntilDeadline(normalized, today);
  if (days !== null && days < 0) return { deadline: null, error: "Hạn hoàn thành không thể là ngày đã qua." };
  return { deadline: normalized, error: null };
}

export type TaskDraft = {
  title: string;
  description: string;
  deadline: string;
  /** Optional: a task due "that day" is a perfectly ordinary task. */
  deadlineTime?: string;
  categoryId?: string | null;
  /** The composer's own reading, written to this person's `task_flags` row after creation. */
  isImportant?: boolean;
  /** Expected effort in minutes, or null for "not estimated". Never required. */
  durationMinutes?: number | null;
  recurrence?: TaskRecurrence;
  recurrencePattern?: RecurrencePattern | null;
  /** Which reminder to set once the task exists, or null for none. */
  reminder?: ReminderPresetId | null;
};

export type ValidatedTaskDraft = {
  title: string;
  description: string;
  deadline: string;
  deadlineTime: string | null;
  categoryId: string | null;
  isImportant: boolean;
  durationMinutes: number | null;
  recurrence: TaskRecurrence;
  recurrencePattern: RecurrencePattern | null;
} | null;

/** All three fields, checked in reading order so the person is told about the first gap only. */
export function validateTaskDraft(
  draft: TaskDraft,
  today: string,
): { value: ValidatedTaskDraft; error: string | null } {
  const title = validateTaskTitle(draft.title);
  if (!title.title) return { value: null, error: title.error };
  const description = validateTaskDescription(draft.description);
  if (!description.description) return { value: null, error: description.error };
  const deadline = validateTaskDeadline(draft.deadline, today);
  if (!deadline.deadline) return { value: null, error: deadline.error };
  const time = validateDeadlineTime(draft.deadlineTime ?? "");
  if (time.error !== null) return { value: null, error: time.error };

  const recurrence: TaskRecurrence = draft.recurrence ?? "none";
  const pattern = recurrence === "custom" ? draft.recurrencePattern ?? null : null;
  if (recurrence === "custom" && (pattern === null || pattern.interval < 1))
    return { value: null, error: "Lặp tuỳ chỉnh cần khoảng cách ít nhất 1." };

  return {
    value: {
      title: title.title,
      description: description.description,
      deadline: deadline.deadline,
      deadlineTime: time.time,
      categoryId: draft.categoryId ?? null,
      isImportant: draft.isImportant ?? false,
      durationMinutes: draft.durationMinutes ?? null,
      recurrence,
      recurrencePattern: pattern,
    },
    error: null,
  };
}

/**
 * Whether anything has been typed in all three required fields. Used only to keep the submit
 * button dark until the form can succeed — the real check is `validateTaskDraft`.
 */
export function isTaskDraftComplete(draft: TaskDraft): boolean {
  return draft.title.trim() !== "" && draft.description.trim() !== "" && draft.deadline.trim() !== "";
}

/** Only the assignee — never the creator, never a bystander — can accept a pending shared task. */
export function canConfirmSharedTask(task: TaskItem, userId: string | undefined): boolean {
  return (
    userId !== undefined &&
    isSharedTask(task) &&
    task.status === "pending_confirmation" &&
    task.creatorId !== userId &&
    isTaskAssignee(task, userId)
  );
}

/**
 * Whether this task is a suggestion waiting on the person it was suggested to.
 *
 * A shared task starts as a request, not an instruction: the creator asks, and the assignee
 * decides. This is what turns "Xác nhận / Xoá" into "Tạo tác vụ / Bỏ qua" — the same two
 * decisions, named for what they actually are. A task someone wrote for themselves has nobody
 * to suggest anything to, so it never reaches this shape.
 */
export function isSuggestion(task: TaskItem, userId: string | undefined): boolean {
  return canConfirmSharedTask(task, userId);
}

/**
 * Declining a suggestion: the assignee's alone, and only while it is still a suggestion.
 *
 * Deliberately NOT available to the creator. A creator who could "skip" on the assignee's
 * behalf would be withdrawing their own request while making it look like a refusal — the
 * creator's way out is deleting what they asked for. Once accepted the task is a promise, and
 * the way out of a promise is the done/return flow, not a retroactive decline.
 */
export function canSkipSharedTask(task: TaskItem, userId: string | undefined): boolean {
  return canConfirmSharedTask(task, userId);
}

/**
 * Whether declining may be done without sending a word.
 *
 * Allowed in a 1-1 and refused in a group. In a 1-1 the other person sees the decline on the
 * task itself, so silence still leaves them informed. In a group the same silence would leave
 * a room of people watching a request go unanswered with no way to tell it was even seen — so
 * a group decline has to carry something. The database refuses a silent group decline
 * independently; this only decides whether the third option is offered.
 */
export function canSkipSilently(task: TaskItem): boolean {
  return task.type === "1-1-shared";
}

/** True once the person asked has declined. The task stays on the list; only its state moves. */
export function isSkipped(task: Pick<TaskItem, "status">): boolean {
  return task.status === "skipped";
}

/**
 * The note saying this task was suggested rather than handed down, shown to whoever is
 * looking at someone else's request. Named, because "someone suggested this" is not an answer
 * to "who is waiting on me".
 */
export function suggestedByNote(creatorName: string): string {
  return `${creatorName} đã gợi ý việc này`;
}

/**
 * The message offered ready-to-send when someone declines, with the asker's real name in it.
 *
 * Pre-filled and sendable as it stands, because the hardest part of declining is finding the
 * words — and someone who cannot find them says nothing at all, which reads as being ignored.
 * It promises to come back to the matter rather than refusing it outright, which is usually
 * what is true.
 */
export function skipMessageTemplate(creatorName: string): string {
  return `${creatorName}, tôi xin theo dõi sau.`;
}

/**
 * The quiet line left in a 1-1 thread when someone declined without a word.
 *
 * It says the decline happened and deliberately does NOT speculate about why — "có lý do riêng
 * của họ" is the whole point: choosing not to explain is a legitimate answer, and the thread
 * should not imply an explanation is owed.
 */
export function silentSkipNote(assigneeName: string): string {
  return `${assigneeName} đã bỏ qua, có lý do riêng của họ.`;
}

/**
 * A decline made without a word, as the conversation needs to show it.
 *
 * Derived from the task rather than stored as a message: a silent decline creates NO message,
 * so the thread has nothing of its own to render. This is the annotation, not a message — it
 * carries no bubble, no sender and no reactions.
 */
export type SilentSkipNotice = {
  taskId: string;
  /** Who declined, so the line can name them. */
  assigneeId: string | null;
  /** When, used only to place the line among the messages. */
  at: string;
};

/**
 * Every silent decline belonging to one conversation, oldest first.
 *
 * Only genuinely silent ones: a decline that sent a message is already visible as that
 * message, and annotating it too would say the same thing twice.
 */
export function silentSkipNotices(
  tasks: readonly TaskItem[],
  conversationId: string,
): SilentSkipNotice[] {
  return tasks
    .filter(
      (task) =>
        task.conversationId === conversationId &&
        isSkipped(task) &&
        task.skippedSilently &&
        task.skippedAt !== null,
    )
    .map((task) => ({
      taskId: task.id,
      assigneeId: task.assigneeId,
      at: task.skippedAt as string,
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Which message each annotation sits after, so the line lands where the decline happened
 * rather than being swept to the bottom of the thread.
 *
 * A decline that predates every message (possible only for a task raised in an empty thread)
 * is keyed under "", which the caller renders above the first message. Keyed by message id
 * rather than index so it survives new arrivals.
 */
export function placeSilentSkipNotices(
  notices: readonly SilentSkipNotice[],
  messages: readonly { id: string; createdAt: string }[],
): Map<string, SilentSkipNotice[]> {
  const placed = new Map<string, SilentSkipNotice[]>();
  for (const notice of notices) {
    let key = "";
    for (const message of messages) {
      if (message.createdAt <= notice.at) key = message.id;
      else break;
    }
    const existing = placed.get(key);
    if (existing) existing.push(notice);
    else placed.set(key, [notice]);
  }
  return placed;
}

/**
 * How someone answers when they decline: send the offered sentence, write their own, or
 * (in a 1-1 only) say nothing at all.
 */
export type SkipReplyMode = "template" | "custom" | "silent";

/**
 * Which ways of declining are on offer for this task, in the order they are shown.
 *
 * A group genuinely has two options rather than three with one greyed out: offering silence
 * and then refusing it would teach people the menu cannot be trusted. The order puts the
 * ready-made sentence first, because the person declining is usually looking for words rather
 * than wanting to compose any.
 */
export function skipReplyModes(task: TaskItem): readonly SkipReplyMode[] {
  return skipReplyModesFor(canSkipSilently(task));
}

/**
 * The same choice, decided from the one fact it actually depends on: whether silence is
 * allowed here. Suggestions live in their own table and have no TaskItem to pass, but the
 * rule they follow is identical, so it is stated once.
 */
export function skipReplyModesFor(allowSilent: boolean): readonly SkipReplyMode[] {
  return allowSilent ? ["template", "custom", "silent"] : ["template", "custom"];
}

/**
 * Whether this decline can be submitted as it stands.
 *
 * The offered sentence is always sendable — that is what makes it useful. A written reply must
 * actually contain something: an empty box submitted as a "message" would be silence wearing
 * the costume of a reply, which is exactly what a group decline may not be.
 */
export function canSubmitSkip(
  task: TaskItem,
  mode: SkipReplyMode,
  customMessage: string,
): boolean {
  return canSubmitSkipFor(canSkipSilently(task), mode, customMessage);
}

/** The same rule, stated without a task, for declining a suggestion. */
export function canSubmitSkipFor(
  allowSilent: boolean,
  mode: SkipReplyMode,
  customMessage: string,
): boolean {
  if (mode === "silent") return allowSilent;
  if (mode === "template") return true;
  return customMessage.trim().length > 0;
}

/**
 * The words this decline will actually send, or null when it sends nothing.
 *
 * Returns null only for a genuine silent decline, so a caller can tell "say nothing" from
 * "say something empty" without re-deriving the rule.
 */
export function skipMessageFor(
  mode: SkipReplyMode,
  creatorName: string,
  customMessage: string,
): string | null {
  if (mode === "silent") return null;
  if (mode === "template") return skipMessageTemplate(creatorName);
  const trimmed = customMessage.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Only the assignee — the person who accepted the task — can claim it is finished. */
export function canMarkSharedDone(task: TaskItem, userId: string | undefined): boolean {
  return (
    userId !== undefined &&
    isSharedTask(task) &&
    task.status === "confirmed" &&
    task.creatorId !== userId &&
    isTaskAssignee(task, userId)
  );
}

/** Only the creator reviews the assignee's claim, and only once that claim exists. */
export function canReviewSharedDone(task: TaskItem, userId: string | undefined): boolean {
  return (
    userId !== undefined &&
    isSharedTask(task) &&
    task.status === "done_pending_review" &&
    task.creatorId === userId
  );
}

/**
 * Reviewing a claim has two answers, and both belong to the creator: accept it, or send the
 * work back. So 'Trả việc' is available in exactly the same place as 'Xác nhận hoàn thành'.
 */
export function canReturnSharedTask(task: TaskItem, userId: string | undefined): boolean {
  return canReviewSharedDone(task, userId);
}

/**
 * Who may reword a task, and until when.
 *
 * A personal task belongs to one person, so they may always edit it. A shared task may be
 * edited by either party — the person who asked and the person carrying it — but only while
 * it is still live. Once the assignee has filed a done claim, the description is the thing
 * being reviewed: rewriting it then would mean judging finished work against wording that
 * changed after the fact. A group bystander can read the task but was never party to it, so
 * it is not theirs to reword. The server enforces all of this; this only decides whether to
 * offer the button.
 */
export function canEditTask(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined) return false;
  if (task.type === "personal") return task.creatorId === userId;
  if (task.status !== "pending_confirmation" && task.status !== "confirmed") return false;
  return task.creatorId === userId || isTaskAssignee(task, userId);
}

/** Why the edit button is absent, said plainly rather than left to be guessed. */
export function editBlockedReason(task: TaskItem, userId: string | undefined): string | null {
  if (canEditTask(task, userId)) return null;
  if (userId === undefined) return "Bạn cần đăng nhập lại.";
  if (task.type === "personal") return "Chỉ chủ nhiệm vụ sửa được.";
  if (task.status === "done") return "Nhiệm vụ đã hoàn thành nên không sửa được nữa.";
  if (task.status === "done_pending_review")
    return "Đang chờ xác nhận hoàn thành — nội dung được giữ nguyên để đối chiếu.";
  return "Chỉ người giao và người nhận nhiệm vụ này mới sửa được.";
}

/** The three fields an edit may change. Everything else about a task is settled at creation. */
export type TaskEdit = {
  title: string;
  description: string;
  deadline: string;
  deadlineTime?: string | null;
};

/** The same bar a new task has to clear, applied to an edit. */
export function validateTaskEdit(
  edit: TaskEdit,
  today: string,
): { value: Required<TaskEdit> | null; error: string | null } {
  const title = validateTaskTitle(edit.title);
  if (!title.title) return { value: null, error: title.error };
  const description = validateTaskDescription(edit.description);
  if (!description.description) return { value: null, error: description.error };
  const deadline = validateTaskDeadline(edit.deadline, today);
  if (!deadline.deadline) return { value: null, error: deadline.error };
  const time = validateDeadlineTime(edit.deadlineTime ?? "");
  if (time.error !== null) return { value: null, error: time.error };
  return {
    value: {
      title: title.title,
      description: description.description,
      deadline: deadline.deadline,
      deadlineTime: time.time,
    },
    error: null,
  };
}

/**
 * An edit that changes nothing is not worth a round trip — or an `updated_at` bump, which
 * would tell the other side something happened when nothing did.
 */
export function isTaskEditUnchanged(task: TaskItem, edit: Required<TaskEdit>): boolean {
  return (
    task.title === edit.title &&
    task.description === edit.description &&
    task.deadline === edit.deadline &&
    task.deadlineTime === edit.deadlineTime
  );
}

/** True once both sides have deleted a shared task, meaning the row is gone from the database. */
export function isTaskGone(task: TaskItem): boolean {
  return task.deletedByCreator && task.deletedByPeer;
}

/** Whether this task sits in *this* person's bin. Each side of a shared task has its own. */
export function isDeletedFor(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined) return false;
  if (task.type === "personal") return task.deletedByCreator;
  if (task.creatorId === userId) return task.deletedByCreator;
  // A group member who was never party to the task has no bin of their own to check.
  if (isTaskBystander(task, userId)) return false;
  return task.deletedByPeer;
}

/**
 * The other party dropped a shared task that this person still keeps. Worth saying out loud:
 * the task is now one-sided, and nothing more will come from them.
 */
export function isDeletedByOther(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined || !isSharedTask(task)) return false;
  if (isTaskBystander(task, userId)) return false;
  return task.creatorId === userId ? task.deletedByPeer : task.deletedByCreator;
}

/** What the surviving party is told when the other side deletes a shared task. */
export function deletedByOtherNote(task: TaskItem, userId: string | undefined): string {
  return task.creatorId === userId ? "Người nhận đã xoá" : "Người giao đã xoá";
}

/**
 * Who may bin a task, and when. This is about authority, not about being finished.
 *
 * A personal task belongs to one person, so they may always delete it. On a shared task the
 * creator may let go at any point — it is their request to withdraw. The person doing the work
 * can only delete once the creator has confirmed the work finished: otherwise unfinished work
 * could be swept off the list before anyone has answered for it, which is exactly what the
 * two-party flow exists to prevent. The server enforces the same rule; this only decides
 * whether to offer the button.
 */
export function canDeleteTask(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined) return false;
  if (task.type === "personal") return task.creatorId === userId;
  if (task.creatorId === userId) return true;
  // A bystander is not party to the request, so it is not theirs to clear.
  if (!isTaskAssignee(task, userId)) return false;
  return task.status === "done";
}

/**
 * True when deleting will destroy the row outright rather than move it to this person's bin:
 * a request nobody has accepted yet has no second copy to preserve. The button says so, because
 * "Xoá" that cannot be undone must not look like "Xoá" that can.
 */
export function deleteIsPermanent(task: TaskItem, userId: string | undefined): boolean {
  if (userId === undefined || !isSharedTask(task)) return false;
  if (task.creatorId !== userId) return false;
  return task.status === "pending_confirmation";
}

/**
 * 'Xoá hẳn' only exists where one person owns the row outright. A shared task in someone's
 * bin is still on the other person's list, so destroying it would delete their copy too.
 */
export function canPurgeTask(task: TaskItem): boolean {
  return task.type === "personal";
}

/** Splits tasks into what this person still keeps and what they have put in the bin. */
export function partitionByBin(
  tasks: TaskItem[],
  userId: string | undefined,
): { kept: TaskItem[]; binned: TaskItem[] } {
  const kept: TaskItem[] = [];
  const binned: TaskItem[] = [];
  for (const task of tasks) {
    if (isTaskGone(task)) continue;
    if (isDeletedFor(task, userId)) binned.push(task);
    else kept.push(task);
  }
  return { kept, binned };
}

/** Groups shared tasks by conversation, preserving the order tasks arrive in. */
export function groupSharedByConversation(tasks: TaskItem[]): SharedTaskGroup[] {
  const groups: SharedTaskGroup[] = [];
  const index = new Map<string, SharedTaskGroup>();
  for (const task of tasks) {
    if (!isSharedTask(task) || !task.conversationId) continue;
    let group = index.get(task.conversationId);
    if (!group) {
      group = { conversationId: task.conversationId, tasks: [] };
      index.set(task.conversationId, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

/**
 * Vietnamese label for a task status chip.
 *
 * Acceptance and completion are kept in separate vocabularies on purpose: the first pair
 * talks about *nhận việc* (taking the task on) and the second about *hoàn thành* (finishing
 * it). A bare "Đã xác nhận" once stood for both, so an accepted task and a finished one read
 * identically.
 */
export function taskStatusLabel(status: TaskStatus): string {
  if (status === "pending_confirmation") return "Chờ nhận việc";
  if (status === "confirmed") return "Đã nhận việc";
  if (status === "done_pending_review") return "Chờ xác nhận hoàn thành";
  // A declined suggestion says so plainly. It is not a failure and not a deletion, so it
  // borrows neither vocabulary.
  if (status === "skipped") return "Đã bỏ qua";
  return "Đã hoàn thành";
}

/**
 * The quiet line shown to whoever is NOT holding the next action, so every shared task
 * states whose turn it is instead of only its raw state. Each line names the step it is
 * waiting on (nhận việc vs xác nhận hoàn thành), never just "waiting".
 */
export function sharedTaskNote(task: TaskItem, userId: string | undefined): string {
  const isCreator = userId !== undefined && task.creatorId === userId;
  const isAssignee = isTaskAssignee(task, userId);
  if (task.status === "pending_confirmation") return isAssignee ? "Chờ bạn nhận việc" : "Chờ nhận việc";
  if (task.status === "confirmed") return "Đã nhận việc";
  if (task.status === "done_pending_review")
    return isCreator ? "Chờ bạn xác nhận hoàn thành" : "Chờ người giao xác nhận hoàn thành";
  // Said from each side: "you declined this" and "they declined this" are different facts,
  // and neither is improved by pretending the other person's reasons are known.
  if (task.status === "skipped") return isAssignee ? "Bạn đã bỏ qua" : "Người nhận đã bỏ qua";
  return "Đã hoàn thành";
}

/**
 * A task is "open" until both sides agree it is finished. A claim awaiting review still
 * counts: nobody can act on it being closed yet, so hiding it from the count would make
 * work disappear while it is still someone's responsibility.
 *
 * A declined suggestion is NOT open — it has been answered, and nobody is waiting on anyone.
 * It stays visible on the list with its state shown, but it must not keep a counter lit or
 * a badge would demand attention for a matter already settled.
 */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "pending_confirmation",
  "confirmed",
  "done_pending_review",
];

export function isOpenTask(task: TaskItem, viewerId?: string): boolean {
  if (isTaskGone(task)) return false;
  if (viewerId !== undefined && isDeletedFor(task, viewerId)) return false;
  return OPEN_TASK_STATUSES.includes(task.status);
}

/**
 * How many of these tasks are still open. Used by every "nhiệm vụ đang mở" counter.
 * Pass the viewer to leave out what they have already binned — a task in the bin is
 * not work they are carrying.
 */
export function countOpenTasks(tasks: TaskItem[], viewerId?: string): number {
  return tasks.filter((task) => isOpenTask(task, viewerId)).length;
}

/**
 * How urgent a task is, read off its deadline. Four bands, because "late", "almost due",
 * "scheduled" and "unscheduled" are the four different reactions a person can have.
 */
export type TaskPriority = "overdue" | "due_soon" | "routine" | "none";

/** Inside this many days a deadline stops being routine and starts being pressing. */
export const DUE_SOON_DAYS = 3;

/**
 * Above this many minutes a task stops being an errand and starts needing a slot in the day.
 * An hour is the line because it is the point where work stops fitting between other things.
 */
export const HEAVY_TASK_MINUTES = 60;

/**
 * One person's reading of one task: whether it matters to them, and how long they think it
 * will take them. Both are opinions — the person who asked for the work and the person
 * carrying it can hold different ones, and each is right about their own list.
 */
export type TaskFlagValue = {
  isImportant: boolean;
  /** Null means not estimated, which is the ordinary resting state, not zero. */
  durationMinutes: number | null;
  /**
   * When THIS person picked the work up, or null while they have not.
   *
   * Per-viewer on purpose. Two people carrying the same shared task start at different
   * moments, and one of them starting says nothing about whether the other has — so this
   * can never be a single column on the task.
   */
  startedAt: string | null;
};

/** The viewer's own flags, keyed by task id. Never holds anyone else's reading. */
export type TaskFlagIndex = ReadonlyMap<string, TaskFlagValue>;

export const NO_TASK_FLAGS: TaskFlagIndex = new Map<string, TaskFlagValue>();

/** What this person marked important. Absent means "not marked", never "unknown". */
export function isImportantFor(flags: TaskFlagIndex, taskId: string): boolean {
  return flags.get(taskId)?.isImportant ?? false;
}

/** This person's own estimate, or null when they never gave one. */
export function durationFor(flags: TaskFlagIndex, taskId: string): number | null {
  return flags.get(taskId)?.durationMinutes ?? null;
}

/** When this person started, or null. Never reports anybody else's start. */
export function startedAtFor(flags: TaskFlagIndex, taskId: string): string | null {
  return flags.get(taskId)?.startedAt ?? null;
}

/** Whether this person has this task underway. Their own answer, nobody else's. */
export function isStartedFor(flags: TaskFlagIndex, taskId: string): boolean {
  return startedAtFor(flags, taskId) !== null;
}

/**
 * Whether "Bắt đầu làm" belongs on a task at all.
 *
 * Only work that is actually live can be picked up: a suggestion has not been agreed to yet,
 * and something already filed done or declined has nothing left to start. Deliberately says
 * nothing about mute or notifications — starting is a private note to yourself, not a state
 * change anyone else is told about.
 */
export function canStartTask(task: TaskItem): boolean {
  return task.status === "confirmed";
}

/** A whole percentage in 0-100, or null when the box is empty or unusable. */
export function parseProgressInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/** A short human reading of progress. Null stays absent rather than becoming "0%". */
export function formatProgress(percent: number | null): string | null {
  return percent === null ? null : `${percent}%`;
}

/** Heavy is a judgement about effort only — it says nothing about urgency or importance. */
export function isHeavyDuration(minutes: number | null): boolean {
  return minutes !== null && minutes > HEAVY_TASK_MINUTES;
}

export function isHeavyFor(flags: TaskFlagIndex, taskId: string): boolean {
  return isHeavyDuration(durationFor(flags, taskId));
}

const PRIORITY_RANK: Record<TaskPriority, number> = { overdue: 0, due_soon: 1, routine: 2, none: 3 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as a calendar day in the viewer's own timezone, `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whole days from `today` to `deadline`, both plain calendar days. Deadlines are days, not
 * instants: comparing them as UTC midnights keeps "due today" the same answer at 08:00 and
 * at 23:00, which a timestamp comparison would not.
 */
export function daysUntilDeadline(deadline: string, today: string): number | null {
  if (!ISO_DATE.test(deadline) || !ISO_DATE.test(today)) return null;
  const utc = (iso: string): number => {
    const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
    return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((utc(deadline) - utc(today)) / 86_400_000);
}

export function deadlinePriority(deadline: string | null, today: string): TaskPriority {
  if (deadline === null) return "none";
  const days = daysUntilDeadline(deadline, today);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days < DUE_SOON_DAYS) return "due_soon";
  return "routine";
}

export function taskPriority(task: TaskItem, today: string): TaskPriority {
  return deadlinePriority(task.deadline, today);
}

/** Short Vietnamese deadline chip: relative while it matters, a plain date once it does not. */
export function deadlineLabel(deadline: string | null, today: string): string | null {
  if (deadline === null) return null;
  const days = daysUntilDeadline(deadline, today);
  if (days === null) return null;
  if (days < 0) return days === -1 ? "Quá hạn 1 ngày" : `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return "Hôm nay";
  if (days === 1) return "Mai";
  if (days < DUE_SOON_DAYS) return `Còn ${days} ngày`;
  const [, month, day] = deadline.split("-");
  return `${day}/${month}`;
}

/**
 * Orders a list the way someone scanning it wants to read: what is late, then what is nearly
 * late, then what is merely scheduled, then what has no date at all. Finished work sinks to the
 * bottom regardless of its deadline — a closed task that happens to be overdue must not outrank
 * live work.
 */
export function compareTaskPriority(
  a: TaskItem,
  b: TaskItem,
  today: string,
  viewerId?: string,
  flags: TaskFlagIndex = NO_TASK_FLAGS,
): number {
  const aClosed = a.status === "done" ? 1 : 0;
  const bClosed = b.status === "done" ? 1 : 0;
  if (aClosed !== bClosed) return aClosed - bClosed;

  const rankA = PRIORITY_RANK[taskPriority(a, today)];
  const rankB = PRIORITY_RANK[taskPriority(b, today)];
  if (rankA !== rankB) return rankA - rankB;

  if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline)
    return a.deadline < b.deadline ? -1 : 1;

  // Same day: the clock decides. A task with no clock is due by the end of that day, so it
  // sits after everything with a stated time rather than jumping to the top.
  if (a.deadlineTime !== b.deadlineTime) {
    if (a.deadlineTime === null) return 1;
    if (b.deadlineTime === null) return -1;
    return a.deadlineTime < b.deadlineTime ? -1 : 1;
  }

  // Same moment: what other people are waiting on comes before private work. Only decidable
  // from someone's point of view, so it is skipped when no viewer is given.
  if (viewerId !== undefined) {
    const tierA = taskTier(a, viewerId);
    const tierB = taskTier(b, viewerId);
    if (tierA !== tierB) return tierA - tierB;
  }

  // Last of all, this person's own importance mark. Deliberately below date, clock and tier:
  // marking a task must not let it jump ahead of work that is genuinely due sooner. Read from
  // the viewer's flags, so one person's marking never reorders anyone else's list.
  const importantA = isImportantFor(flags, a.id);
  const importantB = isImportantFor(flags, b.id);
  if (importantA !== importantB) return importantA ? -1 : 1;

  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTasksByPriority(
  tasks: TaskItem[],
  today: string,
  viewerId?: string,
  flags: TaskFlagIndex = NO_TASK_FLAGS,
): TaskItem[] {
  return [...tasks].sort((a, b) => compareTaskPriority(a, b, today, viewerId, flags));
}

// ---------------------------------------------------------------- views

/**
 * The three ways of reading the same list.
 *
 * `deadline` is the default and the only objective one: what is due soonest. `relationship`
 * answers "what do I owe this person", and `important` is an emergency filter, not a sort —
 * it narrows to starred work and still orders it by deadline.
 */
export type TaskViewMode = "deadline" | "relationship" | "important" | "heavy";

export const TASK_VIEW_LABELS: Record<TaskViewMode, string> = {
  deadline: "Theo hạn",
  // "Đối tượng", not "người": this view now groups by conversation, and a group is not a person.
  relationship: "Theo đối tượng",
  // "Quan trọng", not "Khẩn cấp": what matters and what is urgent are different questions, and
  // the deadline already answers the urgent one. Calling this tab urgent made every important
  // thing without a date look like it did not belong here.
  important: "Quan trọng",
  heavy: "Nhiệm vụ nặng",
};

export type TaskDayGroup = { date: string | null; tasks: TaskItem[] };

/** Timeline shape: one bucket per calendar day, each already in clock-then-tier order. */
export function groupTasksByDeadlineDay(
  tasks: readonly TaskItem[],
  today: string,
  viewerId?: string,
): TaskDayGroup[] {
  const sorted = sortTasksByPriority([...tasks], today, viewerId);
  const groups: TaskDayGroup[] = [];
  const index = new Map<string, TaskDayGroup>();
  for (const task of sorted) {
    const key = task.deadline ?? "";
    let group = index.get(key);
    if (!group) {
      group = { date: task.deadline, tasks: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

/**
 * Only what THIS person marked important, still ordered by when it is due.
 *
 * Flags are required rather than optional: reading this view without them would return an
 * empty list that looks exactly like "you have marked nothing", and a hidden list and an
 * empty one must not be indistinguishable.
 */
export function importantTasks(
  tasks: readonly TaskItem[],
  today: string,
  flags: TaskFlagIndex,
  viewerId?: string,
): TaskItem[] {
  return sortTasksByPriority(
    tasks.filter((task) => isImportantFor(flags, task.id)),
    today,
    viewerId,
    flags,
  );
}

/**
 * Minutes from the start of today until a task is due, in the same unit as an estimate so the
 * two can be subtracted. A task due at a stated hour is due then; one without a clock is due
 * by the end of its day, which is the same reading the sort order already uses. Negative for
 * work already late.
 */
export function leadTimeMinutes(task: TaskItem, today: string): number | null {
  if (task.deadline === null) return null;
  const days = daysUntilDeadline(task.deadline, today);
  if (days === null) return null;
  const END_OF_DAY = 24 * 60;
  if (task.deadlineTime === null) return days * END_OF_DAY + END_OF_DAY;
  const [hours, minutes] = task.deadlineTime.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return days * END_OF_DAY + END_OF_DAY;
  return days * END_OF_DAY + (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * How much room is left after the work itself is accounted for: the time until the deadline
 * minus the time the work is expected to take.
 *
 * This is the whole point of the heavy view. A four-hour job due in six hours is in more
 * trouble than a ten-minute job due in one, even though the second has the nearer deadline —
 * so ordering heavy work by deadline alone would put the wrong task first. A task with no
 * deadline has unlimited room, expressed as infinity so it sorts last without a special case.
 */
export function slackMinutes(task: TaskItem, today: string, flags: TaskFlagIndex): number {
  const lead = leadTimeMinutes(task, today);
  if (lead === null) return Number.POSITIVE_INFINITY;
  return lead - (durationFor(flags, task.id) ?? 0);
}

/**
 * Work this person expects to cost them more than an hour, tightest first.
 *
 * Ordered by slack rather than by deadline, then by deadline to settle ties, so the task that
 * is genuinely about to run out of room sits at the top. Finished work sinks regardless.
 */
export function heavyTasks(
  tasks: readonly TaskItem[],
  today: string,
  flags: TaskFlagIndex,
  viewerId?: string,
): TaskItem[] {
  return tasks
    .filter((task) => isHeavyFor(flags, task.id))
    .sort((a, b) => {
      const aClosed = a.status === "done" ? 1 : 0;
      const bClosed = b.status === "done" ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;

      const slackA = slackMinutes(a, today, flags);
      const slackB = slackMinutes(b, today, flags);
      if (slackA !== slackB) return slackA < slackB ? -1 : 1;

      return compareTaskPriority(a, b, today, viewerId, flags);
    });
}

/** Narrows a list to one shelf. An empty selection means "no filter", not "nothing". */
export function filterByCategories(
  tasks: readonly TaskItem[],
  categoryIds: readonly string[],
): TaskItem[] {
  if (categoryIds.length === 0) return [...tasks];
  const wanted = new Set(categoryIds);
  return tasks.filter((task) => task.categoryId !== null && wanted.has(task.categoryId));
}

/**
 * The most pressing band among the still-open tasks — what colours a group's counter, so a
 * collapsed branch still shows whether anything inside it is late.
 */
export function highestOpenPriority(tasks: TaskItem[], today: string, viewerId?: string): TaskPriority {
  let best: TaskPriority = "none";
  for (const task of tasks) {
    if (!isOpenTask(task, viewerId)) continue;
    const priority = taskPriority(task, today);
    if (PRIORITY_RANK[priority] < PRIORITY_RANK[best]) best = priority;
  }
  return best;
}

/**
 * Whether a task is asking something of this person right now: their move to make, or already
 * late. Used to decide which branches of a collapsed tree open themselves.
 */
export function needsAttention(task: TaskItem, userId: string | undefined, today: string): boolean {
  if (!isOpenTask(task, userId)) return false;
  if (taskPriority(task, today) === "overdue") return true;
  return (
    canConfirmSharedTask(task, userId) || canMarkSharedDone(task, userId) || canReviewSharedDone(task, userId)
  );
}

/**
 * How many tasks are asking for this person right now — the number the Nhiệm vụ badge carries.
 *
 * Deliberately NOT the count of everything open: a badge showing every task on the list would
 * be permanently lit and stop meaning anything. It counts only what is late or waiting on this
 * person's move, so a lit badge always answers "yes, go and look".
 */
export function countTasksNeedingAttention(
  tasks: readonly TaskItem[],
  userId: string | undefined,
  today: string,
): number {
  return tasks.filter((task) => needsAttention(task, userId, today)).length;
}

type TaskRow = {
  id: string;
  type: string;
  creator_id: string;
  assignee_id: string | null;
  context_snapshot: unknown;
  conversation_id: string | null;
  title: string;
  description: string | null;
  status: string;
  confirmed_at: string | null;
  done_at: string | null;
  completed_confirmed_at: string | null;
  skipped_at: string | null;
  skipped_silently: boolean | null;
  deadline_date: string | null;
  deadline_time: string | null;
  deadline_tz: string | null;
  task_category_id: string | null;
  is_important: boolean | null;
  is_milestone: boolean | null;
  progress_percent: number | null;
  output_value: string | null;
  recurrence: string | null;
  recurrence_pattern: unknown;
  recurrence_spawned_at: string | null;
  deleted_by_creator: boolean;
  deleted_by_peer: boolean;
  created_at: string;
};

/** Postgres hands back whatever JSON was stored; only a usable shape becomes a pattern. */
function toRecurrencePattern(raw: unknown): RecurrencePattern | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const interval = typeof record.interval === "number" ? record.interval : Number.NaN;
  const frequency = record.frequency;
  if (!Number.isFinite(interval) || interval < 1) return null;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") return null;
  return { interval, frequency };
}

function toRecurrence(raw: string | null): TaskRecurrence {
  if (raw === "daily" || raw === "weekly" || raw === "monthly" || raw === "custom") return raw;
  return "none";
}

/** Ordering used by both the initial fetch and every realtime insert. */
function compareTasks(a: TaskItem, b: TaskItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isSameTask(a: TaskItem, b: TaskItem): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.confirmedAt === b.confirmedAt &&
    a.doneAt === b.doneAt &&
    a.completedConfirmedAt === b.completedConfirmedAt &&
    a.deadline === b.deadline &&
    a.deadlineTime === b.deadlineTime &&
    a.categoryId === b.categoryId &&
    a.isImportant === b.isImportant &&
    a.isMilestone === b.isMilestone &&
    a.progressPercent === b.progressPercent &&
    a.outputValue === b.outputValue &&
    a.recurrence === b.recurrence &&
    a.deletedByCreator === b.deletedByCreator &&
    a.deletedByPeer === b.deletedByPeer &&
    a.conversationId === b.conversationId
  );
}

/**
 * Inserts or replaces a task in the cached list, keeping fetch order.
 * Returns the same array reference when nothing changed, so React skips the re-render.
 */
export function upsertTask(list: TaskItem[], incoming: TaskItem): TaskItem[] {
  const index = list.findIndex((task) => task.id === incoming.id);
  if (index === -1) {
    const next = [...list, incoming];
    next.sort(compareTasks);
    return next;
  }
  const current = list[index];
  if (current && isSameTask(current, incoming)) return list;
  const next = [...list];
  next[index] = incoming;
  return next;
}

/** Drops a task from the cached list; same reference when it was not there. */
export function removeTask(list: TaskItem[], taskId: string): TaskItem[] {
  const next = list.filter((task) => task.id !== taskId);
  return next.length === list.length ? list : next;
}

/**
 * Maps a realtime row to a task. Realtime sends raw Postgres timestamps without a
 * zone marker, so they are normalised the same way chat message timestamps are.
 */
export function taskFromRealtimeRow(row: Database["public"]["Tables"]["tasks"]["Row"]): TaskItem {
  return {
    id: row.id,
    type: row.type as TaskType,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    contextSnapshot: parseContextSnapshot(row.context_snapshot),
    conversationId: row.conversation_id,
    title: row.title,
    description: row.description ?? "",
    status: row.status as TaskStatus,
    confirmedAt: row.confirmed_at === null ? null : toIsoTimestamp(row.confirmed_at),
    doneAt: row.done_at === null ? null : toIsoTimestamp(row.done_at),
    completedConfirmedAt:
      row.completed_confirmed_at === null ? null : toIsoTimestamp(row.completed_confirmed_at),
    skippedAt: row.skipped_at === null ? null : toIsoTimestamp(row.skipped_at),
    skippedSilently: row.skipped_silently ?? false,
    // A date column carries no zone, so it needs none of the timestamp normalising.
    deadline: row.deadline_date,
    deadlineTime: normalizeDeadlineTime(row.deadline_time),
    deadlineTz: row.deadline_tz ?? "Asia/Ho_Chi_Minh",
    categoryId: row.task_category_id,
    isImportant: row.is_important ?? false,
    isMilestone: row.is_milestone ?? false,
    progressPercent: row.progress_percent,
    outputValue: row.output_value,
    recurrence: toRecurrence(row.recurrence),
    recurrencePattern: toRecurrencePattern(row.recurrence_pattern),
    recurrenceSpawnedAt:
      row.recurrence_spawned_at === null ? null : toIsoTimestamp(row.recurrence_spawned_at),
    deletedByCreator: row.deleted_by_creator,
    deletedByPeer: row.deleted_by_peer,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

const TASK_COLUMNS =
  "id, type, creator_id, assignee_id, context_snapshot, conversation_id, title, description, status, confirmed_at, done_at, completed_confirmed_at, skipped_at, skipped_silently, deadline_date, deadline_time, deadline_tz, task_category_id, is_important, is_milestone, progress_percent, output_value, recurrence, recurrence_pattern, recurrence_spawned_at, deleted_by_creator, deleted_by_peer, created_at";

function toTaskItem(row: TaskRow): TaskItem {
  return {
    id: row.id,
    type: row.type as TaskType,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    contextSnapshot: parseContextSnapshot(row.context_snapshot),
    conversationId: row.conversation_id,
    title: row.title,
    description: row.description ?? "",
    status: row.status as TaskStatus,
    confirmedAt: row.confirmed_at,
    doneAt: row.done_at,
    completedConfirmedAt: row.completed_confirmed_at,
    skippedAt: row.skipped_at,
    skippedSilently: row.skipped_silently ?? false,
    deadline: row.deadline_date,
    deadlineTime: normalizeDeadlineTime(row.deadline_time),
    deadlineTz: row.deadline_tz ?? "Asia/Ho_Chi_Minh",
    categoryId: row.task_category_id,
    isImportant: row.is_important ?? false,
    isMilestone: row.is_milestone ?? false,
    progressPercent: row.progress_percent,
    outputValue: row.output_value,
    recurrence: toRecurrence(row.recurrence),
    recurrencePattern: toRecurrencePattern(row.recurrence_pattern),
    recurrenceSpawnedAt: row.recurrence_spawned_at,
    deletedByCreator: row.deleted_by_creator,
    deletedByPeer: row.deleted_by_peer,
    createdAt: row.created_at,
  };
}

/** Every task visible to the caller: their personal ones plus shared ones from their 1-1s. */
export async function fetchTasks(): Promise<TaskItem[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toTaskItem(row as TaskRow));
}

/**
 * Creates a personal task, actionable immediately (no confirmation step). Title, description
 * and deadline are all required — the same bar a task you give someone else has to clear.
 */
export async function createPersonalTask(
  userId: string,
  draft: TaskDraft,
  today: string = todayIso(),
): Promise<TaskItem> {
  const clean = validateTaskDraft(draft, today);
  if (!clean.value) throw new Error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      type: "personal",
      creator_id: userId,
      title: clean.value.title,
      description: clean.value.description,
      status: "confirmed",
      deadline_date: clean.value.deadline,
      deadline_time: clean.value.deadlineTime,
      deadline_tz: browserTimezone(),
      task_category_id: clean.value.categoryId,
      // The shared column is retired: importance is per-person now and lives in `task_flags`,
      // which the caller writes for whoever is acting. Left at false rather than dropped so
      // rows written before the split still read back unchanged.
      is_important: false,
      recurrence: clean.value.recurrence,
      recurrence_pattern: clean.value.recurrencePattern,
    })
    .select(TASK_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as TaskRow);
}

/** An empty date input means "no deadline", not an invalid one. */
export function normalizeDeadline(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return ISO_DATE.test(trimmed) ? trimmed : null;
}

/** Moves a personal task in or out of the owner's bin. Single-owner rows need no handshake. */
export async function setPersonalTaskDeleted(taskId: string, deleted: boolean): Promise<TaskItem> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ deleted_by_creator: deleted })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();

  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as TaskRow);
}

/** 'Xoá hẳn' for a personal task: the row really leaves the database. */
export async function purgePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw fail(error.code, error.message);
}

/**
 * Marks a personal task done, or re-opens it. Personal tasks are self-governed.
 *
 * `outputValue` is only ever written on the way in — completing with what the work brought.
 * Re-opening deliberately keeps the old text: it is a record of what happened last time, and
 * a new completion overwrites it; erasing it by hand is a separate decision the prompt offers
 * by sending null on the next completion.
 */
export async function setPersonalTaskDone(
  taskId: string,
  done: boolean,
  outputValue?: string | null,
): Promise<TaskItem> {
  const patch: { status: "done" | "confirmed"; done_at: string | null; output_value?: string | null } = done
    ? { status: "done", done_at: new Date().toISOString() }
    : { status: "confirmed", done_at: null };
  if (done && outputValue !== undefined) patch.output_value = outputValue;

  const { data, error } = await supabase.from("tasks").update(patch).eq("id", taskId).select(TASK_COLUMNS).single();
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as TaskRow);
}

/**
 * Where a shared task is being raised: which thread, which kind, who is being asked, and the
 * copy of the conversation that travels with it. A 1-1 task may leave `assigneeId` null — the
 * server fills in the only other participant — but a group task has to name someone.
 */
export type SharedTaskTarget = {
  conversationId: string;
  type: SharedTaskType;
  assigneeId: string | null;
  contextSnapshot: TaskContextSnapshot | null;
};

/**
 * Creates a shared task in a conversation, pending until the person asked confirms.
 * The client-generated id makes network retries idempotent server-side, and the context
 * snapshot can only be written here: the row refuses to have it edited afterwards.
 */
export async function createSharedTask(
  target: SharedTaskTarget,
  draft: TaskDraft,
  today: string = todayIso(),
): Promise<TaskItem> {
  const clean = validateTaskDraft(draft, today);
  if (!clean.value) throw new Error(clean.error ?? "Nhiệm vụ chưa đủ thông tin.");
  if (target.type === "group-shared" && target.assigneeId === null)
    throw new Error("Hãy chọn một thành viên đảm trách nhiệm vụ này.");

  const { data, error } = await supabase.rpc("create_shared_task", {
    p_conversation_id: target.conversationId,
    p_type: target.type,
    p_title: clean.value.title,
    p_description: clean.value.description,
    p_deadline: clean.value.deadline,
    p_task_id: crypto.randomUUID(),
    p_assignee_id: target.assigneeId,
    p_deadline_time: clean.value.deadlineTime,
    p_deadline_tz: browserTimezone(),
    p_category_id: clean.value.categoryId,
    // Retired in favour of per-person `task_flags`; see createPersonalTask.
    p_is_important: false,
    p_recurrence: clean.value.recurrence,
    p_recurrence_pattern: clean.value.recurrencePattern,
    p_context_snapshot:
      target.contextSnapshot === null ? null : snapshotToJson(target.contextSnapshot),
  });

  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/** The assignee accepts a pending shared task. Safe to retry. */
export async function confirmSharedTask(taskId: string): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("confirm_shared_task", { p_task_id: taskId });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/**
 * Step 1 of completion: the assignee claims the work is finished, naming what it brought.
 *
 * Through `mark_shared_task_done_with_output`, which applies every rule the bare claim
 * applies — participant, assignee-only, idempotent retries — and stores the output only
 * while the claim is still open. Once reviewed, the record is closed: the server refuses
 * to rewrite what was already judged. Safe to retry.
 */
export async function markSharedTaskDone(taskId: string, outputValue: string | null): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("mark_shared_task_done_with_output", {
    p_task_id: taskId,
    p_output_value: outputValue,
  });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/** Step 2 of completion: the creator accepts the claim and closes the task. Safe to retry. */
export async function reviewSharedTaskCompletion(taskId: string): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("review_shared_task_completion", { p_task_id: taskId });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/** The other answer to a done claim: send the work back for redo. Creator only. Safe to retry. */
export async function returnSharedTask(taskId: string): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("return_shared_task", { p_task_id: taskId });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/**
 * Puts a shared task in the caller's bin. The row only leaves the database once the other
 * side has binned it too — check `isTaskGone` on the result to know which happened.
 */
export async function deleteSharedTask(taskId: string): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("delete_shared_task", { p_task_id: taskId });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/**
 * Declines a suggestion: the assignee's answer of "not this".
 *
 * `silent` asks to decline without sending a word, which the server allows in a 1-1 and
 * refuses in a group — so this is not a UI-only asymmetry. Safe to retry: a task already
 * declined comes back unchanged rather than failing.
 */
export async function skipSharedTask(taskId: string, silent: boolean): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("skip_shared_task", {
    p_task_id: taskId,
    p_silent: silent,
  });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/**
 * Rewords a shared task: title, detail and when it is due.
 *
 * Both parties may do this while the task is live, because a promise often needs its wording
 * fixed after it is made. The server re-checks who is asking and what state the task is in —
 * this is not a client-side rule with a server-side hint.
 */
export async function updateSharedTaskDetails(
  taskId: string,
  edit: Required<TaskEdit>,
): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("update_shared_task_details", {
    p_task_id: taskId,
    p_title: edit.title,
    p_description: edit.description,
    p_deadline: edit.deadline,
    p_deadline_time: edit.deadlineTime,
    p_deadline_tz: browserTimezone(),
  });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/** The same edit on a personal task, which one person owns outright and RLS already guards. */
export async function updatePersonalTaskDetails(
  taskId: string,
  edit: Required<TaskEdit>,
): Promise<TaskItem> {
  const { data, error } = await supabase
    .from("tasks")
    .update({
      title: edit.title,
      description: edit.description,
      deadline_date: edit.deadline,
      deadline_time: edit.deadlineTime,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as TaskRow);
}

/**
 * The two optional planning fields on a task: milestone, and how far along it is.
 *
 * `progressPercent` uses `undefined` for "leave it alone" and `null` for "erase it", because
 * those are genuinely different requests: setting the milestone flag must not silently wipe
 * a percentage somebody typed, and clearing an estimate has to be sayable.
 */
export type TaskPlanPatch = {
  isMilestone?: boolean;
  progressPercent?: number | null;
};

/**
 * Writes the planning fields on a shared task.
 *
 * Through an RPC rather than a direct update, for the same reason every other shared-task
 * change is: the row belongs to two people, and who may touch it is re-checked by the server
 * against the task's state. A bystander in a group can read this task but not replan it.
 */
export async function updateSharedTaskPlan(
  taskId: string,
  patch: TaskPlanPatch,
): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("update_shared_task_plan", {
    p_task_id: taskId,
    p_is_milestone: patch.isMilestone ?? undefined,
    p_progress_percent: patch.progressPercent ?? undefined,
    p_clear_progress: patch.progressPercent === null,
  });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}

/** The same two fields on a personal task, which one person owns outright. */
export async function updatePersonalTaskPlan(
  taskId: string,
  patch: TaskPlanPatch,
): Promise<TaskItem> {
  const fields: { is_milestone?: boolean; progress_percent?: number | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (patch.isMilestone !== undefined) fields.is_milestone = patch.isMilestone;
  if (patch.progressPercent !== undefined) fields.progress_percent = patch.progressPercent;

  const { data, error } = await supabase
    .from("tasks")
    .update(fields)
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as TaskRow);
}

/**
 * When a task actually closed: the review stamp settles shared work, the claim is all a
 * personal task has. Null for anything still open.
 */
export function completedAtOf(task: TaskItem): string | null {
  return task.completedConfirmedAt ?? task.doneAt;
}

/**
 * The Báo cáo reading: work that closed AND named what it brought, newest first.
 *
 * Both halves matter. A task finished without an output has nothing to read back — it stays
 * on its own list, and does not gain an entry here by merely being finished. And a task this
 * person has binned is gone from their day, however good its result was. Every task the
 * viewer can read is eligible (including a group's), because a completed result is worth
 * seeing regardless of whose hands produced it.
 */
export function reportTasks(tasks: readonly TaskItem[], userId: string | undefined): TaskItem[] {
  return tasks
    .filter(
      (task) =>
        task.status === "done" &&
        task.outputValue !== null &&
        !isTaskGone(task) &&
        !isDeletedFor(task, userId),
    )
    .sort((a, b) => {
      const aAt = completedAtOf(a) ?? a.createdAt;
      const bAt = completedAtOf(b) ?? b.createdAt;
      // Newest first: the report answers "what have I delivered lately".
      if (aAt !== bAt) return aAt < bAt ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
}

/** Takes a shared task back out of the caller's bin. Safe to retry. */
export async function restoreSharedTask(taskId: string): Promise<TaskItem> {
  const { data, error } = await supabase.rpc("restore_shared_task", { p_task_id: taskId });
  if (error) throw fail(error.code, error.message);
  return toTaskItem(data as unknown as TaskRow);
}
