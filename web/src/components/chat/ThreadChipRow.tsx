import { CheckSquare, Clock, FolderKanban, Lightbulb, Pin } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

export type ThreadChipId = "pins" | "suggestions" | "tasks" | "scheduled";

export type ThreadChip =
  | { id: ThreadChipId; label: string; count: number; needsMe?: boolean }
  | { id: "project"; label: string; to: string };

const ICONS: Record<ThreadChipId | "project", typeof Pin> = {
  pins: Pin,
  project: FolderKanban,
  suggestions: Lightbulb,
  tasks: CheckSquare,
  scheduled: Clock,
};

/**
 * AVORA-49 · 2.1: what used to be five strips above a thread (ghim · dự án · gợi ý · việc · hẹn
 * giờ) as one ~36px row. A chip opens its list just below, capped at 35% of the screen, so the
 * messages keep at least 65%. Nothing opens on its own; a chip that needs the reader carries a dot.
 */
export function ThreadChipRow({
  chips,
  open,
  onToggle,
  children,
}: {
  chips: readonly ThreadChip[];
  open: ThreadChipId | null;
  onToggle: (id: ThreadChipId) => void;
  /** The open chip's list. */
  children?: ReactNode;
}) {
  if (chips.length === 0) return null;
  return (
    <>
      <nav aria-label="Trong cuộc này" className="border-b border-border bg-card/80">
        <ul className="no-scrollbar flex h-10 items-center gap-1.5 overflow-x-auto px-3 md:px-10">
          {chips.map((chip) => {
            const Icon = ICONS[chip.id];
            const base =
              "press inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-medium transition-colors";
            if ("to" in chip) {
              return (
                <li key={chip.id}>
                  <Link to={chip.to} className={cn(base, "max-w-[12rem] border-border bg-background text-foreground hover:bg-accent/40")}>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.9} aria-hidden="true" />
                    <span className="truncate">{chip.label}</span>
                  </Link>
                </li>
              );
            }
            const isOpen = open === chip.id;
            return (
              <li key={chip.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => onToggle(chip.id)}
                  className={cn(
                    base,
                    isOpen ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent/40",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                  <span>{chip.label}</span>
                  {chip.needsMe === true && !isOpen ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="cần bạn" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </>
  );
}
