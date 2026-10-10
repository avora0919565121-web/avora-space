import { Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { undoCleanup, useCleanupApply, useCleanupSuggestions, type CleanupKind, type CleanupSuggestion } from "@/lib/cleanup";
import { cn } from "@/lib/utils";

/**
 * AVORA-100 · V·3.3 (ADR-063) — `Dọn kệ tuần này` on kệ 3. Only when there is something to suggest,
 * at most once a week (`prefs.cleanup_seen_week`), unless asked for from Cài đặt › Dung lượng.
 * Avora only suggests: nothing moves until the person ticks and taps. Empty boards start unticked.
 */
const LINES: Record<CleanupKind, { title: (n: number) => string; note: string; isDefault: boolean }> = {
  dusty_board: { title: (n) => `Cất ${n} bảng lâu không mở vào Lưu trữ`, note: "không mở hơn 90 ngày", isDefault: true },
  done_records: { title: (n) => `Cất ${n} mục đã xong hơn 90 ngày`, note: "vẫn tìm thấy, chỉ ẩn khỏi bảng", isDefault: true },
  empty_board: { title: (n) => `Bỏ ${n} bảng trống vào Thùng rác`, note: "chưa có mục nào", isDefault: false },
};

export function CleanupCard({ onLater }: { onLater: () => void }) {
  const suggestions = useCleanupSuggestions();
  const apply = useCleanupApply();
  const groups = useMemo(() => {
    const by = new Map<CleanupKind, CleanupSuggestion[]>();
    for (const item of suggestions.data ?? []) by.set(item.kind, [...(by.get(item.kind) ?? []), item]);
    return (["dusty_board", "done_records", "empty_board"] as const).flatMap((kind) => {
      const items = by.get(kind) ?? [];
      return items.length === 0 ? [] : [{ kind, items }];
    });
  }, [suggestions.data]);
  const [unticked, setUnticked] = useState<Set<CleanupKind>>(() => new Set(["empty_board"]));
  const isOn = (kind: CleanupKind): boolean => !unticked.has(kind);
  const chosen = groups.filter((group) => isOn(group.kind));
  const chosenCount = chosen.length;

  if (suggestions.isPending || groups.length === 0) return null;

  const run = (): void => {
    const items = chosen.flatMap((group) => group.items.map((item) => ({ kind: item.kind, tableId: item.tableId })));
    apply.mutate(items, {
      onSuccess: (result) => {
        toast.success("Đã dọn", {
          duration: 10_000,
          action: { label: "Hoàn tác", onClick: () => void undoCleanup(result).then(() => toast.success("Đã đặt lại như cũ."), () => toast.error("Chưa hoàn tác được.")) },
        });
        onLater();
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <section aria-labelledby="cleanup-card-title" data-cleanup-card="" className="mb-4 rounded-card border border-border bg-card p-4 shadow-sm">
      <h2 id="cleanup-card-title" className="text-[17px] font-semibold tracking-tight text-foreground">Dọn kệ tuần này</h2>
      <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Avora chỉ gợi ý. Không gì bị xoá nếu bạn không chọn.</p>
      <ul className="mt-3">
        {groups.map((group) => {
          const line = LINES[group.kind];
          const count = group.kind === "done_records" ? group.items.reduce((sum, item) => sum + item.itemCount, 0) : group.items.length;
          const names = group.items.slice(0, 2).map((item) => item.tableName).join(" · ");
          const on = isOn(group.kind);
          return (
            <li key={group.kind} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                data-cleanup-kind={group.kind}
                onClick={() => setUnticked((current) => {
                  const next = new Set(current);
                  if (next.has(group.kind)) next.delete(group.kind);
                  else next.add(group.kind);
                  return next;
                })}
                className="press flex w-full items-start gap-3 py-2.5 text-left"
              >
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border", on ? "border-personal bg-personal text-personal-foreground" : "border-border bg-background")}>
                  {on ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-foreground">{line.title(count)}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">
                    {group.kind === "done_records" ? `Trong ${group.items.length} bảng · ${line.note}` : `${names}${group.items.length > 2 ? "…" : ""} — ${line.note}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onLater} className="press h-11 rounded-control border border-border px-4 text-[14px]">Để tuần sau</button>
        <button
          type="button"
          disabled={chosenCount === 0 || apply.isPending}
          onClick={run}
          data-cleanup-run=""
          className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-control bg-personal px-4 text-[14px] font-semibold text-personal-foreground disabled:opacity-50"
        >
          {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Dọn {chosenCount} việc đã chọn
        </button>
      </div>
    </section>
  );
}
