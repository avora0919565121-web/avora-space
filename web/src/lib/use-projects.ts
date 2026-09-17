import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  addDeliverable,
  addObjective,
  confirmDeliverable,
  createProject,
  fetchProjects,
  fetchProjectTree,
  fetchTaskProjectLinks,
  linkTaskToProject,
  projectKeys,
  renameDeliverable,
  renameObjective,
  unlinkTaskFromProject,
  updateProjectDetails,
  type Project,
  type ProjectCharter,
  type ProjectTaskLink,
  type ProjectTree,
} from "@/lib/projects";

export { projectKeys };

/** Every project the viewer can see, newest first. */
export function useProjects(): UseQueryResult<Project[], Error> {
  const { user } = useAuth();

  return useQuery<Project[], Error>({
    queryKey: projectKeys.list,
    queryFn: fetchProjects,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
}

/** One project with all three tiers, for the detail screen. */
export function useProjectTree(
  projectId: string | undefined,
): UseQueryResult<ProjectTree | null, Error> {
  const { user } = useAuth();

  return useQuery<ProjectTree | null, Error>({
    queryKey: projectKeys.tree(projectId ?? "none"),
    queryFn: () => fetchProjectTree(projectId ?? ""),
    enabled: Boolean(user?.id) && projectId !== undefined,
  });
}

/**
 * Which project each task belongs to, read once for the whole task list.
 *
 * One query rather than one per row: the Nhiệm vụ screen asks this of every task it draws, and
 * a request per row would turn scrolling into traffic.
 */
export function useTaskProjectLinks(): ReadonlyMap<string, ProjectTaskLink> {
  const { user } = useAuth();

  const query = useQuery<ProjectTaskLink[], Error>({
    queryKey: ["projects", "task-links"],
    queryFn: fetchTaskProjectLinks,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  return useMemo(() => {
    const map = new Map<string, ProjectTaskLink>();
    for (const link of query.data ?? []) map.set(link.taskId, link);
    return map;
  }, [query.data]);
}

/**
 * The three groups the Dự án tab reads in: your own, one-to-one, and groups.
 *
 * Grouping is derived from the conversation each project lives in rather than from a column on
 * the project — the conversation IS the ownership, so a second field could only disagree with it.
 */
export type ProjectGroupKind = "personal" | "direct" | "group";

export function groupProjects(
  projects: readonly Project[],
  kindOf: (conversationId: string) => ProjectGroupKind | undefined,
): Record<ProjectGroupKind, Project[]> {
  const groups: Record<ProjectGroupKind, Project[]> = { personal: [], direct: [], group: [] };
  for (const project of projects) {
    const kind = kindOf(project.conversationId);
    // A project whose conversation has not loaded yet is not guessed at: showing it under the
    // wrong heading would misstate who can see it, which is the one thing this screen must
    // never do. It appears as soon as the inbox answers.
    if (kind === undefined) continue;
    groups[kind].push(project);
  }
  return groups;
}

/** Opening a project, growing it, signing off a deliverable, and rewording any tier. */
export function useProjectActions(): {
  create: (input: {
    conversationId: string;
    title: string;
    firstObjectiveTitle: string;
    charter?: ProjectCharter;
  }) => Promise<Project>;
  addObjective: (projectId: string, title: string) => Promise<void>;
  addDeliverable: (projectId: string, objectiveId: string, title: string) => Promise<void>;
  linkTask: (projectId: string, taskId: string, deliverableId: string) => Promise<void>;
  unlinkTask: (projectId: string, taskId: string) => Promise<void>;
  confirm: (projectId: string, deliverableId: string) => Promise<void>;
  updateDetails: (input: {
    projectId: string;
    title?: string;
    charter?: ProjectCharter;
  }) => Promise<void>;
  renameObjective: (projectId: string, objectiveId: string, title: string) => Promise<void>;
  renameDeliverable: (projectId: string, deliverableId: string, title: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  /**
   * A change to any tier invalidates that project's tree and the list.
   *
   * The task links query too: linking a task changes what the Nhiệm vụ screen should say about
   * it, and leaving that cache alone is how a task ends up claiming it belongs nowhere.
   */
  const invalidate = useCallback(
    (projectId?: string): void => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list });
      void queryClient.invalidateQueries({ queryKey: ["projects", "task-links"] });
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.tree(projectId) });
      }
    },
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: (input: {
      conversationId: string;
      title: string;
      firstObjectiveTitle: string;
      charter?: ProjectCharter;
    }) => createProject(input),
    onSuccess: (project: Project) => invalidate(project.id),
  });

  const objectiveMutation = useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) =>
      addObjective(projectId, title),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const deliverableMutation = useMutation({
    mutationFn: ({ objectiveId, title }: { projectId: string; objectiveId: string; title: string }) =>
      addDeliverable(objectiveId, title),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const linkMutation = useMutation({
    mutationFn: ({ taskId, deliverableId }: { projectId: string; taskId: string; deliverableId: string }) =>
      linkTaskToProject(taskId, deliverableId),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ taskId }: { projectId: string; taskId: string }) => unlinkTaskFromProject(taskId),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const confirmMutation = useMutation({
    mutationFn: ({ deliverableId }: { projectId: string; deliverableId: string }) =>
      confirmDeliverable(deliverableId),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const detailsMutation = useMutation({
    mutationFn: (input: { projectId: string; title?: string; charter?: ProjectCharter }) =>
      updateProjectDetails(input),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const renameObjectiveMutation = useMutation({
    mutationFn: ({ objectiveId, title }: { projectId: string; objectiveId: string; title: string }) =>
      renameObjective(objectiveId, title),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const renameDeliverableMutation = useMutation({
    mutationFn: ({
      deliverableId,
      title,
    }: {
      projectId: string;
      deliverableId: string;
      title: string;
    }) => renameDeliverable(deliverableId, title),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  return {
    create: useCallback(
      (input: {
        conversationId: string;
        title: string;
        firstObjectiveTitle: string;
        charter?: ProjectCharter;
      }) => createMutation.mutateAsync(input),
      [createMutation],
    ),
    addObjective: useCallback(
      async (projectId: string, title: string) => {
        await objectiveMutation.mutateAsync({ projectId, title });
      },
      [objectiveMutation],
    ),
    addDeliverable: useCallback(
      async (projectId: string, objectiveId: string, title: string) => {
        await deliverableMutation.mutateAsync({ projectId, objectiveId, title });
      },
      [deliverableMutation],
    ),
    linkTask: useCallback(
      async (projectId: string, taskId: string, deliverableId: string) => {
        await linkMutation.mutateAsync({ projectId, taskId, deliverableId });
      },
      [linkMutation],
    ),
    unlinkTask: useCallback(
      async (projectId: string, taskId: string) => {
        await unlinkMutation.mutateAsync({ projectId, taskId });
      },
      [unlinkMutation],
    ),
    confirm: useCallback(
      async (projectId: string, deliverableId: string) => {
        await confirmMutation.mutateAsync({ projectId, deliverableId });
      },
      [confirmMutation],
    ),
    updateDetails: useCallback(
      (input: { projectId: string; title?: string; charter?: ProjectCharter }) =>
        detailsMutation.mutateAsync(input),
      [detailsMutation],
    ),
    renameObjective: useCallback(
      async (projectId: string, objectiveId: string, title: string) => {
        await renameObjectiveMutation.mutateAsync({ projectId, objectiveId, title });
      },
      [renameObjectiveMutation],
    ),
    renameDeliverable: useCallback(
      async (projectId: string, deliverableId: string, title: string) => {
        await renameDeliverableMutation.mutateAsync({ projectId, deliverableId, title });
      },
      [renameDeliverableMutation],
    ),
    isWorking:
      createMutation.isPending ||
      objectiveMutation.isPending ||
      deliverableMutation.isPending ||
      linkMutation.isPending ||
      unlinkMutation.isPending ||
      confirmMutation.isPending ||
      detailsMutation.isPending ||
      renameObjectiveMutation.isPending ||
      renameDeliverableMutation.isPending,
  };
}
