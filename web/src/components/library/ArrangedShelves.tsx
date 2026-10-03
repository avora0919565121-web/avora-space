import { Check, ChevronRight, Circle, NotebookText } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { useConclusions } from "@/components/library/BoardHead";
import { LifecycleShelf } from "@/components/library/ShelfPanels";
import { latestConclusions } from "@/lib/board-head";
import { ARRANGEMENTS, arrangeBoards, boardQuestion, isDusty, openedAgo, sameWords, showArrangePicker, type Arrangement, type PlaceKind } from "@/lib/desk";
import { lifecycleLabel } from "@/lib/board-head";
import type { ThinkTable } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

/**
 * AVORA-81 · PHẦN 2 · B2 (ADR-050) — the shelves under Bàn nghĩ, laid out three ways. Only the
 * layout changes; every board appears exactly once in each. `Theo nơi` adds two drawers
 * (Avora lập sẵn, Sách); the other two link to them under the columns.
 */
export function ArrangedShelves({
  boards,
  arrangement,
  ownBoards,
  placeKind,
  placeOf,
  drawer,
  onArrangement,
  onOpenBoard,
  onOpenDrawer,
  renderDrawer,
  diaryCount,
  archivedCount,
  binCount,
  onOpenDiary,
  onOpenStore,
  hotDefault,
}: {
  boards: readonly ThinkTable[];
  arrangement: Arrangement;
  ownBoards: number;
  placeKind: (board: ThinkTable) => PlaceKind;
  placeOf: (board: ThinkTable) => string | null;
  drawer: "sach" | "avora" | null;
  onArrangement: (next: Arrangement) => void;
  onOpenBoard: (id: string) => void;
  onOpenDrawer: (drawer: "sach" | "avora" | null) => void;
  renderDrawer: (drawer: "sach" | "avora") => ReactNode;
  diaryCount: number | null;
  archivedCount: number;
  binCount: number;
  onOpenDiary: () => void;
  onOpenStore: () => void;
  hotDefault: boolean;
}) {
  const conclusions = useConclusions();
  const latest = useMemo(() => latestConclusions(conclusions.data ?? []), [conclusions.data]);
  const groups = useMemo(() => arrangeBoards(boards, arrangement, placeKind), [boards, arrangement, placeKind]);
  const meta = ARRANGEMENTS.find((item) => item.id === arrangement) ?? ARRANGEMENTS[0];
  const picker = showArrangePicker(ownBoards);

  const row = (board: ThinkTable): ReactNode => {
    const lane = board.lifecycle === "thinking" || board.lifecycle === "concluded" ? board.lifecycle : "waiting";
    const question = boardQuestion(board);
    const conclusion = lane === "concluded" ? latest.get(board.id)?.body ?? null : null;
    const second = [arrangement === "noi" ? lifecycleLabel(lane) : (placeOf(board) ?? "Của tôi"), openedAgo(board.updatedAt)].filter((part) => part !== "").join(" · ");
    return (
      <li key={board.id} className={cn("border-b border-border/50 last:border-b-0", isDusty(board.updatedAt) && "opacity-50")}>
        <button type="button" onClick={() => onOpenBoard(board.id)} data-board-row={board.id} data-lane={lane} className="press flex min-h-[60px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/25">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-label={lifecycleLabel(lane)}>
            {lane === "thinking" ? (
              <span className="h-2.5 w-2.5 rounded-full bg-personal" />
            ) : lane === "concluded" ? (
              <Check className="h-4 w-4 text-[hsl(153_40%_40%)]" strokeWidth={2.5} />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-foreground">{question}</span>
            {!sameWords(board.name, question) && board.purpose !== null ? <span className="block truncate text-[12px] text-muted-foreground">{board.name}</span> : null}
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {second}
              {conclusion !== null ? <span className="text-foreground/80"> → {conclusion}</span> : null}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>
    );
  };

  const drawerLine = (id: "avora" | "sach", label: string, hint: string, hot: boolean): ReactNode => (
    <section key={id} aria-label={label} data-drawer={id} className="rounded-xl border border-border bg-card">
      <button type="button" aria-expanded={drawer === id} onClick={() => onOpenDrawer(drawer === id ? null : id)} className="press flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[15px] font-semibold", hot ? "text-personal" : "text-foreground")}>{label}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">{hint}</span>
        </span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", drawer === id && "rotate-90")} aria-hidden="true" />
      </button>
      {drawer === id ? <div className="border-t border-border/60 p-3">{renderDrawer(id)}</div> : null}
    </section>
  );

  return (
    <section aria-label="Kệ" data-arranged={arrangement} className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Kệ</h2>
        {picker ? (
          <div role="tablist" aria-label="Bày theo" data-arrange-picker="" className="flex gap-1 rounded-full bg-secondary/60 p-0.5">
            {ARRANGEMENTS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={arrangement === item.id} onClick={() => onArrangement(item.id)} className={cn("press h-8 rounded-full px-3 text-[12.5px] transition-colors", arrangement === item.id ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {picker ? <p className="mt-1 text-[13px] text-muted-foreground">{meta.question}</p> : null}

      {arrangement === "tien-trinh" ? (
        // Kéo thả giữa ba cột như kệ 03 cũ; điện thoại / bàn phím: menu `Chuyển sang`.
        <div className="mt-3" data-shelf-group="tien-trinh">
          <LifecycleShelf boards={boards} placeOf={placeOf} onOpen={onOpenBoard} />
        </div>
      ) : (
      <div className={cn("mt-3 grid gap-3", arrangement === "noi" ? "md:grid-cols-2" : "md:grid-cols-3")}>
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label} data-shelf-group={group.id} className="rounded-xl border border-border bg-card">
            <h3 className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.label} <span className="tabular font-normal">{group.boards.length}</span>
            </h3>
            {group.boards.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted-foreground">Chưa có gì.</p> : <ul>{group.boards.map(row)}</ul>}
          </section>
        ))}
      </div>
      )}

      {arrangement === "noi" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {drawerLine("avora", "Avora lập sẵn", "Kết nối · Nhiệm vụ · Két sắt", hotDefault)}
          {drawerLine("sach", "Sách", "Đọc tiếp · Thư viện mở", false)}
        </div>
      ) : (
        <p className="mt-3 text-[13.5px] text-muted-foreground" data-also-on-shelf="">
          Cũng trên kệ:{" "}
          <button type="button" onClick={() => onOpenDrawer("sach")} className="press font-medium text-personal">Sách</button> ·{" "}
          <button type="button" onClick={() => onOpenDrawer("avora")} className={cn("press font-medium", hotDefault ? "text-personal" : "text-personal")}>Avora lập sẵn ›</button>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <button type="button" onClick={onOpenDiary} data-diary-door="" className="press inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-foreground">
          <NotebookText className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Nhật ký · Ghi chép {diaryCount ?? ""} ›
        </button>
        <button type="button" onClick={onOpenStore} data-store="" className="press min-h-11 text-[12.5px] text-muted-foreground">
          Kho: Lưu trữ {archivedCount} · Thùng rác {binCount}
        </button>
      </div>
    </section>
  );
}
