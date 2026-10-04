import { Archive, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MoreHorizontal, Plus, Table2, Trash2 } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useConclusions, useLifecycleChange } from "@/components/library/BoardHead";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { canEditHead, latestConclusions, lifecycleLabel, LIFECYCLES, type Lifecycle } from "@/lib/board-head";
import { boardQuestion, DESK_LIMIT, isDusty, openedAgo, sameWords, type PlaceKind } from "@/lib/desk";
import { neighbour, ROOM_SHELVES, shelfOfRoom, SPINES, type RoomShelf } from "@/lib/room";
import type { ThinkTable } from "@/lib/think-hub";
import { THINKING_TYPES, type BoardTemplate } from "@/lib/think-hub-shelf";
import { DeskFullError, useBoardOpened, useDesk } from "@/lib/use-desk";
import type { OpenQuestion } from "@/lib/use-room";
import { cn } from "@/lib/utils";

/**
 * AVORA-89 · PHẦN 2 (ADR-057) — Kế hoạch as a room: three wall shelves (1 Toàn cảnh · 2 Tổng quan ·
 * 3 Tiến trình) above three desk tops (4 Bảng Avora · 5 Đọc & Nhật ký · 6 Bàn làm việc). One at a time.
 */

const DAY = 86_400_000;
const PLACE_ROWS: readonly { id: PlaceKind; label: string }[] = [
  { id: "personal", label: "Cá nhân" },
  { id: "direct", label: "1-1" },
  { id: "group", label: "Nhóm" },
  { id: "project", label: "Dự án" },
];
const LANES = LIFECYCLES.map((lane) => lane.id);
type Lane = (typeof LANES)[number];
const laneOf = (board: ThinkTable): Lane => (board.lifecycle === "thinking" || board.lifecycle === "concluded" ? board.lifecycle : "waiting");
const typeLabel = (board: ThinkTable): string | null => THINKING_TYPES.find((item) => item.id === board.thinkingType)?.label ?? null;

// ------------------------------------------------------------------ shelf bar · map · up / down

