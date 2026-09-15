import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toIsoTimestamp } from "@/lib/chat";
import {
  parseContextSnapshot,
  snapshotToJson,
  type TaskContextSnapshot,
} from "@/lib/task-context";
import { browserTimezone, normalizeDeadlineTime } from "@/lib/task-schedule";
import { toVietnameseTaskError, type TaskDraft } from "@/lib/tasks";

/** Query keys live here so the realtime provider can patch the cache without importing hooks. */
export const suggestionKeys = {
  all: ["task-suggestions"] as const,
  list: ["task-suggestions", "list"] as const,
};

/**
 * Three answers a suggestion can be in, and only the first one is still a question.
 *
 * `pending` is deliberately NOT a task state — a suggestion nobody has agreed to is not work
 * anybody is carrying, and putting it in `tasks` is what made unanswered requests show up in
 * deadline views, counters and badges as though they were promises.
 */
export type SuggestionStatus = "pending" | "accepted" | "skipped";

/**
 * A piece of work someone proposed in a conversation, before anyone agreed to it.
 *
 * It lives beside the chat rather than on a task list, because that is what it is: a question
 * asked out loud. It becomes a task at the exact moment the person asked says yes, and never
 * before.
 */
export type TaskSuggestion = {
  id: string;
  conversationId: string;
  /** The message it came out of, or null when the thread was empty or that message is gone. */
  messageId: string | null;
  proposerId: string;
  /** The one person being asked. Every rule here turns on them, so it is never null. */
  assigneeId: string;
  title: string;
  description: string;
  deadline: string;
  deadlineTime: string | null;
  deadlineTz: string;
  /** The conversation this was raised from, required at creation and never editable after. */
  contextSnapshot: TaskContextSnapshot | null;
  status: SuggestionStatus;
  /** Whether a decline was made without sending a word. Only ever true in a 1-1. */
  skippedSilently: boolean;
  /** The task this became, once accepted. */
  acceptedTaskId: string | null;
  /** When it was answered, either way. Null exactly while it is still pending. */
  resolvedAt: string | null;
  createdAt: string;
};

type SuggestionRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  proposer_id: string;
  assignee_id: string;
  proposed_title: string;
  proposed_description: string;
  proposed_deadline: string;
  proposed_deadline_time: string | null;
  proposed_deadline_tz: string | null;
  context_snapshot: unknown;
  status: string;
  skipped_silently: boolean | null;
  accepted_task_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

const SUGGESTION_COLUMNS =
  "id, conversation_id, message_id, proposer_id, assignee_id, proposed_title, proposed_description, proposed_deadline, proposed_deadline_time, proposed_deadline_tz, context_snapshot, status, skipped_silently, accepted_task_id, resolved_at, created_at";

function toStatus(raw: string): SuggestionStatus {
  if (raw === "accepted" || raw === "skipped") return raw;
  return "pending";
}

function toSuggestion(row: SuggestionRow): TaskSuggestion {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    proposerId: row.proposer_id,
    assigneeId: row.assignee_id,
    title: row.proposed_title,
    description: row.proposed_description ?? "",
    deadline: row.proposed_deadline,
    deadlineTime: normalizeDeadlineTime(row.proposed_deadline_time),
    deadlineTz: row.proposed_deadline_tz ?? "Asia/Ho_Chi_Minh",
    contextSnapshot: parseContextSnapshot(row.context_snapshot),
    status: toStatus(row.status),
    skippedSilently: row.skipped_silently ?? false,
    acceptedTaskId: row.accepted_task_id,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/** Realtime sends raw Postgres timestamps without a zone marker; normalise them like messages. */
export function suggestionFromRealtimeRow(
  row: Database["public"]["Tables"]["task_suggestions"]["Row"],
): TaskSuggestion {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    proposerId: row.proposer_id,
    assigneeId: row.assignee_id,
    title: row.proposed_title,
    description: row.proposed_description ?? "",
    deadline: row.proposed_deadline,
    deadlineTime: normalizeDeadlineTime(row.proposed_deadline_time),
    deadlineTz: row.proposed_deadline_tz ?? "Asia/Ho_Chi_Minh",
    contextSnapshot: parseContextSnapshot(row.context_snapshot),
    status: toStatus(row.status),
    skippedSilently: row.skipped_silently ?? false,
    acceptedTaskId: row.accepted_task_id,
    resolvedAt: row.resolved_at === null ? null : toIsoTimestamp(row.resolved_at),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

/** Maps Postgres failures on the suggestion RPCs to short Vietnamese messages. */
export function toVietnameseSuggestionError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_suggestion_not_found"))
    return "Không tìm thấy gợi ý này. Có thể nó đã được gỡ.";
  if (normalized.includes("avora_suggestion_already_answered"))
    return "Gợi ý này đã được trả lời rồi.";
  // Reuses the task vocabulary for everything else: the two flows raise the same error names,
  // and a person reading "Chỉ người được giao…" should not get two different wordings of it.
  return toVietnameseTaskError(code, message);
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[task-suggestions] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseSuggestionError(code, message));
}

