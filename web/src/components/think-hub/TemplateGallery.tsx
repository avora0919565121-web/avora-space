import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import type { TablePlace } from "@/lib/table-places";
import type { ThinkTable } from "@/lib/think-hub";
import { orderTemplates, THINKING_TYPES, type BoardTemplate, type TemplateScope, type ThinkingType } from "@/lib/think-hub-shelf";
import { useShelfActions, useTemplates } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

const PERSONAL = "__personal__";

/**
 * "+ Bảng mới" (Đợt gộp 2 · C2): pick what kind of thinking, then a template, then preview and name
 * it. Opened from a conversation, "Ở đâu" is locked to that conversation.
 */
export function TemplateGallery({
  open,
  onOpenChange,
  places,
  initialConversationId,
  lockPlace,
  kindOf,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: readonly TablePlace[];
  initialConversationId: string | null;
  /** True when opened from inside a conversation: the place cannot change. */
  lockPlace: boolean;
  kindOf: (conversationId: string) => "direct" | "group" | "personal" | undefined;
  onCreated: (table: ThinkTable) => void;
}) {
  const templates = useTemplates();
  const { fromTemplate } = useShelfActions();
  const [type, setType] = useState<ThinkingType | null>(null);
  const [picked, setPicked] = useState<BoardTemplate | null>(null);
  const [name, setName] = useState<string>("");
  const [place, setPlace] = useState<string>(PERSONAL);

  useEffect(() => {
    if (!open) return;
    setType(null);
    setPicked(null);
    setName("");
    setPlace(initialConversationId ?? PERSONAL);
  }, [open, initialConversationId]);

  const conversationId = place === PERSONAL ? null : place;
  const scope: TemplateScope = conversationId === null ? "journal" : kindOf(conversationId) === "group" ? "group" : "direct";
  const ordered = useMemo(() => orderTemplates(templates.data ?? [], scope, type), [templates.data, scope, type]);
  const blank = (templates.data ?? []).find((template) => template.id === "blank");

  const choose = (template: BoardTemplate): void => {
    setPicked(template);
    setName(template.id === "blank" ? "" : template.name);
  };

  const create = async (): Promise<void> => {
    if (picked === null || name.trim() === "") return;
    try {
      const table = await fromTemplate.mutateAsync({ template: picked, conversationId, name });
      toast.success(`Đã tạo bảng "${table.name}".`);
      onCreated(table);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tạo được bảng.");
    }
  };

  const card = (template: BoardTemplate, faded: boolean) => (
    <li key={`${template.source}-${template.id}`}>
      <button
        type="button"
        onClick={() => choose(template)}
        className={cn(
          "press flex w-full flex-col items-start rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/30",
          faded && "opacity-60",
        )}
      >
        <span className="text-[14.5px] font-semibold text-foreground">{template.name}</span>
        {template.guidingQuestion !== null ? (
          <span className="mt-0.5 text-[12.5px] text-muted-foreground">{template.guidingQuestion}</span>
        ) : null}
        <span className="mt-1.5 line-clamp-1 text-[11.5px] text-muted-foreground/80">
          {[template.titleLabel, ...template.columns.map((column) => column.label)].join(" · ")}
        </span>
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(longDialogContentClass, "max-w-[640px]")}>
        <LongDialogHeader>
          <DialogTitle className="text-[18px]">{picked === null ? "Bảng mới" : picked.name}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {picked === null ? "Bạn muốn làm gì?" : picked.guidingQuestion ?? "Tự đặt cột và trạng thái."}
          </DialogDescription>
        </LongDialogHeader>

        <LongDialogBody>
          {templates.isPending ? (
            <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải mẫu…
            </p>
          ) : templates.isError ? (
            <p role="alert" className="text-[13.5px] text-destructive">Chưa tải được mẫu. Thử lại sau.</p>
          ) : picked === null ? (
            <>
              <div role="group" aria-label="Kiểu suy nghĩ" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {THINKING_TYPES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={type === item.id}
                    onClick={() => setType(type === item.id ? null : item.id)}
                    className={cn(
                      "press rounded-lg border px-3 py-2.5 text-left transition-colors",
                      type === item.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent/30",
                    )}
                  >
                    <span className="block text-[13.5px] font-semibold text-foreground">{item.label}</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">{item.question}</span>
                  </button>
                ))}
              </div>
              {ordered.mine.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[12.5px] font-medium text-muted-foreground">Mẫu của tôi</p>
                  <ul className="grid gap-2 sm:grid-cols-2">{ordered.mine.map((template) => card(template, false))}</ul>
                </>
              ) : null}
              <p className="mb-2 mt-5 text-[12.5px] font-medium text-muted-foreground">Hợp với nơi này</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {ordered.fitting.map((template) => card(template, false))}
                {blank !== undefined ? card(blank, false) : null}
              </ul>
              {ordered.others.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[12.5px] font-medium text-muted-foreground">Mẫu khác</p>
                  <ul className="grid gap-2 sm:grid-cols-2">{ordered.others.map((template) => card(template, true))}</ul>
                </>
              ) : null}
            </>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="text-[13px] font-medium text-foreground">Tên Bảng</span>
                <input
                  value={name}
                  autoFocus
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-[16px] md:text-[15px] outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-foreground">Ở đâu</span>
                <select
                  value={place}
                  disabled={lockPlace}
                  onChange={(event) => setPlace(event.target.value)}
                  className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-[16px] md:text-[15px] outline-none focus:border-primary disabled:opacity-70"
                >
                  {places.map((item) => (
                    <option key={item.conversationId ?? PERSONAL} value={item.conversationId ?? PERSONAL}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {lockPlace ? <span className="mt-1 block text-[12px] text-muted-foreground">Bảng thuộc cuộc trò chuyện bạn vừa mở.</span> : null}
              </label>
              <dl className="space-y-2 rounded-lg border border-border bg-card px-4 py-3 text-[13px]">
                <div>
                  <dt className="font-medium text-muted-foreground">Cột</dt>
                  <dd className="text-foreground">
                    {[picked.titleLabel, "Trạng thái", "Ưu tiên", "Ngày tiếp theo", "Ghi chú", ...picked.columns.map((column) => column.label)].join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Trạng thái</dt>
                  <dd className="text-foreground">{picked.statuses.join(" → ")}</dd>
                </div>
                {picked.subTemplateName !== null ? (
                  <div>
                    <dt className="font-medium text-muted-foreground">Bảng con đi kèm</dt>
                    <dd className="text-foreground">{picked.subTemplateName}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          )}
        </LongDialogBody>

        <LongDialogFooter className="justify-between">
          {picked !== null ? (
            <button type="button" onClick={() => setPicked(null)} className="press inline-flex items-center gap-1 rounded-md px-3 py-2 text-[14px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Mẫu khác
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="press rounded-md border border-border px-4 py-2 text-[14px]">
              Huỷ
            </button>
            {picked !== null ? (
              <button
                type="button"
                disabled={name.trim() === "" || fromTemplate.isPending}
                onClick={() => void create()}
                className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Dùng mẫu này
              </button>
            ) : null}
          </div>
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}
