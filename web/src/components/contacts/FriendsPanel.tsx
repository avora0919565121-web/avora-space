import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MessageCircle, QrCode, UserMinus } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ConnectQrDialog } from "@/components/contacts/ConnectQrDialog";
import { InviteMessageDialog } from "@/components/contacts/InviteMessageDialog";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { createDirectConversation } from "@/lib/chat";
import {
  fetchAllowGroupConnection,
  looksLikePin,
  matchesConnection,
  normalizePinInput,
  NO_PIN_LABEL,
  setAllowGroupConnection,
  type Connection,
} from "@/lib/connections";
import { useConnections } from "@/lib/use-connections";

/**
 * Bạn bè in Liên hệ (AVORA-38 / Nhóm D).
 * Lists every bạn with their PIN (or "Chưa có PIN"), lets the viewer add someone by PIN or QR,
 * remove a bạn, and decide whether people in a shared Nhóm may open a frame with them.
 */
export function FriendsPanel({ query }: { query: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { connections, isLoading, connectByPin, remove, isWorking } = useConnections();
  const [pin, setPin] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isQrOpen, setIsQrOpen] = useState<boolean>(false);
  const [confirmRemove, setConfirmRemove] = useState<Connection | null>(null);
  /** The PIN waiting for its request message (AVORA-56 · A). */
  const [pendingPin, setPendingPin] = useState<string | null>(null);

  const visible = useMemo(() => connections.filter((item) => matchesConnection(item, query)), [connections, query]);

  const allowQuery = useQuery<boolean, Error>({
    queryKey: ["allow-group-connection", userId],
    queryFn: () => fetchAllowGroupConnection(userId),
    enabled: userId !== "",
  });
  const allowMutation = useMutation({
    mutationFn: (allow: boolean) => setAllowGroupConnection(userId, allow),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["allow-group-connection", userId] }),
    onError: (error: Error) => setNotice(error.message),
  });

  const openByPin = useCallback((value: string): void => {
    setNotice(null);
    setPendingPin(normalizePinInput(value));
  }, []);

  const sendRequest = useCallback(
    async (message: string): Promise<void> => {
      if (pendingPin === null) return;
      const conversationId = await connectByPin(pendingPin, message);
      setPendingPin(null);
      setPin("");
      navigate(`/tin-nhan/${conversationId}`);
    },
    [pendingPin, connectByPin, navigate],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!looksLikePin(pin)) {
        setNotice("PIN có dạng A-XXXXXXXX.");
        return;
      }
      openByPin(pin);
    },
    [pin, openByPin],
  );

  const chatWith = useCallback(
    async (otherId: string): Promise<void> => {
      try {
        navigate(`/tin-nhan/${await createDirectConversation(otherId)}`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chưa mở được. Thử lại nhé.");
      }
    },
    [navigate],
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2 rounded-xl border border-border bg-card p-3">
        <label className="relative block flex-1">
          <span className="sr-only">PIN của người muốn kết bạn</span>
          <KeyRound
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
          />
          <input
            value={pin}
            onChange={(event) => {
              setPin(event.target.value);
              setNotice(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="Kết bạn qua PIN: A-XXXXXXXX"
            className="h-11 w-full rounded-md border border-border bg-card pl-10 pr-3 font-mono text-[14.5px] uppercase text-foreground outline-none transition-colors placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
        </label>
        <button
          type="submit"
          disabled={isWorking}
          className="press h-11 rounded-md bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
        >
          {isWorking ? "Đang mở…" : "Kết bạn"}
        </button>
        <button
          type="button"
          aria-label="Kết bạn bằng mã QR"
          onClick={() => setIsQrOpen(true)}
          className="press flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent/40"
        >
          <QrCode className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </form>
      {notice ? (
        <p role="status" className="-mt-2 px-1 text-[13px] text-primary">
          {notice}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {visible.map((item) => (
          <div key={item.userId} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
            <InitialsAvatar name={item.displayName ?? "?"} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-foreground">{item.displayName ?? "Người dùng AVORA"}</span>
              <span className="block truncate font-mono text-[12.5px] text-muted-foreground">{item.pin ?? NO_PIN_LABEL}</span>
            </span>
            {confirmRemove?.userId === item.userId ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(null)}
                  className="press h-9 rounded-md border border-border px-3 text-[13px] text-foreground hover:bg-accent/40"
                >
                  Giữ
                </button>
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => {
                    void remove(item.userId)
                      .then(() => setConfirmRemove(null))
                      .catch((error: Error) => setNotice(error.message));
                  }}
                  className="press h-9 rounded-md bg-destructive px-3 text-[13px] font-semibold text-destructive-foreground"
                >
                  Gỡ kết bạn
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Nhắn tin với ${item.displayName ?? "người này"}`}
                  onClick={() => void chatWith(item.userId)}
                  className="press flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Gỡ kết bạn với ${item.displayName ?? "người này"}`}
                  onClick={() => setConfirmRemove(item)}
                  className="press flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <UserMinus className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">
            {isLoading
              ? "Đang tải bạn bè…"
              : connections.length === 0
                ? "Chưa có bạn bè. Nhập PIN hoặc quét QR của người bạn muốn kết nối."
                : "Không có bạn nào khớp."}
          </p>
        ) : null}
      </div>

      <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <span className="min-w-0">
          <span className="block text-[14.5px] font-medium text-foreground">Cho phép kết bạn qua nhóm</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            Người chung nhóm có thể mở khung chờ kết bạn với bạn mà không cần PIN.
          </span>
        </span>
        <Switch
          checked={allowQuery.data ?? true}
          disabled={allowQuery.isPending || allowMutation.isPending}
          onCheckedChange={(next) => allowMutation.mutate(next)}
        />
      </label>

      <ConnectQrDialog
        open={isQrOpen}
        onOpenChange={setIsQrOpen}
        onScanned={(scanned) => {
          setIsQrOpen(false);
          openByPin(scanned);
        }}
      />
      <InviteMessageDialog
        open={pendingPin !== null}
        onOpenChange={(next) => (next ? undefined : setPendingPin(null))}
        recipientLabel={pendingPin ?? ""}
        onSend={sendRequest}
      />
    </div>
  );
}
