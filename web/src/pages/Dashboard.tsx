import { Bell, CalendarClock, CalendarDays, ChevronRight, Loader2, MailOpen, MessagesSquare, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ThoughtNote } from "@/components/space/ThoughtNote";
import { useAuth, useDisplayName } from "@/lib/auth";
import { conversationsWithUnread, unreadSummaryText } from "@/lib/chat";
import { dailyThoughtKey, dailyThoughtView } from "@/lib/daily-thoughts";
import { ambientTone } from "@/lib/space-ambient";
import {
  attentionItems,
  isBlockVisible,
  planningCounts,
  planningSummary,
  SPACE_BLOCK_COPY,
  SPACE_BLOCK_ORDER,
  upcomingReminders,
  type AttentionItem,
  type SpaceBlockId,
} from "@/lib/space-blocks";
import { PULSE_LABELS, pulseSentence, spaceDateLabel, taskPulse } from "@/lib/space-summary";
import { contextLink } from "@/lib/task-context";
import { deadlineLabel, todayIso, type TaskItem } from "@/lib/tasks";
import { useThinkRecords, useThinkTables } from "@/lib/use-think-hub";
import { useConversations } from "@/lib/use-conversations";
import { useDailyThoughtCategory } from "@/lib/use-settings";
import { usePendingInvitationCount } from "@/lib/use-task-collab";
import { useTaskReminders } from "@/lib/use-task-meta";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

