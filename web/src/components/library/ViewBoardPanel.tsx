import { ChevronRight, EyeOff, ListPlus, Lock, Maximize2, Minimize2, MoreHorizontal, NotebookPen, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { askText } from "@/components/ConfirmHost";
import { Money } from "@/components/finance/primitives";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { vnDate, isVaultViewBoard, viewBoardOf, type ViewBoardKey, type ViewRow } from "@/lib/avora-default-boards";
import { normalizeSearch } from "@/lib/normalize-search";
import { hereFrom, withReturn } from "@/lib/return-to";
import { useHiddenBoards, useRowMeta } from "@/lib/use-default-boards";
import { useComposerActions } from "@/lib/use-task-composer";
import { useViewBoardRows } from "@/lib/use-view-board-rows";
import { cn } from "@/lib/utils";

/**
 * AVORA-81 · PHẦN 1 (ADR-049) — one frame for every Bảng xem: goal (not editable), `Bảng Avora mặc
 * định · đồng bộ từ {nguồn}`, views, search, rows. Per row: ★, one private note, Tạo việc; tapping a
 * row opens the real place. No column, sub-board, rename, delete, archive or move — ⋯ only hides.
 */
export function ViewBoardPanel({ boardKey, isFullscreen, onFullscreen, onClose }: { boardKey: ViewBoardKey; isFullscreen: boolean; onFullscreen: (on: boolean) => void; onClose: () => void }) {
  const def = viewBoardOf(boardKey);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { createPersonal } = useComposerActions();
  const [view, setView] = useState<string>("table");
  const [query, setQuery] = useState<string>("");
  const [paymentMonth, setPaymentMonth] = useState<"this" | "next">("this");
  const [taskFrom, setTaskFrom] = useState<ViewRow | null>(null);
  const { boards, byMonth, byPerson, currency, assetsValued } = useViewBoardRows({ paymentMonth });
  const { meta, save } = useRowMeta(boardKey);
  const { hide } = useHiddenBoards();
  const board = boards[boardKey];
  const isVault = isVaultViewBoard(boardKey);

  const rows = useMemo(() => {
    const needle = normalizeSearch(query);
    const list = needle === "" ? board.rows : board.rows.filter((row) => normalizeSearch(Object.values(row.cells).join(" ")).includes(needle));
    // ★ first, then the source order.
    return [...list].sort((a, b) => Number(meta.get(b.key)?.starred === true) - Number(meta.get(a.key)?.starred === true));
  }, [board.rows, query, meta]);

  const here = hereFrom(location, "Kế hoạch");
  const open = (row: ViewRow): void => navigate(withReturn(row.href, here));
  const toggleStar = (row: ViewRow): void => {
    const current = meta.get(row.key);
    save.mutate({ sourceKey: row.key, starred: current?.starred !== true, note: current?.note ?? null }, { onError: (error) => toast.error(error.message) });
  };
  const editNote = async (row: ViewRow): Promise<void> => {
    const current = meta.get(row.key);
    const note = await askText({ title: "Ghi chú riêng", body: isVault ? "Chỉ bạn thấy · khoá cùng Két sắt" : "Chỉ bạn thấy", initial: current?.note ?? "", maxLength: 500, confirmLabel: "Lưu" });
    if (note === null) return;
    save.mutate({ sourceKey: row.key, starred: current?.starred === true, note }, { onError: (error) => toast.error(error.message) });
  };
  const titleOf = (row: ViewRow): string => String(row.cells.title ?? "");
  const cell = (row: ViewRow, key: string): React.ReactNode => {
    const column = def.columns.find((item) => item.key === key);
    const value = row.cells[key];
    if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
    if (column?.kind === "money") return <Money cents={Number(value)} currency={row.currency ?? currency} tone="ink" />;
    if (column?.kind === "date") return vnDate(String(value));
    if (column?.kind === "percent") return `${value}%`;
    return String(value);
  };

  return (
    <section aria-label={def.name} data-view-board={boardKey} className="mt-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground md:text-[22px]">{def.name}</h2>
          <p data-board-goal="" className="mt-0.5 text-[14.5px] text-foreground/80">{def.goal}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Bảng Avora mặc định · đồng bộ từ {def.source} 🔗</p>
        </div>
        <button type="button" onClick={() => onFullscreen(!isFullscreen)} aria-label={isFullscreen ? "Thu nhỏ" : "Mở to tập trung"} className="press flex h-10 w-10 items-center justify-center rounded-md border border-border">
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Thao tác với ${def.name}`} className="press flex h-10 w-10 items-center justify-center rounded-md border border-border">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                void hide(boardKey).then(() => {
                  toast.success("Đã ẩn. Hiện lại ở Cài đặt › Kế hoạch.");
                  onClose();
                });
              }}
            >
              <EyeOff className="mr-2 h-4 w-4" /> Ẩn khỏi danh sách
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {board.locked ? (
        <div data-vault-locked="" className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-muted-foreground">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[14.5px]">Đang khoá · Mở Két sắt để xem</span>
          <button type="button" onClick={() => navigate(withReturn("/ket-sat", here))} className="press h-10 rounded-md border border-border px-3 text-[13.5px] text-foreground">
            Mở Két sắt
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {def.views.length > 1 ? (
              <div role="tablist" aria-label="Cách xem" className="flex gap-1.5">
                {def.views.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={cn("press h-9 rounded-full border px-3 text-[13px]", view === item.id ? "border-personal bg-personal-soft font-semibold text-personal-soft-foreground" : "border-border")}>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {boardKey === "payment_calendar" ? (
              <div role="tablist" aria-label="Tháng" className="flex gap-1.5">
                {(["this", "next"] as const).map((month) => (
                  <button key={month} type="button" role="tab" aria-selected={paymentMonth === month} onClick={() => setPaymentMonth(month)} className={cn("press h-9 rounded-full border px-3 text-[13px]", paymentMonth === month ? "border-personal bg-personal-soft font-semibold text-personal-soft-foreground" : "border-border")}>
                    {month === "this" ? "Tới cuối tháng" : "Tháng sau"}
                  </button>
                ))}
              </div>
            ) : null}
            {board.rows.length > 0 ? (
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong bảng" aria-label="Tìm trong bảng" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[16px] outline-none focus:border-personal md:max-w-[260px] md:text-[14px]" />
            ) : null}
          </div>
          {boardKey === "summary" && !assetsValued ? <p className="mt-2 text-[12.5px] text-muted-foreground">Tài sản ròng: Chưa gồm tài sản (ngăn Tài sản chưa có giá trị ước tính).</p> : null}

          {board.isLoading ? (
            <p className="mt-6 text-[14px] text-muted-foreground">Đang tải…</p>
          ) : board.error !== null ? (
            <p role="alert" className="mt-6 text-[14px] text-destructive">{board.error}</p>
          ) : board.rows.length === 0 ? (
            <p data-view-empty="" className="mt-6 rounded-xl border border-dashed border-border px-4 py-5 text-[14.5px] text-muted-foreground">{def.empty}</p>
          ) : view === "month" ? (
            <table className="mt-4 w-full text-[14px]" data-view="month">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="py-2 font-semibold">Tháng</th>
                  <th className="py-2 text-right font-semibold">Thu</th>
                  <th className="py-2 text-right font-semibold">Chi</th>
                  <th className="py-2 text-right font-semibold">Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map((month) => (
                  <tr key={month.month} data-month={month.month} className="border-t border-border/60">
                    <td className="py-2.5">{`${month.month.slice(5)}/${month.month.slice(0, 4)}`}</td>
                    <td className="py-2.5 text-right"><Money cents={month.inCents} currency={currency} tone="in" /></td>
                    <td className="py-2.5 text-right"><Money cents={month.outCents} currency={currency} tone="out" /></td>
                    <td className="py-2.5 text-right"><Money cents={month.diffCents} currency={currency} signed /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : view === "person" ? (
            <ul className="mt-4" data-view="person">
              {byPerson.map((person) => (
                <li key={person.assigneeId} className="flex items-center gap-3 border-b border-border/60 py-3">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{person.name}</span>
                  <span className="text-[13px] text-muted-foreground">{person.count} việc · {person.late > 0 ? <span className="text-destructive">trễ {person.late}</span> : "không trễ"} · xong {person.donePercent}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-3" data-view="table">
              {rows.map((row) => {
                const rowMeta = meta.get(row.key);
                const phoneCols = def.columns.filter((column) => column.key !== "title" && column.phone === true);
                const restCols = def.columns.filter((column) => column.key !== "title");
                return (
                  <li key={row.key} data-view-row={row.key} className="group flex items-center gap-1 border-b border-border/60">
                    <button type="button" onClick={() => toggleStar(row)} aria-label={rowMeta?.starred === true ? "Bỏ quan trọng" : "Đánh dấu quan trọng"} aria-pressed={rowMeta?.starred === true} className="press flex h-11 w-9 shrink-0 items-center justify-center">
                      <Star className={cn("h-4 w-4", rowMeta?.starred === true ? "fill-amber-400 text-amber-400" : "text-muted-foreground/60")} />
                    </button>
                    <button type="button" onClick={() => open(row)} className="press flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 text-left">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-[15px] font-medium", row.hot === true && "text-personal")}>{titleOf(row)}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12.5px] text-muted-foreground md:hidden">
                          {phoneCols.map((column) => <span key={column.key}>{cell(row, column.key)}</span>)}
                        </span>
                        {rowMeta?.note ? <span className="mt-0.5 block truncate text-[12.5px] italic text-muted-foreground">✎ {rowMeta.note}</span> : null}
                      </span>
                      <span className="hidden shrink-0 items-center gap-4 text-[13.5px] md:flex">
                        {restCols.map((column) => (
                          <span key={column.key} className={cn("w-[110px] truncate", column.kind === "money" || column.kind === "number" || column.kind === "percent" ? "text-right" : "")}>{cell(row, column.key)}</span>
                        ))}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`Thêm cho ${titleOf(row)}`} className="press flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void editNote(row)}>
                          <NotebookPen className="mr-2 h-4 w-4" /> Ghi chú riêng
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTaskFrom(row)}>
                          <ListPlus className="mr-2 h-4 w-4" /> Tạo việc
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {taskFrom !== null ? (
        <TaskComposer
          open
          onOpenChange={(next) => !next && setTaskFrom(null)}
          place="personal"
          source={{ label: `${def.name} · ${titleOf(taskFrom)}` }}
          initial={{ title: titleOf(taskFrom).slice(0, 200), deadline: typeof taskFrom.cells.date === "string" && taskFrom.cells.date >= new Date().toISOString().slice(0, 10) ? taskFrom.cells.date : "" }}
          onCreateMine={async (values) => {
            if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
            await createPersonal(user.id, values, null);
            setTaskFrom(null);
          }}
        />
      ) : null}
    </section>
  );
}
