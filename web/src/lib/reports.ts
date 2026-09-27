import { logError } from "@/lib/log";
import { NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import { supabase } from "@/integrations/supabase/client";

/**
 * Báo cáo (AVORA-37 / B).
 *
 * A report lets AVORA know so an account can be dealt with. The reported person is not told.
 * The message text, when included, is copied by the server — never taken from what the client
 * sends — and only for the one message being reported, only if the reporter agreed.
 */
export type ReportReason = "harassment" | "scam" | "inappropriate" | "impersonation" | "other";

export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Quấy rối" },
  { value: "scam", label: "Lừa đảo" },
  { value: "inappropriate", label: "Nội dung không phù hợp" },
  { value: "impersonation", label: "Giả mạo" },
  { value: "other", label: "Khác" },
] as const;

export const REPORT_NOTE_MAX = 500;

/** Said before sending, so the reporter sees exactly what leaves the conversation. */
export const REPORT_CONSENT_TEXT = "Nội dung tin nhắn này sẽ được gửi kèm để AVORA xem xét.";

export const REPORT_SENT_TOAST = "Đã gửi báo cáo. Cảm ơn bạn.";

export type ReportInput = {
  reportedUserId: string;
  reason: ReportReason;
  note: string;
  conversationId: string | null;
  /** Set when reporting one message; null when reporting the person. */
  messageId: string | null;
  includeMessage: boolean;
  alsoBlock: boolean;
};

export function toVietnameseReportError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_report_limit"))
    return "Bạn đã gửi nhiều báo cáo hôm nay. Thử lại vào ngày mai.";
  if (normalized.includes("avora_report_self")) return "Bạn không thể báo cáo chính mình.";
  if (normalized.includes("avora_report_reason_invalid")) return "Hãy chọn một lý do.";
  if (normalized.includes("avora_report_note_max_len"))
    return `Ghi chú tối đa ${REPORT_NOTE_MAX} ký tự.`;
  if (normalized.includes("avora_user_not_found")) return "Không tìm thấy người dùng này trên AVORA.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (normalized.includes("failed to fetch")) return `${NEEDS_NETWORK_MESSAGE}.`;
  if (code === "42501") return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  return "Chưa gửi được báo cáo. Vui lòng thử lại.";
}

/** First lines of the reported message, as the reporter will see them in the dialog. */
export function reportPreview(content: string, maxLines = 2): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const shown = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${shown}…` : shown;
}

export async function submitReport(input: ReportInput): Promise<string> {
  const note = input.note.trim();
  if (note.length > REPORT_NOTE_MAX) throw new Error(`Ghi chú tối đa ${REPORT_NOTE_MAX} ký tự.`);
  const { data, error } = await supabase.rpc("report_user", {
    p_user_id: input.reportedUserId,
    p_reason: input.reason,
    p_note: note === "" ? undefined : note,
    p_conversation_id: input.conversationId ?? undefined,
    p_message_id: input.messageId ?? undefined,
    p_include_message: input.messageId !== null && input.includeMessage,
    p_also_block: input.alsoBlock,
  });
  if (error) {
    logError("reports", { code: error.code, message: error.message });
    throw new Error(toVietnameseReportError(error.code, error.message));
  }
  return data;
}
