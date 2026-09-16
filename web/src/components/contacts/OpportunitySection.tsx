import { Briefcase, Check, ChevronDown, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  formatEstimatedValue,
  isOpenStage,
  OPPORTUNITY_STAGES,
  stageLabel,
  suggestedOpportunityTitle,
  type Opportunity,
  type OpportunityStage,
} from "@/lib/opportunities";
import { useContactOpportunities, useOpportunityActions } from "@/lib/use-opportunities";
import { cn } from "@/lib/utils";

/**
 * Whether this contact is business being followed, and how far along it is.
 *
 * A small section on the contact rather than a CRM tab of its own. The question "where are we
 * with this person" is asked while looking at the person, and a separate screen would mean
 * leaving them to answer it. Someone whose address book is entirely family never meets this
 * beyond one quiet button.
 *
 * Shown for people and companies alike: a freelancer is as much a lead as a firm is, and the
 * contact type is a fact about who they are, not about whether there is business to be had.
 */
export function OpportunitySection({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const { opportunities, isPending } = useContactOpportunities(contactId);
  const { create, setStage, remove, isWorking } = useOpportunityActions();
  const [notice, setNotice] = useState<string | null>(null);

  const open = useCallback(async (): Promise<void> => {
    setNotice(null);
    try {
      await create({ contactId, title: suggestedOpportunityTitle(contactName) });
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, [create, contactId, contactName]);

  const move = useCallback(
    async (opportunityId: string, stage: OpportunityStage): Promise<void> => {
      setNotice(null);
      try {
        await setStage(opportunityId, stage);
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
    [setStage],
  );

  const drop = useCallback(
    async (opportunityId: string): Promise<void> => {
      setNotice(null);
      try {
        await remove(opportunityId);
      } catch (error) {
        setNotice((error as Error).message);
      }
    },
    [remove],
  );

  // Nothing is claimed while the answer is still loading: an empty section would read as "not an
  // opportunity", which is a statement, and the screen does not know that yet.
  if (isPending) {
    return (
      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 py-5" aria-hidden="true">
          <div className="h-4 w-28 animate-pulse rounded bg-secondary" />
        </div>
      </section>
    );
  }

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Cơ hội</h2>
        {opportunities.length > 0 ? (
          <Button
            variant="outline"
            className="press h-9 gap-1.5 px-3 text-[13px]"
            disabled={isWorking}
            onClick={() => void open()}
          >
            <Briefcase className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            Thêm cơ hội
          </Button>
        ) : null}
      </header>

      {opportunities.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <p className="mx-auto max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
            Ghi nhận liên hệ này là một cơ hội kinh doanh để theo dõi tiến triển qua từng giai đoạn.
          </p>
          <Button
            variant="outline"
            className="press mt-3.5 h-10 gap-2 px-4"
            disabled={isWorking}
            onClick={() => void open()}
          >
            <Briefcase className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {isWorking ? "Đang ghi nhận…" : "Đánh dấu là cơ hội kinh doanh"}
          </Button>
        </div>
      ) : (
        <ul>
          {opportunities.map((entry) => (
            <OpportunityRow
              key={entry.id}
              opportunity={entry}
              isWorking={isWorking}
              onMove={(stage) => void move(entry.id, stage)}
              onDrop={() => void drop(entry.id)}
            />
          ))}
        </ul>
      )}

      {notice !== null ? (
        <p role="alert" className="border-t border-border px-5 py-3 text-[13px] text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One opportunity: what it is, where it stands, and the way to move it.
 *
 * The stage picker is collapsed by default. Open, it shows all five at once rather than a
 * next/previous pair — the five are not a ladder, and re-reading a customer downwards is as
 * ordinary as moving them up.
 */
function OpportunityRow({
  opportunity,
  isWorking,
  onMove,
  onDrop,
}: {
  opportunity: Opportunity;
  isWorking: boolean;
  onMove: (stage: OpportunityStage) => void;
  onDrop: () => void;
}) {
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [isConfirmingDrop, setIsConfirmingDrop] = useState<boolean>(false);
  const value = formatEstimatedValue(opportunity.estimatedValue);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-foreground">
            {opportunity.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {value !== null ? `Dự kiến ${value}` : "Chưa định giá"}
          </span>
        </span>

        <StageBadge stage={opportunity.stage} />

        <button
          type="button"
          aria-expanded={isPicking}
          onClick={() => setIsPicking((current) => !current)}
          className="press inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          Đổi giai đoạn
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", isPicking && "rotate-180")}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>
      </div>

      {isPicking ? (
        <div className="border-t border-border bg-secondary/25 px-5 py-3">
          <ul className="flex flex-wrap gap-1.5">
            {OPPORTUNITY_STAGES.map((stage) => {
              const isCurrent = stage === opportunity.stage;
              return (
                <li key={stage}>
                  <button
                    type="button"
                    disabled={isWorking || isCurrent}
                    onClick={() => {
                      onMove(stage);
                      setIsPicking(false);
                    }}
                    className={cn(
                      "press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      isCurrent
                        ? "bg-accent/70 text-accent-foreground"
                        : "border border-border text-foreground hover:bg-accent/40",
                    )}
                  >
                    {isCurrent ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                    ) : null}
                    {stageLabel(stage)}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Two presses, like every other destructive act in the address book. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {!isConfirmingDrop ? (
              <button
                type="button"
                onClick={() => setIsConfirmingDrop(true)}
                className="press inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                Bỏ cơ hội này
              </button>
            ) : (
              <>
                <span className="text-[12.5px] text-muted-foreground">
                  Bỏ cơ hội này? Liên hệ vẫn giữ nguyên.
                </span>
                <Button
                  variant="outline"
                  className="press h-8 px-3 text-[12.5px]"
                  disabled={isWorking}
                  onClick={onDrop}
                >
                  Bỏ cơ hội
                </Button>
                <Button
                  variant="ghost"
                  className="press h-8 px-3 text-[12.5px]"
                  onClick={() => setIsConfirmingDrop(false)}
                >
                  Giữ lại
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The current stage, said once.
 *
 * Open and closed stages are told apart by weight rather than by colour alone: "đối tác" and
 * "không thành" are both endings and neither is asking for anything, so they recede.
 */
export function StageBadge({ stage }: { stage: OpportunityStage }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        isOpenStage(stage)
          ? "bg-accent/60 text-accent-foreground"
          : "border border-border text-muted-foreground",
      )}
    >
      {stageLabel(stage)}
    </span>
  );
}
