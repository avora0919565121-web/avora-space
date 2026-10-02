import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, MessageCircle, Pencil, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { conversationTitle } from "@/lib/chat";
import type { ConversationSummary } from "@/lib/chat-cache";
import { moveThinkTable, thinkHubKeys, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { matchesPersonSearch } from "@/lib/user-aliases";
import { cn } from "@/lib/utils";

/** How many rows, sub-tables and tasks travel with a board — for the preview line. */
export function boardMoveCounts(
  tables: readonly ThinkTable[],
  records: readonly ThinkRecord[],
  taskCountByRecord: ReadonlyMap<string, number>,
  rootId: string,
): { rows: number; subTables: number; tasks: number } {
  const tree = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const table of tables) {
      if (tree.has(table.id) || table.parentRecordId === null || table.deletedAt !== null) continue;
      const parent = records.find((record) => record.id === table.parentRecordId);
      if (parent !== undefined && tree.has(parent.tableId)) {
        tree.add(table.id);
        grew = true;
      }
    }
  }
  const rows = records.filter((record) => record.tableId === rootId).length;
  const tasks = records.filter((record) => tree.has(record.tableId)).reduce((sum, record) => sum + (taskCountByRecord.get(record.id) ?? 0), 0);
  return { rows, subTables: tree.size - 1, tasks };
}

type Place = { id: string | null; title: string; kind: "mine" | "direct" | "group"; at: string | null };

/**
 * `Di chuyển Bảng…` (AVORA-69, ADR-043): one place for a board. Pick where — Bảng của tôi, a 1-1 with
 * a friend, a Nhóm or a Dự án room (recent first, search without accents) — then Cùng sửa / Chỉ xem,
 * read what goes with it, and move. When others have already filled it in, it becomes a proposal.
 */
export function MoveBoardDialog({
  open,
  onOpenChange,
  table,
  conversations,
  counts,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: ThinkTable;
  conversations: readonly ConversationSummary[];
  counts: { rows: number; subTables: number; tasks: number };
  onMoved: (status: "moved" | "proposed" | "mode_changed") => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<string>("");
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<"edit" | "view">(table.shareMode ?? "edit");

  const places: Place[] = useMemo(() => {
    const rooms = conversations
      .filter((item) => (item.kind === "group" || (item.kind === "direct" && item.verification == null && item.isConnected !== false)) && item.conversationId !== table.conversationId)
      .map((item): Place => ({ id: item.conversationId, title: conversationTitle(item), kind: item.kind === "group" ? "group" : "direct", at: item.lastMessageAt }))
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const mine: Place[] = table.conversationId === null ? [] : [{ id: null, title: "Bảng của tôi", kind: "mine", at: null }];
    return [...mine, ...rooms];
  }, [conversations, table.conversationId]);
  const shown = places.filter((place) => matchesPersonSearch(query, [place.title]));
  const chosen = target === undefined ? undefined : places.find((place) => place.id === target);

  const move = useMutation({
    mutationFn: () => moveThinkTable({ tableId: table.id, conversationId: target ?? null, mode }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
      onMoved(result.status);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const placeName = chosen === undefined ? "" : chosen.kind === "mine" ? "Bảng của tôi" : chosen.title;
  const needsAgreement = table.conversationId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,720px)] flex-col gap-0 p-0 sm:max-w-lg">
        <div className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-[18px] font-semibold">Di chuyển Bảng “{table.name}”</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">Một Bảng ở một nơi. Chọn nơi mới cho cả Bảng.</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">1 · Chọn nơi</p>
          <label className="mt-2 flex items-center gap-2 rounded-md border border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm 1-1, Nhóm, Dự án"
              aria-label="Tìm nơi"
              className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]"
            />
          </label>
          <ul className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-border" role="radiogroup" aria-label="Nơi nhận">
            {shown.map((place) => (
              <li key={place.id ?? "mine"} className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === place.id}
                  onClick={() => setTarget(place.id)}
                  className={cn("press flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-[14px]", target === place.id ? "bg-primary/10" : "hover:bg-accent/40")}
                >
                  {place.kind === "group" ? <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : place.kind === "direct" ? <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate">{place.title}</span>
                  <span className="text-[12px] text-muted-foreground">{place.kind === "group" ? "Nhóm" : place.kind === "direct" ? "1-1" : "Riêng"}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-3 py-4 text-[13.5px] text-muted-foreground">Không thấy nơi nào khớp.</li> : null}
          </ul>
          <p className="mt-1.5 text-[12px] text-muted-foreground">1-1 chỉ với bạn bè.</p>

          {chosen !== undefined && chosen.kind !== "mine" ? (
            <>
              <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">2 · Quyền</p>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quyền trong Bảng">
                {(
                  [
                    ["edit", "Cùng sửa", "Mọi người thêm, sửa. Xoá là đề nghị.", Pencil],
                    ["view", "Chỉ xem", "Mọi người xem; chỉ bạn sửa.", Lock],
                  ] as const
                ).map(([value, label, hint, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={cn("press rounded-lg border px-3 py-2.5 text-left", mode === value ? "border-primary bg-primary/10" : "border-border")}
                  >
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                      <Icon className="h-4 w-4" aria-hidden="true" /> {label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {chosen !== undefined ? (
            <p data-move-preview="" className="mt-4 rounded-lg bg-secondary/60 px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground">
              Bảng có {counts.rows} Hạng mục, {counts.subTables} bảng con, {counts.tasks} việc đã tạo. Tất cả đi theo Bảng.
              {chosen.kind === "mine" ? " Bảng về lại chỉ mình bạn thấy." : ` Mọi người trong ${placeName} sẽ thấy toàn bộ.`}
              {" "}Dấu ★ và lời nhắc vẫn là của từng người.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className="press min-h-11 rounded-md px-4 text-[14px] text-muted-foreground">
            Huỷ
          </button>
          <button
            type="button"
            disabled={chosen === undefined || move.isPending}
            onClick={() => move.mutate()}
            data-move-board=""
            className="press min-h-11 rounded-md bg-primary px-4 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {move.isPending ? "Đang chuyển…" : needsAgreement ? "Di chuyển (cần đồng ý nếu người khác đã góp)" : "Di chuyển"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
