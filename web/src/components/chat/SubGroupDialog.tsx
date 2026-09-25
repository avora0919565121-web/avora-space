import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { createSubGroup, type GroupMember } from "@/lib/groups";
import { memberLabel } from "@/lib/member-search";

/**
 * Opens a sub-group under the current group. The opener becomes its owner; members are picked
 * from the parent group only, all ticked by default. Nothing is inherited later: people added
 * to the parent afterwards do not appear here on their own (ADR-014).
 */
export function SubGroupDialog({
  open,
  onOpenChange,
  parentGroupId,
  parentName,
  members,
  selfId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentGroupId: string;
  parentName: string;
  members: readonly GroupMember[];
  selfId: string | undefined;
  onCreated: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { isSubmitting, guard } = useSubmitGuard();
  const [name, setName] = useState<string>("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const others = members.filter((member) => member.userId !== selfId);

  useEffect(() => {
    if (!open) return;
    setName("");
    setNotice(null);
    setPicked(new Set(members.filter((member) => member.userId !== selfId).map((member) => member.userId)));
  }, [open, members, selfId]);

  const submit = useCallback(async (): Promise<void> => {
    if (name.trim().length === 0) {
      setNotice("Nhóm con cần một cái tên.");
      return;
    }
    setNotice(null);
    await guard(async () => {
      try {
        const id = await createSubGroup(parentGroupId, name, [...picked]);
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        toast.success(`Đã tạo nhóm con "${name.trim()}".`);
        onOpenChange(false);
        onCreated(id);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không tạo được nhóm con.");
      }
    });
  }, [name, guard, parentGroupId, picked, queryClient, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Tạo nhóm con</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Nằm dưới {parentName}. Bạn là Owner của nhóm con; chỉ mời được người đang ở nhóm này.
        </DialogDescription>
        <label className="mt-2 block">
          <span className="text-[13px] font-medium text-muted-foreground">Tên nhóm con</span>
          <input
            value={name}
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
          />
        </label>
        {others.length > 0 ? (
          <fieldset className="mt-1">
            <legend className="text-[13px] font-medium text-muted-foreground">Thành viên</legend>
            <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
              {others.map((member) => (
                <li key={member.userId}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/30">
                    <input
                      type="checkbox"
                      checked={picked.has(member.userId)}
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(member.userId);
                          else next.delete(member.userId);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="text-[14px] text-foreground">{memberLabel(member)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        {notice !== null ? (
          <p role="alert" className="text-[13.5px] text-destructive">
            {notice}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Để sau
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? "Đang tạo…" : "Tạo nhóm con"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
