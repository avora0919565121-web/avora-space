import { ChevronRight } from "lucide-react";

import { COVERS, SHELVES, spineHeights, type ShelfId, type ShelfStatus } from "@/lib/library";
import { cn } from "@/lib/utils";

/** A row of small spines standing on a line: how full a shelf is, at a glance (max 10). */
function Spines({ count, seed, className }: { count: number; seed: string; className?: string }) {
  const heights = spineHeights(count, seed);
  return (
    <span aria-hidden="true" className={cn("flex h-7 items-end gap-[3px] border-b-2 border-foreground/15 pb-px", className)}>
      {heights.length === 0 ? <span className="h-2 w-6 rounded-sm bg-muted" /> : null}
      {heights.map((height, index) => (
        <span
          key={index}
          className="w-[7px] rounded-t-[2px] shadow-[inset_-1px_0_0_rgba(0,0,0,0.18)]"
          style={{ height: `${height}%`, backgroundColor: COVERS[(index * 3 + seed.length) % COVERS.length] }}
        />
      ))}
    </span>
  );
}

/**
 * AVORA-77 · B1 — the six shelf cards. A computer: one row (wrapping when narrow), the open shelf
 * outlined in the person's tone. A phone: a list of six lines (spines · name · status · ›).
 */
export function ShelfCards({
  current,
  statusOf,
  onPick,
  layout,
}: {
  current: ShelfId | null;
  statusOf: (id: ShelfId) => ShelfStatus;
  onPick: (id: ShelfId) => void;
  layout: "cards" | "list";
}) {
  if (layout === "list") {
    return (
      <nav aria-label="Sáu kệ" data-shelf-list="" className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul>
          {SHELVES.map((shelf) => {
            const status = statusOf(shelf.id);
            return (
              <li key={shelf.id} className="border-b border-border/70 last:border-b-0">
                <button type="button" onClick={() => onPick(shelf.id)} data-shelf={shelf.id} className="press flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/25">
                  <Spines count={status.spines} seed={shelf.id} className="w-[60px] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Kệ {shelf.no}</span>
                    <span className="block truncate text-[15px] font-semibold text-foreground">{shelf.name}</span>
                    <span className={cn("block truncate text-[12.5px]", status.needsAttention ? "font-medium text-personal" : "text-muted-foreground")}>{status.text}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <div role="group" aria-label="Sáu kệ" data-shelf-cards="" className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
      {SHELVES.map((shelf) => {
        const status = statusOf(shelf.id);
        const isOn = current === shelf.id;
        return (
          <button
            key={shelf.id}
            type="button"
            aria-pressed={isOn}
            data-shelf={shelf.id}
            onClick={() => onPick(shelf.id)}
            className={cn(
              "press group flex min-h-[132px] flex-col rounded-2xl border bg-card px-3.5 pb-3 pt-3 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5",
              isOn ? "border-personal shadow-[0_0_0_1px_hsl(var(--personal))]" : "border-border hover:border-foreground/20",
            )}
          >
            <Spines count={status.spines} seed={shelf.id} />
            <span className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Kệ {shelf.no}</span>
            <span className="text-[14.5px] font-semibold leading-tight text-foreground">{shelf.name}</span>
            <span className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">{shelf.description}</span>
            <span className={cn("mt-auto pt-1.5 text-[12px] tabular-nums", status.needsAttention ? "font-semibold text-personal" : "text-muted-foreground/80")}>{status.text}</span>
          </button>
        );
      })}
    </div>
  );
}
