import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { chatKeys, findUserByEmail, type DirectoryMatch } from "@/lib/chat";
import { canCreateGroup, createGroupConversation } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";

type NewGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new group's conversation id once it exists on the server. */
  onCreated: (conversationId: string) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates a group: a name, then members added one exact email at a time.
 * AVORA has no browsable member list, so invitations are always by address —
 * the same rule the 1-1 flow follows.
 */
export function NewGroupDialog({ open, onOpenChange, onCreated }: NewGroupDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [members, setMembers] = useState<DirectoryMatch[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const { isSubmitting, guard } = useSubmitGuard();

  useEffect(() => {
    if (open) return;
    setName("");
    setEmail("");
    setMembers([]);
    setNotice(null);
  }, [open]);

  const searchMutation = useMutation({
    mutationFn: (value: string) => findUserByEmail(value),
    onSuccess: (result: DirectoryMatch | null) => {
      if (result === null) {
        setNotice("Không tìm thấy người dùng AVORA với email này.");
        return;
      }
      if (members.some((member) => member.userId === result.userId)) {
        setNotice(`${peerLabel(result.displayName, result.email)} đã có trong danh sách.`);
        return;
      }
      setMembers((current) => [...current, result]);
      setEmail("");
      setNotice(null);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const createMutation = useMutation({
    mutationFn: () => createGroupConversation(name, members.map((member) => member.userId)),
    onSuccess: (conversationId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onOpenChange(false);
      onCreated(conversationId);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const handleAdd = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const value = email.trim();
      if (!EMAIL_PATTERN.test(value)) {
        setNotice("Nhập một địa chỉ email hợp lệ.");
        return;
      }
      if (user?.email && value.toLowerCase() === user.email.toLowerCase()) {
        setNotice("Bạn là chủ nhóm nên đã ở trong nhóm rồi.");
        return;
      }
      setNotice(null);
      searchMutation.mutate(value);
    },
    [email, user?.email, searchMutation],
  );

  const removeMember = useCallback((userId: string): void => {
    setMembers((current) => current.filter((member) => member.userId !== userId));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[540px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Nhóm mới</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Đặt tên nhóm và thêm thành viên bằng email
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

        <div className="px-6 pb-4">
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

        <form className="flex gap-2 px-6 pb-5" onSubmit={handleAdd}>
          <label className="relative block flex-1">
            <span className="sr-only">Email thành viên</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.6}
            />
            <input
              value={email}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ten@vidu.com"
              className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
          <Button type="submit" variant="outline" className="press h-11 px-5" disabled={searchMutation.isPending}>
            {searchMutation.isPending ? "Đang tìm…" : "Thêm"}
          </Button>
        </form>

        <div className="border-t border-border">
          {members.length > 0 ? (
            <ul className="max-h-[220px] overflow-y-auto px-3 py-2">
              {members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/30">
                  <InitialsAvatar name={peerLabel(member.displayName, member.email)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {peerLabel(member.displayName, member.email)}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">{member.email}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Bỏ ${peerLabel(member.displayName, member.email)} khỏi danh sách`}
                    onClick={() => removeMember(member.userId)}
                    className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center justify-center gap-2 px-6 py-6 text-center text-[14px] text-muted-foreground">
              <UserPlus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              Thêm ít nhất một thành viên bằng email
            </p>
          )}
          {notice ? <p className="px-6 pb-4 text-[13px] text-primary">{notice}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-[13px] text-muted-foreground">
            {members.length > 0 ? `Bạn + ${members.length} thành viên` : "Bạn là chủ nhóm"}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button
              className="press h-10 px-5"
              disabled={!canCreateGroup(name, members.length) || isSubmitting}
              onClick={() => {
                // Errors are already shown by the mutation's onError; swallow here so the guard releases.
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
