import { supabase } from "@/integrations/supabase/client";
import type { AttachmentPermission } from "@/lib/attachments";

/** What is being forwarded out of Nhật ký / Ghi chép. */
export type JournalForwardItem =
  | { kind: "journal-file"; messageId: string; label: string }
  | { kind: "note-files"; attachmentIds: string[]; label: string }
  | { kind: "note"; noteId: string; label: string };

const ERRORS: [string, string][] = [
  ["avora_not_connected", "Hai bạn không còn là bạn nên không gửi thêm được."],
  ["avora_verification", "Chỉ gửi được chữ khi chưa kết bạn."],
  ["avora_not_my", "Chỉ chuyển tiếp được tệp của chính bạn."],
  ["avora_not_a_participant", "Bạn không có quyền trong cuộc trò chuyện này."],
];

/** Calls the one RPC for this kind of item. Exported for tests. */
export async function forwardJournalItem(item: JournalForwardItem, target: string, permission: AttachmentPermission): Promise<void> {
  const call =
    item.kind === "journal-file"
      ? supabase.rpc("forward_journal_file" as never, { p_message_id: item.messageId, p_target: target, p_permission: permission } as never)
      : item.kind === "note-files"
        ? supabase.rpc("forward_note_files" as never, { p_attachment_ids: item.attachmentIds, p_target: target, p_permission: permission } as never)
        : supabase.rpc("forward_note" as never, { p_note_id: item.noteId, p_target: target, p_permission: permission } as never);
  const { error } = await call;
  if (!error) return;
  const found = ERRORS.find(([code]) => (error.message ?? "").includes(code));
  throw new Error(found?.[1] ?? "Chưa chuyển tiếp được. Thử lại nhé.");
}

