import { supabase } from "@/integrations/supabase/client";
import { toVietnameseDecisionError } from "@/lib/decisions";

/**
 * The structured half of a meeting note.
 *
 * A note used to be one free-text box, which works right up until someone has to find out
 * what was decided three weeks ago. These are the parts a secretary should not have to
 * remember: what the meeting was for, who was actually there, what was agreed, what anyone
 * is now expected to do about it.
 *
 * Every field is optional. The labels are not — they stay on screen even when empty, because
 * the reason minutes lose things is that nobody was reminded the field existed.
 */
export type MeetingNoteDetails = {
  decisionId: string;
  meetingType: string;
  objective: string;
  attendeeIds: string[];
  absenteeIds: string[];
  agendaItems: string[];
  /** Kept out of the free-text body: this is the part people come back to read. */
  decisionsMade: string;
  actionItems: ActionItem[];
  risksIssues: string;
  nextMeetingAt: string | null;
  referenceLinks: string[];
};

/**
 * One thing someone is expected to do after the meeting.
 *
 * `createTask` is a request, not a result: the task itself is only created when the note is
 * finalized, because a draft is still being argued with. `taskId` is stamped by the server
 * once that has happened, which is also what stops a second finalize from producing the work
 * twice.
 */
export type ActionItem = {
  description: string;
  assigneeId: string | null;
  /** `YYYY-MM-DD`, or null while nobody has said when. */
  deadline: string | null;
  createTask: boolean;
  taskId: string | null;
};

export const meetingNoteKeys = {
  details: (conversationId: string) => ["meeting-note-details", conversationId] as const,
};

export const MEETING_TYPE_MAX_LENGTH = 120;
export const MEETING_OBJECTIVE_MAX_LENGTH = 2000;
export const MEETING_DECISIONS_MAX_LENGTH = 5000;
export const MEETING_RISKS_MAX_LENGTH = 5000;
export const MEETING_MAX_AGENDA_ITEMS = 50;
export const MEETING_MAX_ACTION_ITEMS = 50;
export const MEETING_MAX_LINKS = 20;

export function emptyActionItem(): ActionItem {
  return { description: "", assigneeId: null, deadline: null, createTask: false, taskId: null };
}

export function emptyDetails(decisionId: string): MeetingNoteDetails {
  return {
    decisionId,
    meetingType: "",
    objective: "",
    attendeeIds: [],
    absenteeIds: [],
    agendaItems: [],
    decisionsMade: "",
    actionItems: [],
    risksIssues: "",
    nextMeetingAt: null,
    referenceLinks: [],
  };
}

/** True once this note carries anything beyond its title and body. */
export function hasAnyDetail(details: MeetingNoteDetails): boolean {
  return (
    details.meetingType.trim() !== "" ||
    details.objective.trim() !== "" ||
    details.attendeeIds.length > 0 ||
    details.absenteeIds.length > 0 ||
    details.agendaItems.length > 0 ||
    details.decisionsMade.trim() !== "" ||
    details.actionItems.length > 0 ||
    details.risksIssues.trim() !== "" ||
    details.nextMeetingAt !== null ||
    details.referenceLinks.length > 0
  );
}

/**
 * Whether a ticked action item can actually become a task.
 *
 * A task needs someone to carry it, a day it is due, and a description of the work. An item
 * ticked without those cannot be created, and the server refuses the whole finalize rather
 * than skipping the line — so the form has to be able to say which line is short before
 * anyone presses the button.
 */
export function actionItemBlocker(item: ActionItem): string | null {
  if (!item.createTask) return null;
  if (item.description.trim() === "") return "Cần mô tả công việc.";
  if (item.assigneeId === null) return "Cần chọn người phụ trách.";
  if (item.deadline === null || item.deadline.trim() === "") return "Cần chọn hạn hoàn thành.";
  return null;
}

/** Every ticked item that is not yet ready, by its position in the list. */
export function actionItemBlockers(items: readonly ActionItem[]): Map<number, string> {
  const blockers = new Map<number, string>();
  items.forEach((item, index) => {
    const reason = actionItemBlocker(item);
    if (reason !== null) blockers.set(index, reason);
  });
  return blockers;
}

/**
 * Whether the note can be locked.
 *
 * Locking is what creates the tasks, so a note with a half-filled ticked item is not ready:
 * finalizing it would be refused by the server anyway, and the button should not invite that.
 */
export function canFinalizeWithDetails(details: MeetingNoteDetails | undefined): boolean {
  if (details === undefined) return true;
  return actionItemBlockers(details.actionItems).size === 0;
}

