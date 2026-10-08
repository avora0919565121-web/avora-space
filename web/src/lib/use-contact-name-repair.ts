import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { countIssues, findNameIssues, type NameIssue, type NameIssueKind } from "@/lib/contact-name-repair";
import { contactKeys } from "@/lib/contacts";
import { inBatches } from "@/lib/fetch-all-rows";
import { logError } from "@/lib/log";
import { useConnections } from "@/lib/use-connections";
import { useContacts } from "@/lib/use-contacts";

/** One applied rename, with the name it replaced — what `Hoàn tác` puts back. */
export type AppliedRename = { id: string; previous: string; name: string };

/** Applies ticked names to my own contacts in one call (the server ignores anyone else's). */
export async function renameContactsBulk(changes: readonly { id: string; name: string }[]): Promise<AppliedRename[]> {
  // AVORA-102 · B1.4: the server takes ≤ 1 000 per call; send ≤ 500 and keep every applied rename for undo.
  const applied: AppliedRename[] = [];
  for (const batch of inBatches(changes, 500)) {
    const { data, error } = await supabase.rpc("rename_contacts_bulk", { p_changes: batch.map((change) => ({ ...change })) });
    if (error) {
      logError("contact-rename", { code: error.code, message: error.message });
      if (applied.length > 0) throw Object.assign(new Error(`Đã sửa ${applied.length} tên, phần còn lại chưa sửa được. Vui lòng thử lại.`), { applied });
      throw new Error("Chưa sửa được tên. Vui lòng thử lại.");
    }
    if (Array.isArray(data)) applied.push(...(data as AppliedRename[]));
  }
  return applied;
}

/** Every name that may need fixing, grouped, from the contacts already loaded (AVORA-63). */
export function useContactNameIssues(): {
  issues: readonly NameIssue[];
  counts: Record<NameIssueKind, number>;
  total: number;
  isPending: boolean;
} {
  const contacts = useContacts();
  const { byId } = useConnections();
  const issues = useMemo(
    () =>
      findNameIssues(
        (contacts.data ?? []).map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone, linkedUserId: contact.linkedUserId })),
        (userId) => byId.get(userId)?.displayName?.trim() || null,
      ),
    [contacts.data, byId],
  );
  const counts = useMemo(() => countIssues(issues), [issues]);
  return { issues, counts, total: issues.length, isPending: contacts.isPending };
}

export function useRenameContacts() {
  const queryClient = useQueryClient();
  const refresh = useCallback((): void => void queryClient.invalidateQueries({ queryKey: contactKeys.all }), [queryClient]);
  return useMutation({ mutationFn: renameContactsBulk, onSuccess: refresh });
}
