import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { chatKeys } from "@/lib/chat";
import { matchesConnection, NO_PIN_LABEL } from "@/lib/connections";
import { canCreateGroup, createGroupConversation, GROUP_MAX_PEOPLE, GROUP_MIN_PEOPLE } from "@/lib/groups";
import { useConnections } from "@/lib/use-connections";
import { cn } from "@/lib/utils";

type NewGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new group's conversation id once it exists on the server. */
  onCreated: (conversationId: string) => void;
};

/**
 * Creates a group: a name, then members picked among bạn bè (AVORA-38 / ADR-029).
 * A Nhóm needs 3 people counting the creator; talking with one person is a 1-1.
 */
export function NewGroupDialog({ open, onOpenChange, onCreated }: NewGroupDialogProps) {
  const queryClient = useQueryClient();
  const { connections, isLoading } = useConnections();
  const [name, setName] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const { isSubmitting, guard } = useSubmitGuard();

  useEffect(() => {
    if (open) return;
    setName("");
    setQuery("");
    setSelected(new Set());
    setNotice(null);
  }, [open]);

  const filtered = useMemo(() => connections.filter((item) => matchesConnection(item, query)), [connections, query]);

  const toggle = useCallback((userId: string): void => {
    setNotice(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size + 1 < GROUP_MAX_PEOPLE) next.add(userId);
      return next;
    });
  }, []);

  const createMutation = useMutation({
    mutationFn: () => createGroupConversation(name, [...selected]),
    onSuccess: (conversationId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onOpenChange(false);
      onCreated(conversationId);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const missing = Math.max(0, GROUP_MIN_PEOPLE - 1 - selected.size);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[540px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0">
        <div className="flex items-start justify-between px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Nhóm mới</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Đặt tên nhóm và chọn thành viên trong bạn bè
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        <div className="px-6 pb-3">
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Tên nhóm</span>
            <input
              value={name}
              autoFocus
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ví dụ: Nhóm dự án AVORA"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
        </div>

        <div className="px-6 pb-4">
          <label className="relative block">
            <span className="sr-only">Tìm bạn bè</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.6}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên hoặc PIN"
              className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
        </div>

        <div className="max-h-[260px] overflow-y-auto border-t border-border px-3 py-2">
          {filtered.map((item) => {
            const isOn = selected.has(item.userId);
            return (
              <button
                key={item.userId}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggle(item.userId)}
                className={cn(
                  "press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isOn ? "bg-primary/[0.07]" : "hover:bg-accent/30",
                )}
              >
                <InitialsAvatar name={item.displayName ?? "?"} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{item.displayName ?? "Người dùng AVORA"}</span>
                  <span className="block truncate font-mono text-[12.5px] text-muted-foreground">{item.pin ?? NO_PIN_LABEL}</span>
                </span>
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {isOn ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[14px] text-muted-foreground">
              {isLoading
                ? "Đang tải bạn bè…"
                : connections.length === 0
                  ? "Chỉ thêm được bạn bè vào nhóm. Kết bạn qua PIN trước nhé."
                  : "Không có bạn nào khớp."}
            </p>
          ) : null}
        </div>
        {notice ? <p className="border-t border-border px-6 py-3 text-[13px] text-primary">{notice}</p> : null}

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-[13px] text-muted-foreground">
            {missing > 0 ? `Chọn thêm ${missing} người — nhóm cần ít nhất 3 người` : `Bạn + ${selected.size} thành viên`}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button
              className="press h-10 px-5"
              disabled={!canCreateGroup(name, selected.size) || isSubmitting}
              onClick={() => {
                void guard(() => createMutation.mutateAsync().catch(() => undefined));
              }}
            >
              {isSubmitting ? "Đang tạo…" : "Tạo nhóm"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
