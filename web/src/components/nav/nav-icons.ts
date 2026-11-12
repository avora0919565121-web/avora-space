import { BookOpen, House, LayoutGrid, ListTodo, MessageSquareText, Settings, Vault, type LucideIcon } from "lucide-react";

/** One icon per destination, shared by the desktop rail, the tool-belt and the full map. */
export const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/tong-quan": House,
  "/tin-nhan": MessageSquareText,
  "/nhiem-vu": ListTodo,
  // Thư phòng: an open book, the room's quiet core.
  "/ke-hoach": BookOpen,
  "/ket-sat": Vault,
  "/cai-dat": Settings,
};

export function navIconFor(to: string): LucideIcon {
  return NAV_ICONS[to] ?? LayoutGrid;
}
