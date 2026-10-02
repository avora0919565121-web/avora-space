import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { aliasKeys, fetchMyAliases, saveAlias } from "@/lib/user-aliases";

/** My names for people (AVORA-71 · E), shared through one query key. */
export function useUserAliases(): { aliases: ReadonlyMap<string, string>; save: (targetId: string, alias: string) => Promise<void>; isSaving: boolean } {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: aliasKeys.all, queryFn: fetchMyAliases, enabled: Boolean(user?.id), staleTime: 5 * 60_000 });
  const mutation = useMutation({
    mutationFn: ({ targetId, alias }: { targetId: string; alias: string }) => saveAlias(user?.id ?? "", targetId, alias),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: aliasKeys.all }),
  });
  return {
    aliases: query.data ?? new Map<string, string>(),
    save: (targetId, alias) => mutation.mutateAsync({ targetId, alias }),
    isSaving: mutation.isPending,
  };
}
