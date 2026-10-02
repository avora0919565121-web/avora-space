import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { StackedSheetHeader, useEdgeSwipeBack } from "@/components/chat/StackedSheetHeader";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { attachmentKeys, fetchThreadAttachments, type MessageAttachment } from "@/lib/attachments";
import { fetchConversationDiary, type DiaryLine } from "@/lib/chat";
import {
  conversationFiles,
  conversationLinks,
  conversationSourceTasks,
  firstLineByDay,
  localDayKey,
} from "@/lib/conversation-diary";
import { useTasks } from "@/lib/use-tasks";
import type { TaskItem } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { FileChipRow } from "@/components/chat/FileChipRow";
import { matchesFileChip, readFileChip, writeFileChip, type FileChip } from "@/lib/file-category";

type DiaryTab = "days" | "files" | "links" | "sources";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function stamp(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

function taskStatusLabel(task: TaskItem): string {
  if (task.status === "done") return "Đã xong";
  if (task.status === "skipped") return "Đã bỏ qua";
  return "Đang mở";
}

/**
 * Nhật ký trò chuyện (AVORA-52 · B): one 1-1 or group seen the way Nhật ký is — by day, its
 * files, its links and the lines that became tasks. Computed from what the viewer can already
 * read (RLS), never a new store; recalled lines and their files are absent.
 */
export function ConversationDiarySheet({
  open,
  conversationId,
  title,
  stacked,
  urlOf,
  nameOf,
  onJumpToMessage,
  onOpenTask,
}: {
  open: boolean;
  conversationId: string;
  title: string;
  stacked: { backLabel: string; onBack: () => void; onCloseAll: () => void };
  urlOf: (storagePath: string) => string | null;
  nameOf: (userId: string) => string;
  /** Closes everything and lands on that line in the thread. */
  onJumpToMessage: (messageId: string) => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  const [tab, setTab] = useState<DiaryTab>("days");
  // AVORA-73 · B: the same chip row as File của tôi, remembered per device.
  const [fileChip, setFileChipState] = useState<FileChip>(() => readFileChip("avora.conversation-files.chip"));
  const setFileChip = (next: FileChip): void => {
    setFileChipState(next);
    writeFileChip("avora.conversation-files.chip", next);
  };
  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const edgeSwipe = useEdgeSwipeBack(stacked.onBack);

  const linesQuery = useQuery<DiaryLine[], Error>({
    queryKey: ["chat", "conversation-diary", conversationId],
    queryFn: () => fetchConversationDiary(conversationId),
    enabled: open,
    staleTime: 30_000,
  });
  const attachmentsQuery = useQuery<MessageAttachment[], Error>({
    queryKey: attachmentKeys.thread(conversationId),
    queryFn: () => fetchThreadAttachments(conversationId),
    enabled: open,
    staleTime: 30_000,
  });
  const { data: tasks } = useTasks();

  const lines = useMemo(() => linesQuery.data ?? [], [linesQuery.data]);
  const dayFirst = useMemo(() => firstLineByDay(lines), [lines]);
  const links = useMemo(() => conversationLinks(lines), [lines]);
  const allFiles = useMemo(() => conversationFiles(attachmentsQuery.data ?? [], lines, "all"), [attachmentsQuery.data, lines]);
  const files = useMemo(
    () => allFiles.filter((file) => matchesFileChip({ kind: file.kind, mimeType: file.mimeType, fileName: file.fileName, captureSource: file.captureSource ?? null }, fileChip)),
    [allFiles, fileChip],
  );
  const sources = useMemo(() => conversationSourceTasks(tasks ?? [], conversationId), [tasks, conversationId]);

  const tabs: readonly { id: DiaryTab; label: string; count: number | null }[] = [
    { id: "days", label: "Theo ngày", count: null },
    { id: "files", label: "File", count: allFiles.length },
    { id: "links", label: "Liên kết", count: links.length },
    { id: "sources", label: "Nguồn tạo việc", count: sources.length },
  ];

  // Monday-first grid of the month.
  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= days; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day));
    return cells;
  }, [month]);
  const todayKey = localDayKey(new Date().toISOString());
  const isLoading = linesQuery.isPending || (tab === "files" && attachmentsQuery.isPending);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : stacked.onBack())}>
      <SheetContent
        side="right"
        {...edgeSwipe}
        className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md [&>button.absolute]:hidden"
      >
        <StackedSheetHeader backLabel={stacked.backLabel} onBack={stacked.onBack} onCloseAll={stacked.onCloseAll} />
        <div className="px-5 pb-3 pt-4">
          <SheetTitle className="truncate text-[19px] font-semibold tracking-tight text-foreground">
            Nhật ký trò chuyện · {title}
          </SheetTitle>
          <SheetDescription className="mt-1 text-[12.5px] text-muted-foreground">
            Chỉ những gì bạn đang được xem. Tin đã thu hồi không hiện.
          </SheetDescription>
        </div>
        <div role="tablist" aria-label="Cách xem" className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-border px-4 pb-3">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "press flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors",
                tab === entry.id ? "border-foreground/25 bg-accent font-medium text-foreground" : "border-border text-muted-foreground hover:bg-accent/40",
              )}
            >
              {entry.label}
              {entry.count !== null ? <span className="tabular text-[11.5px] text-muted-foreground">{entry.count}</span> : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {linesQuery.isError ? (
            <div className="py-10 text-center">
              <p className="text-[14px] text-muted-foreground">{linesQuery.error.message}</p>
              <button type="button" onClick={() => void linesQuery.refetch()} className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium">
                Thử lại
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-14" role="status" aria-label="Đang tải">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "days" ? (
            <div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Tháng trước"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  className="press flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent/40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="text-[15px] font-semibold capitalize text-foreground">
                  {month.toLocaleDateString("vi-VN", { month: "long", year: "numeric" })}
                </p>
                <button
                  type="button"
                  aria-label="Tháng sau"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  className="press flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday} className="py-1 text-[11px] font-medium text-muted-foreground">
                    {weekday}
                  </span>
                ))}
                {grid.map((date, index) => {
                  if (date === null) return <span key={`blank-${index}`} />;
                  const key = localDayKey(date.toISOString());
                  const firstId = dayFirst.get(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={firstId === undefined}
                      onClick={() => firstId !== undefined && onJumpToMessage(firstId)}
                      aria-label={`${date.getDate()}${firstId !== undefined ? ", có tin — tới tin đầu ngày" : ""}`}
                      className={cn(
                        "press relative flex h-11 flex-col items-center justify-center rounded-lg text-[14px] transition-colors",
                        firstId !== undefined ? "font-medium text-foreground hover:bg-accent/50" : "text-muted-foreground/50",
                        key === todayKey && "ring-1 ring-primary/40",
                      )}
                    >
                      {date.getDate()}
                      {firstId !== undefined ? <span aria-hidden="true" className="absolute bottom-1.5 h-1 w-1 rounded-full bg-primary" /> : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[12.5px] text-muted-foreground">Chạm một ngày có chấm để tới tin đầu tiên của ngày đó.</p>
            </div>
          ) : tab === "files" ? (
            <div>
              <div className="-mx-1 mb-3">
                <FileChipRow
                  files={allFiles.map((file) => ({ kind: file.kind, mimeType: file.mimeType, fileName: file.fileName, captureSource: file.captureSource ?? null }))}
                  chip={fileChip}
                  onChip={setFileChip}
                />
              </div>
              {files.length === 0 ? (
                <p className="py-10 text-center text-[13.5px] text-muted-foreground">Chưa có tệp nào ở đây.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {files.map((file) => (
                    <li key={file.id} className="rounded-[14px] border border-border bg-background/60 p-3">
                      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        <span className="truncate">{nameOf(file.attachedBy)}</span>
                        <span className="tabular">{stamp(file.createdAt)}</span>
                        <button
                          type="button"
                          onClick={() => onJumpToMessage(file.messageId)}
                          className="press ml-auto rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10"
                        >
                          Tới tin
                        </button>
                      </div>
                      <div className="mt-2 max-w-full overflow-hidden">
                        <MessageAttachments attachments={[file]} urlOf={urlOf} outgoing={false} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === "links" ? (
            links.length === 0 ? (
              <p className="py-10 text-center text-[13.5px] text-muted-foreground">Chưa có liên kết nào trong cuộc này.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {links.map((link) => (
                  <li key={link.key} className="rounded-[14px] border border-border bg-background/60 px-3.5 py-3">
                    {/* No preview, no request to the site: the domain and the words around it. */}
                    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="group flex items-start gap-3">
                      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" strokeWidth={1.7} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-foreground group-hover:underline">{link.domain}</span>
                        <span className="mt-0.5 block line-clamp-2 break-words text-[12.5px] text-muted-foreground">{link.caption === "" ? link.url : link.caption}</span>
                      </span>
                    </a>
                    <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{nameOf(link.senderId)}</span>
                      <span className="tabular">{stamp(link.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(link.messageId)}
                        className="press ml-auto rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10"
                      >
                        Tới tin
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : sources.length === 0 ? (
            <p className="py-10 text-center text-[13.5px] text-muted-foreground">Chưa có tin nào trong cuộc này sinh ra nhiệm vụ bạn xem được.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {sources.map((task) => (
                <li key={task.id} className="rounded-[14px] border border-border bg-background/60 px-3.5 py-3">
                  <button type="button" onClick={() => onOpenTask(task)} className="press block w-full text-left">
                    <span className={cn("block truncate text-[14.5px] font-semibold", task.status === "done" ? "text-muted-foreground line-through" : "text-foreground")}>
                      {task.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{taskStatusLabel(task)}</span>
                  </button>
                  {task.contextSnapshot?.originalMessageText ? (
                    <p className="mt-2 line-clamp-2 border-l-2 border-primary/40 pl-2.5 text-[12.5px] text-foreground/80">
                      {task.contextSnapshot.originalMessageText}
                    </p>
                  ) : null}
                  {task.contextSnapshot?.originalMessageId ? (
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(task.contextSnapshot?.originalMessageId ?? "")}
                        className="press rounded-md px-2 py-1 text-[11.5px] font-medium text-primary hover:bg-primary/10"
                      >
                        Tới tin
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
