import { ChevronDown, Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { sendAtLine, useScheduleActions, type ScheduledMessage } from "@/lib/scheduled-messages";
import { cn } from "@/lib/utils";

/**
 * "🕒 2 tin hẹn giờ · gần nhất 20:00 hôm nay" above the composer — the sender's only. Opens the
 * list: Sửa · Gửi ngay · Huỷ; a failed one says why, with Sửa & hẹn lại · Xoá.
 */
/** Scheduled messages still waiting or failed — the chip row's count (AVORA-49 · 2.1). */
export function waitingScheduled(items: readonly ScheduledMessage[]): ScheduledMessage[] {
  return items.filter((item) => item.status === "pending" || item.status === "failed");
}

export function ScheduledStrip({
  conversationId,
  items,
  embedded = false,
}: {
  conversationId: string;
  items: readonly ScheduledMessage[];
  /** Opened from the thread's chip row: the list at once, capped at 35% of the screen. */
  embedded?: boolean;
}) {
  const [isOpenState, setIsOpen] = useState<boolean>(false);
  const isOpen = embedded || isOpenState;
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const { update, cancel, sendNow } = useScheduleActions(conversationId);
  const waiting = items.filter((item) => item.status === "pending" || item.status === "failed");
  if (waiting.length === 0) return null;
  const pending = waiting.filter((item) => item.status === "pending");
  const failed = waiting.length - pending.length;
  const next = pending[0];

  const run = (promise: Promise<unknown>, success: string): void => {
    void promise.then(() => toast.success(success)).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không thực hiện được."));
  };

  return (
    <div className={cn("mx-auto mb-2 max-w-2xl rounded-[12px] border border-border bg-card", embedded && "mb-0 max-h-[35dvh] overflow-y-auto rounded-none border-x-0 border-t-0")}>
      {embedded ? null : (
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="press flex min-h-10 w-full items-center gap-2 px-3 text-left text-[12.5px] text-foreground"
      >
        <Clock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {pending.length > 0 ? `${pending.length} tin hẹn giờ` : ""}
          {next !== undefined ? ` · gần nhất ${sendAtLine(new Date(next.sendAt))}` : ""}
          {failed > 0 ? <span className="text-destructive">{pending.length > 0 ? " · " : ""}{failed} tin không gửi được</span> : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} strokeWidth={1.8} aria-hidden="true" />
      </button>
      )}
      {isOpen ? (
        <ul className="border-t border-border">
          {waiting.map((item) => (
            <li key={item.id} className="border-t border-border px-3 py-2 first:border-t-0">
              <p className="line-clamp-2 text-[13px] text-foreground">{item.content}</p>
              <p className={cn("mt-0.5 text-[12px]", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {item.status === "failed" ? (item.failReason ?? "Không gửi được") : `Gửi lúc ${sendAtLine(new Date(item.sendAt))}`}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setEditing(item)} className="press min-h-9 rounded-md border border-border px-2.5 text-[12.5px] font-medium hover:bg-secondary">
                  {item.status === "failed" ? "Sửa & hẹn lại" : "Sửa"}
                </button>
                {item.status === "pending" ? (
                  <button type="button" onClick={() => run(sendNow.mutateAsync(item.id), "Đã gửi.")} className="press min-h-9 rounded-md border border-border px-2.5 text-[12.5px] font-medium hover:bg-secondary">
                    Gửi ngay
                  </button>
                ) : null}
                <button type="button" onClick={() => run(cancel.mutateAsync(item.id), item.status === "failed" ? "Đã xoá." : "Đã huỷ hẹn giờ.")} className="press min-h-9 rounded-md px-2.5 text-[12.5px] font-medium text-destructive hover:bg-destructive/10">
                  {item.status === "failed" ? "Xoá" : "Huỷ"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ScheduleMessageDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        content={editing?.content ?? ""}
        initialAt={editing !== null && editing.status === "pending" ? new Date(editing.sendAt) : null}
        title={editing?.status === "failed" ? "Hẹn lại" : "Sửa giờ gửi"}
        submitLabel="Lưu"
        isWorking={update.isPending}
        onSubmit={(at) => {
          if (editing === null) return;
          run(
            update.mutateAsync({ id: editing.id, content: editing.content, sendAt: at }).then(() => setEditing(null)),
            `Đã hẹn gửi lúc ${sendAtLine(at)}.`,
          );
        }}
      />
    </div>
  );
}
