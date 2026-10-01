import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { createDirectConversation } from "@/lib/chat";
import { matchesConnection, type Connection } from "@/lib/connections";
import { buildContextSnapshot } from "@/lib/task-context";
import { useConnections } from "@/lib/use-connections";
import { useComposerActions } from "@/lib/use-task-composer";

/**
 * `+ › Giao việc cho người khác` (AVORA-60 · D): pick one of your bạn bè, then the one task form
 * opens on "Cho {tên}" — the same suggestion a 1-1 would send, filed in that 1-1 so both see it.
 */
export function AssignTaskFlow({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const { connections } = useConnections();
  const { proposeOne } = useComposerActions();
  const [query, setQuery] = useState<string>("");
  const [target, setTarget] = useState<{ person: Connection; conversationId: string } | null>(null);
  const [isOpening, setIsOpening] = useState<boolean>(false);

  const shown = useMemo(() => connections.filter((item) => matchesConnection(item, query)), [connections, query]);
  const nameOf = (person: Connection): string => person.displayName?.trim() || "Người dùng AVORA";

  const pick = async (person: Connection): Promise<void> => {
    setIsOpening(true);
    try {
      const conversationId = await createDirectConversation(person.userId);
      setTarget({ person, conversationId });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không mở được cuộc trò chuyện với người này.");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setQuery("");
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-[420px] gap-0 p-0">
          <div className="border-b border-border px-5 pb-3 pt-5 pr-12">
            <DialogTitle className="text-[17px] font-semibold">Giao việc cho ai?</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Chọn một người bạn — việc sẽ nằm trong cuộc trò chuyện của hai người.
            </DialogDescription>
          </div>
          <div className="px-5 pt-3">
            <label className="flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm theo tên hoặc PIN"
                aria-label="Tìm bạn"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]"
              />
            </label>
          </div>
          <ul className="max-h-[50dvh] overflow-y-auto px-2 py-2">
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">
                {connections.length === 0 ? "Chưa có bạn nào. Kết bạn bằng PIN trong Kết nối nhé." : "Không thấy ai khớp."}
              </li>
            ) : (
              shown.map((person) => (
                <li key={person.userId}>
                  <button
                    type="button"
                    disabled={isOpening}
                    onClick={() => void pick(person)}
                    className="press flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-accent/40 disabled:opacity-60"
                  >
                    <InitialsAvatar name={nameOf(person)} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{nameOf(person)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
      {target !== null ? (
        <TaskComposer
          open
          onOpenChange={(next) => (next ? undefined : setTarget(null))}
          place="direct"
          peerId={target.person.userId}
          peerName={nameOf(target.person)}
          startChoice="peer"
          onCreateMine={async (values) => {
            // "Cho tôi" picked after all: the 1-1's own self path, same as from the chat.
            if (user === null || user === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
            await proposeOne(
              {
                conversationId: target.conversationId,
                assigneeId: user.id,
                messageId: null,
                contextSnapshot: snapshot(target, values.description),
              },
              values,
              true,
            );
          }}
          onPropose={async (assigneeId, values) => {
            await proposeOne(
              { conversationId: target.conversationId, assigneeId, messageId: null, contextSnapshot: snapshot(target, values.description) },
              values,
              false,
            );
          }}
        />
      ) : null}
    </>
  );
}

function snapshot(target: { person: Connection; conversationId: string }, description: string) {
  return buildContextSnapshot({
    conversationType: "direct",
    conversationId: target.conversationId,
    conversationName: target.person.displayName?.trim() || "Người dùng AVORA",
    message: null,
    senderName: "",
    userResponse: description,
  });
}
