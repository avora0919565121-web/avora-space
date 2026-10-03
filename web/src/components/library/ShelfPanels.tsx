import { ArrowRightLeft, ChevronRight, Lock, NotebookText, Plus, Trash2, Archive, HelpCircle } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DIARY_HINTS, DIARY_ICONS } from "@/components/chat/DiaryViews";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { findJournal } from "@/hooks/use-paste-task";
import { useAuth } from "@/lib/auth";
import { canEditHead, editedAgo, latestConclusions, lifecycleLabel, LIFECYCLES, type Lifecycle } from "@/lib/board-head";
import { ensureJournalConversation } from "@/lib/chat";
import { DIARY_VIEW_PARAM, DIARY_VIEWS, diaryViewSlug, type DiaryView } from "@/lib/diary-views";
import { byLifecycle, PLACE_FILTERS, placeKindOf, type PlaceFilter } from "@/lib/library";
import { hereFrom, withReturn } from "@/lib/return-to";
import type { ThinkTable } from "@/lib/think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useNotes } from "@/lib/use-notes";
import { useVaultUnlocked } from "@/lib/use-vault-lock";
import { cn } from "@/lib/utils";
import { useConclusions, useLifecycleChange } from "@/components/library/BoardHead";

const rowClass = "press flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/25";

// ------------------------------------------------------------------ kệ 01

/**
 * Kệ 01 · Bảng Avora mặc định — three columns `Kết nối · Nhiệm vụ · Két sắt` (ADR-045). While Két
 * sắt is locked its column says so and names nothing (ADR-034).
 */
