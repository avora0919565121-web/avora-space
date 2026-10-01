import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, KeyRound, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { chatKeys } from "@/lib/chat";
import { celebrate } from "@/lib/confetti";
import {
  confirmVerification,
  CONNECTED_MESSAGE,
  connectionKeys,
  declineVerification,
  requestTitle,
  type ConnectionRequest,
} from "@/lib/connections";
import { useConnectionRequests } from "@/lib/use-connections";

/**
 * AVORA-56 · A — where a friend request can be seen without opening its conversation.
 *
 * A quiet line at the top of Kết nối (no sound, no red), and behind it one card per request:
 * who is asking, their message, Đồng ý / Từ chối. Mutual friends are never shown, on purpose.
 * Declining stays silent for the sender, exactly as inside the conversation.
 */
export function ConnectionRequestsRow() {
  const { requests } = useConnectionRequests();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (requests.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="press mb-1 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13.5px] text-foreground hover:bg-accent/30"
      >
        <UserPlus className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        <span className="flex-1">
          Lời mời kết bạn <span className="tabular text-muted-foreground">· {requests.length}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </button>
      <ConnectionRequestsSheet open={isOpen} onOpenChange={setIsOpen} requests={requests} />
    </>
  );
}

function ConnectionRequestsSheet({
  open,
  onOpenChange,
  requests,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: readonly ConnectionRequest[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <div className="border-b border-border px-5 pb-4 pt-5 md:pt-6">
          <SheetTitle className="text-[19px] font-semibold tracking-tight">Lời mời kết bạn</SheetTitle>
          <SheetDescription className="mt-1 text-[13px]">
            Đọc lời nhắn rồi quyết định. Người gửi không được báo khi bạn từ chối.
          </SheetDescription>
        </div>
        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {requests.map((request) => (
            <RequestCard key={request.conversationId} request={request} />
          ))}
          {requests.length === 0 ? (
            <li className="px-2 py-10 text-center text-[14px] text-muted-foreground">Không còn lời mời nào.</li>
          ) : null}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function RequestCard({ request }: { request: ConnectionRequest }) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  };

  const accept = useMutation({
    mutationFn: () => confirmVerification(request.conversationId),
    onSuccess: (result) => {
      if (result === "connected") {
        toast.success(CONNECTED_MESSAGE);
        celebrate("connection");
      } else {
        toast.success("Đã đồng ý. Chờ người kia đồng ý nhé.");
      }
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const decline = useMutation({
    mutationFn: () => declineVerification(request.conversationId),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const isBusy = accept.isPending || decline.isPending;
  const title = requestTitle(request);
  const Via = request.viaGroupName !== null ? Users : KeyRound;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <InitialsAvatar name={title} size="sm" />
        <span className="min-w-0 flex-1">
          <span className={request.displayName === null ? "block truncate font-mono text-[14px] font-medium" : "block truncate text-[15px] font-semibold"}>
            {title}
          </span>
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <Via className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            {request.viaGroupName !== null ? `Từ nhóm ${request.viaGroupName}` : "Qua PIN"}
          </span>
        </span>
      </div>
      {request.message !== null ? (
        <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-secondary/50 px-3 py-2 text-[14px] leading-6 text-foreground">
          {request.message}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => decline.mutate()}
          className="press h-10 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-50"
        >
          Từ chối
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => accept.mutate()}
          className="press h-10 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/92 disabled:opacity-60"
        >
          Đồng ý
        </button>
      </div>
    </li>
  );
}
