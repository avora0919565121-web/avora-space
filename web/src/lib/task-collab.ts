/**
 * Pure shapes and rules for the three things a task can carry beside itself: what to bring
 * (resources), what to tick off (checklist), and who else is taking part (participants).
 *
 * Kept free of the database client so the rules can be tested without a network.
 *
 * Participants run ALONGSIDE `assignee_id`, never instead of it: the assignee is still the one
 * person carrying the work, and an invitation only says "come along". Inviting is always a
 * person's own act — nothing here, and nothing in the assistant, invites anyone on its own.
 */
export type InvitationStatus = "pending" | "accepted" | "declined";

export type TaskParticipant = {
  id: string;
  taskId: string;
  userId: string;
  status: InvitationStatus;
  invitedBy: string;
  invitedAt: string;
  respondedAt: string | null;
};

export type ChecklistItem = {
  id: string;
  taskId: string;
  content: string;
  position: number;
  completed: boolean;
  completedAt: string | null;
};

export type TaskResource = {
  id: string;
  taskId: string;
  content: string;
  createdBy: string;
  createdAt: string;
};

export function isInvitationStatus(value: string): value is InvitationStatus {
  return value === "pending" || value === "accepted" || value === "declined";
}

/** Invitations still waiting on THIS person. Declined ones are theirs to forget. */
export function pendingInvitationsFor(
  participants: readonly TaskParticipant[],
  userId: string | undefined,
): TaskParticipant[] {
  if (userId === undefined) return [];
  return participants.filter((row) => row.userId === userId && row.status === "pending");
}

/** "3/5" — how far a checklist has got. Null when there is no list at all. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number } | null {
  if (items.length === 0) return null;
  return { done: items.filter((item) => item.completed).length, total: items.length };
}

/** The position a new item takes: after the last one, whatever gaps reordering left. */
export function nextChecklistPosition(items: readonly ChecklistItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
}

export function toVietnameseCollabError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_invite_not_creator")) return "Chỉ người tạo việc mới mời được người khác.";
  if (normalized.includes("avora_invite_shared_only")) return "Chỉ việc chung trong cuộc trò chuyện mới mời được người khác.";
  if (normalized.includes("avora_invite_self")) return "Bạn đã ở trong việc này rồi.";
  if (normalized.includes("avora_invite_not_member")) return "Người này chưa ở trong cuộc trò chuyện.";
  if (normalized.includes("avora_invite_exists")) return "Đã mời người này rồi.";
  if (normalized.includes("avora_invitation_not_open")) return "Lời mời này đã được trả lời.";
  if (normalized.includes("avora_invitation_not_yours")) return "Bạn không rút được lời mời này.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với việc này.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Bạn thử lại nhé.";
}
