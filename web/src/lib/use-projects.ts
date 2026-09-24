import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/lib/auth";
import {
  addSuccessCriterion,
  closeProject,
  createProject,
  createProjectTask,
  deleteSuccessCriterion,
  fetchProjectDetail,
  fetchProjects,
  fetchTaskProjectLinks,
  linkTaskToProject,
  projectKeys,
  recordSuccessCriterion,
  updateProjectCharter,
  type CharterDraft,
  type MeasurementType,
  type Project,
  type ProjectDetail,
  type ProjectTaskInput,
  type ProjectTaskLink,
} from "@/lib/projects";
import { taskKeys } from "@/lib/tasks";
import { thinkHubKeys } from "@/lib/think-hub";

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

/** One project with its criteria and task links, for the detail screen. */
export function useProjectDetail(projectId: string | undefined): UseQueryResult<ProjectDetail | null, Error> {
  const { user } = useAuth();

  return useQuery<ProjectDetail | null, Error>({
    queryKey: projectKeys.detail(projectId ?? "none"),
    queryFn: () => fetchProjectDetail(projectId ?? ""),
    enabled: Boolean(user?.id) && projectId !== undefined,
  });
}

/**
 * Which project each task belongs to, read once for the whole task list.
 *
 * One query rather than one per row: the Nhiệm vụ screen asks this of every task it draws.
 */
export function useTaskProjectLinks(): ReadonlyMap<string, ProjectTaskLink> {
  const { user } = useAuth();

  const query = useQuery<ProjectTaskLink[], Error>({
    queryKey: projectKeys.taskLinks,
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

/** Projects are group work (ADR-002): the tab lists only those living in a group. */
export function groupProjectsOnly(
  projects: readonly Project[],
  kindOf: (conversationId: string) => string | undefined,
): Project[] {
  // A project whose conversation has not loaded yet is held back rather than guessed at.
  return projects.filter((project) => kindOf(project.conversationId) === "group");
}

/** Opening a project, its charter, its criteria, its tasks, and closing it. */
export function useProjectActions(): {
  create: (conversationId: string, draft: CharterDraft) => Promise<Project>;
  updateCharter: (
    projectId: string,
    patch: { title?: string; valueOrientation?: string; objective?: string; scope?: string; assumptions?: string },
  ) => Promise<void>;
  addCriterion: (input: {
    projectId: string;
    description: string;
    measurementType: MeasurementType;
    targetPercent: number | null;
  }) => Promise<void>;
  recordCriterion: (
    projectId: string,
    input: { criterionId: string; actualPercent?: number | null; meetingNoteId?: string | null },
  ) => Promise<void>;
  deleteCriterion: (projectId: string, criterionId: string) => Promise<void>;
  createTask: (input: ProjectTaskInput) => Promise<string>;
  moveTask: (projectId: string, taskId: string, recordId: string | null) => Promise<void>;
  close: (projectId: string) => Promise<Project>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    (projectId?: string): void => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list });
      void queryClient.invalidateQueries({ queryKey: projectKeys.taskLinks });
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      }
    },
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: ({ conversationId, draft }: { conversationId: string; draft: CharterDraft }) =>
      createProject(conversationId, draft),
    onSuccess: (project: Project) => {
      invalidate(project.id);
      // The project's root table was made in the same call.
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
    },
  });

  const charterMutation = useMutation({
    mutationFn: ({
      projectId,
      patch,
    }: {
      projectId: string;
      patch: { title?: string; valueOrientation?: string; objective?: string; scope?: string; assumptions?: string };
    }) => updateProjectCharter(projectId, patch),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const addCriterionMutation = useMutation({
    mutationFn: (input: {
      projectId: string;
      description: string;
      measurementType: MeasurementType;
      targetPercent: number | null;
    }) => addSuccessCriterion(input),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const recordCriterionMutation = useMutation({
    mutationFn: ({
      input,
    }: {
      projectId: string;
      input: { criterionId: string; actualPercent?: number | null; meetingNoteId?: string | null };
    }) => recordSuccessCriterion(input),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const deleteCriterionMutation = useMutation({
    mutationFn: ({ criterionId }: { projectId: string; criterionId: string }) => deleteSuccessCriterion(criterionId),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: ProjectTaskInput) => createProjectTask(input),
    onSuccess: (_result, variables) => {
      invalidate(variables.project.id);
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });

  const moveTaskMutation = useMutation({
    mutationFn: ({ projectId, taskId, recordId }: { projectId: string; taskId: string; recordId: string | null }) =>
      linkTaskToProject(taskId, projectId, recordId),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const closeMutation = useMutation({
    mutationFn: (projectId: string) => closeProject(projectId),
    onSuccess: (project: Project) => invalidate(project.id),
  });

  return {
    create: useCallback(
      (conversationId: string, draft: CharterDraft) => createMutation.mutateAsync({ conversationId, draft }),
      [createMutation],
    ),
    updateCharter: useCallback(
      async (
        projectId: string,
        patch: { title?: string; valueOrientation?: string; objective?: string; scope?: string; assumptions?: string },
      ) => {
        await charterMutation.mutateAsync({ projectId, patch });
      },
      [charterMutation],
    ),
    addCriterion: useCallback(
      async (input: {
        projectId: string;
        description: string;
        measurementType: MeasurementType;
        targetPercent: number | null;
      }) => {
        await addCriterionMutation.mutateAsync(input);
      },
      [addCriterionMutation],
    ),
    recordCriterion: useCallback(
      async (
        projectId: string,
        input: { criterionId: string; actualPercent?: number | null; meetingNoteId?: string | null },
      ) => {
        await recordCriterionMutation.mutateAsync({ projectId, input });
      },
      [recordCriterionMutation],
    ),
    deleteCriterion: useCallback(
      async (projectId: string, criterionId: string) => {
        await deleteCriterionMutation.mutateAsync({ projectId, criterionId });
      },
      [deleteCriterionMutation],
    ),
    createTask: useCallback((input: ProjectTaskInput) => createTaskMutation.mutateAsync(input), [createTaskMutation]),
    moveTask: useCallback(
      async (projectId: string, taskId: string, recordId: string | null) => {
        await moveTaskMutation.mutateAsync({ projectId, taskId, recordId });
      },
      [moveTaskMutation],
    ),
    close: useCallback((projectId: string) => closeMutation.mutateAsync(projectId), [closeMutation]),
    isWorking:
      createMutation.isPending ||
      charterMutation.isPending ||
      addCriterionMutation.isPending ||
      recordCriterionMutation.isPending ||
      deleteCriterionMutation.isPending ||
      createTaskMutation.isPending ||
      moveTaskMutation.isPending ||
      closeMutation.isPending,
  };
}