export function DefaultShelf({ boards, countOf, activeId, onOpen }: { boards: readonly ThinkTable[]; countOf: (tableId: string) => number; activeId: string | null; onOpen: (id: string) => void }) {
  const isVaultOpen = useVaultUnlocked();
  const navigate = useNavigate();
  const zones: { id: "ket-noi" | "nhiem-vu" | "ket-sat"; label: string; boards: readonly ThinkTable[] }[] = [
    { id: "ket-noi", label: "Kết nối", boards: boards.filter((b) => b.syncSource === "contact_opportunities") },
    { id: "nhiem-vu", label: "Nhiệm vụ", boards: [] },
    { id: "ket-sat", label: "Két sắt", boards: [] },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3" data-shelf-panel="mac-dinh">
      {zones.map((zone) => (
        <section key={zone.id} aria-label={zone.label} className="rounded-xl border border-border bg-card">
          <h3 className="border-b border-border/70 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{zone.label}</h3>
          {zone.id === "ket-sat" && !isVaultOpen ? (
            <button type="button" onClick={() => navigate("/ket-sat")} data-vault-locked="" className={cn(rowClass, "text-muted-foreground")}>
              <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[13.5px]">Đang khoá · Mở Két sắt để xem</span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          ) : zone.boards.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">Chưa có bảng nào ở đây.</p>
          ) : (
            <ul>
              {zone.boards.map((board) => (
                <li key={board.id} className="border-b border-border/50 last:border-b-0">
                  <button type="button" onClick={() => onOpen(board.id)} data-default-board={board.id} className={cn(rowClass, activeId === board.id && "bg-accent/40")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-foreground">{board.name}</span>
                      {board.purpose !== null ? <span className="block truncate text-[12.5px] text-muted-foreground">{board.purpose}</span> : null}
                    </span>
                    <span className="tabular shrink-0 text-[12.5px] text-muted-foreground">{countOf(board.id)} dòng</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ kệ 02

/** Kệ 02 · Bảng tôi hoạch định — every board a person plans with, one line each. */
export function PlannedShelf({
  boards,
  kindOf,
  placeOf,
  countOf,
  activeId,
  onOpen,
  onAskQuestion,
  onNewBoard,
}: {
  boards: readonly ThinkTable[];
  kindOf: (conversationId: string) => string | undefined;
  placeOf: (table: ThinkTable) => string | null;
  countOf: (tableId: string) => number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onAskQuestion: (id: string) => void;
  onNewBoard: () => void;
}) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<PlaceFilter>("all");
  const live = useMemo(() => boards.filter((b) => b.archivedAt === null), [boards]);
  const counts = useMemo(() => {
    const out: Record<PlaceFilter, number> = { all: live.length, personal: 0, direct: 0, group: 0, project: 0 };
    for (const board of live) out[placeKindOf(board, kindOf)] += 1;
    return out;
  }, [live, kindOf]);
  const shown = filter === "all" ? live : live.filter((board) => placeKindOf(board, kindOf) === filter);
  return (
    <div data-shelf-panel="hoach-dinh">
      <div role="tablist" aria-label="Lọc theo nơi" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:px-0">
        {PLACE_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "press h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium",
              filter === item.id ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-card text-foreground",
            )}
          >
            {item.label} <span className="tabular text-[12px] opacity-70">{counts[item.id]}</span>
          </button>
        ))}
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {shown.map((board) => {
          const place = placeOf(board);
          const isMine = board.ownerUserId === user?.id && !(board.projectId !== null && board.parentRecordId === null);
          return (
            <li key={board.id} className="border-b border-border/60 last:border-b-0">
              <div className={cn("flex items-stretch", activeId === board.id && "bg-accent/40")}>
                <button type="button" onClick={() => onOpen(board.id)} data-board-row={board.id} className="press flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left hover:bg-accent/25">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">{board.name}</span>
                    {board.lifecycle !== undefined && board.lifecycle !== "waiting" ? (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", board.lifecycle === "thinking" ? "bg-personal-soft text-personal-soft-foreground" : "bg-secondary text-muted-foreground")}>
                        {lifecycleLabel(board.lifecycle)}
                      </span>
                    ) : null}
                  </span>
                  {board.purpose !== null ? <span className="truncate text-[13px] italic text-muted-foreground">{board.purpose}</span> : null}
                  <span className="truncate text-[12px] text-muted-foreground/80">
                    {[place ?? "Của tôi", `${countOf(board.id)} Hạng mục`].join(" · ")}
                  </span>
                </button>
                {board.purpose === null && isMine ? (
                  <button type="button" onClick={() => onAskQuestion(board.id)} className="press shrink-0 self-center px-3 text-[12.5px] font-medium text-personal">
                    + Ghi câu hỏi của Bảng
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-4 py-4 text-[13.5px] text-muted-foreground">Chưa có bảng nào ở đây.</li> : null}
        <li className="border-t border-border/60">
          <button type="button" onClick={onNewBoard} className="press flex w-full items-center gap-1.5 px-4 py-3 text-left text-[13.5px] font-medium text-personal">
            <Plus className="h-4 w-4" aria-hidden="true" /> Bảng mới
          </button>
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ kệ 03

const DRAG_TYPE = "application/x-avora-board";

/**
 * Kệ 03 · Theo trạng thái — the very boards of kệ 02, stood up by how far the thinking has gone.
 * Dragging a card (or `Chuyển sang` on a phone) marks it; the server checks the right to.
 */
export function LifecycleShelf({ boards, placeOf, onOpen }: { boards: readonly ThinkTable[]; placeOf: (table: ThinkTable) => string | null; onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const conclusions = useConclusions();
  const change = useLifecycleChange();
  const latest = useMemo(() => latestConclusions(conclusions.data ?? []), [conclusions.data]);
  const lanes = useMemo(() => byLifecycle(boards), [boards]);
  const [over, setOver] = useState<Lifecycle | null>(null);
  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b] as const)), [boards]);

  const move = (board: ThinkTable, lane: Lifecycle): void => {
    if (board.lifecycle === lane) return;
    if (!canEditHead(board, user?.id, false)) {
      toast.error("Bảng này đang Chỉ xem — chỉ chủ Bảng đổi được.");
      return;
    }
    void change(board, lane);
  };
  const drop = (event: DragEvent<HTMLElement>, lane: Lifecycle): void => {
    event.preventDefault();
    setOver(null);
    const board = byId.get(event.dataTransfer.getData(DRAG_TYPE));
    if (board !== undefined) move(board, lane);
  };

  return (
    <div className="grid gap-3 md:grid-cols-3" data-shelf-panel="trang-thai">
      {LIFECYCLES.map((lane) => (
        <section
          key={lane.id}
          aria-label={lane.label}
          data-lane={lane.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (over !== lane.id) setOver(lane.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(event) => drop(event, lane.id)}
          className={cn("min-h-[140px] rounded-xl border bg-secondary/40 p-2 transition-colors", over === lane.id ? "border-personal bg-personal-soft/50" : "border-border")}
        >
          <h3 className="flex items-center justify-between px-2 pb-2 pt-1 text-[12.5px] font-semibold text-foreground">
            {lane.label}
            <span className="tabular text-muted-foreground">{lanes[lane.id].length}</span>
          </h3>
          <ul className="space-y-2">
            {lanes[lane.id].map((board) => {
              const line = latest.get(board.id);
              const editable = canEditHead(board, user?.id, false);
              return (
                <li
                  key={board.id}
                  draggable={editable}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, board.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  data-lane-card={board.id}
                  className={cn("rounded-lg border border-border bg-card shadow-sm", editable && "cursor-grab active:cursor-grabbing")}
                >
                  <div className="flex items-start">
                    <button type="button" onClick={() => onOpen(board.id)} className="press min-w-0 flex-1 px-3 py-2.5 text-left">
                      <span className="block truncate text-[14px] font-semibold text-foreground">{board.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{placeOf(board) ?? "Của tôi"}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground/90">{line !== undefined ? `Kết luận: ${line.body}` : editedAgo(board.updatedAt)}</span>
                    </button>
                    {editable ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" aria-label={`Chuyển "${board.name}" sang trạng thái khác`} className="press m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40">
                            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {LIFECYCLES.filter((item) => item.id !== lane.id).map((item) => (
                            <DropdownMenuItem key={item.id} onSelect={() => move(board, item.id)}>
                              Chuyển sang {item.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ kệ 05

/** Kệ 05 · Nhật ký — only a door: the five readings of Nhật ký, each opened with `‹ Kế hoạch` to come back. */
export function DiaryShelf() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: conversations } = useConversations();
  const notes = useNotes();
  const open = async (view: DiaryView | null): Promise<void> => {
    try {
      const journalId = findJournal(conversations)?.conversationId ?? (await ensureJournalConversation());
      const path = view === null ? `/tin-nhan/${journalId}` : `/tin-nhan/${journalId}?${DIARY_VIEW_PARAM}=${diaryViewSlug(view)}`;
      navigate(withReturn(path, hereFrom(location, "Kế hoạch")));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa mở được Nhật ký.");
    }
  };
  const countOf = (view: DiaryView): number | null => (view === "notes" && notes.notes.data !== undefined ? notes.liveNotes.length : null);
  return (
    <div data-shelf-panel="nhat-ky">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {DIARY_VIEWS.map((view) => {
          const Icon = DIARY_ICONS[view.id];
          const count = countOf(view.id);
          return (
            <button key={view.id} type="button" onClick={() => void open(view.id)} data-diary-door={view.id} className="press flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-accent/25">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[14.5px] font-semibold text-foreground">{view.label}</span>
                  {count !== null ? <span className="tabular text-[12.5px] text-muted-foreground">{count}</span> : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{DIARY_HINTS[view.id]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => void open(null)} className="press mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-personal px-5 text-[14px] font-semibold text-personal-foreground">
        <NotebookText className="h-4 w-4" aria-hidden="true" /> Mở Nhật ký ›
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ kệ 06

/** Kệ 06 · Khác — boards without a question, archived boards, the bin. (`Ý chưa xếp` waits for K2.) */
export function OtherShelf({
  noQuestion,
  archived,
  binCount,
  onOpen,
  onOpenTrash,
}: {
  noQuestion: readonly ThinkTable[];
  archived: readonly ThinkTable[];
  binCount: number;
  onOpen: (id: string) => void;
  onOpenTrash: () => void;
}) {
  const [open, setOpen] = useState<"question" | "archived" | null>(null);
  const nothing = noQuestion.length === 0 && archived.length === 0 && binCount === 0;
  const group = (id: "question" | "archived", label: string, Icon: typeof HelpCircle, list: readonly ThinkTable[]) => (
    <li className="border-b border-border/60 last:border-b-0">
      <button type="button" aria-expanded={open === id} disabled={list.length === 0} onClick={() => setOpen(open === id ? null : id)} className={cn(rowClass, "disabled:opacity-50")}>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14.5px] font-medium text-foreground">{label}</span>
        <span className="tabular text-[13px] text-muted-foreground">{list.length}</span>
      </button>
      {open === id ? (
        <ul className="border-t border-border/50 bg-secondary/30">
          {list.map((board) => (
            <li key={board.id}>
              <button type="button" onClick={() => onOpen(board.id)} className="press flex w-full items-center gap-2 px-11 py-2.5 text-left text-[14px] text-foreground hover:bg-accent/25">
                <span className="min-w-0 flex-1 truncate">{board.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
  return (
    <div data-shelf-panel="khac">
      {nothing ? <p className="mb-2 text-[13.5px] text-muted-foreground" data-nothing-to-file="">Không có gì cần xếp.</p> : null}
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {group("question", "Bảng chưa có câu hỏi", HelpCircle, noQuestion)}
        {group("archived", "Đã lưu trữ", Archive, archived)}
        <li>
          <button type="button" onClick={onOpenTrash} className={rowClass}>
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[14.5px] font-medium text-foreground">Thùng rác</span>
            <span className="tabular text-[13px] text-muted-foreground">{binCount}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