/** Morning, afternoon or evening — the same greeting a person would actually use. */
function greeting(hour: number): string {
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/** Where tapping a task goes: its conversation when it has one, else the task list. */
function taskHref(task: TaskItem): string {
  return task.conversationId === null ? "/nhiem-vu" : contextLink(task.conversationId, task.id);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function reminderWhen(iso: string, today: string): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  const label = deadlineLabel(day, today) ?? "";
  return `${label} · ${clock(iso)}`;
}

function attentionMeta(item: AttentionItem, today: string): { text: string; tone: string } {
  if (item.kind === "event") {
    const where = item.task.location === null ? "" : ` · ${item.task.location}`;
    return { text: `Có mặt lúc ${clock(item.task.startAt ?? "")}${where}`, tone: "text-foreground" };
  }
  if (item.kind === "overdue")
    return { text: deadlineLabel(item.task.deadline, today) ?? "Quá hạn", tone: "text-task-overdue" };
  return { text: "Hôm nay", tone: "text-task-due-soon" };
}

/** The frame every block shares: title, the one line saying what it holds, and the tap hint. */
function Block({
  id,
  icon,
  children,
}: {
  id: SpaceBlockId;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const copy = SPACE_BLOCK_COPY[id];
  return (
    <section aria-labelledby={`space-${id}`} className="mt-8">
      <h2 id={`space-${id}`} className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
        {icon}
        {copy.title}
      </h2>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.description}</p>
      <div className="mt-3">{children}</div>
      <p className="mt-2 text-[12px] text-task-idle">{copy.hint}</p>
    </section>
  );
}

function EmptyLine({ id }: { id: SpaceBlockId }) {
  return (
    <p className="rounded-[12px] border border-dashed border-border px-4 py-4 text-[14px] text-muted-foreground">
      {SPACE_BLOCK_COPY[id].empty}
    </p>
  );
}

const rowClass =
  "press flex min-h-12 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0 transition-colors hover:bg-accent/30";

/**
 * Avora Space — the opening screen, read top to bottom in the order `SPACE_BLOCK_ORDER` gives.
 *
 * It answers where to look first and then gets out of the way. The faint wash behind it is the
 * time of day, worked out once when the screen opens; it never moves and never refreshes itself.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const displayName = useDisplayName();
  const { data: tasks, isLoading } = useTasks();
  const { data: conversations } = useConversations();
  const { data: reminders } = useTaskReminders();
  const { data: hubRecords } = useThinkRecords();
  const { data: hubTables } = useThinkTables();
  const invitationCount = usePendingInvitationCount();
  const thoughtCategory = useDailyThoughtCategory();
  const userId: string | undefined = user?.id;

  // Computed once per mount on purpose — a state, not an animation.
  const [opened] = useState<Date>(() => new Date());
  const [tone] = useState(() => ambientTone(opened));
  const today = todayIso(opened);

  const thought = useMemo(() => dailyThoughtView(thoughtCategory, opened), [thoughtCategory, opened]);
  const thoughtKey = useMemo(() => dailyThoughtKey(thoughtCategory, opened), [thoughtCategory, opened]);
  const unreadThreads = useMemo(() => conversationsWithUnread(conversations ?? []), [conversations]);
  const pulse = useMemo(() => taskPulse(tasks ?? [], userId, today), [tasks, userId, today]);
  const attention = useMemo(() => attentionItems(tasks ?? [], userId, today), [tasks, userId, today]);
  const upcoming = useMemo(
    () => upcomingReminders(reminders ?? [], tasks ?? [], userId, opened),
    [reminders, tasks, userId, opened],
  );
  const planning = useMemo(
    () => planningCounts(hubRecords ?? [], hubTables ?? [], opened),
    [hubRecords, hubTables, opened],
  );

  const renderBlock = (id: SpaceBlockId): ReactNode => {
    switch (id) {
      case "greeting":
        return (
          <header key={id}>
            <h1 className="text-[19px] leading-snug text-foreground">
              <span className="font-normal text-muted-foreground">{greeting(opened.getHours())}, </span>
              <span className="font-semibold">{displayName}</span>
              <span className="font-normal text-muted-foreground">
                <span className="text-task-idle" aria-hidden="true">
                  {" · "}
                </span>
                {spaceDateLabel(opened)}
              </span>
            </h1>
            {thought === null ? null : (
              <section aria-label={SPACE_BLOCK_COPY.greeting.title} className="mt-4 border-l-2 border-primary/30 pl-4">
                <blockquote className="text-[20px] leading-[1.65] text-foreground">{thought.text}</blockquote>
                {thought.speaker === null ? null : (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">— {thought.speaker}</p>
                )}
                <p className="mt-3 text-[12px] text-task-idle">{SPACE_BLOCK_COPY.greeting.hint}</p>
                <ThoughtNote thought={thought} thoughtKey={thoughtKey} />
              </section>
            )}
          </header>
        );

      case "attention":
        return (
          <Block key={id} id={id} icon={<CalendarClock className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />}>
            {isLoading ? (
              <div className="flex justify-center py-8" role="status" aria-label="Đang tải nhiệm vụ">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-stretch rounded-[12px] border border-border bg-card">
                  {PULSE_LABELS.map(({ key, label }, index) => (
                    <div key={key} className={cn("flex-1 px-4 py-3", index > 0 ? "border-l border-border" : "")}>
                      <p
                        className={cn(
                          "tabular text-[24px] font-semibold leading-none",
                          pulse[key] === 0
                            ? "text-task-idle"
                            : key === "overdue"
                              ? "text-task-overdue"
                              : key === "today"
                                ? "text-task-due-soon"
                                : "text-foreground",
                        )}
                      >
                        {pulse[key]}
                      </p>
                      <p className="mt-1.5 text-[12px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[14px] text-muted-foreground">{pulseSentence(pulse)}</p>
                <div className="mt-3">
                  {attention.length === 0 ? (
                    <EmptyLine id={id} />
                  ) : (
                    <div className="overflow-hidden rounded-[12px] border border-border bg-card">
                      {attention.slice(0, 8).map((item) => {
                        const meta = attentionMeta(item, today);
                        return (
                          <Link key={item.task.id} to={taskHref(item.task)} className={rowClass}>
                            <span
                              className={cn(
                                "w-1 self-stretch rounded-full",
                                item.kind === "event" ? "bg-primary/60" : item.kind === "overdue" ? "bg-task-overdue" : "bg-task-due-soon",
                              )}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14.5px] font-medium text-foreground">{item.task.title}</span>
                              <span className={cn("block text-[12px]", meta.tone)}>{meta.text}</span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link to="/nhiem-vu" className="inline-flex min-h-10 items-center text-[13px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
                    Xem tất cả nhiệm vụ
                  </Link>
                  {/* Straight into Lịch, Day view, today — the same day this block is about. */}
                  <Link
                    to={`/nhiem-vu?muc=lich&xem=ngay&ngay=${today}`}
                    aria-label="Xem lịch hôm nay"
                    className="press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/30"
                  >
                    <CalendarDays className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    Xem lịch
                  </Link>
                </div>
              </>
            )}
          </Block>
        );

      case "reminders":
        return (
          <Block key={id} id={id} icon={<Bell className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />}>
            {upcoming.length === 0 ? (
              <EmptyLine id={id} />
            ) : (
              <div className="overflow-hidden rounded-[12px] border border-border bg-card">
                {upcoming.slice(0, 6).map(({ reminder, task }) => (
                  <Link key={reminder.id} to={taskHref(task)} className={rowClass}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-foreground">{task.title}</span>
                      <span className="block text-[12px] text-muted-foreground">{reminderWhen(reminder.at, today)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </Block>
        );

      case "planning":
        if (!isBlockVisible(id, planning.length)) return null;
        return (
          <Block key={id} id={id} icon={<Table2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />}>
            <p className="sr-only">{planningSummary(planning)}</p>
            <div className="flex flex-wrap gap-2">
              {planning.map((entry) => (
                <Link
                  key={entry.tableId}
                  to={`/ke-hoach?bang=${encodeURIComponent(entry.tableId)}`}
                  className="press flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-accent/30"
                >
                  {entry.tableName}
                  <span className="tabular font-semibold">{entry.count}</span>
                </Link>
              ))}
            </div>
          </Block>
        );

      case "invitations":
        if (!isBlockVisible(id, invitationCount)) return null;
        return (
          <Block key={id} id={id} icon={<MailOpen className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />}>
            <Link to="/nhiem-vu?muc=loi-moi" className={cn(rowClass, "rounded-[12px] border border-border bg-card")}>
              <span className="flex-1 text-[14.5px] font-medium text-foreground">
                {invitationCount} lời mời đang chờ bạn trả lời
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            </Link>
          </Block>
        );

      case "communication":
        return (
          <Block key={id} id={id} icon={<MessagesSquare className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />}>
            {unreadThreads > 0 ? (
              <Link
                to="/tin-nhan"
                aria-label={`${unreadSummaryText(unreadThreads)}. Mở Tin nhắn`}
                className="press flex min-h-14 items-center gap-3 rounded-[12px] border border-border bg-card px-4 transition-colors hover:bg-accent/30"
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/60">
                  <MessagesSquare className="h-[18px] w-[18px] text-foreground" strokeWidth={1.7} aria-hidden="true" />
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">{unreadSummaryText(unreadThreads)}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">Đang đợi bạn trả lời</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              </Link>
            ) : (
              <p className="text-[14px] text-muted-foreground">{unreadSummaryText(0)}</p>
            )}
          </Block>
        );
    }
  };

  return (
    <div
      className="paper min-h-screen flex-1 md:h-screen md:overflow-y-auto"
      data-ambient={tone.part}
      style={{ backgroundImage: `${tone.wash}, radial-gradient(hsl(38 28% 86% / 0.55) 0.5px, transparent 0.5px)`, backgroundSize: "100% 100%, 22px 22px" }}
    >
      <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-8">
        {SPACE_BLOCK_ORDER.map((id) => renderBlock(id))}
      </div>
    </div>
  );
}
