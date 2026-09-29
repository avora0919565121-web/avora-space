import { useMemo } from "react";

import { TaskComposer, type ComposerSource } from "@/components/tasks/TaskComposer";
import { useAuth } from "@/lib/auth";
import type { ConversationKind } from "@/lib/chat";
import type { GroupMember } from "@/lib/groups";
import { buildContextSnapshot, type ContextMessage } from "@/lib/task-context";
import type { ComposerPlace } from "@/lib/task-composer";
import { useComposerActions, useTaskRecipientIds, type ComposerValues } from "@/lib/use-task-composer";

type TaskFromChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationKind: ConversationKind;
  conversationName: string;
  /** The 1-1 peer. Null in a group, where recipients come from the member list. */
  peerId: string | null;
  peerName: string;
  members: readonly GroupMember[];
  /** The message this task is about: a chosen bubble, or the newest one. Null in an empty thread. */
  contextMessage: ContextMessage | null;
  contextSenderName: string;
  /** Project chat: filed under this project when accepted. */
  projectId?: string | null;
};

/**
 * Tạo việc from a conversation — Nhật ký, 1-1, Nhóm, chat Dự án — through the one form (ADR-030).
 *
 * - Nhật ký: only "Cho tôi", a personal task pointing back at the note.
 * - 1-1: Cho tôi (personal, the other person does not see it) · Cho {tên} (suggestion) · Cả hai.
 * - Nhóm / Dự án: Cho tôi (the existing self-take path, the group sees it) · Cả nhóm · Chọn người.
 * The quoted message is copied once and travels with every task/suggestion made here.
 */
export function TaskFromChatDialog({
  open,
  onOpenChange,
  conversationId,
  conversationKind,
  conversationName,
  peerId,
  peerName,
  members,
  contextMessage,
  contextSenderName,
  projectId = null,
}: TaskFromChatDialogProps) {
  const { user } = useAuth();
  const { createPersonal, proposeOne } = useComposerActions();
  const place: ComposerPlace =
    conversationKind === "personal" ? "personal" : conversationKind === "group" ? "group" : "direct";
  const recipientIds = useTaskRecipientIds(open && place === "group" ? conversationId : null);

  // "Cả nhóm" / "Chọn người" never offer someone the server would refuse (block either way).
  const reachable = useMemo(() => {
    if (place !== "group") return members;
    const allowed = new Set<string>(recipientIds.data ?? []);
    return members.filter((member) => allowed.has(member.userId));
  }, [place, members, recipientIds.data]);

  const snapshotFor = (values: ComposerValues) =>
    buildContextSnapshot({
      conversationType: conversationKind,
      conversationId,
      conversationName,
      message: contextMessage,
      senderName: contextSenderName,
      userResponse: values.description,
    });

  const source: ComposerSource | null =
    contextMessage === null
      ? null
      : {
          label: place === "personal" ? "Từ ghi chú trong Nhật ký" : `Từ tin nhắn của ${contextSenderName}`,
          render: () => (
            <p className="line-clamp-2 whitespace-pre-wrap text-[13px] leading-5 text-foreground">
              {contextMessage.content.trim() === "" ? "(Tin nhắn chỉ có tệp đính kèm)" : contextMessage.content}
            </p>
          ),
        };

  return (
    <TaskComposer
      open={open}
      onOpenChange={onOpenChange}
      place={place}
      source={source}
      peerId={peerId}
      peerName={peerName}
      members={reachable}
      onCreateMine={async (values) => {
        if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        if (place === "group") {
          // The group's own self-take path (AVORA 13): accepted at once, the group sees it.
          await proposeOne(
            { conversationId, assigneeId: user.id, messageId: contextMessage?.id ?? null, contextSnapshot: snapshotFor(values), projectId },
            values,
            true,
          );
          return;
        }
        // Nhật ký and "Cho tôi" in a 1-1: a personal task; the snapshot points back at the message.
        await createPersonal(user.id, values, snapshotFor(values));
      }}
      onPropose={async (assigneeId, values) => {
        await proposeOne(
          { conversationId, assigneeId, messageId: contextMessage?.id ?? null, contextSnapshot: snapshotFor(values), projectId },
          values,
          false,
        );
      }}
    />
  );
}
