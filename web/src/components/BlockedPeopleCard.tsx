import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { blockedPersonLabel, NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import { useBlocks } from "@/lib/use-blocks";
import { useOnline } from "@/lib/use-online";

/**
 * Người đã chặn (AVORA-37 / A). Only the people the viewer blocked — never who blocked them.
 * Unblocking is one tap and tells nobody, so there is no confirmation here.
 */
export function BlockedPeopleCard() {
  const { blocks, isLoading, unblock, isWorking } = useBlocks();
  const isOnline = useOnline();

  const handleUnblock = (userId: string, label: string): void => {
    void unblock(userId)
      .then(() => toast.success(`Đã bỏ chặn ${label}.`))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa lưu được."));
  };

  return (
    <section aria-labelledby="blocked-people-title" className="mt-s-4 rounded-card border border-border bg-card p-s-4">
      <h2 id="blocked-people-title" className="flex items-center gap-2 text-[17px] font-semibold text-foreground">
        <Ban className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        Người đã chặn
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Họ không nhắn, gửi gợi ý việc hay tìm thấy bạn được. Họ không biết mình bị chặn.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6" role="status" aria-label="Đang tải danh sách">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : blocks.length === 0 ? (
        <p className="mt-s-2 text-[14px] text-muted-foreground">Bạn chưa chặn ai.</p>
      ) : (
        <ul className="mt-s-2 divide-y divide-border">
          {blocks.map((person) => {
            const label = blockedPersonLabel(person);
            return (
              <li key={person.userId} className="flex min-h-14 items-center gap-3 py-2">
                <InitialsAvatar name={label} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-foreground">{label}</p>
                  {person.email !== null && person.email !== label ? (
                    <p className="truncate text-[12.5px] text-muted-foreground">{person.email}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={isWorking || !isOnline}
                  title={isOnline ? undefined : NEEDS_NETWORK_MESSAGE}
                  onClick={() => handleUnblock(person.userId, label)}
                  className="press h-11 shrink-0 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
                >
                  {isOnline ? "Bỏ chặn" : NEEDS_NETWORK_MESSAGE}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
