import { ChevronRight, ListTodo, Loader2, MessagesSquare, UserRound, Users } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useAuth, useDisplayName } from "@/lib/auth";
import { conversationsWithUnread, unreadSummaryText } from "@/lib/chat";
import { dailyThoughtView } from "@/lib/daily-thoughts";
import {
  openCountsByScope,
  scopeLink,
  TASK_SCOPE_LABELS,
  TASK_SCOPE_NOTES,
  TASK_SCOPES,
  type TaskScope,
} from "@/lib/task-scope";
import { todayIso, type TaskItem } from "@/lib/tasks";
import { useConversations } from "@/lib/use-conversations";
import { useDailyThoughtCategory } from "@/lib/use-settings";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

const SCOPE_ICONS: Record<TaskScope, typeof UserRound> = {
  personal: UserRound,
  direct: MessagesSquare,
  group: Users,
};

/** Morning, afternoon or evening — the same greeting a person would actually use. */
function greeting(hour: number): string {
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/**
 * The opening screen: how much is waiting, split the three ways work actually arrives.
 *
 * It answers one question — where should I look first — and then gets out of the way. Each
 * block is a door into Tab Nhiệm vụ already narrowed to that kind of work, so the number you
 * tapped and the list you land on are always the same set of tasks.
 *
 * The day's thought sits with the greeting, as part of being met by name, rather than at the
 * foot of the page where it would read as an afterthought. Who is waiting on a reply stays
 * below the work: that is something to act on, not something to sit with.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const displayName = useDisplayName();
  const { data: tasks, isLoading } = useTasks();
  const { data: conversations } = useConversations();
  const thoughtCategory = useDailyThoughtCategory();
  const userId: string | undefined = user?.id;
  const today = todayIso();

  const unreadThreads = useMemo(
    () => conversationsWithUnread(conversations ?? []),
    [conversations],
  );

  const thought = useMemo(() => dailyThoughtView(thoughtCategory, new Date()), [thoughtCategory]);

  const counts = useMemo(
    () => openCountsByScope(tasks ?? [], userId),
    [tasks, userId],
  );
  const total = counts.personal + counts.direct + counts.group;

  const overdue = useMemo(
    () =>
      (tasks ?? []).filter(
        (task: TaskItem) =>
          task.status !== "done" && task.deadline !== null && task.deadline < today,
      ).length,
    [tasks, today],
  );

  return (
    <div className="paper min-h-screen flex-1 md:h-screen md:overflow-y-auto">
      <div className="rise-in mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-[14px] text-muted-foreground">{greeting(new Date().getHours())}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
          {displayName}
        </h1>

        {thought === null ? null : (
          <section aria-label="Suy ngẫm hôm nay" className="mt-4 border-l-2 border-primary/30 pl-4">
            <blockquote className="text-[15px] leading-7 text-foreground/90">
              {thought.text}
            </blockquote>
            {thought.speaker === null ? null : (
              <p className="mt-1.5 text-[13px] text-muted-foreground">— {thought.speaker}</p>
            )}
          </section>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16" role="status" aria-label="Đang tải nhiệm vụ">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <p className="mt-2 text-[15px] text-muted-foreground">
              {total === 0
                ? "Không còn việc nào đang chờ. Nghỉ tay một chút nhé."
                : overdue > 0
                  ? `${total} việc đang chờ, trong đó ${overdue} việc đã quá hạn.`
                  : `${total} việc đang chờ bạn.`}
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TASK_SCOPES.map((scope) => {
                const Icon = SCOPE_ICONS[scope];
                const count = counts[scope];
                return (
                  <Link
                    key={scope}
                    to={scopeLink(scope)}
                    aria-label={`${TASK_SCOPE_LABELS[scope]}: ${count} nhiệm vụ đang chờ`}
                    className="press flex min-h-[112px] flex-col justify-between rounded-[12px] border border-border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-accent/30"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                      <span className="text-[14px] font-semibold text-foreground">
                        {TASK_SCOPE_LABELS[scope]}
                      </span>
                    </span>
                    <span className="mt-3 flex items-baseline gap-2">
                      <span
                        className={cn(
                          "tabular text-[32px] font-semibold leading-none",
                          count > 0 ? "text-foreground" : "text-task-idle",
                        )}
                      >
                        {count}
                      </span>
                      <span className="text-[13px] text-muted-foreground">đang chờ</span>
                    </span>
                    <span className="mt-2 text-[12px] text-muted-foreground">{TASK_SCOPE_NOTES[scope]}</span>
                  </Link>
                );
              })}
            </div>

            <Link
              to="/nhiem-vu"
              className="press mt-4 flex min-h-12 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              <ListTodo className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
              Xem tất cả nhiệm vụ
            </Link>

            <p className="mt-6 text-[13px] leading-5 text-muted-foreground">
              Việc cá nhân được thêm ở tab Nhiệm vụ. Việc chung — 1-1 hay nhóm — luôn bắt đầu từ
              cuộc trò chuyện, nơi hai bên đã trao đổi với nhau.
            </p>
          </>
        )}

        {unreadThreads > 0 ? (
          <Link
            to="/tin-nhan"
            aria-label={`${unreadSummaryText(unreadThreads)}. Mở Tin nhắn`}
            className="press mt-8 flex min-h-14 items-center gap-3 rounded-[12px] border border-border bg-card px-4 transition-colors hover:border-foreground/30 hover:bg-accent/30"
          >
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/60">
              <MessagesSquare className="h-[18px] w-[18px] text-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-foreground">
                {unreadSummaryText(unreadThreads)}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Đang đợi bạn trả lời
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          </Link>
        ) : (
          <p className="mt-8 text-[13px] text-muted-foreground">{unreadSummaryText(0)}</p>
        )}
      </div>
    </div>
  );
}
