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
  /**
   * When someone pressed "Bắt đầu họp". Null = stage 1 (Kế hoạch họp: the plan is being prepared);
   * set = stage 2 (the meeting is on, each agenda line collects its own decisions). One way only,
   * and shared by everyone reading the note.
   */
  meetingStartedAt: string | null;
  /** Planned start, part of the plan. */
  scheduledAt: string | null;
  location: string;
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
  /**
   * The agenda line (0-based position in `agendaItems`) this item was decided under, or null for
   * work raised outside the agenda.
   */
  agendaIndex: number | null;
};

export const meetingNoteKeys = {
  details: (conversationId: string) => ["meeting-note-details", conversationId] as const,
  files: (conversationId: string) => ["meeting-note-files", conversationId] as const,
  journalRefs: (userId: string) => ["journal-references", userId] as const,
};

export const MEETING_LOCATION_MAX_LENGTH = 300;

export const MEETING_TYPE_MAX_LENGTH = 120;
export const MEETING_OBJECTIVE_MAX_LENGTH = 2000;
export const MEETING_DECISIONS_MAX_LENGTH = 5000;
export const MEETING_RISKS_MAX_LENGTH = 5000;
export const MEETING_MAX_AGENDA_ITEMS = 50;
export const MEETING_MAX_ACTION_ITEMS = 50;
export const MEETING_MAX_LINKS = 20;

export function emptyActionItem(agendaIndex: number | null = null): ActionItem {
  return { description: "", assigneeId: null, deadline: null, createTask: false, taskId: null, agendaIndex };
}

