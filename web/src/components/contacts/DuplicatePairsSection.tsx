import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitMerge, Loader2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";

import { formatPhoneForDisplay } from "@/lib/contact-clean";
import { dismissDuplicate, fetchDuplicatePairs, mergeContacts, undoMerge, type DuplicatePair } from "@/lib/contact-channels";
import { contactKeys } from "@/lib/contacts";
import { duplicateKeys } from "@/lib/duplicate-keys";


/** How many pairs are drawn before `Xem thêm` — a book with 1 000+ pairs must not draw them all. */
const PAGE = 30;

/**
 * AVORA-102 · B1.3 — `Có thể trùng`: two of my contacts share a phone or email (an earlier import
 * that only saw the first 1 000 people created the second). Nothing is merged on its own: each
 * pair is `Gộp` (keep the older one, move numbers / opportunities / tasks over) or
 * `Không phải trùng`, and a merge can be undone.
 */
export function DuplicatePairsSection({ onOpenContact }: { onOpenContact: (contactId: string) => void }) {
  const queryClient = useQueryClient();
  const pairsQuery = useQuery({ queryKey: duplicateKeys.pairs, queryFn: fetchDuplicatePairs, staleTime: 30_000 });
  const [shown, setShown] = useState<number>(PAGE);
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: duplicateKeys.pairs });
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  }, [queryClient]);

  const merge = useMutation({
    mutationFn: (pair: DuplicatePair) => mergeContacts(pair.keepId, pair.dropId),
    onSuccess: (mergeId, pair) => {
      refresh();
      toast(`Đã gộp ${pair.dropName} vào ${pair.keepName}`, {
        duration: 10_000,
        action: {
          label: "Hoàn tác",
          onClick: () => {
            void undoMerge(mergeId).then(refresh, (problem: unknown) => toast("Chưa hoàn tác được", { description: (problem as Error).message }));
          },
        },
      });
    },
    onError: (problem: unknown) => toast("Chưa gộp được", { description: (problem as Error).message }),
  });
  const dismiss = useMutation({
    mutationFn: (pair: DuplicatePair) => dismissDuplicate(pair.keepId, pair.dropId),
    onSuccess: refresh,
    onError: (problem: unknown) => toast("Chưa lưu được", { description: (problem as Error).message }),
  });

  const pairs = pairsQuery.data ?? [];
  if (pairs.length === 0) return null;
  const busy = merge.isPending || dismiss.isPending;

  return (
    <section className="mt-9" data-duplicate-pairs="">
      <h2 className="text-[16px] font-semibold text-foreground">Có thể trùng ({pairs.length.toLocaleString("vi-VN")})</h2>
      <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
        Hai liên hệ có cùng số điện thoại hoặc email. Gộp thì giữ liên hệ cũ và chuyển số, email, cơ hội, việc sang. AVORA không tự gộp.
      </p>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
        {pairs.slice(0, shown).map((pair) => (
          <PairRow
            key={`${pair.keepId}:${pair.dropId}`}
            pair={pair}
            isBusy={busy}
            onOpen={onOpenContact}
            onMerge={() => merge.mutate(pair)}
            onDismiss={() => dismiss.mutate(pair)}
          />
        ))}
      </ul>
      {pairs.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="press mt-3 min-h-11 px-2 text-[14px] font-medium text-primary">
          Xem thêm {Math.min(PAGE, pairs.length - shown)} cặp
        </button>
      ) : null}
    </section>
  );
}

const PairRow = memo(function PairRow({
  pair,
  isBusy,
  onOpen,
  onMerge,
  onDismiss,
}: {
  pair: DuplicatePair;
  isBusy: boolean;
  onOpen: (contactId: string) => void;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="px-4 py-3.5" data-duplicate-pair="">
      <p className="min-w-0 text-[14.5px] text-foreground">
        <button type="button" onClick={() => onOpen(pair.keepId)} className="font-semibold [overflow-wrap:anywhere] hover:underline">
          {pair.keepName}
        </button>
        <span className="text-muted-foreground"> · </span>
        <button type="button" onClick={() => onOpen(pair.dropId)} className="font-semibold [overflow-wrap:anywhere] hover:underline">
          {pair.dropName}
        </button>
      </p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Cùng {pair.kind === "phone" ? `số ${formatPhoneForDisplay(pair.value)}` : `email ${pair.value}`}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={onMerge}
          className="press inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GitMerge className="h-4 w-4" aria-hidden="true" />}
          Gộp
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={onDismiss}
          className="press h-10 rounded-lg border border-border px-3.5 text-[13.5px] font-medium text-foreground disabled:opacity-50"
        >
          Không phải trùng
        </button>
      </div>
    </li>
  );
});