/** How many tasks locking this note will hand out. */
export function pendingTaskCount(details: MeetingNoteDetails | undefined): number {
  if (details === undefined) return 0;
  return details.actionItems.filter((item) => item.createTask && item.taskId === null).length;
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[meeting-notes] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_note_action_needs_description"))
    return new Error("Một việc cần làm đã tick “Tạo Task” nhưng chưa có mô tả.");
  if (normalized.includes("avora_note_action_needs_assignee"))
    return new Error("Một việc cần làm đã tick “Tạo Task” nhưng chưa có người phụ trách.");
  if (normalized.includes("avora_note_action_needs_deadline"))
    return new Error("Một việc cần làm đã tick “Tạo Task” nhưng chưa có hạn hoàn thành.");
  if (normalized.includes("avora_note_person_not_participant"))
    return new Error("Có người trong danh sách không còn trong nhóm này.");
  if (normalized.includes("avora_note_actions_not_array"))
    return new Error("Danh sách việc cần làm không hợp lệ.");
  return new Error(toVietnameseDecisionError(code, message));
}

type DetailsRow = {
  decision_id: string;
  meeting_type: string | null;
  objective: string | null;
  attendee_ids: string[] | null;
  absentee_ids: string[] | null;
  agenda_items: string[] | null;
  decisions_made: string | null;
  action_items: unknown;
  risks_issues: string | null;
  next_meeting_at: string | null;
  reference_links: string[] | null;
};

/** Reads an action item off stored JSON. Anything malformed reads as an empty line. */
function toActionItem(raw: unknown): ActionItem {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyActionItem();
  const record = raw as Record<string, unknown>;
  return {
    description: typeof record.description === "string" ? record.description : "",
    assigneeId:
      typeof record.assignee_id === "string" && record.assignee_id !== "" ? record.assignee_id : null,
    deadline: typeof record.deadline === "string" && record.deadline !== "" ? record.deadline : null,
    createTask: record.create_task === true,
    taskId: typeof record.task_id === "string" && record.task_id !== "" ? record.task_id : null,
  };
}

function toDetails(row: DetailsRow): MeetingNoteDetails {
  return {
    decisionId: row.decision_id,
    meetingType: row.meeting_type ?? "",
    objective: row.objective ?? "",
    attendeeIds: row.attendee_ids ?? [],
    absenteeIds: row.absentee_ids ?? [],
    agendaItems: row.agenda_items ?? [],
    decisionsMade: row.decisions_made ?? "",
    actionItems: Array.isArray(row.action_items) ? row.action_items.map(toActionItem) : [],
    risksIssues: row.risks_issues ?? "",
    nextMeetingAt: row.next_meeting_at,
    referenceLinks: row.reference_links ?? [],
  };
}

const DETAILS_COLUMNS =
  "decision_id, meeting_type, objective, attendee_ids, absentee_ids, agenda_items, decisions_made, action_items, risks_issues, next_meeting_at, reference_links";

/**
 * Details for every note in one group, keyed by note id.
 *
 * Fetched for the whole group in one pass rather than per note, because the log renders all
 * of them at once and a request per row would be a request per row.
 */
export async function fetchMeetingNoteDetails(
  decisionIds: readonly string[],
): Promise<Map<string, MeetingNoteDetails>> {
  if (decisionIds.length === 0) return new Map<string, MeetingNoteDetails>();
  const { data, error } = await supabase
    .from("meeting_note_details")
    .select(DETAILS_COLUMNS)
    .in("decision_id", [...decisionIds]);
  if (error) throw fail(error.code, error.message);

  const index = new Map<string, MeetingNoteDetails>();
  for (const row of data ?? []) {
    const details = toDetails(row as DetailsRow);
    index.set(details.decisionId, details);
  }
  return index;
}

/** Saves the structured half of a draft. Refused by the database once the note is locked. */
export async function saveMeetingNoteDetails(details: MeetingNoteDetails): Promise<void> {
  const { error } = await supabase.rpc("save_meeting_note_details", {
    p_decision_id: details.decisionId,
    p_meeting_type: details.meetingType.trim(),
    p_objective: details.objective.trim(),
    p_attendee_ids: details.attendeeIds,
    p_absentee_ids: details.absenteeIds,
    p_agenda_items: details.agendaItems.map((item) => item.trim()).filter((item) => item !== ""),
    p_decisions_made: details.decisionsMade.trim(),
    p_action_items: details.actionItems
      .filter((item) => item.description.trim() !== "" || item.createTask)
      .map((item) => ({
        description: item.description.trim(),
        assignee_id: item.assigneeId,
        deadline: item.deadline,
        create_task: item.createTask,
        // Preserved so a re-save never un-stamps a line that already produced a task.
        task_id: item.taskId,
      })),
    p_risks_issues: details.risksIssues.trim(),
    p_next_meeting_at: details.nextMeetingAt,
    p_reference_links: details.referenceLinks
      .map((link) => link.trim())
      .filter((link) => link !== ""),
  });
  if (error) throw fail(error.code, error.message);
}
