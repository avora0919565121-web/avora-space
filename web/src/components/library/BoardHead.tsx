import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, ListPlus, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { askConfirm, askText } from "@/components/ConfirmHost";
import { TaskCard } from "@/components/tasks/TaskCard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import {
  boardHeadKeys,
  canEditHead,
  canEditQuestion,
  fetchConclusions,
  hasLifecycle,
  lifecycleLabel,
  LIFECYCLES,
  markConcludeSuggested,
  saveConclusion,
  setLifecycle,
  setThinkingType,
  shortDate,
  wasConcludeSuggested,
  type Conclusion,
  type Lifecycle,
} from "@/lib/board-head";
import { boardChangeKeys } from "@/lib/board-changes";
import { supabase } from "@/integrations/supabase/client";
import { announceDeskFull } from "@/lib/use-desk";
import { thinkHubKeys, type ThinkTable } from "@/lib/think-hub";
import { THINKING_TYPES, type ThinkingType } from "@/lib/think-hub-shelf";
import { useComposerActions } from "@/lib/use-task-composer";
import { cn } from "@/lib/utils";

/** Every conclusion I can see, newest first — shared by the open board, kệ 03 and the history. */
export function useConclusions() {
  const { user } = useAuth();
  return useQuery<Conclusion[], Error>({ queryKey: boardHeadKeys.conclusions, queryFn: fetchConclusions, enabled: Boolean(user?.id), staleTime: 30_000 });
}

/** Changing the lifecycle from anywhere (▾ here, a drag on kệ 03) goes through one place. */
export function useLifecycleChange(): (table: ThinkTable, next: Lifecycle) => Promise<boolean> {
  const queryClient = useQueryClient();
  return async (table, next) => {
    try {
      await setLifecycle(table.id, next);
      // AVORA-81 · B1 ①: marking a board Đang suy nghĩ puts it on my desk (full → choose one to put down).
      if (next === "thinking") {
        const { error } = await supabase.rpc("place_on_desk", { p_table_id: table.id });
        if (error?.message.includes("avora_desk_full")) announceDeskFull(table.id);
        void queryClient.invalidateQueries({ queryKey: ["think-desk"] });
      }
      void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
      void queryClient.invalidateQueries({ queryKey: boardChangeKeys.table(table.id) });
      toast.success(`Đã đánh dấu “${lifecycleLabel(next)}”.`);
      return true;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa đổi được.");
      return false;
    }
  };
}

/**
 * AVORA-77 · A4 — the head of the open board, two lines:
 *
 *   Có nên mở xưởng thứ hai?                         Đang suy nghĩ ▾
 *   Kết luận: Nên, nếu vay được 2 tỷ · 30/09   ›     (or: + Ghi kết luận)
 *
 * The question is the board's `purpose`. The lifecycle is only ever marked by a person.
 */
