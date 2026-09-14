import { Heart, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { GuidanceNote } from "@/components/tasks/ScheduleFields";
import {
  FAMILY_RELATION_OPTIONS,
  familyRelationLabel,
  type FamilyRelationType,
} from "@/lib/family";
import { useFamilyRelations } from "@/lib/use-family";
import { cn } from "@/lib/utils";

/**
 * Marking a 1-1 contact as family.
 *
 * One-directional, and the panel says so out loud. This is the viewer's own record of who
 * matters in a lasting way — the other person is never told and sees nothing, so nobody has
 * to accept or refuse being called family.
 *
 * The five kinds are a fixed list rather than a text box because this record exists to be
 * read by a rule: the mute exception cannot act on a relationship typed out by hand.
 */
export function FamilyFlagCard({ peerId, peerName }: { peerId: string; peerName: string }) {
  const { relationOf, mark, clear, isWorking } = useFamilyRelations();
  const current: FamilyRelationType | null = relationOf(peerId);
  const [isPicking, setIsPicking] = useState<boolean>(false);

  const choose = async (relationType: FamilyRelationType): Promise<void> => {
    try {
      await mark(peerId, relationType);
      setIsPicking(false);
      toast.success(`Đã đánh dấu ${peerName} là ${familyRelationLabel(relationType)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được đánh dấu.");
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await clear(peerId);
      setIsPicking(false);
      toast.success("Đã bỏ đánh dấu Gia đình.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không bỏ được đánh dấu.");
    }
  };

  return (
    <section className="border-t border-border px-6 py-5" aria-label="Đánh dấu Gia đình">
      <div className="flex items-start gap-2">
        <Heart
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            current === null ? "text-muted-foreground" : "fill-primary text-primary",
          )}
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-foreground">Gia đình</p>
          {current === null ? (
            <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
              Chỉ bạn thấy đánh dấu này — {peerName} không được thông báo và không thấy gì.
            </p>
          ) : (
            <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
              Đã đánh dấu là{" "}
              <span className="font-medium text-foreground">{familyRelationLabel(current)}</span>.
              Chỉ bạn thấy điều này.
            </p>
          )}
        </div>
        {current !== null && !isPicking ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void remove()}
            aria-label="Bỏ đánh dấu Gia đình"
            title="Bỏ đánh dấu Gia đình"
            className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-45"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        <GuidanceNote guidanceKey="family_flag_tag" />
      </div>

      {isPicking || current !== null ? (
        <div className="mt-3 space-y-1.5">
          {FAMILY_RELATION_OPTIONS.map((option) => {
            const active = current === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={isWorking}
                onClick={() => void choose(option.value)}
                aria-pressed={active}
                className={cn(
                  "press flex w-full items-start gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors disabled:opacity-45",
                  active
                    ? "border-primary/45 bg-primary/10"
                    : "border-border bg-card hover:bg-accent/40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[13.5px]",
                      active ? "font-semibold text-foreground" : "text-foreground",
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {option.note}
                  </span>
                </span>
              </button>
            );
          })}
          {current !== null ? (
            <button
              type="button"
              disabled={isWorking}
              onClick={() => void remove()}
              className="press mt-0.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-45"
            >
              Bỏ đánh dấu Gia đình
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={isWorking}
          onClick={() => setIsPicking(true)}
          className="press mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
        >
          <Heart className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Đánh dấu là Gia đình
        </button>
      )}
    </section>
  );
}
