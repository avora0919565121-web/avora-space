import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { pendingInvitationsFor, type ChecklistItem, type TaskParticipant, type TaskResource } from "@/lib/task-collab";
import {
  addChecklistItem,
  addResource,
  deleteChecklistItem,
  deleteResource,
  fetchChecklist,
  fetchResources,
  fetchTaskParticipants,
  respondTaskInvitation,
  setChecklistItemCompleted,
} from "@/lib/task-collab-api";

export const taskCollabKeys = {
  participants: ["task-participants"] as const,
  checklist: (taskId: string) => ["task-checklist", taskId] as const,
  resources: (taskId: string) => ["task-resources", taskId] as const,
};

export function useTaskParticipants(): UseQueryResult<TaskParticipant[], Error> {
  const { user } = useAuth();
  return useQuery<TaskParticipant[], Error>({
    queryKey: taskCollabKeys.participants,
    queryFn: fetchTaskParticipants,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
}

/** Invitations waiting on the signed-in person. */
export function usePendingInvitations(): TaskParticipant[] {
  const { user } = useAuth();
  const { data } = useTaskParticipants();
  return useMemo(() => pendingInvitationsFor(data ?? [], user?.id), [data, user?.id]);
}

export function usePendingInvitationCount(): number {
  return usePendingInvitations().length;
}

export function useRespondInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ participantId, accept }: { participantId: string; accept: boolean }) =>
      respondTaskInvitation(participantId, accept),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskCollabKeys.participants });
    },
  });
}

export function useChecklist(taskId: string | null): UseQueryResult<ChecklistItem[], Error> {
  return useQuery<ChecklistItem[], Error>({
    queryKey: taskCollabKeys.checklist(taskId ?? ""),
    queryFn: () => fetchChecklist(taskId ?? ""),
    enabled: taskId !== null,
  });
}

export function useResources(taskId: string | null): UseQueryResult<TaskResource[], Error> {
  return useQuery<TaskResource[], Error>({
    queryKey: taskCollabKeys.resources(taskId ?? ""),
    queryFn: () => fetchResources(taskId ?? ""),
    enabled: taskId !== null,
  });
}

export function useChecklistActions(taskId: string) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: taskCollabKeys.checklist(taskId) });
  };
  return {
    add: useMutation({
      mutationFn: ({ content, position }: { content: string; position: number }) =>
        addChecklistItem(taskId, content, position),
      onSuccess: refresh,
    }),
    toggle: useMutation({
      mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
        setChecklistItemCompleted(itemId, completed),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (itemId: string) => deleteChecklistItem(itemId), onSuccess: refresh }),
  };
}

export function useResourceActions(taskId: string) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: taskCollabKeys.resources(taskId) });
  };
  return {
    add: useMutation({ mutationFn: (content: string) => addResource(taskId, content), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (resourceId: string) => deleteResource(resourceId), onSuccess: refresh }),
  };
}
