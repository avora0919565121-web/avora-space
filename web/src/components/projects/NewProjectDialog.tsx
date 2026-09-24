import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { charterProblem, EMPTY_CHARTER, type CharterDraft } from "@/lib/projects";
import { useProjectActions } from "@/lib/use-projects";
import { cn } from "@/lib/utils";

const inputClass =
  "mt-1.5 h-11 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60";
const areaClass =
  "mt-1.5 w-full resize-y rounded-md border border-border bg-card px-4 py-2.5 text-[14.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60";

/**
 * Opens a project in a group: title, Kim chỉ nam, Mục tiêu, and both dates.
 *
 * All five are required and none is pre-filled — the dates especially: when a project starts
 * and when it should end is decided by the people running it, not by today's date. Scope and
 * assumptions stay folded away and optional. Success criteria are added later, on the project
 * itself, as the work shows what "done" should mean.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  conversationId,
  conversationLabel,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The group the project will live in. */
  conversationId: string | undefined;
  conversationLabel: string;
  onCreated: (projectId: string) => void;
}) {
  const { create, isWorking } = useProjectActions();
  const [draft, setDraft] = useState<CharterDraft>(EMPTY_CHARTER);
  const [isMoreOpen, setIsMoreOpen] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setDraft(EMPTY_CHARTER);
    setIsMoreOpen(false);
    setNotice(null);
  }, [open]);

  const setField = useCallback(<K extends keyof CharterDraft>(key: K, value: CharterDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const problem = charterProblem(draft);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (conversationId === undefined) return;
    if (problem !== null) {
      setNotice(problem);
      return;
    }
    setNotice(null);
    try {
      const project = await create(conversationId, draft);
      onOpenChange(false);
      toast.success("Đã mở dự án.");
      onCreated(project.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không mở được dự án.");
    }
  }, [conversationId, problem, create, draft, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[560px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="px-6 pb-4 pt-6">
          <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Dự án mới</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
            Trong {conversationLabel}. Cả nhóm sẽ thấy dự án này.
          </DialogDescription>
        </div>

        <div className="max-h-[58vh] overflow-y-auto px-6 pb-5">
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Tiêu đề dự án</span>
            <input
              value={draft.title}
              autoFocus
              maxLength={200}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="Ví dụ: Lắp đặt chiếu sáng HANA"
              className={inputClass}
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[13px] font-medium text-foreground">Kim chỉ nam</span>
            <textarea
              value={draft.valueOrientation}
              rows={2}
              maxLength={2000}
              onChange={(event) => setField("valueOrientation", event.target.value)}
              placeholder="Dự án này phục vụ điều gì lớn hơn?"
              className={areaClass}
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[13px] font-medium text-foreground">Mục tiêu</span>
            <textarea
              value={draft.objective}
              rows={2}
              maxLength={2000}
              onChange={(event) => setField("objective", event.target.value)}
              placeholder="Khi xong, điều gì đã đạt được?"
              className={areaClass}
            />
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[13px] font-medium text-foreground">Ngày bắt đầu</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => setField("startDate", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-foreground">Kết thúc dự kiến</span>
              <input
                type="date"
                value={draft.targetEndDate}
                min={draft.startDate || undefined}
                onChange={(event) => setField("targetEndDate", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            Ngày do nhóm tự định — không có ngày nào được chọn sẵn.
          </p>

          <button
            type="button"
            onClick={() => setIsMoreOpen((current) => !current)}
            aria-expanded={isMoreOpen}
            className="press mt-5 flex w-full items-center gap-2 rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cn("h-4 w-4 shrink-0 text-muted-foreground", isMoreOpen && "rotate-180")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-foreground">Phạm vi và giả định</span>
              <span className="block text-[12.5px] text-muted-foreground">Không bắt buộc, điền sau cũng được</span>
            </span>
          </button>

          {isMoreOpen ? (
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-[13px] font-medium text-foreground">Phạm vi</span>
                <textarea
                  value={draft.scope}
                  rows={2}
                  maxLength={2000}
                  onChange={(event) => setField("scope", event.target.value)}
                  placeholder="Những gì thuộc và không thuộc dự án này"
                  className={areaClass}
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-foreground">Giả định</span>
                <textarea
                  value={draft.assumptions}
                  rows={2}
                  maxLength={2000}
                  onChange={(event) => setField("assumptions", event.target.value)}
                  placeholder="Điều đang cho là đúng, nếu sai thì phải tính lại"
                  className={areaClass}
                />
              </label>
            </div>
          ) : null}

          <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
            Tiêu chí thành công được thêm dần ngay trong dự án, khi nhóm đã rõ thế nào là xong.
          </p>

          {notice ? (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            className="press h-10 px-5"
            disabled={problem !== null || isWorking || conversationId === undefined}
            title={problem ?? undefined}
            onClick={() => void handleCreate()}
          >
            {isWorking ? "Đang mở…" : "Mở dự án"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
