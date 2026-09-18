import { supabase } from "@/integrations/supabase/client";

/**
 * Carrying messages into another conversation, and clearing notes out of a journal.
 *
 * Both are bulk actions, so both report what actually happened rather than claiming success.
 * A forward that silently dropped two files would be worse than one that says it did.
 */
export type ForwardResult = {
  forwarded: number;
  filesCarried: number;
  filesBlocked: number;
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[forwarding] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_not_a_participant"))
    return new Error("Bạn không có quyền trong cuộc trò chuyện này.");
  if (normalized.includes("avora_forward_too_many"))
    return new Error("Chỉ chuyển tiếp được tối đa 50 tin một lần.");
  if (normalized.includes("avora_delete_too_many"))
    return new Error("Chỉ xoá được tối đa 200 ghi chú một lần.");
  if (normalized.includes("avora_delete_not_allowed"))
    return new Error("Chỉ xoá được ghi chú của chính bạn trong Nhật ký.");
  if (normalized.includes("avora_not_signed_in"))
    return new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  if (code === "42501" || normalized.includes("permission denied") || normalized.includes("row-level"))
    return new Error("Bạn không có quyền thực hiện thao tác này.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không thực hiện được. Vui lòng thử lại.");
}

/** Copies messages into another thread, keeping each file's own permission. */
export async function forwardMessages(
  messageIds: readonly string[],
  targetConversationId: string,
): Promise<ForwardResult> {
  const { data, error } = await supabase.rpc("forward_messages", {
    p_message_ids: [...messageIds],
    p_target_conversation_id: targetConversationId,
  });

  if (error) throw fail(error.code, error.message);
  const row = (data ?? {}) as { forwarded?: number; files_carried?: number; files_blocked?: number };
  return {
    forwarded: row.forwarded ?? 0,
    filesCarried: row.files_carried ?? 0,
    filesBlocked: row.files_blocked ?? 0,
  };
}

/** Removes notes from your own journal. The server refuses anything else. */
export async function deleteJournalMessages(messageIds: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc("delete_journal_messages", {
    p_message_ids: [...messageIds],
  });
  if (error) throw fail(error.code, error.message);
  return data ?? 0;
}

/** What a forwarded message says about where it came from. */
export function forwardedFromLabel(senderName: string | null | undefined): string {
  const name = (senderName ?? "").trim();
  return name === "" ? "Đã chuyển tiếp" : `Đã chuyển tiếp từ ${name}`;
}

/**
 * The one line summarising a bulk forward.
 *
 * Files that could not travel are named in the same breath as the ones that did. Reporting
 * only the success would let someone believe a document arrived when it did not.
 */
export function forwardSummaryText(result: ForwardResult, targetName: string): string {
  if (result.forwarded === 0) return "Không có tin nào được chuyển tiếp.";

  const head =
    result.forwarded === 1
      ? `Đã chuyển tiếp 1 tin đến ${targetName}`
      : `Đã chuyển tiếp ${result.forwarded} tin đến ${targetName}`;

  if (result.filesBlocked === 0) return `${head}.`;
  return `${head} · ${result.filesBlocked} tệp không được phép chuyển tiếp.`;
}

/** What the floating bar says it is about to delete. */
export function deleteSummaryText(count: number): string {
  if (count <= 0) return "Không có ghi chú nào được xoá.";
  return count === 1 ? "Đã xoá 1 ghi chú." : `Đã xoá ${count} ghi chú.`;
}

/**
 * Toggling one message in a selection.
 *
 * A plain set operation, kept here so the thread and its tests agree on what selecting
 * twice means — it deselects, rather than counting twice.
 */
export function toggleSelected(selected: readonly string[], messageId: string): string[] {
  return selected.includes(messageId)
    ? selected.filter((id) => id !== messageId)
    : [...selected, messageId];
}
