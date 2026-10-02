import { useState } from "react";
import { toast } from "sonner";

import { proposalProgress, type SharedProposal } from "@/lib/think-hub-shelf";
import { useShelfActions } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

const STATUS_LINE: Record<SharedProposal["status"], string> = {
  open: "",
  approved: "Đã làm theo đề nghị",
  rejected: "Cần trao đổi",
  withdrawn: "Đã rút lại",
  expired: "Hết hạn — chưa đủ đồng ý",
};

/**
 * The system line that opened a proposal, grown into a card (ADR-031): progress for everyone,
 * "Đồng ý · Không đồng ý" for stakeholders only, "Rút lại đề nghị" for the proposer.
 */
export function ProposalCard({
  content,
  proposal,
  userId,
  nameOf,
}: {
  content: string;
  proposal: SharedProposal | undefined;
  userId: string | undefined;
  nameOf: (userId: string) => string;
}) {
  const { vote, withdraw } = useShelfActions();
  const [isDisagreeing, setIsDisagreeing] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");

  if (proposal === undefined) {
    return <p className="mx-auto max-w-md px-4 text-center text-[12.5px] leading-relaxed text-muted-foreground">{content}</p>;
  }
  const mine = proposal.votes.find((entry) => entry.userId === userId);
  const canVote = proposal.status === "open" && mine !== undefined && mine.vote === null;
  const isProposer = proposal.proposedBy === userId;

  const cast = (choice: "agree" | "disagree"): void => {
    vote
      .mutateAsync({ proposalId: proposal.id, vote: choice, reason: choice === "disagree" ? reason : null })
      .then(
        () => {
          setIsDisagreeing(false);
          toast.success(choice === "agree" ? "Đã đồng ý." : "Đã gửi ý kiến không đồng ý.");
        },
        (error: unknown) => toast.error(error instanceof Error ? error.message : "Không gửi được."),
      );
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px]">
      <p className="text-foreground">{content}</p>
      <p className={cn("mt-1.5 text-[12px]", proposal.status === "open" ? "text-muted-foreground" : "font-medium text-foreground")}>
        {proposal.status === "open" ? proposalProgress(proposal, nameOf) : STATUS_LINE[proposal.status]}
      </p>
      {canVote && !isDisagreeing ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={vote.isPending} onClick={() => cast("agree")} className="press rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground">
            Đồng ý
          </button>
          <button type="button" onClick={() => setIsDisagreeing(true)} className="press rounded-md border border-border px-3 py-1.5 text-[13px]">
            Không đồng ý
          </button>
        </div>
      ) : null}
      {isDisagreeing ? (
        <div className="mt-2 space-y-2">
          <input
            value={reason}
            autoFocus
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Một câu lý do"
            aria-label="Lý do không đồng ý"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-[16px] md:text-[13.5px] outline-none focus:border-personal"
          />
          <div className="flex gap-2">
            <button type="button" disabled={reason.trim() === "" || vote.isPending} onClick={() => cast("disagree")} className="press rounded-md bg-destructive px-3 py-1.5 text-[13px] font-semibold text-destructive-foreground disabled:opacity-50">
              Gửi
            </button>
            <button type="button" onClick={() => setIsDisagreeing(false)} className="press rounded-md border border-border px-3 py-1.5 text-[13px]">Huỷ</button>
          </div>
        </div>
      ) : null}
      {isProposer && proposal.status === "open" ? (
        <button
          type="button"
          onClick={() => withdraw.mutateAsync(proposal.id).then(() => toast.success("Đã rút lại đề nghị."), (error: unknown) => toast.error(error instanceof Error ? error.message : "Không rút lại được."))}
          className="press mt-2 text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          Rút lại đề nghị
        </button>
      ) : null}
    </div>
  );
}
