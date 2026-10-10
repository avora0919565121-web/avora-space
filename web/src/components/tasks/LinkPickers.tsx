import { CheckCircle2, Circle, FileText, Loader2, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cardDay } from "@/lib/task-card";
import { useLinkableRecords, useLinkableTasks, useTaskLinkActions } from "@/lib/task-links";
import { cn } from "@/lib/utils";

/**
 * AVORA-104 · PHẦN 3 (ADR-076) — the two pickers: from a task, `Gắn vào Hạng mục`; from a Hạng mục,
 * `Gắn việc có sẵn`. Search (accent-free, on the server), `GẦN ĐÂY` first, each row with its path.
 * Only what sits in the same place is ever offered — the server decides that, not this list.
 */

function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState<string>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function PickerFrame({
  open,
  onOpenChange,
  title,
  placeholder,
  query,
  onQuery,
  note,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  query: string;
  onQuery: (next: string) => void;
  note: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const body = (
    <div data-link-picker="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        {isMobile ? (
          <SheetTitle className="min-w-0 flex-1 text-[17px] font-semibold text-foreground">{title}</SheetTitle>
        ) : (
          <DialogTitle className="min-w-0 flex-1 text-[17px] font-semibold text-foreground">{title}</DialogTitle>
        )}
        {isMobile ? (
          <SheetDescription className="sr-only">{note}</SheetDescription>
        ) : (
          <DialogDescription className="sr-only">{note}</DialogDescription>
        )}
        <button type="button" aria-label="Đóng" onClick={() => onOpenChange(false)} className="press flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
          <X className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
      <label className="mx-4 mt-2 flex h-11 items-center gap-2 rounded-full border border-border bg-card px-3.5 focus-within:border-muted-foreground">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <input
          lang="vi"
          value={query}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(event) => onQuery(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground md:text-[14.5px]"
        />
      </label>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">{children}</div>
      <p className="border-t border-border px-4 py-3 text-[12px] leading-5 text-muted-foreground">{note}</p>
    </div>
  );
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex h-[78dvh] flex-col gap-0 rounded-t-[18px] border-border bg-background p-0 [&>button:last-child]:hidden">
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[min(560px,80vh)] max-w-[440px] flex-col gap-0 rounded-xl border-border bg-background p-0">
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Section({ label }: { label: string }) {
  return <p className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>;
}

function Row({ icon, title, sub, onClick, isWorking, isCurrent }: { icon: ReactNode; title: string; sub: string; onClick: () => void; isWorking: boolean; isCurrent?: boolean }) {
  return (
    <button
      type="button"
      data-link-row=""
      disabled={isWorking || isCurrent === true}
      onClick={onClick}
      className="press flex min-h-[56px] w-full items-center gap-3 border-b border-border/60 px-4 text-left hover:bg-accent/30 disabled:opacity-70"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-foreground">{title}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>
      </span>
      {isCurrent === true ? <span className="shrink-0 text-[12px] text-personal">Đang gắn</span> : null}
    </button>
  );
}

/** From a task: `Gắn vào Hạng mục` — tìm / gần đây → chọn. */
export function RecordPicker({
  taskId,
  open,
  onOpenChange,
  onLinked,
}: {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: (recordTitle: string) => void;
}) {
  const [query, setQuery] = useState<string>("");
  const debounced = useDebounced(query);
  const { data, isPending, isError } = useLinkableRecords(open ? taskId : null, debounced);
  const { link } = useTaskLinkActions();
  const choose = (recordId: string, title: string): void => {
    link.mutate(
      { taskId, recordId },
      {
        onSuccess: () => {
          toast.success(`Đã gắn vào ${title}.`);
          onLinked?.(title);
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };
  const list = data ?? [];
  return (
    <PickerFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Gắn vào Hạng mục"
      placeholder="Tìm hạng mục…"
      query={query}
      onQuery={setQuery}
      note="Chỉ hiện Hạng mục cùng nơi với việc (bảng riêng ↔ việc riêng; bảng nhóm / dự án ↔ việc của nhóm / dự án đó)."
    >
      {debounced.trim() === "" ? <Section label="Gần đây" /> : null}
      {isPending ? (
        <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tìm…
        </p>
      ) : isError ? (
        <p className="px-4 py-3 text-[13px] text-destructive">Không tải được danh sách. Thử lại sau.</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          {debounced.trim() === "" ? "Chưa có Hạng mục nào cùng nơi với việc này." : "Không thấy Hạng mục nào khớp."}
        </p>
      ) : (
        list.map((record) => (
          <Row
            key={record.recordId}
            icon={<FileText className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />}
            title={record.recordTitle}
            sub={record.path}
            isCurrent={record.isCurrent}
            isWorking={link.isPending}
            onClick={() => choose(record.recordId, record.recordTitle)}
          />
        ))
      )}
    </PickerFrame>
  );
}

/** From a Hạng mục: `Gắn việc có sẵn` — việc chưa gắn trước. */
export function TaskPicker({
  recordId,
  recordTitle,
  open,
  onOpenChange,
}: {
  recordId: string;
  recordTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState<string>("");
  const debounced = useDebounced(query);
  const { data, isPending, isError } = useLinkableTasks(open ? recordId : null, debounced);
  const { link } = useTaskLinkActions();
  const list = data ?? [];
  return (
    <PickerFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Gắn việc có sẵn"
      placeholder="Tìm việc…"
      query={query}
      onQuery={setQuery}
      note={`Việc chưa xong, cùng nơi với ${recordTitle}, mà bạn sửa được. Việc đã ở Hạng mục khác sẽ chuyển sang đây.`}
    >
      {isPending ? (
        <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tìm…
        </p>
      ) : isError ? (
        <p className="px-4 py-3 text-[13px] text-destructive">Không tải được danh sách. Thử lại sau.</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">{debounced.trim() === "" ? "Không còn việc nào để gắn." : "Không thấy việc nào khớp."}</p>
      ) : (
        list.map((task) => (
          <Row
            key={task.taskId}
            icon={
              task.status === "done" ? (
                <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <Circle className={cn("h-[18px] w-[18px]")} strokeWidth={1.6} aria-hidden="true" />
              )
            }
            title={task.title}
            sub={[cardDay(task.deadline), task.linkedRecordTitle !== null ? `đang ở ${task.linkedRecordTitle}` : "chưa gắn Hạng mục"].filter((part) => part !== null).join(" · ")}
            isWorking={link.isPending}
            onClick={() =>
              link.mutate(
                { taskId: task.taskId, recordId },
                {
                  onSuccess: () => {
                    toast.success(`Đã gắn “${task.title}” vào ${recordTitle}.`);
                    onOpenChange(false);
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        ))
      )}
    </PickerFrame>
  );
}
