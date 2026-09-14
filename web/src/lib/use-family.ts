import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  clearFamilyRelation,
  familyKeys,
  fetchFamilyRelations,
  setFamilyRelation,
  toFamilyIndex,
  type FamilyRelation,
  type FamilyRelationType,
} from "@/lib/family";

/**
 * The viewer's own record of who is family.
 *
 * Private to them: RLS returns only their rows, so nothing here can reveal how anyone else
 * has labelled their own relationships — or that they have been labelled at all.
 */
export function useFamilyRelations(): {
  index: ReadonlyMap<string, FamilyRelationType>;
  relationOf: (userId: string | null | undefined) => FamilyRelationType | null;
  mark: (relatedUserId: string, relationType: FamilyRelationType) => Promise<void>;
  clear: (relatedUserId: string) => Promise<void>;
  isWorking: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data } = useQuery<FamilyRelation[], Error>({
    queryKey: familyKeys.list,
    queryFn: fetchFamilyRelations,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });

  const index = useMemo(() => toFamilyIndex(data ?? []), [data]);

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: familyKeys.all });
  }, [queryClient]);

  const markMutation = useMutation({
    mutationFn: ({
      relatedUserId,
      relationType,
    }: {
      relatedUserId: string;
      relationType: FamilyRelationType;
    }) => setFamilyRelation(userId ?? "", relatedUserId, relationType),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: (relatedUserId: string) => clearFamilyRelation(relatedUserId),
    onSuccess: invalidate,
  });

  const relationOf = useCallback(
    (id: string | null | undefined): FamilyRelationType | null =>
      id === null || id === undefined ? null : (index.get(id) ?? null),
    [index],
  );

  const mark = useCallback(
    async (relatedUserId: string, relationType: FamilyRelationType): Promise<void> => {
      if (userId === undefined) return;
      await markMutation.mutateAsync({ relatedUserId, relationType });
    },
    [markMutation, userId],
  );

  const clear = useCallback(
    async (relatedUserId: string): Promise<void> => {
      await clearMutation.mutateAsync(relatedUserId);
    },
    [clearMutation],
  );

  return {
    index,
    relationOf,
    mark,
    clear,
    isWorking: markMutation.isPending || clearMutation.isPending,
  };
}
