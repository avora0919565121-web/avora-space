import { CalendarDays, CheckSquare, Hash, Link2, List, Paperclip, Type, UserRound, type LucideIcon } from "lucide-react";

import type { ColumnType } from "@/lib/think-hub";
import { cn } from "@/lib/utils";

const ICONS: Record<ColumnType, LucideIcon> = {
  text: Type,
  number: Hash,
  date: CalendarDays,
  select: List,
  link: Link2,
  contact: UserRound,
  checkbox: CheckSquare,
  file: Paperclip,
};

/** The small kind marker beside a column's name (AVORA-61 · F): Aa · # · lịch · danh sách · link · người · ô tích · kẹp giấy. */
export function ColumnTypeIcon({ type, className }: { type: ColumnType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon data-column-type={type} className={cn("h-3.5 w-3.5 shrink-0", className)} strokeWidth={1.8} aria-hidden="true" />;
}