export function RoomBar({ shelf, onGo, onOpenMap }: { shelf: RoomShelf; onGo: (to: RoomShelf, dir: "left" | "right" | "up" | "down") => void; onOpenMap: () => void }) {
  const meta = shelfOfRoom(shelf);
  const left = neighbour(shelf, "left");
  const right = neighbour(shelf, "right");
  return (
    <div
      data-room-bar={shelf}
      className={cn("flex h-12 shrink-0 items-center gap-1 border-b border-border px-2", meta.row === "wall" ? "bg-[hsl(var(--room-wall))]" : "bg-[hsl(var(--room-desk))]")}
    >
      <div className="flex w-[30%] min-w-0 justify-start">
        {left !== null ? (
          <button type="button" onClick={() => onGo(left, "left")} data-room-prev="" aria-label={`Sang ${shelfOfRoom(left).name}`} className="press flex h-11 min-w-0 items-center gap-0.5 rounded-md pr-1 text-[12px] leading-tight text-muted-foreground">
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2 text-left">{shelfOfRoom(left).name}</span>
          </button>
        ) : null}
      </div>
      <button type="button" onClick={onOpenMap} aria-label={`Đang ở ${meta.name}. Xem cả phòng`} data-room-map-button="" className="press flex min-w-0 flex-1 flex-col items-center justify-center rounded-md">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-foreground">{meta.name}</span>
          <MiniMap shelf={shelf} />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {meta.row === "wall" ? "Kệ treo tường" : "Mặt bàn"} · {shelf}
        </span>
      </button>
      <div className="flex w-[30%] min-w-0 justify-end">
        {right !== null ? (
          <button type="button" onClick={() => onGo(right, "right")} data-room-next="" aria-label={`Sang ${shelfOfRoom(right).name}`} className="press flex h-11 min-w-0 items-center gap-0.5 rounded-md pl-1 text-[12px] leading-tight text-muted-foreground">
            <span className="line-clamp-2 text-right">{shelfOfRoom(right).name}</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MiniMap({ shelf }: { shelf: RoomShelf }) {
  return (
    <span className="grid grid-cols-3 gap-[2px]" aria-hidden="true" data-room-minimap="">
      {ROOM_SHELVES.map((item) => (
        <span key={item.id} data-on={item.id === shelf ? "" : undefined} className={cn("h-[5px] w-[9px] rounded-[1.5px]", item.id === shelf ? "bg-personal" : "bg-foreground/15")} />
      ))}
    </span>
  );
}

export function RoomMapSheet({ open, shelf, summaries, onOpenChange, onGo }: { open: boolean; shelf: RoomShelf; summaries: Record<RoomShelf, string>; onOpenChange: (open: boolean) => void; onGo: (to: RoomShelf) => void }) {
  const row = (kind: "wall" | "desk") => (
    <div className={cn("grid grid-cols-3 gap-2 rounded-xl p-2", kind === "wall" ? "bg-[hsl(var(--room-wall))]" : "bg-[hsl(var(--room-desk))]")}>
      {ROOM_SHELVES.filter((item) => item.row === kind).map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onGo(item.id)}
          data-room-tile={item.id}
          aria-current={item.id === shelf ? "true" : undefined}
          className={cn("press flex min-h-[92px] flex-col justify-between rounded-lg border bg-card p-2.5 text-left shadow-sm", item.id === shelf ? "border-personal ring-1 ring-personal" : "border-border")}
        >
          <span className="text-[11px] text-muted-foreground">{item.id}</span>
          <span className="text-[14px] font-semibold leading-tight text-foreground">{item.name}</span>
          <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{summaries[item.id]}</span>
        </button>
      ))}
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="mx-auto max-w-xl rounded-b-[22px] px-3 pb-4 pt-[calc(env(safe-area-inset-top)+16px)]" data-room-sheet="">
        <SheetTitle className="px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Kệ treo tường</SheetTitle>
        <SheetDescription className="sr-only">Cả phòng Kế hoạch — chạm một ô để tới.</SheetDescription>
        <div className="mt-2">{row("wall")}</div>
        <p className="mt-3 px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Mặt bàn</p>
        <div className="mt-2">{row("desk")}</div>
        <p className="mt-3 text-center text-[12.5px] text-muted-foreground">
          Chạm một ô để tới · đang ở <b className="font-semibold text-personal">{shelf} {shelfOfRoom(shelf).name}</b>
        </p>
      </SheetContent>
    </Sheet>
  );
}

/** One pill at the bottom centre: `⌄ Xuống bàn · …` on the wall row, `⌃ Lên kệ · …` on the desk row. */
export function UpDownPill({ shelf, onGo }: { shelf: RoomShelf; onGo: (to: RoomShelf, dir: "up" | "down") => void }) {
  const down = neighbour(shelf, "down");
  const up = neighbour(shelf, "up");
  const to = down ?? up;
  if (to === null) return null;
  return (
    <button
      type="button"
      onClick={() => onGo(to, down !== null ? "down" : "up")}
      data-room-updown={down !== null ? "down" : "up"}
      className="press absolute bottom-3 left-1/2 z-20 inline-flex h-10 max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-4 text-[13.5px] text-foreground shadow-[0_4px_16px_-6px_hsl(30_20%_20%/0.35)]"
    >
      {down !== null ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{down !== null ? "Xuống bàn" : "Lên kệ"} ·</span>
      <b className="truncate font-semibold">{shelfOfRoom(to).name}</b>
    </button>
  );
}

/** 2.3 — small tabs at the edges of a focused board, pointing to the shelves beside its home shelf. */
export function EdgeArrows({ home, title, onGo }: { home: RoomShelf; title: string; onGo: (to: RoomShelf) => void }) {
  const arrows = (["left", "right", "up", "down"] as const).flatMap((side) => {
    const to = neighbour(home, side);
    return to === null ? [] : [{ side, to }];
  });
  return (
    <>
      {arrows.map(({ side, to }) => (
        <button
          key={side}
          type="button"
          data-bleed=""
          data-edge-arrow={side}
          onClick={() => onGo(to)}
          aria-label={`Rời ${title}, sang ${shelfOfRoom(to).name}`}
          className={cn(
            "press fixed z-30 flex items-center justify-center bg-personal/[0.14] text-personal",
            side === "left" && "left-0 top-1/2 h-16 w-[18px] -translate-y-1/2 rounded-r-lg",
            side === "right" && "right-0 top-1/2 h-16 w-[18px] -translate-y-1/2 rounded-l-lg",
            side === "up" && "left-1/2 top-[calc(env(safe-area-inset-top)+56px)] h-4 w-16 -translate-x-1/2 rounded-b-lg md:top-3",
            side === "down" && "bottom-[calc(env(safe-area-inset-bottom)+8px)] left-1/2 h-4 w-16 -translate-x-1/2 rounded-t-lg",
          )}
        >
          {side === "left" ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : side === "right" ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : side === "up" ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ kệ 1 · Toàn cảnh

export type SpinePreview = { title: string; count: number; items: { key: string; label: string; sub?: string; tone?: string }[]; primary: { label: string; onPress: () => void }; secondary?: { label: string; onPress: () => void } };

const SPINE_KEY = "avora-room-spine";

export function OverviewShelf({
  counts,
  previewOf,
  templates,
  templateCount,
  usedCount,
  onUseTemplate,
  onOpenLibrary,
  onFirstTemplates,
}: {
  counts: Record<(typeof SPINES)[number]["id"], number>;
  previewOf: (id: Exclude<(typeof SPINES)[number]["id"], "templates">) => SpinePreview;
  templates: readonly BoardTemplate[];
  templateCount: number;
  usedCount: ReadonlyMap<string, number>;
  onUseTemplate: (template: BoardTemplate) => void;
  onOpenLibrary: () => void;
  onFirstTemplates: () => void;
}) {
  const [open, setOpen] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(SPINE_KEY);
    } catch {
      return null;
    }
  });
  const choose = (id: string): void => {
    const next = open === id ? null : id;
    setOpen(next);
    try {
      if (next === null) window.localStorage.removeItem(SPINE_KEY);
      else window.localStorage.setItem(SPINE_KEY, next);
    } catch {
      // Device memory only; nothing to do.
    }
    if (next === "templates") onFirstTemplates();
  };
  const heights = [148, 132, 160, 142, 136, 150];
  return (
    <div data-room-shelf="1">
      <div className="rounded-2xl bg-[linear-gradient(180deg,hsl(var(--room-wood)/0.25),hsl(var(--room-wood)/0.4))] px-3 pt-4 shadow-inner">
        <div className="flex items-end justify-center gap-2 sm:gap-3" role="group" aria-label="Tủ kệ">
          {SPINES.map((spine, index) => {
            const isOpen = open === spine.id;
            return (
              <button
                key={spine.id}
                type="button"
                onClick={() => choose(spine.id)}
                aria-pressed={isOpen}
                aria-label={`${spine.label} · ${counts[spine.id]}`}
                data-spine={spine.id}
                data-spine-kind={spine.kind}
                style={{ backgroundColor: spine.tone, height: heights[index] }}
                className={cn(
                  "press relative flex w-[13.5%] max-w-[64px] flex-col items-center justify-between rounded-t-[5px] pb-2 pt-3 text-white shadow-[inset_-3px_0_0_hsl(0_0%_0%/0.18),inset_2px_0_0_hsl(0_0%_100%/0.12)] transition-transform duration-200 motion-reduce:transition-none",
                  isOpen ? "-translate-y-3 ring-2 ring-white/90" : "",
                )}
              >
                {spine.kind === "binder" ? <span className="h-3.5 w-3.5 rounded-full bg-black/35 ring-2 ring-white/25" aria-hidden="true" /> : null}
                {spine.kind === "box" ? <span className="h-2.5 w-7 rounded-full bg-black/30" aria-hidden="true" /> : null}
                {spine.kind === "book" ? <span className="absolute inset-x-0 top-6 h-[3px] bg-amber-200/80" aria-hidden="true" /> : null}
                {spine.kind === "notebook" ? <span className="absolute bottom-0 right-2 top-0 w-[3px] bg-black/30" aria-hidden="true" /> : null}
                <span className="min-h-0 flex-1 overflow-hidden py-1 text-[13px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180">{spine.label}</span>
                {spine.kind === "book" ? <span className="absolute inset-x-0 bottom-7 h-[3px] bg-amber-200/80" aria-hidden="true" /> : null}
                <span className="tabular text-[12px] font-semibold">{counts[spine.id]}</span>
              </button>
            );
          })}
        </div>
        <div className="-mx-3 h-3 rounded-b-xl bg-[hsl(var(--room-wood))]" aria-hidden="true" />
      </div>

      {open === null ? (
        <p className="mt-4 text-center text-[13px] text-muted-foreground" data-spine-hint="">Chạm một gáy để xem bên trong</p>
      ) : open === "templates" ? (
        <section className="mt-3 animate-rise-in rounded-2xl border border-border bg-card p-4" data-spine-preview="templates">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[16px] font-semibold">Mẫu bảng · {templateCount} mẫu</h3>
            <span className="text-[12px] text-muted-foreground">dùng gần đây</span>
          </div>
          <ul className="mt-2">
            {templates.slice(0, 3).map((template) => (
              <li key={template.id} className="border-b border-border/60 last:border-b-0">
                <button type="button" onClick={() => onUseTemplate(template)} data-template-quick={template.id} className="press flex min-h-14 w-full items-center gap-3 py-2 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><Table2 className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-foreground">{template.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{template.columns.slice(0, 3).map((column) => column.label).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{(usedCount.get(template.id) ?? 0) > 0 ? `đã dùng ${usedCount.get(template.id)}` : "gợi ý"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">Chạm một mẫu → chọn nơi → bảng mới mở ngay, tự lên bàn.</p>
          <button type="button" onClick={onOpenLibrary} data-open-library-full="" className="press mt-3 h-11 w-full rounded-xl bg-personal text-[14.5px] font-semibold text-personal-foreground">
            Xem cả {templateCount} mẫu ›
          </button>
        </section>
      ) : (
        (() => {
          const preview = previewOf(open as Exclude<(typeof SPINES)[number]["id"], "templates">);
          return (
            <section className="mt-3 animate-rise-in rounded-2xl border border-border bg-card p-4" data-spine-preview={open}>
              <h3 className="text-[16px] font-semibold">
                {preview.title} <span className="font-normal text-muted-foreground">· {preview.count}</span>
              </h3>
              {preview.items.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Chưa có gì ở đây.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {preview.items.slice(0, 5).map((item) => (
                    <li key={item.key} className="flex min-w-0 items-center gap-2">
                      {item.tone !== undefined ? <span className="h-7 w-5 shrink-0 rounded-sm" style={{ backgroundColor: item.tone }} aria-hidden="true" /> : null}
                      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{item.label}</span>
                      {item.sub !== undefined ? <span className="shrink-0 text-[12px] text-muted-foreground">{item.sub}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={preview.primary.onPress} data-spine-primary="" className="press h-11 min-w-0 flex-1 rounded-xl bg-personal px-3 text-[14px] font-semibold text-personal-foreground">
                  {preview.primary.label}
                </button>
                {preview.secondary !== undefined ? (
                  <button type="button" onClick={preview.secondary.onPress} className="press h-11 shrink-0 rounded-xl border border-border px-3 text-[14px]">
                    {preview.secondary.label}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })()
      )}
    </div>
  );
}

// ------------------------------------------------------------------ kệ 2 · Tổng quan (thinking, not doing)

export function ThinkingOverview({
  boards,
  deskIds,
  openQuestions,
  placeOf,
  onOpen,
  onAskQuestions,
  onGo,
  now = new Date(),
}: {
  boards: readonly ThinkTable[];
  deskIds: readonly string[];
  openQuestions: ReadonlyMap<string, OpenQuestion>;
  placeOf: (board: ThinkTable) => string | null;
  onOpen: (id: string) => void;
  onAskQuestions: (ids: string[]) => void;
  onGo: (to: RoomShelf) => void;
  now?: Date;
}) {
  const { openedAt } = useBoardOpened();
  const conclusions = useConclusions();
  const latest = useMemo(() => latestConclusions(conclusions.data ?? []), [conclusions.data]);
  const lastOpen = (board: ThinkTable): string => openedAt.get(board.id) ?? board.createdAt;
  const live = boards.filter((board) => board.archivedAt === null);
  const thinking = live
    .filter((board) => laneOf(board) === "thinking")
    .sort((a, b) => Number(deskIds.includes(b.id)) - Number(deskIds.includes(a.id)) || lastOpen(b).localeCompare(lastOpen(a)));
  const dusty = live
    .filter((board) => laneOf(board) === "waiting" && now.getTime() - new Date(lastOpen(board)).getTime() >= 7 * DAY)
    .sort((a, b) => lastOpen(a).localeCompare(lastOpen(b)));
  const noQuestion = live.filter((board) => (board.purpose ?? "").trim() === "");
  const settled = live
    .filter((board) => laneOf(board) === "concluded")
    .map((board) => ({ board, conclusion: latest.get(board.id) }))
    .filter((item) => item.conclusion !== undefined && now.getTime() - new Date(item.conclusion.createdAt).getTime() <= 7 * DAY)
    .sort((a, b) => (b.conclusion?.createdAt ?? "").localeCompare(a.conclusion?.createdAt ?? ""))[0];

  const gaps = (board: ThinkTable): string[] => {
    const open = openQuestions.get(board.id);
    const out: string[] = [];
    if (open !== undefined && open.emptyCells > 0) out.push(`Còn trống ${open.emptyCells} ô`);
    if (open !== undefined && !open.hasConclusion) out.push("chưa có kết luận");
    const mine = openedAt.get(board.id);
    if (open?.othersChangedAt != null && (mine === undefined || open.othersChangedAt > mine)) out.push(`có người thêm ý ${openedAgo(open.othersChangedAt, now)}`);
    return out;
  };
  const question = (board: ThinkTable, extra: string[], dot: boolean) => (
    <li key={board.id} className="border-b border-border/60 last:border-b-0">
      <button type="button" onClick={() => onOpen(board.id)} data-open-question={board.id} className="press flex w-full items-start gap-2.5 py-2.5 text-left">
        <span className={cn("mt-[7px] h-2 w-2 shrink-0 rounded-full", dot ? "bg-personal" : "border border-muted-foreground/60")} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] italic leading-snug text-foreground">“{boardQuestion(board)}”</span>
          {extra.map((line) => (
            <span key={line} className="block truncate text-[12.5px] text-muted-foreground">{line}</span>
          ))}
        </span>
      </button>
    </li>
  );
  const isEmpty = thinking.length === 0 && dusty.length === 0 && noQuestion.length === 0;
  return (
    <div data-room-shelf="2">
      <h2 className="text-[20px] font-semibold tracking-tight text-foreground">Điều gì còn chưa thông suốt?</h2>
      {isEmpty ? (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-[14px] text-muted-foreground" data-all-clear="">
          Mọi điều đang nghĩ đều đã thông suốt.{" "}
          <button type="button" onClick={() => onGo(6)} className="press font-medium text-personal">Đặt một điều lên bàn ›</button>
        </div>
      ) : null}
      {thinking.length > 0 ? (
        <section className="mt-3 rounded-2xl border border-border bg-card px-4 py-2" data-overview="thinking">
          <h3 className="pt-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Đang nghĩ {thinking.length}</h3>
          <ul>
            {thinking.slice(0, 5).map((board) => {
              const onDesk = deskIds.includes(board.id);
              const head = [onDesk ? "Trên bàn" : (placeOf(board) ?? "Của tôi"), openedAgo(lastOpen(board), now)].filter((part) => part !== "").join(" · ");
              const gap = gaps(board).join(" · ");
              return question(board, gap === "" ? [head] : [head, gap], onDesk);
            })}
          </ul>
          {thinking.length > 5 ? (
            <button type="button" onClick={() => onGo(3)} className="press py-2 text-[13px] font-medium text-personal">và {thinking.length - 5} điều nữa</button>
          ) : null}
        </section>
      ) : null}
      {dusty.length > 0 ? (
        <section className="mt-3 rounded-2xl border border-border bg-card px-4 py-2" data-overview="dusty">
          <h3 className="pt-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Để lâu chưa nghĩ tiếp {dusty.length}</h3>
          <ul>
            {dusty.slice(0, 3).map((board) => {
              const days = Math.floor((now.getTime() - new Date(lastOpen(board)).getTime()) / DAY);
              return question(board, [`Đang chờ · ${days} ngày chưa mở`], false);
            })}
          </ul>
          {dusty.length > 3 ? (
            <button type="button" onClick={() => onGo(3)} className="press py-2 text-[13px] font-medium text-personal">và {dusty.length - 3} điều nữa</button>
          ) : null}
        </section>
      ) : null}
      {noQuestion.length > 0 ? (
        <section className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3" data-overview="no-question">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-foreground">{noQuestion.length} bảng chưa có câu hỏi</span>
            <span className="block text-[12.5px] text-muted-foreground">Một câu hỏi rõ giúp nghĩ rõ</span>
          </span>
          <button type="button" onClick={() => onAskQuestions(noQuestion.map((board) => board.id))} className="press h-10 shrink-0 rounded-lg border border-border px-3 text-[13.5px] font-medium text-personal">
            Đặt câu hỏi
          </button>
        </section>
      ) : null}
      {settled !== undefined ? (
        <button type="button" onClick={() => onOpen(settled.board.id)} data-overview="settled" className="press mt-3 block w-full text-left text-[13.5px] leading-snug text-muted-foreground">
          <b className="font-semibold text-foreground">Vừa thông suốt:</b> “{boardQuestion(settled.board)}” → <i>{settled.conclusion?.body}</i> · {openedAgo(settled.conclusion?.createdAt ?? null, now)}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ kệ 3 · Tiến trình (place × progress)

export function ProgressMatrix({
  boards,
  placeKind,
  placeOf,
  archivedCount,
  binCount,
  onOpen,
  onOpenArchive,
  onOpenTrash,
}: {
  boards: readonly ThinkTable[];
  placeKind: (board: ThinkTable) => PlaceKind;
  placeOf: (board: ThinkTable) => string | null;
  archivedCount: number;
  binCount: number;
  onOpen: (id: string) => void;
  onOpenArchive: () => void;
  onOpenTrash: () => void;
}) {
  const { user } = useAuth();
  const change = useLifecycleChange();
  const { openedAt } = useBoardOpened();
  const live = boards.filter((board) => board.archivedAt === null);
  const cellOf = (row: PlaceKind, lane: Lane) => live.filter((board) => placeKind(board) === row && laneOf(board) === lane);
  const latestOpen = [...live].sort((a, b) => (openedAt.get(b.id) ?? b.updatedAt).localeCompare(openedAt.get(a.id) ?? a.updatedAt))[0];
  const [pick, setPick] = useState<{ row: PlaceKind | null; lane: Lane | null } | null>(null);
  const chosen = pick ?? (latestOpen === undefined ? { row: null, lane: null } : { row: placeKind(latestOpen), lane: laneOf(latestOpen) });
  const picked = live.filter((board) => (chosen.row === null || placeKind(board) === chosen.row) && (chosen.lane === null || laneOf(board) === chosen.lane));
  const label = [chosen.row === null ? null : PLACE_ROWS.find((r) => r.id === chosen.row)?.label, chosen.lane === null ? null : lifecycleLabel(chosen.lane)].filter(Boolean).join(" · ");
  const [over, setOver] = useState<string | null>(null);

  const mark = (board: ThinkTable, lane: Lifecycle): void => {
    if (laneOf(board) === lane) return;
    if (!canEditHead(board, user?.id, false)) {
      toast.error("Bảng này đang Chỉ xem — chỉ chủ Bảng đổi được.");
      return;
    }
    void change(board, lane);
  };
  const card = (board: ThinkTable, compact: boolean) => {
    const editable = canEditHead(board, user?.id, false);
    const last = openedAt.get(board.id) ?? board.updatedAt;
    const sub = [typeLabel(board), placeOf(board) ?? "Của tôi", openedAgo(last)].filter((part) => part !== null && part !== "").join(" · ");
    return (
      <li
        key={board.id}
        draggable={editable && !compact}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/avora-board", board.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        data-matrix-card={board.id}
        className={cn("flex items-start rounded-lg border border-border bg-card", isDusty(last) && "opacity-50")}
      >
        <button type="button" onClick={() => onOpen(board.id)} className="press min-w-0 flex-1 px-3 py-2 text-left">
          <span className="block truncate text-[14px] font-medium text-foreground">{boardQuestion(board)}</span>
          {!sameWords(board.name, boardQuestion(board)) && board.purpose !== null ? <span className="block truncate text-[12px] text-muted-foreground">{board.name}</span> : null}
          <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>
        </button>
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Đánh dấu “${board.name}”`} className="press m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LIFECYCLES.filter((item) => item.id !== laneOf(board)).map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => mark(board, item.id)}>
                  Đánh dấu {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>
    );
  };
  const drop = (event: DragEvent<HTMLElement>, lane: Lane): void => {
    event.preventDefault();
    setOver(null);
    const board = live.find((item) => item.id === event.dataTransfer.getData("text/avora-board"));
    if (board !== undefined) mark(board, lane);
  };

  return (
    <div data-room-shelf="3">
      {/* Phone: counts grid; tap a cell / row / column, the boards show below. */}
      <div className="md:hidden">
        <div className="grid grid-cols-[56px_repeat(3,minmax(0,1fr))] gap-1.5" data-matrix-grid="">
          <span />
          {LIFECYCLES.map((lane) => (
            <button key={lane.id} type="button" onClick={() => setPick({ row: null, lane: lane.id })} className="press h-8 text-center text-[12px] font-medium text-muted-foreground">
              {lane.label.replace("Đang suy nghĩ", "Đang nghĩ")}
            </button>
          ))}
          {PLACE_ROWS.map((row) => (
            <div key={row.id} className="contents">
              <button type="button" onClick={() => setPick({ row: row.id, lane: null })} className="press flex h-12 items-center text-left text-[12.5px] font-semibold text-foreground">
                {row.label}
              </button>
              {LANES.map((lane) => {
                const n = cellOf(row.id, lane).length;
                const isOn = chosen.row === row.id && chosen.lane === lane;
                return (
                  <button
                    key={lane}
                    type="button"
                    onClick={() => setPick({ row: row.id, lane })}
                    data-matrix-cell={`${row.id}:${lane}`}
                    aria-pressed={isOn}
                    className={cn("press flex h-12 items-center justify-center rounded-lg text-[17px] tabular", isOn ? "bg-personal font-semibold text-personal-foreground" : n === 0 ? "border border-dashed border-border text-muted-foreground/50" : "border border-border bg-card text-foreground")}
                  >
                    {n === 0 ? "·" : n}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Chạm một ô để xem bảng trong ô đó · chạm tên hàng / cột để xem cả hàng / cột</p>
        <section className="mt-3" data-matrix-picked="">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label === "" ? "Tất cả" : label} {picked.length}</h3>
          <ul className="mt-2 space-y-2">{picked.map((board) => card(board, true))}</ul>
          {picked.length === 0 ? <p className="mt-2 text-[13px] text-muted-foreground">Ô này chưa có bảng nào.</p> : null}
        </section>
      </div>

      {/* Computer: the whole matrix; each cell a lane; drag a card to another column. */}
      <div className="hidden md:block" data-matrix-full="">
        <div className="grid grid-cols-[96px_repeat(3,minmax(0,1fr))] gap-2">
          <span />
          {LIFECYCLES.map((lane) => (
            <h3 key={lane.id} className="px-1 text-[12.5px] font-semibold text-muted-foreground">
              {lane.label} · {live.filter((board) => laneOf(board) === lane.id).length}
            </h3>
          ))}
          {PLACE_ROWS.map((row) => (
            <div key={row.id} className="contents">
              <span className="pt-2 text-[13px] font-semibold text-foreground">{row.label}</span>
              {LANES.map((lane) => {
                const list = cellOf(row.id, lane);
                const key = `${row.id}:${lane}`;
                return (
                  <ul
                    key={lane}
                    data-cell={key}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (over !== key) setOver(key);
                    }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(event) => drop(event, lane)}
                    className={cn("min-h-[44px] space-y-1.5 rounded-xl border p-1.5", over === key ? "border-personal bg-personal-soft/40" : list.length === 0 ? "border-dashed border-border/70" : "border-border bg-secondary/40")}
                  >
                    {list.map((board) => card(board, false))}
                  </ul>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2" data-matrix-store="">
        <button type="button" onClick={onOpenArchive} className="press flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14px]">
          <Archive className="h-4 w-4" aria-hidden="true" /> Lưu trữ {archivedCount}
        </button>
        <button type="button" onClick={onOpenTrash} className="press flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14px]">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Thùng rác {binCount}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ kệ 6 · Bàn làm việc

export function WorkDesk({
  boards,
  placeOf,
  countOf,
  onOpen,
  onCreate,
  onFull,
  onGo,
}: {
  boards: readonly ThinkTable[];
  placeOf: (board: ThinkTable) => string | null;
  countOf: (id: string) => number;
  onOpen: (id: string) => void;
  onCreate: (question: string) => Promise<ThinkTable | null>;
  onFull: (id: string) => void;
  onGo: (to: RoomShelf) => void;
}) {
  const desk = useDesk();
  const change = useLifecycleChange();
  const { user } = useAuth();
  const [text, setText] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const byId = useMemo(() => new Map(boards.map((board) => [board.id, board] as const)), [boards]);
  const onDesk = desk.ids.map((id) => byId.get(id)).filter((board): board is ThinkTable => board !== undefined);
  const submit = async (): Promise<void> => {
    const question = text.trim();
    if (question === "" || isSaving) return;
    setIsSaving(true);
    try {
      const created = await onCreate(question);
      if (created === null) return;
      setText("");
      try {
        await desk.place.mutateAsync(created.id);
      } catch (caught) {
        if (caught instanceof DeskFullError) onFull(created.id);
      }
    } finally {
      setIsSaving(false);
    }
  };
  const slots = Math.max(0, DESK_LIMIT - onDesk.length);
  return (
    <div data-room-shelf="6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Trên bàn <span className="tabular" data-desk-count="">{onDesk.length}/{DESK_LIMIT}</span>
        </h2>
        <button type="button" onClick={() => onGo(3)} className="press text-[13px] font-medium text-personal">Lấy từ kệ 3</button>
      </div>
      <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[repeat(2,minmax(0,1fr))]" data-desk-cards="">
        {onDesk.map((board) => (
          <li key={board.id} className="flex items-start rounded-2xl border border-border bg-card shadow-sm" data-desk-card={board.id}>
            <button type="button" onClick={() => onOpen(board.id)} className="press min-w-0 flex-1 px-4 py-3 text-left">
              <span className="block text-[17px] font-semibold leading-snug text-foreground">{boardQuestion(board)}</span>
              <span className="mt-1 block truncate text-[12.5px] text-muted-foreground">{[typeLabel(board), placeOf(board) ?? "Của tôi", lifecycleLabel(board.lifecycle)].filter(Boolean).join(" · ")}</span>
              <span className="mt-1 block truncate text-[13px] text-foreground/80">{countOf(board.id)} hạng mục · {openedAgo(board.updatedAt).replace(/^/, "sửa ")}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Thêm cho “${board.name}”`} className="press m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void desk.remove.mutateAsync(board.id).then(() => toast.success("Đã đặt xuống — về kệ 3."))}>Đặt xuống</DropdownMenuItem>
                {canEditHead(board, user?.id, false)
                  ? LIFECYCLES.filter((item) => item.id !== laneOf(board)).map((item) => (
                      <DropdownMenuItem key={item.id} onSelect={() => void change(board, item.id)}>
                        Đánh dấu {item.label}
                      </DropdownMenuItem>
                    ))
                  : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {Array.from({ length: slots }, (_, index) => (
          <li key={`slot-${index}`} data-desk-slot="" className="flex h-14 items-center justify-center rounded-2xl border border-dashed border-border text-[13px] text-muted-foreground/70">
            Chỗ trống
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="Điều gì đang ở trong đầu bạn?"
          aria-label="Điều gì đang ở trong đầu bạn?"
          data-desk-input=""
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]"
        />
        <button type="submit" disabled={text.trim() === "" || isSaving} className="press inline-flex h-11 shrink-0 items-center gap-1 rounded-xl bg-personal px-3.5 text-[14px] font-semibold text-personal-foreground disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" /> Đặt lên bàn
        </button>
      </form>
    </div>
  );
}

/** Wraps one shelf with the slide (220 ms along the way travelled) or a fade when motion is reduced. */
export function RoomStage({ shelf, dir, children }: { shelf: RoomShelf; dir: "left" | "right" | "up" | "down" | null; children: ReactNode }) {
  return (
    <div key={shelf} data-room-stage={shelf} className={cn(dir === null ? "" : `room-in-${dir}`)}>
      {children}
    </div>
  );
}
