import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hourglass, KeyRound, Users } from "lucide-react";
import { memo, useState } from "react";

import { chatKeys, type ConversationVerification } from "@/lib/chat";
import { celebrate } from "@/lib/confetti";
import { confirmVerification, CONNECTED_MESSAGE, connectionKeys, declineVerification } from "@/lib/connections";

type VerificationPanelProps = {
  conversationId: string;
  verification: ConversationVerification;
  viewerId: string;
};

function daysLeft(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000));
}

/**
 * The "Chờ kết bạn" strip above the composer (AVORA-38 / Nhóm C).
 * Text only, 5 messages per side, 7 days. Both press Đồng ý → bạn; either presses Từ chối →
 * the frame closes for both, with no reason shown.
 */
export const VerificationPanel = memo(function VerificationPanel({ conversationId, verification, viewerId }: VerificationPanelProps) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
  };

  const confirmMutation = useMutation({
    mutationFn: () => confirmVerification(conversationId),
    onSuccess: (result) => {
      setNotice(result === "connected" ? CONNECTED_MESSAGE : "Đã đồng ý. Chờ người kia đồng ý nhé.");
      if (result === "connected") celebrate("connection");
      refresh();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const declineMutation = useMutation({
    mutationFn: () => declineVerification(conversationId),
    onSuccess: refresh,
    onError: (error: Error) => setNotice(error.message),
  });

  const isOpener = verification.openedBy === viewerId;
  const Icon = verification.viaGroupId !== null ? Users : KeyRound;
  const isBusy = confirmMutation.isPending || declineMutation.isPending;

  return (
    <div className="mx-auto mb-2 max-w-2xl rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">
            {verification.viaGroupName !== null ? `Chờ kết bạn · Từ nhóm ${verification.viaGroupName}` : "Chờ kết bạn"}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {isOpener ? "Bạn mở khung này. " : "Người này muốn kết bạn. "}
            Chỉ gửi chữ · còn {verification.messagesLeft}/5 tin của bạn
            <span className="inline-flex items-center gap-1">
              {" "}· <Hourglass className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> còn {daysLeft(verification.expiresAt)} ngày
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => declineMutation.mutate()}
          className="press h-10 rounded-[10px] border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
        >
          Từ chối
        </button>
        <button
          type="button"
          disabled={isBusy || verification.confirmedByMe}
          onClick={() => confirmMutation.mutate()}
          className="press h-10 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
        >
          {verification.confirmedByMe ? (isOpener ? "Đã gửi lời mời" : "Đã đồng ý") : "Đồng ý kết bạn"}
        </button>
      </div>
      {notice ? (
        <p role="status" className="mt-2 text-right text-[12.5px] text-primary">
          {notice}
        </p>
      ) : null}
    </div>
  );
});
