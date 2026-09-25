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
  closeProjectEarly,
  deleteProject,
  fetchCheckAdjust,
  fetchDeletedProjects,
  fetchIsProjectRootOwner,
  postProjectThanks,
  reopenProject,
  restoreProject,
  saveCheckAdjustNote,
  type CheckAdjust,
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
import { buildProjectIndex, type ProjectIndex } from "@/lib/task-scope";
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

/**
 * Which tasks and chats belong to a live project, for splitting work into the four Connect Hub
 * layers. Deleted projects are already hidden by the database, so their work falls back to its chat.
 */
export function useTaskProjectIndex(): ProjectIndex {
  const { data: projects } = useProjects();
  const links = useTaskProjectLinks();
  return useMemo(() => buildProjectIndex(projects ?? [], [...links.values()]), [projects, links]);
}

/** The private Check-Adjust record (opener only). */
export function useCheckAdjust(projectId: string | undefined, enabled: boolean): UseQueryResult<CheckAdjust | null, Error> {
  return useQuery<CheckAdjust | null, Error>({
    queryKey: ["projects", "check-adjust", projectId ?? "none"],
    queryFn: () => fetchCheckAdjust(projectId ?? ""),
    enabled: enabled && projectId !== undefined,
  });
}

/** Projects in the bin the viewer may restore, as a root-group owner. */
export function useDeletedProjects(): UseQueryResult<Project[], Error> {
  const { user } = useAuth();
  return useQuery<Project[], Error>({
    queryKey: ["projects", "deleted"],
    queryFn: fetchDeletedProjects,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
}

export function useIsProjectRootOwner(projectId: string | undefined): boolean {
  const { user } = useAuth();
  const query = useQuery<boolean, Error>({
    queryKey: ["projects", "root-owner", projectId ?? "none"],
    queryFn: () => fetchIsProjectRootOwner(projectId ?? ""),
    enabled: Boolean(user?.id) && projectId !== undefined,
    staleTime: 60_000,
  });
  return query.data === true;
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
  postThanks: (projectId: string, body: string) => Promise<Project>;
  closeEarly: (projectId: string, reason: string) => Promise<Project>;
  reopen: (projectId: string) => Promise<Project>;
  saveNote: (projectId: string, note: string) => Promise<void>;
  remove: (projectId: string, confirmTitle: string, reason: string) => Promise<void>;
  restore: (projectId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    (projectId?: string): void => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.list });
      void queryClient.invalidateQueries({ queryKey: projectKeys.taskLinks });
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
        void queryClient.invalidateQueries({ queryKey: ["projects", "check-adjust", projectId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["projects", "deleted"] });
    },
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: ({ conversationId, draft }: { conversationId: string; draft: CharterDraft }) =>
      createProject(conversationId, draft),
    onSuccess: (project: Project) => {
      invalidate(project.id);
      // The project's root table and its sub-group were made in the same call.
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
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

  const thanksMutation = useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: string }) => postProjectThanks(projectId, body),
    onSuccess: (project: Project) => {
      invalidate(project.id);
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
      void queryClient.invalidateQueries({ queryKey: ["pins"] });
    },
  });

  const earlyMutation = useMutation({
    mutationFn: ({ projectId, reason }: { projectId: string; reason: string }) => closeProjectEarly(projectId, reason),
    onSuccess: (project: Project) => invalidate(project.id),
  });

  const reopenMutation = useMutation({
    mutationFn: (projectId: string) => reopenProject(projectId),
    onSuccess: (project: Project) => invalidate(project.id),
  });

  const noteMutation = useMutation({
    mutationFn: ({ projectId, note }: { projectId: string; note: string }) => saveCheckAdjustNote(projectId, note),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });

  const removeMutation = useMutation({
    mutationFn: ({ projectId, confirmTitle, reason }: { projectId: string; confirmTitle: string; reason: string }) =>
      deleteProject(projectId, confirmTitle, reason),
    onSuccess: (_result, variables) => {
      invalidate(variables.projectId);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (projectId: string) => restoreProject(projectId),
    onSuccess: (_result, projectId) => {
      invalidate(projectId);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
    },
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
    postThanks: useCallback(
      (projectId: string, body: string) => thanksMutation.mutateAsync({ projectId, body }),
      [thanksMutation],
    ),
    closeEarly: useCallback(
      (projectId: string, reason: string) => earlyMutation.mutateAsync({ projectId, reason }),
      [earlyMutation],
    ),
    reopen: useCallback((projectId: string) => reopenMutation.mutateAsync(projectId), [reopenMutation]),
    saveNote: useCallback(
      (projectId: string, note: string) => noteMutation.mutateAsync({ projectId, note }),
      [noteMutation],
    ),
    remove: useCallback(
      (projectId: string, confirmTitle: string, reason: string) =>
        removeMutation.mutateAsync({ projectId, confirmTitle, reason }),
      [removeMutation],
    ),
    restore: useCallback((projectId: string) => restoreMutation.mutateAsync(projectId), [restoreMutation]),
    isWorking:
      createMutation.isPending ||
      charterMutation.isPending ||
      addCriterionMutation.isPending ||
      recordCriterionMutation.isPending ||
      deleteCriterionMutation.isPending ||
      createTaskMutation.isPending ||
      moveTaskMutation.isPending ||
      closeMutation.isPending ||
      thanksMutation.isPending ||
      earlyMutation.isPending ||
      reopenMutation.isPending ||
      noteMutation.isPending ||
      removeMutation.isPending ||
      restoreMutation.isPending,
  };
}
