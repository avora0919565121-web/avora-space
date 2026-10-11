import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { fetchShareReadStatus, receiptKeys, setShareReadStatus } from "@/lib/receipts";

/**
 * AVORA-108 · 3.4 — Cài đặt › Riêng tư: `Cho nhóm biết khi tôi đã xem tin`. Mutual by design:
 * off means nobody sees that I read, and I see nobody either.
 */
export function ShareReadCard() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const share = useQuery({ queryKey: receiptKeys.share(userId), queryFn: () => fetchShareReadStatus(userId), enabled: userId !== "" });
  const change = useMutation({
    mutationFn: setShareReadStatus,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["receipts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const isOn = change.isPending ? change.variables === true : share.data !== false;

  return (
    <section aria-labelledby="privacy-heading" className="rounded-card border border-border bg-card p-s-4" data-share-read-card="">
      <h2 id="privacy-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
        Riêng tư
      </h2>
      <label className="mt-s-2 flex min-h-12 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[15px] font-medium text-foreground">
            <Eye className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            Cho nhóm biết khi tôi đã xem tin
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-muted-foreground">Tắt thì bạn cũng không thấy ai đã xem tin của bạn.</span>
        </span>
        <Switch checked={isOn} disabled={share.isPending} onCheckedChange={(next) => change.mutate(next)} aria-label="Cho nhóm biết khi tôi đã xem tin" data-share-read-switch="" />
      </label>
    </section>
  );
}
