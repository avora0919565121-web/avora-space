import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/lib/auth";
import { guidanceKeys, restoreGuidance } from "@/lib/guidance";
import { chooseFinanceBook } from "@/lib/use-finance-book";
import { sampleHiddenKey } from "@/lib/vault-samples";

const ALL = ["finance", "passwords", "certificates", "documents", "assets"] as const;

/** KT-07c: "Xem lại mẫu Két sắt" — every compartment's samples come back (this account, every device). */
export function useRestoreSamples(): () => Promise<void> {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!user?.id) return;
    await Promise.all(ALL.map((section) => restoreGuidance(user.id, sampleHiddenKey(section))));
    chooseFinanceBook(null);
    await queryClient.invalidateQueries({ queryKey: guidanceKeys.all });
  }, [user?.id, queryClient]);
}
