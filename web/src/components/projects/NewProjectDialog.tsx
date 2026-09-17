import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ProjectCharter } from "@/lib/projects";
import { useProjectActions } from "@/lib/use-projects";
import { cn } from "@/lib/utils";

/** The four charter questions, in the order they are usually answered. */
const CHARTER_FIELDS: readonly {
  readonly key: keyof ProjectCharter;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  { key: "purpose", label: "Mục đích", placeholder: "Vì sao dự án này đáng làm?" },
  { key: "scope", label: "Phạm vi", placeholder: "Những gì thuộc và không thuộc dự án này" },
  {
    key: "successCriteria",
    label: "Tiêu chí thành công",
    placeholder: "Nhìn vào đâu để biết dự án đã xong?",
  },
  { key: "assumptions", label: "Giả định", placeholder: "Điều đang cho là đúng, nếu sai thì phải xem lại" },
];

/**
 * Opens a project: a title, its first objective, and an optional charter.
 *
 * The charter stays folded away because a project usually starts as an intention, not a scope
 * document — the two fields above it are the only ones that must be answered, and the create
 * button says so by staying dim until they are.
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
  /** The conversation the project will live in — journal, 1-1, or group. */
  conversationId: string | undefined;
  /** Named on screen so nobody opens a group project thinking it is private. */
  conversationLabel: string;
  onCreated: (projectId: string) => void;
}) {
  const { create, isWorking } = useProjectActions();
  const [title, setTitle] = useState<string>("");
  const [objective, setObjective] = useState<string>("");
  const [charter, setCharter] = useState<ProjectCharter>({});
  const [isCharterOpen, setIsCharterOpen] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle("");
    setObjective("");
    setCharter({});
    setIsCharterOpen(false);
    setNotice(null);
  }, [open]);

  const canCreate = title.trim().length > 0 && objective.trim().length > 0;

  const handleCreate = useCallback(async (): Promise<void> => {
    if (conversationId === undefined || !canCreate) return;
    setNotice(null);
    try {
      const project = await create({
        conversationId,
        title,
        firstObjectiveTitle: objective,
        charter,
      });
      onOpenChange(false);
      toast.success("Đã mở dự án.");
      onCreated(project.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không mở được dự án.");
    }
  }, [conversationId, canCreate, create, title, objective, charter, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[560px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="px-6 pb-4 pt-6">
          <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
            Dự án mới
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
            Trong {conversationLabel}
          </DialogDescription>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-6 pb-5">
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Tiêu đề dự án</span>
            <input
              value={title}
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Ra mắt bản thử AVORA"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[13px] font-medium text-foreground">Mục tiêu đầu tiên</span>
            <input
              value={objective}
              maxLength={200}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ví dụ: Chốt phạm vi bản thử"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
            <span className="mt-1.5 block text-[12.5px] text-muted-foreground">
              Một dự án không có mục tiêu nào thì chưa nói được nó đang đi đâu.
            </span>
          </label>

          <button
            type="button"
            onClick={() => setIsCharterOpen((current) => !current)}
            aria-expanded={isCharterOpen}
            className="press mt-5 flex w-full items-center gap-2 rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                isCharterOpen && "rotate-180",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-foreground">
                Hiến chương dự án
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                Bốn câu hỏi, điền sau cũng được
              </span>
            </span>
          </button>

          {isCharterOpen ? (
            <div className="mt-3 space-y-3">
              {CHARTER_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className="text-[13px] font-medium text-foreground">{field.label}</span>
                  <textarea
                    value={charter[field.key] ?? ""}
                    rows={2}
                    maxLength={2000}
                    onChange={(event) =>
                      setCharter((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    placeholder={field.placeholder}
                    className="mt-1.5 w-full resize-y rounded-md border border-border bg-card px-4 py-2.5 text-[14.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {notice ? <p className="mt-4 text-[13px] text-primary">{notice}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            className="press h-10 px-5"
            disabled={!canCreate || isWorking || conversationId === undefined}
            onClick={() => void handleCreate()}
          >
            {isWorking ? "Đang mở…" : "Mở dự án"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
