import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { normalizeSearch } from "@/lib/normalize-search";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";
import {
  drawerLabel,
  previewStakeholders,
  previewTableDelete,
  previewTransfer,
  proposalVerb,
  transferTargets,
  type Drawer,
  type ProposalAction,
  type ProposalTarget,
} from "@/lib/think-hub-shelf";
import { useSharedTrash, useShelfActions } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

const buttonPrimary = "press rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground disabled:opacity-50";
const buttonQuiet = "press rounded-md border border-border px-4 py-2 text-[14px]";
const field = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[15px] outline-none focus:border-primary";

/** "Đề nghị xoá / lưu trữ / mở lại" (ADR-031): reason required, stakeholders shown before sending. */
export function ProposeDialog({
  target,
  onOpenChange,
}: {
  target: { action: ProposalAction; targetType: ProposalTarget; targetId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { propose } = useShelfActions();
  const [reason, setReason] = useState<string>("");
  useEffect(() => setReason(""), [target]);
  const stakeholders = useQuery({
    queryKey: ["shared-proposals", "stakeholders", target?.targetType, target?.targetId],
    queryFn: () => previewStakeholders(target?.targetType ?? "think_hub_table", target?.targetId ?? ""),
    enabled: target !== null,
  });

  const send = async (): Promise<void> => {
    if (target === null) return;
    try {
      const status = await propose.mutateAsync({ action: target.action, targetType: target.targetType, targetId: target.targetId, reason });
      toast.success(status === "approved" ? "Không ai khác từng dùng — đã làm ngay và ghi vào cuộc trò chuyện." : "Đã gửi đề nghị vào cuộc trò chuyện.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không gửi được đề nghị.");
    }
  };

  const verb = target === null ? "" : proposalVerb(target.action, target.targetType);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogTitle className="text-[18px] first-letter:uppercase">Đề nghị {verb}</DialogTitle>
        <DialogDescription className="text-[13px]">
          "{target?.name}" là tài sản chung — chỉ {verb} khi mọi bên liên quan đồng ý. Một người không đồng ý thì cần trao đổi.
        </DialogDescription>
        <label className="block">
          <span className="text-[13px] font-medium">Lý do</span>
          <textarea value={reason} maxLength={300} rows={3} onChange={(event) => setReason(event.target.value)} className={field} />
        </label>
        <div className="rounded-lg bg-secondary/50 px-3 py-2 text-[13px]">
          <p className="font-medium text-muted-foreground">Sẽ hỏi</p>
          {stakeholders.isPending ? (
            <Loader2 className="mt-1 h-4 w-4 animate-spin" />
          ) : stakeholders.isError ? (
            <p className="text-destructive">Chưa tải được danh sách.</p>
          ) : (stakeholders.data ?? []).length === 0 ? (
            <p className="text-foreground">Không ai khác từng dùng — sẽ làm ngay, vẫn ghi vào cuộc trò chuyện.</p>
          ) : (
            <p className="text-foreground">{(stakeholders.data ?? []).map((person) => person.name).join(", ")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonQuiet} onClick={() => onOpenChange(false)}>Huỷ</button>
          <button type="button" className={buttonPrimary} disabled={reason.trim() === "" || propose.isPending} onClick={() => void send()}>
            Gửi đề nghị
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Xoá a personal table (C5): the way out first ("Đổi tên…"), counts of what goes to the bin. */
export function DeleteTableDialog({
  table,
  onOpenChange,
  onRename,
  onDelete,
}: {
  table: ThinkTable | null;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: (table: ThinkTable) => Promise<void>;
}) {
  const preview = useQuery({
    queryKey: ["think-hub", "delete-preview", table?.id],
    queryFn: () => previewTableDelete(table?.id ?? ""),
    enabled: table !== null,
  });
  const counts = preview.data;
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="text-[18px]">Đổi tên hoặc mục tiêu thay vì xoá?</DialogTitle>
        <DialogDescription className="text-[13px]">Một Bảng thường chỉ cần đổi hướng, không cần bỏ.</DialogDescription>
        <button type="button" className={buttonPrimary} onClick={onRename}>Đổi tên / mục tiêu</button>
        <div className="rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground">
          {preview.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : counts === undefined ? (
            "Chưa đếm được."
          ) : (
            <>
              {counts.records} Hạng mục · {counts.subTables} bảng con · {counts.tasks} nhiệm vụ sẽ vào Thùng rác (khôi phục được cùng Bảng).
              {counts.tasksKeptByAssignee > 0 ? ` ${counts.tasksKeptByAssignee} việc người nhận chưa xong vẫn ở lại danh sách của họ.` : ""}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonQuiet} onClick={() => onOpenChange(false)}>Huỷ</button>
          <button
            type="button"
            className="press rounded-md px-4 py-2 text-[14px] font-medium text-destructive hover:bg-destructive/10"
            onClick={() => table !== null && void onDelete(table)}
          >
            Xoá Bảng
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Thùng rác Kế hoạch: my own tables (restore / purge with name) and shared ones I may restore. */
export function HubTrashDialog({
  open,
  onOpenChange,
  personalBinned,
  onRestorePersonal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personalBinned: readonly ThinkTable[];
  onRestorePersonal: (tableId: string) => Promise<void>;
}) {
  const shared = useSharedTrash(open);
  const { restoreShared, purge } = useShelfActions();
  const [purging, setPurging] = useState<ThinkTable | null>(null);
  const [typed, setTyped] = useState<string>("");

  const row = "flex items-center gap-2 border-b border-border/60 px-1 py-2.5 last:border-b-0";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[520px] overflow-y-auto">
        <DialogTitle className="text-[18px]">Thùng rác Kế hoạch</DialogTitle>
        <p className="text-[12.5px] font-medium text-muted-foreground">Của tôi</p>
        {personalBinned.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Trống.</p> : null}
        <ul>
          {personalBinned.map((table) => (
            <li key={table.id} className={row}>
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{table.name}</span>
              <button type="button" className="press inline-flex items-center gap-1 rounded px-2 py-1 text-[13px]" onClick={() => void onRestorePersonal(table.id)}>
                <RotateCcw className="h-4 w-4" /> Khôi phục
              </button>
              <button type="button" className="press inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-destructive" onClick={() => { setTyped(""); setPurging(table); }}>
                <Trash2 className="h-4 w-4" /> Xoá vĩnh viễn
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] font-medium text-muted-foreground">Chung</p>
        {shared.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {shared.isError ? <p className="text-[13px] text-destructive">Chưa tải được.</p> : null}
        {(shared.data ?? []).length === 0 && shared.isSuccess ? <p className="text-[13.5px] text-muted-foreground">Trống.</p> : null}
        <ul>
          {(shared.data ?? []).map((item) => (
            <li key={item.tableId} className={row}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px]">{item.name}</span>
                <span className="block text-[12px] text-muted-foreground">Xoá theo đề nghị của {item.proposedByName}</span>
              </span>
              <button
                type="button"
                className="press inline-flex items-center gap-1 rounded px-2 py-1 text-[13px]"
                onClick={() => restoreShared.mutateAsync(item.tableId).then(() => toast.success("Đã khôi phục và ghi vào cuộc trò chuyện."), (error: unknown) => toast.error(error instanceof Error ? error.message : "Không khôi phục được."))}
              >
                <RotateCcw className="h-4 w-4" /> Khôi phục
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-muted-foreground">Tài sản chung không có Xoá vĩnh viễn.</p>

        {purging !== null ? (
          <div className="mt-2 rounded-lg border border-destructive/40 p-3">
            <p className="text-[13.5px]">Gõ đúng tên <strong>{purging.name}</strong> để xoá vĩnh viễn Bảng, Hạng mục và bảng con. Nhiệm vụ vẫn ở Thùng rác Nhiệm vụ.</p>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Tên Bảng" className={field} />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={buttonQuiet} onClick={() => setPurging(null)}>Huỷ</button>
              <button
                type="button"
                disabled={typed.trim() !== purging.name.trim() || purge.isPending}
                className="press rounded-md bg-destructive px-4 py-2 text-[14px] font-semibold text-destructive-foreground disabled:opacity-40"
                onClick={() =>
                  purge.mutateAsync({ tableId: purging.id, name: typed }).then(
                    () => { toast.success("Đã xoá vĩnh viễn."); setPurging(null); },
                    (error: unknown) => toast.error(error instanceof Error ? error.message : "Không xoá được."),
                  )
                }
              >
                Xoá vĩnh viễn
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "Lưu làm mẫu của tôi" — structure only. */
export function SaveTemplateDialog({ table, onOpenChange }: { table: ThinkTable | null; onOpenChange: (open: boolean) => void }) {
  const { saveTemplate } = useShelfActions();
  const [name, setName] = useState<string>("");
  useEffect(() => setName(table?.name ?? ""), [table]);
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogTitle className="text-[18px]">Lưu làm mẫu của tôi</DialogTitle>
        <DialogDescription className="text-[13px]">Chỉ lưu cột và trạng thái — không lưu Hạng mục nào.</DialogDescription>
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} aria-label="Tên mẫu" className={field} />
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonQuiet} onClick={() => onOpenChange(false)}>Huỷ</button>
          <button
            type="button"
            className={buttonPrimary}
            disabled={name.trim() === "" || saveTemplate.isPending || table === null}
            onClick={() =>
              table !== null &&
              saveTemplate.mutateAsync({ tableId: table.id, name }).then(
                () => { toast.success("Đã lưu vào Mẫu của tôi."); onOpenChange(false); },
                (error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được mẫu."),
              )
            }
          >
            Lưu mẫu
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Di chuyển / Sao chép Hạng mục sang Bảng khác (C11): pick a target (grouped by drawer, accent-free
 * search), then one preview step that says exactly what will happen. The server re-checks all of it.
 */
export function MoveRecordDialog({
  request,
  tables,
  records,
  drawerOf,
  onOpenChange,
  onDone,
}: {
  request: { record: ThinkRecord; mode: "move" | "copy" } | null;
  tables: readonly ThinkTable[];
  records: readonly ThinkRecord[];
  drawerOf: (table: ThinkTable) => Drawer;
  onOpenChange: (open: boolean) => void;
  onDone: (targetTableId: string) => void;
}) {
  const { move, copy } = useShelfActions();
  const [query, setQuery] = useState<string>("");
  const [targetId, setTargetId] = useState<string | null>(null);
  useEffect(() => {
    setQuery("");
    setTargetId(null);
  }, [request]);

  const targets = useMemo(() => {
    if (request === null) return [];
    const needle = normalizeSearch(query.trim());
    return transferTargets(tables, records, request.record.tableId).filter((table) => needle === "" || normalizeSearch(table.name).includes(needle));
  }, [request, tables, records, query]);

  const preview = useQuery({
    queryKey: ["think-hub", "transfer", request?.record.id, targetId],
    queryFn: () => previewTransfer(request?.record.id ?? "", targetId ?? ""),
    enabled: request !== null && targetId !== null,
  });

  const mode = request?.mode ?? "move";
  const p = preview.data;
  const blocked = mode === "move" && p !== undefined && !p.canMove;

  const run = async (): Promise<void> => {
    if (request === null || targetId === null) return;
    try {
      const recordId = request.record.id;
      const sourceTableId = request.record.tableId;
      const targetName = tables.find((table) => table.id === targetId)?.name ?? "Bảng khác";
      const destination = targetId;
      if (mode === "move") await move.mutateAsync({ recordId, targetTableId: destination });
      else await copy.mutateAsync({ recordId, targetTableId: destination });
      // AVORA-53 · 5.6: stay on the source table; the toast offers the way there and the way back.
      toast.success(mode === "move" ? `Đã chuyển sang ${targetName}` : `Đã sao chép sang ${targetName}`, {
        action: { label: "Xem", onClick: () => onDone(destination) },
        ...(mode === "move"
          ? {
              cancel: {
                label: "Hoàn tác",
                onClick: () =>
                  void move
                    .mutateAsync({ recordId, targetTableId: sourceTableId })
                    .then(() => toast.success("Đã đưa Hạng mục về chỗ cũ."))
                    .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không hoàn tác được.")),
              },
            }
          : {}),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thực hiện được.");
    }
  };

  const groups: Drawer[] = ["personal", "direct", "group", "project"];
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-[520px] flex-col">
        <DialogTitle className="text-[18px]">{mode === "move" ? "Di chuyển sang Bảng khác" : "Sao chép sang Bảng khác"}</DialogTitle>
        <DialogDescription className="text-[13px]">"{request?.record.title}"</DialogDescription>
        {targetId === null ? (
          <>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bảng…" aria-label="Tìm bảng" className={field} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {groups.map((drawer) => {
                const list = targets.filter((table) => drawerOf(table) === drawer);
                if (list.length === 0) return null;
                return (
                  <div key={drawer} className="mt-3">
                    <p className="text-[12.5px] font-medium text-muted-foreground">{drawerLabel(drawer)}</p>
                    <ul>
                      {list.map((table) => (
                        <li key={table.id}>
                          <button type="button" onClick={() => setTargetId(table.id)} className="press w-full rounded-md px-2 py-2 text-left text-[14.5px] hover:bg-accent/30">
                            {table.name}
                            {table.depth > 1 ? <span className="ml-1.5 text-[12px] text-muted-foreground">bảng con · tầng {table.depth}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {targets.length === 0 ? <p className="mt-3 text-[13.5px] text-muted-foreground">Không có Bảng nào nhận được.</p> : null}
            </div>
          </>
        ) : preview.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : preview.isError || p === undefined ? (
          <p role="alert" className="text-[13.5px] text-destructive">{preview.error?.message ?? "Chưa xem trước được."}</p>
        ) : (
          <div className="space-y-2 text-[13.5px]">
            <p>
              {p.sourceTableName} → <strong>{p.targetTableName}</strong> <span className="text-muted-foreground">({p.targetScopeName})</span>
            </p>
            <ul className="list-disc space-y-1 pl-5 text-foreground">
              <li>Tiêu đề, ưu tiên, nhóm, ngày tiếp theo, thẻ, ghi chú giữ nguyên.</li>
              <li>{p.statusChanged ? `Trạng thái "${p.statusFrom}" không có ở Bảng đích → "${p.statusTo}".` : `Trạng thái giữ "${p.statusTo}".`}</li>
              {p.keptColumns.length > 0 ? <li>Cột giữ nguyên: {p.keptColumns.join(", ")}.</li> : null}
              {p.unmatched.length > 0 ? <li>Ghép vào cuối Ghi chú: {p.unmatched.map((u) => `${u.label}: ${u.value}`).join("; ")}.</li> : null}
              {mode === "move" && p.tasks > 0 ? <li>{p.tasks} nhiệm vụ và sao ★ đi theo.</li> : null}
              {mode === "copy" ? <li>Không chép nhiệm vụ, sao, bảng con. Ghi "Sao chép từ {p.sourceTableName}" vào Ghi chú.</li> : null}
            </ul>
            {mode === "move" && p.projectLinksDropped > 0 ? (
              <p className="flex gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Rời Dự án: {p.projectLinksDropped} nhiệm vụ của dự án sẽ bỏ liên kết với Hạng mục này.
              </p>
            ) : null}
            {mode === "move" && p.scope === "to_shared" && !blocked ? (
              <p className="rounded-md bg-secondary/60 px-3 py-2">Mọi người trong {p.targetScopeName} sẽ thấy Hạng mục này.</p>
            ) : null}
            {blocked ? (
              <p className={cn("rounded-md bg-secondary/60 px-3 py-2 text-muted-foreground")}>
                {p.moveBlock === "has_subtable"
                  ? `Hạng mục này có bảng con "${p.subTableName ?? ""}". Gỡ bảng con trước (xoá hoặc lưu trữ bảng con), hoặc tạo Hạng mục mới ở Bảng muốn chuyển tới.`
                  : p.moveBlock === "shared"
                    ? "Hạng mục chung chỉ chuyển ra ngoài được khi do bạn tạo, chưa ai khác sửa và không có nhiệm vụ của người khác. Bạn vẫn sao chép được."
                    : p.moveBlock === "target_full"
                      ? "Bảng đích đã đủ 1.000 Hạng mục."
                      : "Bạn không di chuyển được Hạng mục này. Hãy sao chép."}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex justify-between gap-2">
          {targetId !== null ? (
            <button type="button" className={buttonQuiet} onClick={() => setTargetId(null)}>Chọn Bảng khác</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className={buttonQuiet} onClick={() => onOpenChange(false)}>Huỷ</button>
            {targetId !== null ? (
              blocked && p?.canCopy === true ? (
                <button type="button" className={buttonPrimary} onClick={() => request !== null && void copy.mutateAsync({ recordId: request.record.id, targetTableId: targetId }).then(() => { toast.success("Đã sao chép Hạng mục."); onDone(targetId); onOpenChange(false); }, (error: unknown) => toast.error(error instanceof Error ? error.message : "Không sao chép được."))}>
                  Sao chép thay vì chuyển
                </button>
              ) : (
                <button type="button" className={buttonPrimary} disabled={p === undefined || blocked || move.isPending || copy.isPending} onClick={() => void run()}>
                  {mode === "move" ? "Chuyển" : "Sao chép"}
                </button>
              )
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Áp dụng mẫu" on an empty table the viewer owns (C2). */
export function ApplyTemplateRow({
  templates,
  onApply,
}: {
  tableId: string;
  templates: readonly import("@/lib/think-hub-shelf").BoardTemplate[];
  onApply: (template: import("@/lib/think-hub-shelf").BoardTemplate) => void;
}) {
  const [pickedId, setPickedId] = useState<string>("");
  const choices = templates.filter((template) => template.id !== "blank");
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <select
        value={pickedId}
        onChange={(event) => setPickedId(event.target.value)}
        aria-label="Chọn mẫu"
        className="h-9 rounded-md border border-border bg-background px-2 text-[16px] md:text-[13.5px]"
      >
        <option value="">Chọn mẫu…</option>
        {choices.map((template) => (
          <option key={`${template.source}-${template.id}`} value={`${template.source}:${template.id}`}>
            {template.source === "mine" ? `Của tôi · ${template.name}` : template.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pickedId === ""}
        onClick={() => {
          const found = choices.find((template) => `${template.source}:${template.id}` === pickedId);
          if (found !== undefined) onApply(found);
        }}
        className="press rounded-md border border-border px-3 py-1.5 text-[13.5px] font-medium disabled:opacity-50"
      >
        Áp dụng mẫu
      </button>
    </div>
  );
}
