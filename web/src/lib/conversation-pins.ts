import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { logError } from "@/lib/log";

export { withPinnedFirst } from "@/lib/conversation-order";

/**
 * Ghim hội thoại (AVORA-57 · D). Per person, at most 5, kept in `conversation_pins` which only
 * its owner can read — the other side never learns they were pinned.
 */
export const MAX_PINNED_CONVERSATIONS = 5;
export const PIN_LIMIT_MESSAGE = `Chỉ ghim được tối đa ${MAX_PINNED_CONVERSATIONS} cuộc trò chuyện. Bỏ ghim một cuộc trước nhé.`;

export const conversationPinKeys = {
  all: ["conversation-pins"] as const,
};

function fail(code: string | undefined, message: string): Error {
  logError("conversation-pins", { code, message });
  if (message.toLowerCase().includes("avora_pin_limit")) return new Error(PIN_LIMIT_MESSAGE);
  if (message.toLowerCase().includes("failed to fetch")) return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Chưa ghim được. Thử lại nhé.");
}

/** conversation id → pinned at. */
export async function fetchConversationPins(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("list_my_conversation_pins");
  if (error) throw fail(error.code, error.message);
  return new Map((data ?? []).map((row) => [row.conversation_id, row.pinned_at] as const));
}

export async function setConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_conversation_pinned", { p_conversation_id: conversationId, p_pinned: pinned });
  if (error) throw fail(error.code, error.message);
}

export function useConversationPins() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const query = useQuery<Map<string, string>, Error>({
    queryKey: conversationPinKeys.all,
    queryFn: fetchConversationPins,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  const pins = useMemo(() => query.data ?? new Map<string, string>(), [query.data]);

  const mutation = useMutation({
    mutationFn: ({ conversationId, pinned }: { conversationId: string; pinned: boolean }) =>
      setConversationPinned(conversationId, pinned),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: conversationPinKeys.all }),
  });

  const togglePin = useCallback(
    (conversationId: string): void => {
      const pinned = !pins.has(conversationId);
      if (pinned && pins.size >= MAX_PINNED_CONVERSATIONS) {
        toast.error(PIN_LIMIT_MESSAGE);
        return;
      }
      mutation.mutate(
        { conversationId, pinned },
        {
          onSuccess: () => toast(pinned ? "Đã ghim lên đầu" : "Đã bỏ ghim", { duration: 1500 }),
          onError: (error: Error) => toast.error(error.message),
        },
      );
    },
    [pins, mutation],
  );

  return { pins, togglePin };
}
