import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, QrCode, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ConnectQrDialog } from "@/components/contacts/ConnectQrDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { chatKeys, createDirectConversation } from "@/lib/chat";
import { looksLikePin, matchesConnection, NO_PIN_LABEL } from "@/lib/connections";
import { useConnections } from "@/lib/use-connections";

type NewChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the conversation id once it exists on the server. */
  onCreated: (conversationId: string) => void;
};

/**
 * Starts a 1-1 (AVORA-38 / ADR-029).
 *
 * Bạn bè are listed and searchable by name or PIN. Anyone else is reached only by their PIN —
 * typed or scanned — which opens a "Chờ kết bạn" frame instead of an ordinary chat.
 */
export function NewChatDialog({ open, onOpenChange, onCreated }: NewChatDialogProps) {
  const queryClient = useQueryClient();
  const { connections, isLoading, connectByPin, isWorking } = useConnections();
  const [query, setQuery] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState<boolean>(false);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setNotice(null);
  }, [open]);

  const filtered = useMemo(
    () => connections.filter((item) => matchesConnection(item, query)),
    [connections, query],
  );

  const finish = useCallback(
    (conversationId: string): void => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onOpenChange(false);
      onCreated(conversationId);
    },
    [queryClient, onOpenChange, onCreated],
  );

  const openWithFriend = useCallback(
    async (userId: string): Promise<void> => {
      setIsOpening(true);
      setNotice(null);
      try {
        finish(await createDirectConversation(userId));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chưa mở được. Thử lại nhé.");
      } finally {
        setIsOpening(false);
      }
    },
    [finish],
  );

  const openWithPin = useCallback(
    async (pin: string): Promise<void> => {
      setNotice(null);
      try {
        finish(await connectByPin(pin));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chưa mở được. Thử lại nhé.");
      }
    },
    [connectByPin, finish],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (filtered.length === 1) {
        void openWithFriend(filtered[0].userId);
        return;
      }
      if (looksLikePin(query)) {
        void openWithPin(query);
        return;
      }
      setNotice("Người chưa là bạn chỉ tìm được bằng PIN, dạng A-XXXXXXXX.");
    },
    [filtered, query, openWithFriend, openWithPin],
  );

  const showPinRow = looksLikePin(query) && filtered.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className="max-w-[540px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0">
          <div className="flex items-start justify-between px-6 pb-4 pt-6">
            <div>
              <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Trò chuyện mới</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
                Chọn một người bạn, hoặc nhập PIN của người mới
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

          <form className="flex gap-2 px-6 pb-4" onSubmit={handleSubmit}>
            <label className="relative block flex-1">
              <span className="sr-only">Tên hoặc PIN</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.6}
              />
              <input
                value={query}
                autoFocus
                autoCapitalize="characters"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setNotice(null);
                }}
                placeholder="Tên bạn bè hoặc A-XXXXXXXX"
                className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
            </label>
            <Button type="button" variant="outline" className="press h-11 gap-1.5 px-3.5" onClick={() => setIsQrOpen(true)}>
              <QrCode className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              <span className="hidden sm:inline">QR</span>
            </Button>
          </form>

          <div className="max-h-[46vh] overflow-y-auto border-t border-border">
            {showPinRow ? (
              <button
                type="button"
                disabled={isWorking}
                onClick={() => void openWithPin(query)}
                className="press flex w-full items-center gap-3 bg-primary/[0.06] px-6 py-4 text-left transition-colors hover:bg-primary/10"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <KeyRound className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">
                    {isWorking ? "Đang mở…" : "Kết bạn qua PIN"}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">
                    Mở khung chờ kết bạn — chỉ gửi chữ, tối đa 5 tin mỗi bên
                  </span>
                </span>
              </button>
            ) : null}

            {filtered.map((item) => (
              <button
                key={item.userId}
                type="button"
                disabled={isOpening}
                onClick={() => void openWithFriend(item.userId)}
                className="press flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-accent/40"
              >
                <InitialsAvatar name={item.displayName ?? "?"} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">
                    {item.displayName ?? "Người dùng AVORA"}
                  </span>
                  <span className="block truncate font-mono text-[12.5px] text-muted-foreground">
                    {item.pin ?? NO_PIN_LABEL}
                  </span>
                </span>
              </button>
            ))}

            {!showPinRow && filtered.length === 0 ? (
              <p className="px-6 py-6 text-center text-[14px] text-muted-foreground">
                {isLoading
                  ? "Đang tải bạn bè…"
                  : connections.length === 0
                    ? "Bạn chưa có bạn bè nào. Nhập PIN hoặc quét QR để kết bạn."
                    : "Không có bạn nào khớp. Người mới thì nhập PIN của họ."}
              </p>
            ) : null}
          </div>

          {notice ? (
            <p role="status" className="border-t border-border px-6 py-3 text-[13px] text-primary">
              {notice}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConnectQrDialog
        open={isQrOpen}
        onOpenChange={setIsQrOpen}
        onScanned={(pin) => {
          setIsQrOpen(false);
          void openWithPin(pin);
        }}
      />
    </>
  );
}