export function BoardHead({
  table,
  isReadOnly,
  scopeLabel,
  editingQuestion,
  onEditingQuestion,
  onSaveQuestion,
  projectLines,
}: {
  table: ThinkTable;
  isReadOnly: boolean;
  scopeLabel: string;
  editingQuestion: boolean;
  onEditingQuestion: (on: boolean) => void;
  onSaveQuestion: (question: string) => Promise<void>;
  /** A project's root board reads its project's Kim chỉ nam / Mục tiêu instead of a question. */
  projectLines?: { guide: string | null; objective: string | null } | null;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const conclusions = useConclusions();
  const changeLifecycle = useLifecycleChange();
  const { createPersonal } = useComposerActions();
  const [draft, setDraft] = useState<string>(table.purpose ?? "");
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isTaskOpen, setIsTaskOpen] = useState<boolean>(false);

  const mine = useMemo(() => (conclusions.data ?? []).filter((item) => item.tableId === table.id), [conclusions.data, table.id]);
  const latest: Conclusion | undefined = mine[0];
  const withLifecycle = hasLifecycle(table);
  const canHead = canEditHead(table, user?.id, isReadOnly);
  const canQuestion = canEditQuestion(table, user?.id) && !isReadOnly;
  const lifecycle: Lifecycle = table.lifecycle ?? "waiting";

  const writeConclusion = async (): Promise<void> => {
    const text = await askText({ title: latest === undefined ? "Ghi kết luận" : "Kết luận mới", body: "Một dòng. Kết luận cũ vẫn giữ trong lịch sử.", initial: "", confirmLabel: "Lưu", maxLength: 500 });
    if (text === null) return;
    try {
      await saveConclusion(table.id, text);
      void queryClient.invalidateQueries({ queryKey: boardHeadKeys.conclusions });
      void queryClient.invalidateQueries({ queryKey: boardChangeKeys.table(table.id) });
      toast.success("Đã ghi kết luận.");
      // Once per board, on its first conclusion: offer — never switch by itself.
      if (lifecycle !== "concluded" && mine.length === 0 && !wasConcludeSuggested(table.id)) {
        markConcludeSuggested(table.id);
        const ok = await askConfirm({ title: "Đánh dấu Đã chốt?", body: "Chỉ khi bạn thấy không cần nghĩ thêm về Bảng này.", confirmLabel: "Đánh dấu Đã chốt", cancelLabel: "Chưa" });
        if (ok) await changeLifecycle(table, "concluded");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Chưa ghi được kết luận.");
    }
  };

  return (
    <section aria-label="Câu hỏi của Bảng" data-board-head="" className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">{scopeLabel}</p>

      {projectLines != null ? (
        <dl className="mt-1.5 space-y-1.5 text-[13.5px]">
          <div>
            <dt className="inline font-medium text-muted-foreground">Kim chỉ nam: </dt>
            <dd className="inline text-foreground">{projectLines.guide ?? "…"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-muted-foreground">Mục tiêu: </dt>
            <dd className="inline text-foreground">{projectLines.objective ?? "…"}</dd>
          </div>
        </dl>
      ) : editingQuestion ? (
        <form
          className="mt-1.5 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveQuestion(draft);
          }}
        >
          <input
            value={draft}
            autoFocus
            maxLength={500}
            aria-label="Câu hỏi của Bảng"
            placeholder="Bảng này giúp bạn trả lời câu hỏi gì?"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onEditingQuestion(false)}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[16px] text-foreground outline-none focus:border-personal md:text-[14.5px]"
          />
          <button type="submit" className="press h-10 rounded-md bg-personal px-3.5 text-[13px] font-semibold text-personal-foreground">
            Lưu
          </button>
        </form>
      ) : (
        <div className="mt-1 flex items-start gap-2">
          <p className={cn("min-w-0 flex-1 text-[15.5px] font-medium leading-snug", table.purpose === null ? "text-muted-foreground" : "text-foreground")} data-board-question="">
            {table.purpose ?? (canQuestion ? "" : "Chưa có câu hỏi.")}
            {table.purpose === null && canQuestion ? (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  onEditingQuestion(true);
                }}
                className="press text-[14px] font-medium text-personal"
              >
                + Ghi câu hỏi của Bảng
              </button>
            ) : null}
          </p>
          {canQuestion && table.purpose !== null ? (
            <button
              type="button"
              onClick={() => {
                setDraft(table.purpose ?? "");
                onEditingQuestion(true);
              }}
              aria-label="Sửa câu hỏi của Bảng"
              title="Sửa câu hỏi của Bảng"
              className="press shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
          {withLifecycle ? (
            canHead && lifecycle !== "archived" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" data-lifecycle={lifecycle} className="press inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-accent/40">
                    {lifecycleLabel(lifecycle)}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  {LIFECYCLES.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={() => item.id !== lifecycle && void changeLifecycle(table, item.id)} className="gap-2">
                      <Check className={cn("h-4 w-4", item.id === lifecycle ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span data-lifecycle={lifecycle} className="inline-flex h-8 shrink-0 items-center rounded-full bg-secondary px-3 text-[12.5px] text-muted-foreground">
                {lifecycleLabel(lifecycle)}
              </span>
            )
          ) : null}
        </div>
      )}

      {withLifecycle ? (
        <div className="mt-1.5 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
          {latest !== undefined ? (
            <button type="button" onClick={() => setIsHistoryOpen(true)} data-conclusion="" className="press group flex min-w-0 flex-1 items-center gap-1 text-left">
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground">Kết luận: </span>
                <span className="text-foreground">{latest.body}</span>
                <span className="text-muted-foreground"> · {shortDate(latest.createdAt)}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-label="Lịch sử kết luận" />
            </button>
          ) : null}
          {canHead ? (
            <button type="button" onClick={() => void writeConclusion()} className="press shrink-0 text-[13px] font-medium text-personal">
              {latest === undefined ? "+ Ghi kết luận" : "Kết luận mới"}
            </button>
          ) : null}
          {lifecycle === "concluded" && latest !== undefined && !isReadOnly ? (
            <button type="button" onClick={() => setIsTaskOpen(true)} className="press inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12.5px] font-medium text-foreground hover:bg-accent/40">
              <ListPlus className="h-3.5 w-3.5" aria-hidden="true" /> Tạo việc từ kết luận
            </button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogTitle className="text-[18px]">Lịch sử kết luận</DialogTitle>
          <DialogDescription className="text-[13px]">{table.name} · chỉ đọc</DialogDescription>
          <ol className="max-h-[60dvh] space-y-2 overflow-y-auto" data-conclusion-history="">
            {mine.map((item) => (
              <li key={item.id} className="rounded-lg border border-border px-3 py-2">
                <p className="text-[14px] text-foreground">{item.body}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("vi-VN")}</p>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>

      {isTaskOpen && latest !== undefined ? (
        <TaskCard
          open
          onOpenChange={setIsTaskOpen}
          place="personal"
          source={{ label: `Từ kết luận của Bảng ${table.name}` }}
          initial={{ title: latest.body.slice(0, 200) }}
          onCreateMine={async (values) => {
            if (user?.id === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
            return createPersonal(user.id, values, null);
          }}
        />
      ) : null}
    </section>
  );
}

/** `⋯ › Kiểu tư duy` (A5): the five ways, one tap; `Không chọn` clears it. */
export function ThinkingTypeDialog({ table, open, onOpenChange }: { table: ThinkTable; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const pick = (type: ThinkingType | null): void => {
    setThinkingType(table.id, type).then(
      () => {
        void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
        onOpenChange(false);
        toast.success(type === null ? "Đã bỏ kiểu tư duy." : `Kiểu tư duy: ${THINKING_TYPES.find((item) => item.id === type)?.label ?? ""}.`);
      },
      (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Chưa đổi được."),
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="text-[18px]">Kiểu tư duy</DialogTitle>
        <DialogDescription className="text-[13px]">Câu hỏi dẫn hiện mờ trong ô ghi chú trống của mỗi Hạng mục.</DialogDescription>
        <ul className="space-y-1.5">
          {THINKING_TYPES.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={table.thinkingType === item.id}
                onClick={() => pick(item.id)}
                className={cn("press w-full rounded-lg border px-3 py-2.5 text-left", table.thinkingType === item.id ? "border-personal bg-personal-soft" : "border-border hover:bg-accent/30")}
              >
                <span className="block text-[14px] font-semibold text-foreground">{item.label}</span>
                <span className="block text-[12.5px] text-muted-foreground">{item.description}</span>
                <span className="mt-0.5 block text-[12.5px] italic text-muted-foreground/80">“{item.question}”</span>
              </button>
            </li>
          ))}
        </ul>
        {table.thinkingType != null ? (
          <button type="button" onClick={() => pick(null)} className="press self-start text-[13px] text-muted-foreground hover:text-foreground">
            Không chọn kiểu nào
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
