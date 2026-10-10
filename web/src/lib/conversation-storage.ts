import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** K6 · đợt A: how much the conversation's shared store holds. Counted, not enforced yet. */
export type ConversationStorage = { bytes: number; files: number; capBytes: number };

export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** The one line in ⋯ › Nhật ký trò chuyện › File: `Kho chung 1,4 GB · tệp giữ 30 ngày (sắp áp dụng)`. */
export function storageLine(storage: ConversationStorage | null): string {
  return `Kho chung ${formatStorageBytes(storage?.bytes ?? 0)} · tệp giữ 30 ngày (sắp áp dụng)`;
}

export function useConversationStorage(conversationId: string | undefined): ConversationStorage | null {
  const { data } = useQuery<ConversationStorage | null, Error>({
    queryKey: ["conversation-storage", conversationId ?? ""],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("conversation_storage" as never)
        .select("bytes, files, cap_bytes")
        .eq("conversation_id", conversationId as string)
        .maybeSingle();
      if (error || row === null) return null;
      const value = row as { bytes: number; files: number; cap_bytes: number };
      return { bytes: Number(value.bytes), files: value.files, capBytes: Number(value.cap_bytes) };
    },
    enabled: Boolean(conversationId),
    staleTime: 60_000,
  });
  return data ?? null;
}

/** K6 · đợt A: files I uploaded to chats (Standard 5 GB — counted, not yet a limit). */
export const STANDARD_UPLOAD_CAP_BYTES = 5 * 1024 ** 3;

export function useMyUploadUsage(): number | null {
  const { data } = useQuery<number | null, Error>({
    queryKey: ["storage-usage-mine"],
    queryFn: async () => {
      const { data: row, error } = await supabase.from("storage_usage" as never).select("bytes").maybeSingle();
      if (error || row === null) return 0;
      return Number((row as { bytes: number }).bytes);
    },
    staleTime: 60_000,
  });
  return data ?? null;
}
