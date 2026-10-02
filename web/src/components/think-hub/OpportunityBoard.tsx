import { ChevronDown, Link2, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ContactPicker } from "@/components/finance/ContactPicker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createOpportunity, suggestedOpportunityTitle } from "@/lib/opportunities";
import { STAGE_CHIPS, totalValue, type StageChip } from "@/lib/opportunity-board";
import type { ThinkRecord, ThinkTable } from "@/lib/think-hub";
import { useContacts } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

const vnd = (n: number): string => `${n.toLocaleString("vi-VN")} ₫`;

/**
 * AVORA-72 · B — under the board's name: 🔗 `Bảng Avora mặc định · đồng bộ từ Danh bạ`, the stage chips
 * (`Đang mở` by default), the total of `Giá trị ước tính` for the rows shown, and the empty state.
 */
export function OpportunityBoardBar({
  chip,
  onChip,
  records,
  isEmpty,
  onNew,
}: {
  chip: StageChip;
  onChip: (chip: StageChip) => void;
  records: readonly ThinkRecord[];
  isEmpty: boolean;
  onNew: () => void;
}) {
  const total = totalValue(records);
  return (
    <div className="mt-1" data-opportunity-bar="">
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Link2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Bảng Avora mặc định · đồng bộ từ Danh bạ
      </p>
      {isEmpty ? (
        <div className="mt-3 rounded-xl border border-dashed border-border px-5 py-6 text-center" data-opportunity-empty="">
          <p className="text-[15px] font-medium text-foreground">Gán Cơ hội cho một liên hệ để bắt đầu</p>
          <button type="button" onClick={onNew} className="press mx-auto mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" aria-hidden="true" /> Cơ hội mới
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <div role="tablist" aria-label="Lọc theo giai đoạn" className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
            {STAGE_CHIPS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={chip === item.id}
                onClick={() => onChip(item.id)}
                className={cn("press h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium", chip === item.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground" data-opportunity-total={total}>
            Tổng <strong className="font-semibold text-foreground">{vnd(total)}</strong>
          </span>
        </div>
      )}
    </div>
  );
}

/** `Cơ hội mới` — pick a contact (or add one by name), the row appears on the board by itself. */
export function NewOpportunityDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { data: contacts } = useContacts();
  const [contactId, setContactId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  useEffect(() => {
    if (!open) {
      setContactId("");
      setTitle("");
      setValue("");
    }
  }, [open]);
  const contact = (contacts ?? []).find((c) => c.id === contactId);
  useEffect(() => {
    if (contact !== undefined && title === "") setTitle(suggestedOpportunityTitle(contact.name));
    // Only when the person changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);
  const submit = async (): Promise<void> => {
    setIsWorking(true);
    try {
      const amount = value.replace(/[^\d]/g, "");
      await createOpportunity({ contactId, title, estimatedValue: amount === "" ? null : Number(amount) });
      toast.success("Đã thêm vào Danh sách cơ hội.");
      onCreated();
      onOpenChange(false);
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Chưa thêm được.");
    } finally {
      setIsWorking(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="text-[18px]">Cơ hội mới</DialogTitle>
        <DialogDescription className="text-[13.5px]">Chọn một liên hệ. Thông tin liên hệ hiện trên bảng và luôn khớp với Danh bạ.</DialogDescription>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div>
            <span className="text-[13px] font-medium">Liên hệ</span>
            <div className="mt-1"><ContactPicker contacts={contacts ?? []} value={contactId} onChange={setContactId} placeholder="Chọn liên hệ" /></div>
          </div>
          <label className="block">
            <span className="text-[13px] font-medium">Tiêu đề</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-primary md:text-[15px]" />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">Giá trị ước tính (₫)</span>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px] tabular-nums outline-none focus:border-primary md:text-[15px]" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="press h-11 rounded-lg px-4 text-[14px] text-muted-foreground">Huỷ</button>
            <button type="submit" disabled={isWorking || contactId === "" || title.trim() === ""} className="press flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-[14px] font-semibold text-primary-foreground disabled:opacity-50">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Thêm
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const GROUP_KEY = "avora.default-boards-open";

/**
 * AVORA-72 · A — `Bảng Avora mặc định`: a folded group at the head of Kế hoạch with three zones
 * `Kết nối · Nhiệm vụ · Két sắt`; a zone without boards stays hidden. Only Kết nối has one today.
 */
export function DefaultBoardsGroup({ boards, activeId, onOpen }: { boards: readonly ThinkTable[]; activeId: string | null; onOpen: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(GROUP_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const visible = boards.filter((b) => b.hiddenInList !== true || b.id === activeId);
  if (visible.length === 0) return null;
  const zones: { id: string; label: string; boards: readonly ThinkTable[] }[] = [
    { id: "ket-noi", label: "Kết nối", boards: visible.filter((b) => b.syncSource === "contact_opportunities") },
    { id: "nhiem-vu", label: "Nhiệm vụ", boards: [] },
    { id: "ket-sat", label: "Két sắt", boards: [] },
  ];
  return (
    <section className="mb-3 rounded-xl border border-border bg-card" data-default-boards="">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() =>
          setIsOpen((v) => {
            try {
              window.localStorage.setItem(GROUP_KEY, v ? "0" : "1");
            } catch {
              // Remembering is a courtesy.
            }
            return !v;
          })
        }
        className="press flex min-h-12 w-full items-center gap-2 px-4 text-left"
      >
        <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-[14.5px] font-semibold text-foreground">Bảng Avora mặc định</span>
        <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="border-t border-border px-2 pb-2 pt-1">
          {zones.filter((z) => z.boards.length > 0).map((zone) => (
            <div key={zone.id}>
              <p className="px-2 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{zone.label}</p>
              {zone.boards.map((board) => (
                <button key={board.id} type="button" onClick={() => onOpen(board.id)} className={cn("press flex min-h-12 w-full flex-col justify-center rounded-lg px-2 text-left hover:bg-accent/40", activeId === board.id && "bg-accent/50")} data-default-board={board.id}>
                  <span className="text-[14.5px] font-medium text-foreground">{board.name}</span>
                  <span className="text-[12px] text-muted-foreground">Bảng Avora mặc định · đồng bộ từ Danh bạ</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
