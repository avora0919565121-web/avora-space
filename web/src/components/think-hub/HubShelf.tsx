import { ChevronDown, Lock, Plus, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DRAWERS,
  drawerLabel,
  searchShelf,
  whenLabel,
  type Drawer,
  type ReminderLine,
  type ReminderTile,
  type ShelfTable,
} from "@/lib/think-hub-shelf";
import { cn } from "@/lib/utils";

const TILES: readonly { id: ReminderTile; label: string }[] = [
  { id: "overdue", label: "Quá hạn" },
  { id: "today", label: "Hôm nay" },
  { id: "week", label: "Trong tuần" },
  { id: "starred", label: "★ Quan trọng" },
];

/**
 * Kế hoạch as a filing shelf (Đợt gộp 2 · C3): four reminder tiles that fold open a short list,
 * four drawers that fold open their tables, and — once a table is chosen — only a thin bar
 * naming it. Read-only here (ADR-013): nothing changes a status or a date from the shelf.
 */
export function HubShelf({
  tiles,
  shelf,
  today,
  selected,
  selectedDrawer,
  drawerOfLine,
  onPickTable,
  onPickLine,
  onNewTable,
  onOpenTrash,
}: {
  tiles: Record<ReminderTile, ReminderLine[]>;
  shelf: Record<Drawer, { live: ShelfTable[]; archived: ShelfTable[] }>;
  today: string;
  selected: ShelfTable | null;
  selectedDrawer: Drawer | null;
  drawerOfLine: (line: ReminderLine) => Drawer;
  onPickTable: (tableId: string) => void;
  onPickLine: (line: ReminderLine) => void;
  onNewTable: (drawer: Drawer) => void;
  onOpenTrash: () => void;
}) {
  const [openTile, setOpenTile] = useState<ReminderTile | null>(null);
  const [openDrawer, setOpenDrawer] = useState<Drawer | null>(selected === null ? "personal" : null);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const nothingDue = tiles.overdue.length + tiles.today.length + tiles.week.length === 0;
  const lines = openTile === null ? [] : tiles[openTile];

  // ★ reads as tables with their starred Hạng mục (C8).
  const starredByTable = useMemo(() => {
    const groups = new Map<string, ReminderLine[]>();
    for (const line of tiles.starred) groups.set(line.table.id, [...(groups.get(line.table.id) ?? []), line]);
    return [...groups.values()];
  }, [tiles.starred]);

  const drawerItems = openDrawer === null ? [] : searchShelf(shelf[openDrawer].live, query);

  return (
    <div className="space-y-4">
      <section aria-label="Cần nhắc">
        {nothingDue && tiles.starred.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">Không có gì cần nhắc.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {TILES.map((tile) => {
              const count = tiles[tile.id].length;
              const active = openTile === tile.id;
              return (
                <button
                  key={tile.id}
                  type="button"
                  disabled={count === 0}
                  aria-expanded={active}
                  onClick={() => {
                    setOpenTile(active ? null : tile.id);
                    setShowAll(false);
                  }}
                  className={cn(
                    "press flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40",
                    active ? "border-primary bg-primary/8" : "border-border bg-card hover:bg-accent/30",
                  )}
                >
                  <span
                    className={cn(
                      "tabular text-[22px] font-semibold leading-none md:text-[26px]",
                      tile.id === "overdue" && count > 0 ? "text-destructive" : tile.id === "starred" && count > 0 ? "text-amber-500" : "text-foreground",
                    )}
                  >
                    {count}
                  </span>
                  <span className="mt-1 text-[11.5px] leading-tight text-muted-foreground md:text-[12.5px]">{tile.label}</span>
                </button>
              );
            })}
          </div>
        )}

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
                <button type="button" onClick={() => setShowAll(true)} className="press w-full px-4 py-2 text-left text-[13px] font-medium text-primary">
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
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
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

      <section aria-label="Kệ">
        {selected !== null && openDrawer === null ? (
          <button
            type="button"
            onClick={() => setOpenDrawer(selectedDrawer ?? "personal")}
            className="press flex w-full items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-accent/25"
          >
            <span className="min-w-0 flex-1 truncate text-[15px]">
              <span className="text-muted-foreground">{drawerLabel(selectedDrawer ?? "personal")} › </span>
              <span className="font-semibold text-foreground">{selected.table.name}</span>
              {selected.placeName !== null ? <span className="ml-2 text-[12.5px] text-muted-foreground">{selected.placeName}</span> : null}
            </span>
            {selected.table.archivedAt !== null ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Đã lưu trữ" /> : null}
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        ) : (
          <>
            <div role="tablist" aria-label="Ngăn" className="flex items-end gap-1">
              {DRAWERS.map((drawer) => {
                const count = shelf[drawer.id].live.length;
                const late = shelf[drawer.id].live.some((item) => item.hasOverdue);
                const active = openDrawer === drawer.id;
                return (
                  <button
                    key={drawer.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setOpenDrawer(active ? null : drawer.id);
                      setQuery("");
                      setShowArchived(false);
                    }}
                    className={cn(
                      "press relative flex-1 rounded-t-xl border border-b-0 px-2 py-2 text-[13.5px] font-medium transition-colors",
                      active ? "bg-card text-foreground" : "border-transparent bg-secondary/60 text-muted-foreground hover:text-foreground",
                      count === 0 && !active && "opacity-50",
                    )}
                  >
                    {drawer.label} <span className="tabular text-[12px] text-muted-foreground">{count}</span>
                    {late ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" aria-label="có mục quá hạn" /> : null}
                  </button>
                );
              })}
            </div>
            {openDrawer !== null ? (
              <div className="rounded-b-xl rounded-tr-xl border border-border bg-card">
                {shelf[openDrawer].live.length > 8 ? (
                  <label className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
                    <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Tìm bảng…"
                      aria-label="Tìm bảng"
                      className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                    />
                  </label>
                ) : null}
                <ul>
                  {drawerItems.map((item) => (
                    <ShelfRow key={item.table.id} item={item} active={selected?.table.id === item.table.id} onPick={() => {
                      onPickTable(item.table.id);
                      setOpenDrawer(null);
                    }} />
                  ))}
                  {drawerItems.length === 0 ? (
                    <li className="px-4 py-3 text-[13.5px] text-muted-foreground">{query === "" ? "Ngăn này chưa có Bảng nào." : "Không thấy bảng nào."}</li>
                  ) : null}
                  {shelf[openDrawer].archived.length > 0 ? (
                    <li className="border-t border-border/70">
                      <button type="button" onClick={() => setShowArchived(!showArchived)} className="press flex w-full items-center gap-1.5 px-4 py-2 text-left text-[12.5px] text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Đã lưu trữ ({shelf[openDrawer].archived.length})
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showArchived && "rotate-180")} aria-hidden="true" />
                      </button>
                    </li>
                  ) : null}
                  {showArchived
                    ? shelf[openDrawer].archived.map((item) => (
                        <ShelfRow key={item.table.id} item={item} active={selected?.table.id === item.table.id} muted onPick={() => {
                          onPickTable(item.table.id);
                          setOpenDrawer(null);
                        }} />
                      ))
                    : null}
                  <li className="border-t border-border/70">
                    <button type="button" onClick={() => onNewTable(openDrawer)} className="press flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-[13.5px] font-medium text-primary">
                      <Plus className="h-4 w-4" aria-hidden="true" /> Bảng mới ở đây
                    </button>
                  </li>
                </ul>
              </div>
            ) : null}
            <div className="mt-1.5 flex justify-end">
              <button type="button" onClick={onOpenTrash} className="press inline-flex items-center gap-1 px-1 text-[12px] text-muted-foreground hover:text-foreground">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Thùng rác
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ShelfRow({ item, active, muted = false, onPick }: { item: ShelfTable; active: boolean; muted?: boolean; onPick: () => void }) {
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={cn("press flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/25", active && "bg-accent/40", muted && "opacity-60")}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {muted ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            <span className="truncate text-[14.5px] font-medium text-foreground">{item.table.name}</span>
          </span>
          {item.placeName !== null ? <span className="block truncate text-[12px] text-muted-foreground">{item.placeName}</span> : null}
        </span>
        <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">{item.recordCount}</span>
        {item.hasOverdue ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-label="có mục quá hạn" /> : null}
      </button>
    </li>
  );
}
