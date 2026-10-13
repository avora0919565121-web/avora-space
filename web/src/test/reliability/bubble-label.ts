import type { ChatMessage } from "@/lib/chat";

/** The words under a bubble, exactly as Messages.tsx (lines ~4366–4394) chooses them. */
export function bubbleLabel(message: ChatMessage): string {
  if (message.failed === true) return "Chưa gửi được · Gửi lại";
  if (message.pending === true) return message.outboxState === "waiting_network" ? "Đang chờ mạng" : "Chờ gửi…";
  return "Đã gửi";
}