/** Every suggestion in every conversation this person is in. RLS decides what that means. */
export async function fetchTaskSuggestions(): Promise<TaskSuggestion[]> {
  const { data, error } = await supabase
    .from("task_suggestions")
    .select(SUGGESTION_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toSuggestion(row as SuggestionRow));
}

/** Where a suggestion is being raised, and who is being asked. */
export type SuggestionTarget = {
  conversationId: string;
  assigneeId: string;
  /** The message being answered, quoted on the suggestion. Null in an empty thread. */
  messageId: string | null;
  contextSnapshot: TaskContextSnapshot;
};

/**
 * Proposes work to someone. Writes nothing to `tasks` — that is the point of the split.
 *
 * The client-generated id makes network retries idempotent server-side, and the context
 * snapshot can only be written here: the row refuses to have it edited afterwards.
 */
export async function createTaskSuggestion(
  target: SuggestionTarget,
  draft: { title: string; description: string; deadline: string; deadlineTime: string | null },
): Promise<TaskSuggestion> {
  const { data, error } = await supabase.rpc("create_task_suggestion", {
    p_conversation_id: target.conversationId,
    p_assignee_id: target.assigneeId,
    p_title: draft.title,
    p_description: draft.description,
    p_deadline: draft.deadline,
    p_context_snapshot: snapshotToJson(target.contextSnapshot),
    p_suggestion_id: crypto.randomUUID(),
    p_message_id: target.messageId,
    p_deadline_time: draft.deadlineTime,
    p_deadline_tz: browserTimezone(),
  });

  if (error) throw fail(error.code, error.message);
  return toSuggestion(data as unknown as SuggestionRow);
}

/**
 * "Tạo tác vụ": the suggestion becomes a real task, created at this moment and not before.
 *
 * Returns the task, already accepted — the person calling this just agreed, so asking them to
 * confirm it afterwards would be asking them to accept the thing they accepted. Safe to retry:
 * a suggestion already accepted returns its existing task instead of making a second one.
 */
export async function acceptTaskSuggestion(
  suggestionId: string,
): Promise<Database["public"]["Tables"]["tasks"]["Row"]> {
  const { data, error } = await supabase.rpc("accept_task_suggestion", {
    p_suggestion_id: suggestionId,
    p_task_id: crypto.randomUUID(),
  });
  if (error) throw fail(error.code, error.message);
  return data as unknown as Database["public"]["Tables"]["tasks"]["Row"];
}

/**
 * "Bỏ qua": the other answer. Touches only the suggestion — no task is created, and none is
 * deleted, because none ever existed. Declining leaves no trace in anybody's task list.
 *
 * `silent` asks to decline without sending a word, which the server allows in a 1-1 and refuses
 * in a group, so this is not a UI-only asymmetry. Safe to retry.
 */
export async function skipTaskSuggestion(
  suggestionId: string,
  silent: boolean,
): Promise<TaskSuggestion> {
  const { data, error } = await supabase.rpc("skip_task_suggestion", {
    p_suggestion_id: suggestionId,
    p_silent: silent,
  });
  if (error) throw fail(error.code, error.message);
  return toSuggestion(data as unknown as SuggestionRow);
}

// ---------------------------------------------------------------- reading

/** Still a question: nobody has answered it yet. */
export function isPending(suggestion: TaskSuggestion): boolean {
  return suggestion.status === "pending";
}

