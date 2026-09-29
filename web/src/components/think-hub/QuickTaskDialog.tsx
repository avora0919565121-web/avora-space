import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { TaskComposer } from "@/components/tasks/TaskComposer";
import { useAuth } from "@/lib/auth";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import type { Project } from "@/lib/projects";
import { buildContextSnapshot } from "@/lib/task-context";
import { departureTimes, type ComposerPlace } from "@/lib/task-composer";
import { browserTimezone } from "@/lib/task-schedule";
import { taskKeys, todayIso, updatePersonalTaskSchedule } from "@/lib/tasks";
import { createRecordTask, thinkHubKeys, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useComposerActions, useTaskRecipientIds, type ComposerValues } from "@/lib/use-task-composer";

/**
 * Tạo nhiệm vụ from one Hạng mục — the one task form (ADR-030), Nguồn "Từ Hạng mục … · Bảng …".
 *
 * Where it goes follows the Bảng:
 * - a private Bảng: only "Cho tôi" (personal task filed under the Hạng mục);
 * - a 1-1 Bảng: "Cho tôi" is a personal task the other person does not see; the other person
 *   gets a suggestion, filed under the Hạng mục once they agree;
 * - a group / project Bảng: "Cho tôi" is accepted at once, others get suggestions — all filed
 *   under the Hạng mục (and the project) when accepted.
 */
export function QuickTaskDialog({
  record,
  table,
  project,
  conversationKind,
  conversationName,
  onOpenChange,
}: {
  record: ThinkRecord | null;
  table: ThinkTable | undefined;
  /** Set when the table belongs to a project. */
  project: Project | undefined;
  conversationKind: "direct" | "group" | null;
  conversationName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: conversations } = useConversations();
  const { proposeOne } = useComposerActions();

  const conversationId: string | null =
    project !== undefined ? project.conversationId : (table?.conversationId ?? null);
  const place: ComposerPlace =
    project !== undefined || conversationKind === "group" ? "group" : conversationKind === "direct" ? "direct" : "personal";
  const peerId =
    place === "direct" ? (conversations?.find((item) => item.conversationId === conversationId)?.peerId ?? null) : null;

  const membersQuery = useQuery({
    queryKey: groupKeys.members(conversationId ?? ""),
    queryFn: () => fetchGroupMembers(conversationId as string),
    enabled: record !== null && place === "group" && conversationId !== null,
  });
  const recipientIds = useTaskRecipientIds(record !== null && place === "group" ? conversationId : null);
  const reachable = useMemo(() => {
    const allowed = new Set<string>(recipientIds.data ?? []);
    return (membersQuery.data ?? []).filter((member) => allowed.has(member.userId));
  }, [membersQuery.data, recipientIds.data]);

  if (record === null || table === undefined) return null;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: thinkHubKeys.recordTasks });
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  };

  /**
   * The existing Hạng mục route: personal on a private Bảng, or "Cho tôi" on a 1-1 Bảng. That route
   * carries no Sự kiện, so one is written right after — the task is the author's own, and personal.
   */
  const createOnRecord = async (values: ComposerValues): Promise<void> => {
    const taskId = await createRecordTask({
      recordId: record.id,
      title: values.title,
      description: values.description,
      deadline: values.deadline,
      deadlineTime: values.deadlineTime,
      assigneeId: place === "direct" ? (user?.id ?? null) : null,
      deadlineTz: browserTimezone(),
    });
    if (values.startAt !== null) {
      const presence = values.requiresPresence;
      const times = presence ? departureTimes(values.startAt, values.travelMinutes, values.reminderOffsetMinutes) : null;
      await updatePersonalTaskSchedule(taskId, {
        startAt: values.startAt,
        endAt: values.endAt,
        location: values.location,
        requiresPresence: presence,
        travelDurationMinutes: presence ? values.travelMinutes : null,
        departureReminderAt: times === null ? null : times.remindAt.toISOString(),
      });
    }
    refresh();
  };

  const suggest = async (assigneeId: string, values: ComposerValues, isSelf: boolean): Promise<void> => {
    if (conversationId === null) throw new Error("Bảng này không thuộc cuộc trò chuyện nào.");
    await proposeOne(
      {
        conversationId,
        assigneeId,
        messageId: null,
        contextSnapshot: buildContextSnapshot({
          conversationType: place === "group" ? "group" : "direct",
          conversationId,
          conversationName,
          message: null,
          senderName: "",
          userResponse: `Từ Hạng mục: ${record.title}`,
        }),
        recordId: record.id,
        projectId: project?.id ?? null,
      },
      values,
      isSelf,
    );
    refresh();
  };

  return (
    <TaskComposer
      open
      onOpenChange={onOpenChange}
      place={place}
      source={{ label: `Từ Hạng mục ${record.title} · Bảng ${table.name}` }}
      peerId={peerId}
      peerName={conversationName}
      members={reachable}
      initial={{
        title: record.title,
        deadline: record.nextActionDate !== null && record.nextActionDate >= todayIso() ? record.nextActionDate : "",
      }}
      onCreateMine={async (values) => {
        if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        if (place === "group") {
          await suggest(user.id, values, true);
          return;
        }
        await createOnRecord(values);
      }}
      onPropose={(assigneeId, values) => suggest(assigneeId, values, false)}
    />
  );
}
