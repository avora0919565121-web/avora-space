import { supabase } from "@/integrations/supabase/client";
import {
  isInvitationStatus,
  toVietnameseCollabError,
  type ChecklistItem,
  type TaskParticipant,
  type TaskResource,
} from "@/lib/task-collab";

function fail(scope: string, code: string | undefined, message: string): Error {
  console.error(`[${scope}] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseCollabError(message));
}

type ParticipantRow = {
  id: string;
  task_id: string;
  user_id: string;
  invitation_status: string;
  invited_by: string;
  invited_at: string;
  responded_at: string | null;
};

function toParticipant(row: ParticipantRow): TaskParticipant {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    status: isInvitationStatus(row.invitation_status) ? row.invitation_status : "pending",
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    respondedAt: row.responded_at,
  };
}

/** Every participant row the caller may see: their own invitations and those on tasks they see. */
export async function fetchTaskParticipants(): Promise<TaskParticipant[]> {
  const { data, error } = await supabase
    .from("task_participants")
    .select("id, task_id, user_id, invitation_status, invited_by, invited_at, responded_at")
    .order("invited_at", { ascending: false });
  if (error) throw fail("task-participants", error.code, error.message);
  return (data ?? []).map((row) => toParticipant(row as ParticipantRow));
}

export async function inviteTaskParticipant(taskId: string, userId: string): Promise<TaskParticipant> {
  const { data, error } = await supabase.rpc("invite_task_participant", {
    p_task_id: taskId,
    p_user_id: userId,
  });
  if (error) throw fail("task-participants", error.code, error.message);
  return toParticipant(data as unknown as ParticipantRow);
}

export async function respondTaskInvitation(participantId: string, accept: boolean): Promise<TaskParticipant> {
  const { data, error } = await supabase.rpc("respond_task_invitation", {
    p_participant_id: participantId,
    p_accept: accept,
  });
  if (error) throw fail("task-participants", error.code, error.message);
  return toParticipant(data as unknown as ParticipantRow);
}

export async function withdrawTaskInvitation(participantId: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_task_invitation", { p_participant_id: participantId });
  if (error) throw fail("task-participants", error.code, error.message);
}

// ------------------------------------------------------------------ checklist

type ChecklistRow = {
  item_id: string;
  task_id: string;
  content: string;
  position: number;
  completed: boolean;
  completed_at: string | null;
};

function toChecklistItem(row: ChecklistRow): ChecklistItem {
  return {
    id: row.item_id,
    taskId: row.task_id,
    content: row.content,
    position: row.position,
    completed: row.completed,
    completedAt: row.completed_at,
  };
}

const CHECKLIST_COLUMNS = "item_id, task_id, content, position, completed, completed_at";

export async function fetchChecklist(taskId: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from("checklist_items")
    .select(CHECKLIST_COLUMNS)
    .eq("task_id", taskId)
    .order("position", { ascending: true });
  if (error) throw fail("checklist", error.code, error.message);
  return (data ?? []).map((row) => toChecklistItem(row as ChecklistRow));
}

export async function addChecklistItem(taskId: string, content: string, position: number): Promise<ChecklistItem> {
  const { data, error } = await supabase
    .from("checklist_items")
    .insert({ task_id: taskId, content: content.trim(), position })
    .select(CHECKLIST_COLUMNS)
    .single();
  if (error) throw fail("checklist", error.code, error.message);
  return toChecklistItem(data as ChecklistRow);
}

export async function setChecklistItemCompleted(itemId: string, completed: boolean): Promise<void> {
  const { error } = await supabase.from("checklist_items").update({ completed }).eq("item_id", itemId);
  if (error) throw fail("checklist", error.code, error.message);
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from("checklist_items").delete().eq("item_id", itemId);
  if (error) throw fail("checklist", error.code, error.message);
}

// ------------------------------------------------------------------ resources

type ResourceRow = {
  resource_id: string;
  task_id: string;
  content: string;
  created_by: string;
  created_at: string;
};

const RESOURCE_COLUMNS = "resource_id, task_id, content, created_by, created_at";

function toResource(row: ResourceRow): TaskResource {
  return {
    id: row.resource_id,
    taskId: row.task_id,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function fetchResources(taskId: string): Promise<TaskResource[]> {
  const { data, error } = await supabase
    .from("task_resources")
    .select(RESOURCE_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw fail("task-resources", error.code, error.message);
  return (data ?? []).map((row) => toResource(row as ResourceRow));
}

export async function addResource(taskId: string, content: string): Promise<TaskResource> {
  const { data, error } = await supabase
    .from("task_resources")
    .insert({ task_id: taskId, content: content.trim() })
    .select(RESOURCE_COLUMNS)
    .single();
  if (error) throw fail("task-resources", error.code, error.message);
  return toResource(data as ResourceRow);
}

export async function deleteResource(resourceId: string): Promise<void> {
  const { error } = await supabase.from("task_resources").delete().eq("resource_id", resourceId);
  if (error) throw fail("task-resources", error.code, error.message);
}
