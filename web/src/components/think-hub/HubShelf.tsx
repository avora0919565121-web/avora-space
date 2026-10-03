import { Star } from "lucide-react";
import { useMemo, useState } from "react";

import { drawerLabel, REMINDER_TILES, whenLabel, type Drawer, type ReminderLine, type ReminderTile } from "@/lib/think-hub-shelf";
import { cn } from "@/lib/utils";

/**
 * The four tiles at the head of Kế hoạch (AVORA-77 · A1): `Quá hạn · cần chốt`, `Hôm nay · cần tập
 * trung`, `Trong tuần · cần sắp xếp`, `★ Quan trọng · cần ưu tiên`. A tile at 0 fades. Tapping one
 * unfolds a short list under the row; nothing changes a date or a status from here (ADR-013).
 * On a phone the four become one scrolling row of chips, one line tall.
 */
export function HubShelf({
  tiles,
  today,
  initialTile = null,
  drawerOfLine,
  onPickLine,
}: {
  tiles: Record<ReminderTile, ReminderLine[]>;
  today: string;
  /** `?o=` from Avora Space › Góc kế hoạch: open with that tile unfolded. */
  initialTile?: ReminderTile | null;
  drawerOfLine: (line: ReminderLine) => Drawer;
  onPickLine: (line: ReminderLine) => void;
}) {
  const [openTile, setOpenTile] = useState<ReminderTile | null>(initialTile);
  const [showAll, setShowAll] = useState<boolean>(false);
  const lines = openTile === null ? [] : tiles[openTile];

  // ★ reads as tables with their starred Hạng mục (C8).
  const starredByTable = useMemo(() => {
    const groups = new Map<string, ReminderLine[]>();
    for (const line of tiles.starred) groups.set(line.table.id, [...(groups.get(line.table.id) ?? []), line]);
    return [...groups.values()];
  }, [tiles.starred]);

  return (
    <section aria-label="Cần nhắc" data-reminder-tiles="">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {REMINDER_TILES.map((tile) => {
          const count = tiles[tile.id].length;
          const active = openTile === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              disabled={count === 0}
              aria-expanded={active}
              data-tile={tile.id}
              onClick={() => {
                setOpenTile(active ? null : tile.id);
                setShowAll(false);
              }}
              className={cn(
                "press flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-left transition-colors disabled:opacity-40",
                "md:flex-col md:items-start md:gap-0 md:rounded-xl md:px-3 md:py-2.5",
                active ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-card hover:bg-accent/30",
              )}
            >
              <span className="text-[13px] font-medium text-foreground md:order-2 md:mt-1 md:text-[12.5px] md:font-normal md:text-muted-foreground">
                {tile.label}
              </span>
              <span
                className={cn(
                  "tabular text-[14px] font-semibold md:order-1 md:text-[24px] md:leading-none",
                  tile.id === "overdue" && count > 0 ? "text-destructive" : tile.id === "starred" && count > 0 ? "text-star" : "text-foreground",
                )}
              >
                {count}
              </span>
              <span className="text-[12.5px] text-muted-foreground md:order-3 md:text-[11.5px]">
                <span className="md:hidden">· </span>
                {tile.ask}
              </span>
            </button>
          );
        })}
      </div>

      {openTile !== null && openTile !== "starred" ? (
        <ul className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
          {(showAll ? lines : lines.slice(0, 5)).map((line) => (
            <li key={line.record.id} className="border-b border-border/70 last:border-b-0">
              <button type="button" onClick={() => onPickLine(line)} className="press flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/25">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-foreground">{line.record.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {line.table.name} · {drawerLabel(drawerOfLine(line))}
                  </span>
                </span>
                <span className={cn("shrink-0 text-[12px]", openTile === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                  {whenLabel(line.when, today)}
                </span>
              </button>
            </li>
          ))}
          {!showAll && lines.length > 5 ? (
            <li>
              <button type="button" onClick={() => setShowAll(true)} className="press w-full px-4 py-2 text-left text-[13px] font-medium text-personal">
                Xem thêm {lines.length - 5}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {openTile === "starred" ? (
        <div className="mt-2 space-y-2">
          {starredByTable.map((group) => (
            <div key={group[0].table.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <p className="border-b border-border/70 px-4 py-2 text-[12.5px] font-semibold text-muted-foreground">
                {group[0].table.name} · {drawerLabel(drawerOfLine(group[0]))}
              </p>
              <ul>
                {group.map((line) => (
                  <li key={line.record.id}>
                    <button type="button" onClick={() => onPickLine(line)} className="press flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/25">
                      <Star className="h-3.5 w-3.5 shrink-0 fill-star text-star" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{line.record.title}</span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">{whenLabel(line.when, today)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
