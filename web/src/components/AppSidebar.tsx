import {
  Briefcase,
  LayoutGrid,
  ListTodo,
  LogOut,
  MessageSquareText,
  Settings,
  Vault,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ResizeHandle } from "@/components/ResizeHandle";
import { useAuth, useDisplayName } from "@/lib/auth";
import { NAV_COLUMN, useColumnWidth } from "@/lib/column-width";
import { formatUnreadBadge } from "@/lib/chat";
import { obligationAttention } from "@/lib/finance";
import { NAV_ITEMS } from "@/lib/navigation";
import { countTasksNeedingAttention, todayIso } from "@/lib/tasks";
import { useTotalUnread } from "@/lib/use-conversations";
import { useTransactions } from "@/lib/use-finance";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

/** One icon per rail destination; the labels and order live in `NAV_ITEMS`. */
const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/tong-quan": LayoutGrid,
  "/tin-nhan": MessageSquareText,
  "/nhiem-vu": ListTodo,
  // A briefcase, shared with nothing else in the rail: Vault keeps the safe, ListTodo the
  // task list, MessageSquareText the inbox.
  "/business-hub": Briefcase,
  "/ket-sat": Vault,
  "/cai-dat": Settings,
};

/**
 * Fixed site navigation shared by every signed-in screen.
 *
 * The app always opens on Avora Space, so these badges are the only thing that says another tab
 * wants attention. They are a reminder, never a redirection — nothing here moves the reader off
 * the screen they chose to start on.
 */
export function AppSidebar() {
  const { user, signOut } = useAuth();
  const displayName = useDisplayName();
  const navigate = useNavigate();
  const unreadTotal = useTotalUnread();
  const { data: tasks } = useTasks();
  const { data: transactions } = useTransactions();
  // Desktop only: the rail's width, as the reader last dragged it.
  const navColumn = useColumnWidth(NAV_COLUMN);
  const asideRef = useRef<HTMLElement | null>(null);

  // Only what is late or waiting on this person's move. A badge counting every open task would
  // never go out, and a badge that is always lit is decoration rather than information.
  const taskAttention: number = useMemo(
    () => countTasksNeedingAttention(tasks ?? [], user?.id, todayIso()),
    [tasks, user?.id],
  );

  /**
   * Money that is late or due within the week.
   *
   * A count and nothing else. This badge sits OUTSIDE Két sắt, on every screen in the app — an
   * amount, a lender's name or even the word tax would put on display exactly what the vault
   * exists to keep. The number says there is something to look at; the looking happens inside.
   */
  const vaultAttention: number = useMemo(
    () => obligationAttention(transactions ?? [], todayIso()).total,
    [transactions],
  );

  /** What each tab is asking for right now, if anything. */
  const badges: Readonly<Record<string, { count: number; label: string }>> = {
    "/tin-nhan": { count: unreadTotal, label: `${unreadTotal} tin nhắn chưa đọc` },
    "/nhiem-vu": { count: taskAttention, label: `${taskAttention} nhiệm vụ cần bạn xử lý` },
    "/ket-sat": { count: vaultAttention, label: `${vaultAttention} khoản tới hạn` },
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate("/dang-nhap", { replace: true });
  };

  return (
    <aside
      ref={asideRef}
      style={navColumn.isDesktop ? { width: navColumn.width } : undefined}
      className="paper relative flex w-full shrink-0 flex-col border-b border-border md:h-screen md:w-[240px] md:border-b-0 md:border-r"
    >
      <ResizeHandle columnRef={asideRef} control={navColumn} label="Độ rộng thanh điều hướng" />
      <div className="flex items-center gap-2.5 px-6 pb-5 pt-6">
        <img
          src="/icon.png"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="h-7 w-7 rounded-md"
        />
        <span className="wordmark text-[17px] text-foreground">AVORA</span>
      </div>

      <nav aria-label="Điều hướng chính" className="px-3 md:px-3">
        <ul className="flex gap-1 md:block md:space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon: LucideIcon = NAV_ICONS[item.to] ?? LayoutGrid;
            const badge = badges[item.to];
            return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium transition-colors",
                    isActive
                      ? "bg-accent/70 text-primary"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -left-3 top-1/2 hidden h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity md:block",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                    <span>{item.label}</span>
                    {badge !== undefined && badge.count > 0 ? (
                      <span
                        aria-label={badge.label}
                        className="tabular ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                      >
                        {formatUnreadBadge(badge.count)}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto hidden border-t border-border px-4 py-5 md:block">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={displayName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-foreground">{displayName}</p>
            <p className="truncate text-[12px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="press mt-4 flex w-full items-center gap-3 rounded-md px-1 py-2 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
