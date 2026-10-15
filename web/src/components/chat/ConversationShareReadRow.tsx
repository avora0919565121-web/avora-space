import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { fetchConversationShareRead, setConversationShareRead } from "@/lib/receipts";
import { cn } from "@/lib/utils";
import { FeatureGate } from "@/components/features/FeatureGate";

const OPTIONS: readonly { value: boolean | null; label: string }[] = [
  { value: null, label: "Theo cài đặt chung" },
  { value: true, label: "Luôn bật" },
  { value: false, label: "Luôn tắt" },
];

/**
 * AVORA-108 · 1 — in the conversation's own ⋯: `Cho người này biết khi tôi đã xem` (1-1) /
 * `Cho nhóm này biết…` (Nhóm). Easy with one person, a quiet distance with another.
 */
function ConversationShareReadRowInner({ conversationId, isGroup }: { conversationId: string; isGroup: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const key = ["receipts", "conversation-share", conversationId, userId] as const;
  const current = useQuery({ queryKey: key, queryFn: () => fetchConversationShareRead(conversationId, userId), enabled: userId !== "" });
  const change = useMutation({
    mutationFn: (value: boolean | null) => setConversationShareRead(conversationId, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["receipts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const value = change.isPending ? (change.variables ?? null) : (current.data ?? null);

  return (
    <div className="rounded-md px-2 py-2" data-conversation-share-read="">
      <p className="flex items-center gap-2.5 text-[14px] text-foreground">
        <Eye className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        {isGroup ? "Cho nhóm này biết khi tôi đã xem" : "Cho người này biết khi tôi đã xem"}
      </p>
      <div role="radiogroup" aria-label={isGroup ? "Cho nhóm này biết khi tôi đã xem" : "Cho người này biết khi tôi đã xem"} className="mt-2 grid grid-cols-3 gap-1 pl-[26px]">
        {OPTIONS.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-share-read-option={String(option.value)}
            onClick={() => change.mutate(option.value)}
            className={cn(
              "press min-h-11 rounded-control border px-1.5 text-[12.5px] leading-tight",
              value === option.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** AVORA-112-B: behind the `read_receipts` switch (stable · soon · hidden). */
export function ConversationShareReadRow(props: Parameters<typeof ConversationShareReadRowInner>[0]) {
  return (
    <FeatureGate feature="read_receipts">
      <ConversationShareReadRowInner {...props} />
    </FeatureGate>
  );
}
