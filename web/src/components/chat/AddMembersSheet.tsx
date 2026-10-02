import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { StackedSheetHeader, useEdgeSwipeBack } from "@/components/chat/StackedSheetHeader";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { addGroupMembers, chatKeys } from "@/lib/chat";
import { connectionKeys, fetchMyConnections, type Connection } from "@/lib/connections";
import { groupKeys } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import { cn } from "@/lib/utils";

function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/**
 * Thành viên › Thêm thành viên (AVORA-47 · I): only the adder's own friends who are not in the
 * group yet. The server checks the role (owner / admin), the friendship, blocks and the 300 cap.
 */
export function AddMembersSheet({
  open,
  conversationId,
  memberIds,
  stacked,
}: {
  open: boolean;
  conversationId: string;
  memberIds: readonly string[];
  stacked: { backLabel: string; onBack: () => void; onCloseAll: () => void };
}) {
  const queryClient = useQueryClient();
  const edgeSwipe = useEdgeSwipeBack(stacked.onBack);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState<string>("");

  const friendsQuery = useQuery<Connection[], Error>({
    queryKey: connectionKeys.all,
    queryFn: fetchMyConnections,
    enabled: open,
    staleTime: 60_000,
  });

  const candidates = useMemo(() => {
    const inGroup = new Set(memberIds);
    const needle = fold(query.trim());
    return (friendsQuery.data ?? [])
      .filter((friend) => !inGroup.has(friend.userId))
      .filter((friend) => needle === "" || fold(peerLabel(friend.displayName)).includes(needle) || (friend.pin ?? "").includes(needle));
  }, [friendsQuery.data, memberIds, query]);

  const addMutation = useMutation({
    mutationFn: () => addGroupMembers(conversationId, picked),
    onSuccess: (count) => {
      toast.success(count > 0 ? `Đã thêm ${count} người vào nhóm.` : "Không có ai mới để thêm.");
      setPicked([]);
      void queryClient.invalidateQueries({ queryKey: groupKeys.members(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      stacked.onBack();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = (userId: string): void =>
    setPicked((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : stacked.onBack())}>
      <SheetContent
        side="right"
        {...edgeSwipe}
        className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md [&>button.absolute]:hidden"
      >
        <StackedSheetHeader backLabel={stacked.backLabel} onBack={stacked.onBack} onCloseAll={stacked.onCloseAll} />
        <div className="px-5 pb-3 pt-4">
          <SheetTitle className="text-[19px] font-semibold tracking-tight text-foreground">Thêm thành viên</SheetTitle>
          <SheetDescription className="mt-1 text-[12.5px] text-muted-foreground">Bạn bè của bạn chưa ở trong nhóm.</SheetDescription>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên hoặc PIN"
              aria-label="Tìm bạn bè"
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-[16px] md:text-[15px] outline-none focus:border-personal/60"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {friendsQuery.isPending ? (
            <div className="flex justify-center py-12" role="status" aria-label="Đang tải">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : friendsQuery.isError ? (
            <div className="py-10 text-center">
              <p className="text-[14px] text-muted-foreground">{friendsQuery.error.message}</p>
              <button type="button" onClick={() => void friendsQuery.refetch()} className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium">
                Thử lại
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13.5px] text-muted-foreground">
              {query.trim() !== "" ? `Không thấy ai khớp "${query.trim()}".` : "Mọi bạn bè của bạn đã ở trong nhóm."}
            </p>
          ) : (
            <ul>
              {candidates.map((friend) => {
                const isOn = picked.includes(friend.userId);
                return (
                  <li key={friend.userId}>
                    <button
                      type="button"
                      aria-pressed={isOn}
                      onClick={() => toggle(friend.userId)}
                      className="press flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent/30"
                    >
                      <InitialsAvatar name={peerLabel(friend.displayName)} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{peerLabel(friend.displayName)}</span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                          isOn ? "border-personal bg-personal text-personal-foreground" : "border-border",
                        )}
                      >
                        {isOn ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <button
            type="button"
            disabled={picked.length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            className="press h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-45"
          >
            {addMutation.isPending ? "Đang thêm…" : picked.length > 0 ? `Thêm ${picked.length} người` : "Chọn người để thêm"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
