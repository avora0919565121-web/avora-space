import { Lock } from "lucide-react";
import { useMemo, useState } from "react";

import { AssigneePicker } from "@/components/chat/AssigneePicker";
import { useContacts } from "@/lib/use-contacts";
import { useUserAliases } from "@/lib/use-user-aliases";
import type { GroupMember } from "@/lib/groups";
import {
  choiceLabel,
  choicesFor,
  pickerMembers,
  type ComposerPlace,
  type RecipientChoice,
} from "@/lib/task-composer";
import { cn } from "@/lib/utils";

/**
 * "Giao cho" (ADR-030): three answers at most, never pre-filled except where "Cho tôi" is the
 * only one. "Chọn người" opens the member list (Tôi pinned first, accent-free search) and folds
 * back into the summary line once chosen.
 */
export function RecipientPicker({
  id,
  place,
  choice,
  onChoice,
  peerName,
  members,
  selfId,
  pickedIds,
  onPickedIds,
  summary,
  lockedLabel,
}: {
  id: string;
  place: ComposerPlace;
  choice: RecipientChoice;
  onChoice: (next: RecipientChoice) => void;
  peerName: string;
  /** Only people the server lets this person reach (no block either way). */
  members: readonly GroupMember[];
  selfId: string | undefined;
  pickedIds: readonly string[];
  onPickedIds: (next: string[]) => void;
  /** "Gửi tới: An, Bình · và bạn" — shown under the buttons once someone is chosen. */
  summary: string | null;
  /** Editing: who receives is settled, so the field is a locked line instead of buttons. */
  lockedLabel?: string;
}) {
  const [isPicking, setIsPicking] = useState<boolean>(false);
  // AVORA-71 · E: the picker shows and searches my own name for each person.
  const { aliases } = useUserAliases();
  const { data: contacts } = useContacts();
  const myNames = useMemo(() => {
    const names = new Map<string, string>(aliases);
    for (const contact of contacts ?? []) if (contact.linkedUserId !== null) names.set(contact.linkedUserId, contact.name);
    return names;
  }, [aliases, contacts]);
  const options = choicesFor(place);
  const pickable = useMemo(() => pickerMembers(members, selfId), [members, selfId]);
  const picked = useMemo(
    () => pickable.filter((member) => pickedIds.includes(member.userId)),
    [pickable, pickedIds],
  );

  if (lockedLabel !== undefined) {
    return (
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Giao cho</p>
        <p className="flex min-h-11 items-center gap-2 rounded-[10px] border border-border bg-secondary/40 px-3 text-[14px] text-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          {lockedLabel}
        </p>
      </div>
    );
  }

  const choose = (next: RecipientChoice): void => {
    onChoice(next);
    setIsPicking(next === "pick");
  };

  return (
    <div>
      <p id={`${id}-label`} className="mb-1.5 text-[12px] font-medium text-muted-foreground">
        Giao cho
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = choice === option;
          const isOnly = options.length === 1;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={isOnly}
              onClick={() => choose(option)}
              className={cn(
                "press min-h-11 rounded-full border px-4 text-[14px] font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent/50",
                isOnly && "cursor-default opacity-100",
              )}
            >
              {choiceLabel(option, place, peerName)}
            </button>
          );
        })}
      </div>

      {choice === "pick" && isPicking ? (
        <div className="mt-2.5 rounded-[12px] border border-border bg-secondary/30 p-2.5">
          <AssigneePicker
            id={`${id}-people`}
            members={pickable}
            selected={picked}
            onChange={(next) => onPickedIds(next.map((member) => member.userId))}
            selfId={selfId}
            allowSelf
            myNames={myNames}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setIsPicking(false)}
              disabled={picked.length === 0}
              className="press h-10 rounded-[10px] border border-border bg-card px-4 text-[13px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-40"
            >
              Xong
            </button>
          </div>
        </div>
      ) : null}

      {summary !== null ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-foreground">
          <span aria-hidden="true" className="text-muted-foreground">→</span>
          <span className="font-medium">{summary}</span>
          {choice === "pick" && !isPicking ? (
            <button
              type="button"
              onClick={() => setIsPicking(true)}
              className="press rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Đổi
            </button>
          ) : null}
        </p>
      ) : choice === "pick" && !isPicking ? (
        <button
          type="button"
          onClick={() => setIsPicking(true)}
          className="press mt-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          Chọn người nhận…
        </button>
      ) : null}
    </div>
  );
}
