import { Briefcase, LayoutGrid, ListTodo, MessageSquareText, Settings, Vault, type LucideIcon } from "lucide-react";

/** One icon per destination, shared by the desktop rail, the tool-belt and the full map. */
export const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/tong-quan": LayoutGrid,
  "/tin-nhan": MessageSquareText,
  "/nhiem-vu": ListTodo,
  // A briefcase, shared with nothing else: Vault keeps the safe, ListTodo the task list.
  "/ke-hoach": Briefcase,
  "/ket-sat": Vault,
  "/cai-dat": Settings,
};

export function navIconFor(to: string): LucideIcon {
  return NAV_ICONS[to] ?? LayoutGrid;
}
