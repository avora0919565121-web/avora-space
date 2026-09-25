import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { obligationAttention } from "@/lib/finance";
import { countTasksNeedingAttention, todayIso } from "@/lib/tasks";
import { useTotalUnread } from "@/lib/use-conversations";
import { useTransactions } from "@/lib/use-finance";
import { useTasks } from "@/lib/use-tasks";

export type NavBadge = { count: number; label: string };

/**
 * What each tab is asking for right now, if anything — shared by the desktop rail and the
 * phone's tool-belt so the two can never disagree.
 *
 * Only what is late or waiting on this person's move: a badge that is always lit is decoration.
 * Két sắt shows a count and nothing else, because the badge sits outside the vault on every
 * screen — an amount or a lender's name would put on display exactly what the vault keeps.
 */
export function useNavBadges(): Readonly<Record<string, NavBadge>> {
  const { user } = useAuth();
  const unreadTotal = useTotalUnread();
  const { data: tasks } = useTasks();
  const { data: transactions } = useTransactions();

  const taskAttention: number = useMemo(
    () => countTasksNeedingAttention(tasks ?? [], user?.id, todayIso()),
    [tasks, user?.id],
  );
  const vaultAttention: number = useMemo(
    () => obligationAttention(transactions ?? [], todayIso()).total,
    [transactions],
  );

  return useMemo(
    () => ({
      "/tin-nhan": { count: unreadTotal, label: `${unreadTotal} tin nhắn chưa đọc` },
      "/nhiem-vu": { count: taskAttention, label: `${taskAttention} nhiệm vụ cần bạn xử lý` },
      "/ket-sat": { count: vaultAttention, label: `${vaultAttention} khoản tới hạn` },
    }),
    [unreadTotal, taskAttention, vaultAttention],
  );
}
