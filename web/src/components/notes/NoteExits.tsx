import { useMemo, useState } from "react";
import { toast } from "sonner";

import { TaskCard } from "@/components/tasks/TaskCard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { normalizeSearch } from "@/lib/normalize-search";
import { createThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useThinkTables } from "@/lib/use-think-hub";
import { useComposerActions } from "@/lib/use-task-composer";

export type TaskExit = { title: string; text: string; sourceLabel: string };
export type BoardExit = { title: string; text: string };

/**
 * The two ways out of a Ghi chép (AVORA-44 · B/C): "Tạo nhiệm vụ" is the one task form (ADR-030)
 * with the note as its Nguồn; "Đưa vào Bảng" makes a Hạng mục in a table the person may add to.
 * The note's words go in as plain words — the note itself stays where it is, unlinked.
 */
export function NoteExits({
  task,
  board,
  onTaskClose,
  onBoardClose,
}: {
  task: TaskExit | null;
  board: BoardExit | null;
  onTaskClose: () => void;
  onBoardClose: () => void;
}) {
  const { user } = useAuth();
  const { createPersonal } = useComposerActions();
  const tables = useThinkTables();
  const [query, setQuery] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const targets = useMemo(() => {
    const needle = normalizeSearch(query);
    return (tables.data ?? []).filter(
      (table: ThinkTable) =>
        table.deletedAt === null &&
        table.archivedAt === null &&
        table.kind !== "bookshelf" &&
        table.projectId === null &&
        (needle === "" || normalizeSearch(table.name).includes(needle)),
    );
  }, [tables.data, query]);

  return (
    <>
      <TaskCard
        open={task !== null}
        onOpenChange={(open) => {
          if (!open) onTaskClose();
        }}
        place="personal"
        source={task === null ? null : { label: task.sourceLabel }}
        initial={task === null ? undefined : { title: task.title.slice(0, 200), description: task.text.slice(0, 2000) }}
        onCreateMine={async (values) => {
          if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
          return createPersonal(user.id, values, null);
        }}
        onCreated={() => onTaskClose()}
      />
      <Dialog open={board !== null} onOpenChange={(open) => !open && onBoardClose()}>
        <DialogContent className={cn(longDialogContentClass, "max-w-md")}>
          <LongDialogHeader>
          <DialogTitle>Đưa vào Bảng</DialogTitle>
          <DialogDescription className="mt-1">Tạo một Hạng mục mới từ ghi chép này. Ghi chép vẫn giữ nguyên.</DialogDescription>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm Bảng"
            className="mt-3 h-10 w-full rounded-md border border-border bg-background px-3 text-[16px] md:text-[14px] outline-none focus:border-personal"
          />
          </LongDialogHeader>
          <LongDialogBody>
          <ul className="space-y-1">
            {tables.isPending ? <li className="py-4 text-center text-[13px] text-muted-foreground">Đang tải Bảng…</li> : null}
            {tables.isError ? <li className="py-4 text-center text-[13px] text-destructive">Chưa tải được danh sách Bảng.</li> : null}
            {tables.isSuccess && targets.length === 0 ? <li className="py-4 text-center text-[13px] text-muted-foreground">Không có Bảng phù hợp.</li> : null}
            {targets.map((table) => (
              <li key={table.id}>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    if (board === null) return;
                    setIsSaving(true);
                    void createThinkRecord({
                      tableId: table.id,
                      scope: { conversationId: table.conversationId, projectId: null },
                      title: board.title.slice(0, 200) || "Hạng mục từ ghi chép",
                      notes: board.text.slice(0, 4000),
                    })
                      .then(() => {
                        toast.success(`Đã tạo Hạng mục trong "${table.name}".`);
                        onBoardClose();
                      })
                      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không tạo được Hạng mục."))
                      .finally(() => setIsSaving(false));
                  }}
                  className="press flex w-full items-center rounded-md border border-border px-3 py-2.5 text-left text-[14px] hover:bg-accent/40 disabled:opacity-50"
                >
                  <span className="truncate">{table.name}</span>
                  <span className="ml-auto pl-2 text-[11.5px] text-muted-foreground">{table.conversationId === null ? "Của tôi" : "Chung"}</span>
                </button>
              </li>
            ))}
          </ul>
          </LongDialogBody>
          <LongDialogFooter>
            <button type="button" onClick={onBoardClose} className="press h-10 rounded-md border border-border px-4 text-[14px]">
              Huỷ
            </button>
          </LongDialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