/**
 * Whether this person is the one being asked, and the question is still open.
 *
 * Deliberately excludes the proposer: a proposer who could answer on the assignee's behalf
 * would be agreeing with themselves, or withdrawing their own request while making it look
 * like a refusal. Their way out is deleting the suggestion, not answering it.
 */
export function canAnswerSuggestion(
  suggestion: TaskSuggestion,
  userId: string | undefined,
): boolean {
  return userId !== undefined && isPending(suggestion) && suggestion.assigneeId === userId;
}

/**
 * Whether declining this one may be done without sending a word.
 *
 * Allowed in a 1-1 and refused in a group, mirroring the database exactly. A group is told the
 * kind of room it is by its conversation type, which the caller supplies — the suggestion row
 * does not carry it, and inferring it from anything else would be a guess.
 */
export function canSkipSuggestionSilently(conversationKind: string): boolean {
  return conversationKind === "direct";
}

/** Everything still waiting on this person to answer, oldest first. */
export function suggestionsAwaiting(
  suggestions: readonly TaskSuggestion[],
  userId: string | undefined,
): TaskSuggestion[] {
  if (userId === undefined) return [];
  return suggestions.filter((entry) => canAnswerSuggestion(entry, userId));
}

/**
 * What this person has asked of others and not heard back on.
 *
 * This is the half that used to be invisible: before the split, a proposer saw their unanswered
 * request sitting in their task list looking like work in progress. It is not — it is a question
 * they are waiting on, which is a different thing and belongs under its own heading.
 */
export function suggestionsProposed(
  suggestions: readonly TaskSuggestion[],
  userId: string | undefined,
): TaskSuggestion[] {
  if (userId === undefined) return [];
  return suggestions.filter((entry) => isPending(entry) && entry.proposerId === userId);
}

/** Every suggestion still open in one conversation, for the panel inside that chat. */
export function pendingInConversation(
  suggestions: readonly TaskSuggestion[],
  conversationId: string,
): TaskSuggestion[] {
  return suggestions.filter(
    (entry) => entry.conversationId === conversationId && isPending(entry),
  );
}

/**
 * Silent declines belonging to one conversation, oldest first.
 *
 * Only genuinely silent ones: a decline that sent a message is already visible as that message,
 * and annotating it too would say the same thing twice.
 */
export function silentlySkippedInConversation(
  suggestions: readonly TaskSuggestion[],
  conversationId: string,
): { id: string; assigneeId: string; at: string }[] {
  return suggestions
    .filter(
      (entry) =>
        entry.conversationId === conversationId &&
        entry.status === "skipped" &&
        entry.skippedSilently &&
        entry.resolvedAt !== null,
    )
    .map((entry) => ({
      id: entry.id,
      assigneeId: entry.assigneeId,
      at: entry.resolvedAt as string,
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Inserts or replaces a suggestion in the cached list, keeping fetch order. */
export function upsertSuggestion(
  list: TaskSuggestion[],
  incoming: TaskSuggestion,
): TaskSuggestion[] {
  const index = list.findIndex((entry) => entry.id === incoming.id);
  if (index === -1) {
    const next = [...list, incoming];
    next.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return next;
  }
  const current = list[index];
  if (
    current &&
    current.status === incoming.status &&
    current.skippedSilently === incoming.skippedSilently &&
    current.acceptedTaskId === incoming.acceptedTaskId &&
    current.title === incoming.title
  ) {
    return list;
  }
  const next = [...list];
  next[index] = incoming;
  return next;
}

/** Drops a suggestion from the cached list; same reference when it was not there. */
export function removeSuggestion(list: TaskSuggestion[], id: string): TaskSuggestion[] {
  const next = list.filter((entry) => entry.id !== id);
  return next.length === list.length ? list : next;
}

/**
 * The draft a suggestion form produces, validated by the same rules a task draft is.
 * Kept as a distinct shape so a suggestion cannot accidentally carry task-only fields
 * (recurrence, category, reminders) that only become meaningful once someone accepts.
 */
export type SuggestionDraft = Pick<TaskDraft, "title" | "description" | "deadline"> & {
  deadlineTime?: string;
};
