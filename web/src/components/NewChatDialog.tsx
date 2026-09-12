import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { chatKeys, createDirectConversation, findUserByEmail, type DirectoryMatch } from "@/lib/chat";
import { peerLabel } from "@/lib/initials";

type NewChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the conversation id once it exists on the server. */
  onCreated: (conversationId: string) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Starts a 1-1 conversation by exact email.
 * AVORA has no browsable member list, so lookup is a single exact match.
 */
export function NewChatDialog({ open, onOpenChange, onCreated }: NewChatDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState<string>("");
  const [match, setMatch] = useState<DirectoryMatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setEmail("");
    setMatch(null);
    setNotice(null);
  }, [open]);

  const searchMutation = useMutation({
    mutationFn: (value: string) => findUserByEmail(value),
    onSuccess: (result: DirectoryMatch | null) => {
      setMatch(result);
      setNotice(result === null ? "Không tìm thấy người dùng AVORA với email này." : null);
    },
    onError: (error: Error) => {
      setMatch(null);
      setNotice(error.message);
    },
  });

  const createMutation = useMutation({
    mutationFn: (otherUserId: string) => createDirectConversation(otherUserId),
    onSuccess: (conversationId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onOpenChange(false);
      onCreated(conversationId);
    },
    onError: (error: Error) => {
      setNotice(error.message);
    },
  });

  const handleSearch = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const value = email.trim();
      setMatch(null);
      if (!EMAIL_PATTERN.test(value)) {
        setNotice("Nhập một địa chỉ email hợp lệ.");
        return;
      }
      if (user?.email && value.toLowerCase() === user.email.toLowerCase()) {
        setNotice("Đây là email của bạn. Hãy nhập email của người bạn muốn nhắn.");
        return;
      }
      setNotice(null);
      searchMutation.mutate(value);
    },
    [email, user?.email, searchMutation],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[540px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              Trò chuyện mới
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Nhập chính xác email của người dùng AVORA
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

        <form className="flex gap-2 px-6 pb-5" onSubmit={handleSearch}>
          <label className="relative block flex-1">
            <span className="sr-only">Email người nhận</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.6}
            />
            <input
              value={email}
              autoFocus
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ten@vidu.com"
              className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
          <Button type="submit" variant="outline" className="press h-11 px-5" disabled={searchMutation.isPending}>
            {searchMutation.isPending ? "Đang tìm…" : "Tìm"}
          </Button>
        </form>

        <div className="border-t border-border">
          {match ? (
            <div className="flex items-center gap-3 bg-accent/40 px-6 py-4">
              <InitialsAvatar name={peerLabel(match.displayName, match.email)} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium text-foreground">
                  {peerLabel(match.displayName, match.email)}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">{match.email}</span>
              </span>
            </div>
          ) : (
            <p className="px-6 py-6 text-center text-[14px] text-muted-foreground">
              {notice ?? "Tìm theo email để bắt đầu trò chuyện."}
            </p>
          )}
          {match && notice ? <p className="px-6 pb-4 text-[13px] text-primary">{notice}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            className="press h-10 px-5"
            disabled={match === null || createMutation.isPending}
            onClick={() => {
              if (match) createMutation.mutate(match.userId);
            }}
          >
            {createMutation.isPending ? "Đang mở…" : "Bắt đầu trò chuyện"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
