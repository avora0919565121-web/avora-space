import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, EyeOff, Timer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { ChatMessage } from "@/lib/chat-cache";
import {
  answerDisappearProposal,
  DISAPPEAR_NOTE,
  DISAPPEAR_OPTIONS,
  disappearKeys,
  disappearLabel,
  setDisappearTimer,
  setHideTombstones,
  type DisappearProposal,
  type DisappearSeconds,
  type DisappearState,
} from "@/lib/disappear";
import { cn } from "@/lib/utils";

const rowClass = "press flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/40";

/**
 * AVORA-109 · B1 + B4 — two rows in the conversation's ⋯, right after Không khí:
 * `Tin tự biến mất` (opens the choice) and `Ẩn dấu vết tin đã biến mất / thu hồi` (my screen only).
 */
export function DisappearRows({
  conversationId,
  kind,
  canChange,
  state,
}: {
  conversationId: string;
  kind: "direct" | "group";
  canChange: boolean;
  state: DisappearState | undefined;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const key = disappearKeys.state(conversationId);
  const change = useMutation({
    mutationFn: (seconds: DisappearSeconds | null) => setDisappearTimer(conversationId, seconds),
    onSuccess: async (result, seconds) => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      setIsOpen(false);
      if (result === "proposed") toast.success(`Đã gửi đề nghị ${disappearLabel(seconds)} cho người kia.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const hide = useMutation({
    mutationFn: (value: boolean) => setHideTombstones(conversationId, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (error: Error) => toast.error(error.message),
  });
  const current = state?.seconds ?? null;
  const pending = state?.proposal ?? null;
  const hidden = hide.isPending ? hide.variables === true : state?.hideTombstones === true;

  return (
    <>
      <button type="button" data-disappear-row="" onClick={() => setIsOpen(true)} className={rowClass}>
        <Timer className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px] text-foreground">Tin tự biến mất</span>
        <span className="text-[13px] text-muted-foreground" data-disappear-value="">
          {pending !== null ? `Chờ đồng ý · ${disappearLabel(pending.seconds)}` : disappearLabel(current)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
      </button>
      <label className={cn(rowClass, "cursor-pointer")} data-hide-tombstones-row="">
        <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px] text-foreground">Ẩn dấu vết tin đã biến mất / thu hồi</span>
        <Switch
          checked={hidden}
          onCheckedChange={(next) => hide.mutate(next)}
          aria-label="Ẩn dấu vết tin đã biến mất / thu hồi"
          data-hide-tombstones-switch=""
        />
      </label>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="bottom" className="p-0 md:mx-auto md:max-w-md md:rounded-t-card" data-disappear-sheet="">
          <SheetHeader className="px-4 pt-4 text-left">
            <SheetTitle className="text-[17px]">Tin tự biến mất</SheetTitle>
            <SheetDescription className="text-[14px] leading-6">
              {kind === "direct"
                ? "Bật hoặc đổi thời gian cần người kia đồng ý. Tắt thì có hiệu lực ngay."
                : canChange
                  ? "Áp cho tin gửi sau lúc đổi. Mọi người trong nhóm sẽ thấy một dòng thông báo."
                  : "Chỉ chủ nhóm hoặc quản trị viên đổi được."}
            </SheetDescription>
          </SheetHeader>
          <div role="radiogroup" aria-label="Tin tự biến mất" className="grid gap-1 px-4 pb-2 pt-s-4">
            {DISAPPEAR_OPTIONS.map((option) => {
              const selected = option.value === current;
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canChange || change.isPending}
                  data-disappear-option={String(option.value)}
                  onClick={() => change.mutate(option.value)}
                  className={cn(
                    "press flex min-h-12 items-center justify-between rounded-control border px-4 text-[16px] disabled:opacity-50",
                    selected ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground",
                  )}
                >
                  {option.label}
                  {pending !== null && pending.seconds === option.value ? <span className="text-[13px] opacity-80">Đang chờ đồng ý</span> : null}
                </button>
              );
            })}
          </div>
          <p className="px-4 pb-6 pt-s-2 text-[13px] leading-5 text-muted-foreground" data-disappear-note="">
            {DISAPPEAR_NOTE}
          </p>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** B1 — the proposal line in a 1-1: the other person answers; the proposer sees it waiting. */
export function DisappearProposalLine({
  message,
  proposal,
  viewerId,
  conversationId,
}: {
  message: Pick<ChatMessage, "id" | "content">;
  proposal: DisappearProposal | null;
  viewerId: string;
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: (accept: boolean) => answerDisappearProposal(proposal?.id ?? "", accept),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: disappearKeys.state(conversationId) });
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const isOpen = proposal !== null && proposal.messageId === message.id;
  return (
    <div className="mx-auto my-2 max-w-md px-4 text-center text-[12.5px] leading-relaxed text-muted-foreground" data-disappear-proposal="">
      <span className="inline-flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        {message.content}
      </span>
      {isOpen && proposal.proposedBy !== viewerId ? (
        <span className="mt-2 flex justify-center gap-2">
          <button
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate(true)}
            className="press h-10 rounded-control bg-primary px-4 text-[14px] font-medium text-primary-foreground disabled:opacity-60"
            data-disappear-accept=""
          >
            Đồng ý
          </button>
          <button
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate(false)}
            className="press h-10 rounded-control border border-border bg-card px-4 text-[14px] text-foreground disabled:opacity-60"
            data-disappear-decline=""
          >
            Không đồng ý
          </button>
        </span>
      ) : isOpen ? (
        <span className="mt-1 block" data-disappear-waiting="">Đang chờ người kia đồng ý.</span>
      ) : null}
    </div>
  );
}
