import { logError } from "@/lib/log";
import { CONTACT_UNAVAILABLE_MESSAGE, isContactUnavailable } from "@/lib/blocks";
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
  /** True when two or more messages went as one conversation bundle (Đợt gộp 2 · B1). */
  asBundle?: boolean;
  /** Bundle only: files that stayed behind (view-only images, and every non-image file). */
  filesLeftBehind?: number;
  /** Bundle only (AVORA-57 · B): images that travelled in the bundle's grid. */
  imagesCarried?: number;
  /** Bundle only: images whose sender allowed viewing only. */
  imagesBlocked?: number;
};

function fail(code: string | undefined, message: string): Error {
  logError("forwarding", { code, message });
  const normalized = message.toLowerCase();
  if (isContactUnavailable(normalized)) return new Error(CONTACT_UNAVAILABLE_MESSAGE);
  if (normalized.includes("avora_not_a_participant"))
    return new Error("Bạn không có quyền trong cuộc trò chuyện này.");
  if (normalized.includes("avora_forward_bundle_mixed"))
    return new Error("Chỉ chuyển tiếp được các tin trong cùng một cuộc trò chuyện.");
  if (normalized.includes("avora_forward_bundle_min_two"))
    return new Error("Cần ít nhất 2 tin còn nội dung để chuyển thành đoạn hội thoại.");
  if (normalized.includes("avora_verification_text_only"))
    return new Error("Chỉ gửi được chữ khi chưa kết bạn.");
  if (normalized.includes("avora_not_connected"))
    return new Error("Hai bạn không còn là bạn nên không gửi thêm được.");
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

/**
 * Copies messages into another thread.
 *
 * One message keeps its files (each at its own permission). Two or more become ONE message that
 * carries the conversation as words only (Đợt gộp 2 · B1).
 */
export async function forwardMessages(
  messageIds: readonly string[],
  targetConversationId: string,
): Promise<ForwardResult> {
  if (messageIds.length >= 2) {
    const { data, error } = await supabase.rpc("forward_messages_as_bundle", {
      p_message_ids: [...messageIds],
      p_target_conversation_id: targetConversationId,
    });
    if (error) throw fail(error.code, error.message);
    const row = (data ?? {}) as {
      forwarded?: number;
      files_left_behind?: number;
      images_carried?: number;
      images_blocked?: number;
    };
    return {
      forwarded: row.forwarded ?? 0,
      filesCarried: row.images_carried ?? 0,
      filesBlocked: row.images_blocked ?? 0,
      asBundle: true,
      filesLeftBehind: row.files_left_behind ?? 0,
      imagesCarried: row.images_carried ?? 0,
      imagesBlocked: row.images_blocked ?? 0,
    };
  }
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

/** Brings journal entries back from the bin (AVORA-44 · A.5, kept 30 days). */
export async function restoreJournalMessages(messageIds: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc("restore_journal_messages", { p_message_ids: [...messageIds] });
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
  if (result.asBundle === true) {
    const head = `Đã chuyển ${result.forwarded} tin thành một đoạn hội thoại tới ${targetName}`;
    const parts: string[] = [];
    const carried = result.imagesCarried ?? 0;
    const blocked = result.imagesBlocked ?? 0;
    const otherFiles = Math.max(0, (result.filesLeftBehind ?? 0) - blocked);
    if (carried > 0) parts.push(`kèm ${carried} ảnh`);
    if (blocked > 0) parts.push(`${blocked} ảnh không chuyển được`);
    if (otherFiles > 0) parts.push(`${otherFiles} tệp không đi kèm`);
    return parts.length > 0 ? `${head} · ${parts.join(" · ")}` : head;
  }

  const head =
    result.forwarded === 1
      ? `Đã chuyển tiếp 1 tin đến ${targetName}`
      : `Đã chuyển tiếp ${result.forwarded} tin đến ${targetName}`;

  if (result.filesBlocked === 0) return `${head}.`;
  return `${head} · ${result.filesBlocked} tệp không được phép chuyển tiếp.`;
}

/** What the floating bar says it is about to delete. */
export function deleteSummaryText(count: number): string {
  if (count <= 0) return "Không có mục nào được xoá.";
  return count === 1 ? "Đã chuyển 1 mục vào Thùng rác." : `Đã chuyển ${count} mục vào Thùng rác.`;
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
