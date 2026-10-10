import { useQuery } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fetchDeliveries, type ChatMessage } from "@/lib/chat";

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Chi tiết of one message (AVORA-57 · C): when it was sent; on my own line also `Đã gửi` and
 * `Đã nhận` with their times. Never "Đã xem", never a list of who read it (ADR-028).
 */
export function MessageDetailsDialog({
  message,
  isOwn,
  onOpenChange,
}: {
  message: ChatMessage | null;
  isOwn: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const messageId = message?.id ?? "";
  const deliveryQuery = useQuery<Map<string, string>, Error>({
    queryKey: ["chat", "delivery", "details", messageId],
    queryFn: () => fetchDeliveries([messageId]),
    enabled: message !== null && isOwn,
    staleTime: 10_000,
  });
  const deliveredAt = deliveryQuery.data?.get(messageId) ?? null;

  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px] gap-0 rounded-card border-border bg-card p-5">
        <DialogTitle className="text-[17px] font-semibold tracking-tight">Chi tiết</DialogTitle>
        <DialogDescription className="sr-only">Thời gian của tin nhắn này</DialogDescription>
        {message !== null ? (
          <dl className="mt-4 space-y-3 text-[14px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Gửi lúc</dt>
              <dd className="tabular text-foreground">{fullTime(message.createdAt)}</dd>
            </div>
            {message.editedAt != null ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Đã sửa</dt>
                <dd className="tabular text-foreground">{fullTime(message.editedAt)}</dd>
              </div>
            ) : null}
            {isOwn ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Đã gửi</dt>
                  <dd className="tabular text-foreground">{fullTime(message.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Đã nhận</dt>
                  <dd className="tabular text-foreground">
                    {deliveredAt !== null ? fullTime(deliveredAt) : deliveryQuery.isPending ? "…" : "Chưa có"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