export function emptyDetails(decisionId: string): MeetingNoteDetails {
  return {
    decisionId,
    meetingStartedAt: null,
    scheduledAt: null,
    location: "",
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
    details.scheduledAt !== null ||
    details.location.trim() !== "" ||
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

/** Stage 1 is the plan; stage 2 starts when someone presses "Bắt đầu họp". */
export function meetingStage(details: MeetingNoteDetails | undefined): 1 | 2 {
  return details?.meetingStartedAt != null ? 2 : 1;
}

/**
 * Action items grouped under the agenda line they belong to, keeping each item's position in the
 * flat list (the position is what an edit writes back to). Items pointing past the end of the
 * agenda — a line was removed — fall into `loose` rather than disappearing.
 */
export function groupActionItemsByAgenda(details: MeetingNoteDetails): {
  byAgenda: { index: number; item: ActionItem }[][];
  loose: { index: number; item: ActionItem }[];
} {
  const byAgenda: { index: number; item: ActionItem }[][] = details.agendaItems.map(() => []);
  const loose: { index: number; item: ActionItem }[] = [];
  details.actionItems.forEach((item, index) => {
    const slot = item.agendaIndex !== null ? byAgenda[item.agendaIndex] : undefined;
    if (slot !== undefined) slot.push({ index, item });
    else loose.push({ index, item });
  });
  return { byAgenda, loose };
}

/**
 * Removes one agenda line and keeps every action item pointing at the right line: items under the
 * removed line become loose (their decision is kept, not thrown away), later lines shift up by one.
 */
export function removeAgendaItem(details: MeetingNoteDetails, removeAt: number): MeetingNoteDetails {
  return {
    ...details,
    agendaItems: details.agendaItems.filter((_, i) => i !== removeAt),
    actionItems: details.actionItems.map((item) => {
      if (item.agendaIndex === null) return item;
      if (item.agendaIndex === removeAt) return { ...item, agendaIndex: null };
      if (item.agendaIndex > removeAt) return { ...item, agendaIndex: item.agendaIndex - 1 };
      return item;
    }),
  };
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
  if (normalized.includes("avora_note_agenda_index_invalid"))
    return new Error("Một việc cần làm đang gắn với nội dung họp không còn tồn tại.");
  if (normalized.includes("avora_note_too_many_items"))
    return new Error("Biên bản có quá nhiều dòng (tối đa 50 mỗi loại).");
  if (normalized.includes("avora_note_not_finalized"))
    return new Error("Chỉ lưu được biên bản đã hoàn tất.");
  if (normalized.includes("avora_note_file_bad_path") || normalized.includes("avora_note_file_missing"))
    return new Error("Tệp chưa tải lên xong. Thử lại nhé.");
  return new Error(toVietnameseDecisionError(code, message));
}

type DetailsRow = {
  decision_id: string;
  meeting_started_at: string | null;
  scheduled_at: string | null;
  location: string | null;
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
    agendaIndex:
      typeof record.agenda_index === "number" &&
      Number.isInteger(record.agenda_index) &&
      record.agenda_index >= 0
        ? record.agenda_index
        : null,
  };
}

function toDetails(row: DetailsRow): MeetingNoteDetails {
  return {
    decisionId: row.decision_id,
    meetingStartedAt: row.meeting_started_at,
    scheduledAt: row.scheduled_at,
    location: row.location ?? "",
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
  "decision_id, meeting_started_at, scheduled_at, location, meeting_type, objective, attendee_ids, absentee_ids, agenda_items, decisions_made, action_items, risks_issues, next_meeting_at, reference_links";

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

/**
 * The exact payload a save sends.
 *
 * Blank agenda lines are dropped, so every item's `agendaIndex` is re-pointed at the line's new
 * position; an item whose line was blank (and therefore dropped) becomes loose. Blank, unticked
 * action items are dropped too.
 */
export function toSavePayload(details: MeetingNoteDetails): {
  agendaItems: string[];
  actionItems: {
    description: string;
    assignee_id: string | null;
    deadline: string | null;
    create_task: boolean;
    task_id: string | null;
    agenda_index: number | null;
  }[];
} {
  const remap = new Map<number, number>();
  const agendaItems: string[] = [];
  details.agendaItems.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    remap.set(index, agendaItems.length);
    agendaItems.push(trimmed);
  });
  const actionItems = details.actionItems
    .filter((item) => item.description.trim() !== "" || item.createTask)
    .map((item) => ({
      description: item.description.trim(),
      assignee_id: item.assigneeId,
      deadline: item.deadline,
      create_task: item.createTask,
      task_id: item.taskId,
      agenda_index: item.agendaIndex === null ? null : (remap.get(item.agendaIndex) ?? null),
    }));
  return { agendaItems, actionItems };
}

/** Saves the structured half of a draft. Refused by the database once the note is locked. */
export async function saveMeetingNoteDetails(details: MeetingNoteDetails): Promise<void> {
  const payload = toSavePayload(details);
  const { error } = await supabase.rpc("save_meeting_note_details", {
    p_decision_id: details.decisionId,
    p_meeting_type: details.meetingType.trim(),
    p_objective: details.objective.trim(),
    p_attendee_ids: details.attendeeIds,
    p_absentee_ids: details.absenteeIds,
    p_agenda_items: payload.agendaItems,
    p_decisions_made: details.decisionsMade.trim(),
    p_action_items: payload.actionItems,
    p_risks_issues: details.risksIssues.trim(),
    p_next_meeting_at: details.nextMeetingAt,
    p_reference_links: details.referenceLinks
      .map((link) => link.trim())
      .filter((link) => link !== ""),
    p_scheduled_at: details.scheduledAt,
    p_location: details.location.trim(),
  });
  if (error) throw fail(error.code, error.message);
}

/** "Bắt đầu họp": moves the note into stage 2 for everyone. Safe to press twice. */
export async function startMeeting(decisionId: string): Promise<void> {
  const { error } = await supabase.rpc("start_meeting_note", { p_decision_id: decisionId });
  if (error) throw fail(error.code, error.message);
}

/* ---------------------------------------------------------------------------------------------
 * Custom minutes file (Word/PDF), view-only, beside the structured note
 * ------------------------------------------------------------------------------------------- */

export const MEETING_FILE_BUCKET = "meeting-files";
export const MEETING_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const MEETING_FILE_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
/** For the file picker: extensions as well as types, since some systems report no type for .doc. */
export const MEETING_FILE_ACCEPT = ".pdf,.doc,.docx," + MEETING_FILE_MIME_TYPES.join(",");

export type MeetingNoteFile = {
  decisionId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  uploadedBy: string;
  createdAt: string;
};

/** The type a chosen file is uploaded as, inferred from its name when the browser gave none. */
export function meetingFileMimeType(file: { name: string; type: string }): string | null {
  if (MEETING_FILE_MIME_TYPES.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  return null;
}

/** Why a chosen file cannot be the minutes file, or null when it can. */
export function meetingFileRejection(file: { name: string; type: string; size: number }): string | null {
  if (meetingFileMimeType(file) === null) return "Chỉ nhận tệp Word (.doc, .docx) hoặc PDF.";
  if (file.size <= 0) return "Tệp trống.";
  if (file.size > MEETING_FILE_MAX_BYTES) return "Tệp lớn hơn 25 MB.";
  return null;
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (cleaned === "" ? "bien-ban" : cleaned).slice(0, 120);
}

/** Where a note's file lives: `{conversationId}/{decisionId}/{uploadId}-{name}`. */
export function meetingFilePath(conversationId: string, decisionId: string, fileName: string): string {
  return `${conversationId}/${decisionId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

export async function fetchMeetingNoteFiles(
  decisionIds: readonly string[],
): Promise<Map<string, MeetingNoteFile>> {
  const index = new Map<string, MeetingNoteFile>();
  if (decisionIds.length === 0) return index;
  const { data, error } = await supabase
    .from("meeting_note_files")
    .select("decision_id, storage_path, file_name, mime_type, byte_size, uploaded_by, created_at")
    .in("decision_id", [...decisionIds]);
  if (error) throw fail(error.code, error.message);
  for (const row of data ?? []) {
    index.set(row.decision_id, {
      decisionId: row.decision_id,
      storagePath: row.storage_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      uploadedBy: row.uploaded_by,
      createdAt: row.created_at,
    });
  }
  return index;
}

/**
 * Uploads a Word/PDF and makes it this note's minutes file, replacing any earlier one. The old
 * object is tidied away afterwards; if that fails it is only an orphan nobody can read (the read
 * policy requires a note to point at it).
 */
export async function attachMeetingNoteFile(input: {
  conversationId: string;
  decisionId: string;
  file: File;
}): Promise<void> {
  const reason = meetingFileRejection(input.file);
  if (reason !== null) throw new Error(reason);
  const mimeType = meetingFileMimeType(input.file) as string;
  const path = meetingFilePath(input.conversationId, input.decisionId, input.file.name);

  const upload = await supabase.storage
    .from(MEETING_FILE_BUCKET)
    .upload(path, input.file, { contentType: mimeType, upsert: false });
  if (upload.error) {
    console.error("[meeting-notes] upload failed:", upload.error.message);
    throw new Error("Không tải được tệp lên. Kiểm tra kết nối rồi thử lại.");
  }

  const { data, error } = await supabase.rpc("attach_meeting_note_file", {
    p_decision_id: input.decisionId,
    p_storage_path: path,
    p_file_name: input.file.name,
    p_mime_type: mimeType,
    p_byte_size: input.file.size,
  });
  if (error) {
    await supabase.storage.from(MEETING_FILE_BUCKET).remove([path]);
    throw fail(error.code, error.message);
  }
  const replaced = typeof data === "string" && data !== "" ? data : null;
  if (replaced !== null) await supabase.storage.from(MEETING_FILE_BUCKET).remove([replaced]);
}

/** Back to the AVORA template only. */
export async function removeMeetingNoteFile(decisionId: string): Promise<void> {
  const { data, error } = await supabase.rpc("remove_meeting_note_file", { p_decision_id: decisionId });
  if (error) throw fail(error.code, error.message);
  const removed = typeof data === "string" && data !== "" ? data : null;
  if (removed !== null) await supabase.storage.from(MEETING_FILE_BUCKET).remove([removed]);
}

/** A short-lived link to view the file. View-only: opened in the browser, not offered as a download. */
export async function meetingFileUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(MEETING_FILE_BUCKET).createSignedUrl(storagePath, 300);
  if (error) {
    console.error("[meeting-notes] signed url failed:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * "Lưu vào Nhật ký" — a reference in the saver's own Diary
 * ------------------------------------------------------------------------------------------- */

/** A finalized meeting note kept in someone's Diary, by reference. */
export type JournalReference = {
  id: string;
  decisionId: string | null;
  title: string;
  groupId: string;
  groupName: string;
  authorName: string;
  finalizedAt: string | null;
  fileName: string | null;
  createdAt: string;
};

function readSnapshotString(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  return typeof value === "string" ? value : "";
}

export function toJournalReference(row: {
  id: string;
  decision_id: string | null;
  context_snapshot: unknown;
  created_at: string;
}): JournalReference {
  const snapshot =
    row.context_snapshot !== null && typeof row.context_snapshot === "object" && !Array.isArray(row.context_snapshot)
      ? (row.context_snapshot as Record<string, unknown>)
      : {};
  const finalizedAt = readSnapshotString(snapshot, "finalized_at");
  const fileName = readSnapshotString(snapshot, "file_name");
  return {
    id: row.id,
    decisionId: row.decision_id,
    title: readSnapshotString(snapshot, "title") || "Biên bản họp",
    groupId: readSnapshotString(snapshot, "group_id"),
    groupName: readSnapshotString(snapshot, "group_name"),
    authorName: readSnapshotString(snapshot, "author_name"),
    finalizedAt: finalizedAt === "" ? null : finalizedAt,
    fileName: fileName === "" ? null : fileName,
    createdAt: row.created_at,
  };
}

export async function fetchJournalReferences(): Promise<JournalReference[]> {
  const { data, error } = await supabase
    .from("journal_references")
    .select("id, decision_id, context_snapshot, created_at")
    .order("created_at", { ascending: false });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map(toJournalReference);
}

/** Saves a finalized note into the caller's Diary. Saving twice keeps one entry. */
export async function saveMeetingNoteToJournal(decisionId: string): Promise<void> {
  const { error } = await supabase.rpc("save_meeting_note_to_journal", { p_decision_id: decisionId });
  if (error) throw fail(error.code, error.message);
}

/** Takes the entry out of Diary. The note itself is untouched. */
export async function removeJournalReference(referenceId: string): Promise<void> {
  const { error } = await supabase.from("journal_references").delete().eq("id", referenceId);
  if (error) throw fail(error.code, error.message);
}
