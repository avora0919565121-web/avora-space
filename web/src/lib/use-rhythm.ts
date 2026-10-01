import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  archiveConversation,
  chatKeys,
  fetchArchives,
  fetchNewestMessageId,
  markUnreadFrom,
  markConversationRead,
  unarchiveConversation,
  type ConversationSummary,
} from "@/lib/chat";
import {
  activeFocus,
  clearConversationMute,
  CONVERSATION_MUTE_DURATIONS,
  muteKeys,
  mutedUntilFor,
  setConversationMute,
  toConversationMutes,
  type FocusMode,
  type MuteDurationOption,
} from "@/lib/mute";
import { useMuteSettings } from "@/lib/use-mute";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";

export const rhythmKeys = {
  archives: ["chat", "archives"] as const,
};

/** `HH:mm`, or `HH:mm dd/MM` when the moment is not today. */
export function shortUntil(until: string, now: Date = new Date()): string {
  const date = new Date(until);
  const time = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${time} ${date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
}

/**
 * A conversation archived before its newest message stays archived; a newer message brings it
 * back into the list on its own (AVORA-47 · F). Nobody else ever learns of it.
 */
export function isArchivedNow(summary: ConversationSummary, archivedAt: string | undefined): boolean {
  if (archivedAt === undefined || summary.kind === "personal") return false;
  if (summary.lastMessageAt === null) return true;
  return new Date(summary.lastMessageAt).getTime() <= new Date(archivedAt).getTime();
}

export type FocusDurationOption = { id: string; label: string; hours: number | null; untilOff?: boolean };

/** Chế độ tập trung's four answers (ADR-027). Only focus may run "Tới khi tôi tắt". */
export const FOCUS_DURATIONS: readonly FocusDurationOption[] = [
  { id: "1h", label: "1 giờ", hours: 1 },
  { id: "4h", label: "4 giờ", hours: 4 },
  { id: "today", label: "Hết hôm nay", hours: null },
  { id: "off", label: "Tới khi tôi tắt", hours: null, untilOff: true },
];

export function focusUntilFor(option: FocusDurationOption, now: Date = new Date()): Date | null {
  if (option.untilOff === true) return null;
  return mutedUntilFor({ id: option.id, label: option.label, hours: option.hours }, now);
}

/**
 * The viewer's own rhythm in Kết nối: archives, per-conversation mutes, focus mode, and Xem sau.
 * Everything here is private by design — RLS hands nobody else these rows (ADR-027 / 028).
 */
export function useRhythm() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const { settings } = useMuteSettings();
  const { data: profile } = useProfileSettings();
  const { setFocus } = useSettingsActions();

  const archivesQuery = useQuery<Map<string, string>, Error>({
    queryKey: rhythmKeys.archives,
    queryFn: fetchArchives,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
  const archives = useMemo(() => archivesQuery.data ?? new Map<string, string>(), [archivesQuery.data]);
  const conversationMutes = useMemo(() => toConversationMutes(settings), [settings]);
  const focus: FocusMode | null = activeFocus(profile?.focusMode, profile?.focusUntil);
  const focusUntil: string | null = focus === null ? null : (profile?.focusUntil ?? null);

  const invalidateInbox = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  }, [queryClient]);

  const archiveMutation = useMutation({
    mutationFn: async ({ conversationId, archive }: { conversationId: string; archive: boolean }) => {
      if (archive) await archiveConversation(userId ?? "", conversationId);
      else await unarchiveConversation(conversationId);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: rhythmKeys.archives }),
  });

  const archive = useCallback(
    (conversationId: string): void => {
      archiveMutation.mutate(
        { conversationId, archive: true },
        {
          onSuccess: () =>
            toast("Đã lưu trữ", {
              action: { label: "Hoàn tác", onClick: () => archiveMutation.mutate({ conversationId, archive: false }) },
            }),
          onError: (error: Error) => toast.error(error.message),
        },
      );
    },
    [archiveMutation],
  );

  const unarchive = useCallback(
    (conversationId: string): void => {
      archiveMutation.mutate(
        { conversationId, archive: false },
        { onError: (error: Error) => toast.error(error.message) },
      );
    },
    [archiveMutation],
  );

  const muteConversation = useCallback(
    async (conversationId: string, option: MuteDurationOption): Promise<void> => {
      try {
        const until = mutedUntilFor(option);
        await setConversationMute(conversationId, until);
        void queryClient.invalidateQueries({ queryKey: muteKeys.all });
        toast(`Đã tắt thông báo tới ${shortUntil(until.toISOString())}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Chưa tắt được thông báo.");
      }
    },
    [queryClient],
  );

  const unmuteConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        await clearConversationMute(conversationId);
        void queryClient.invalidateQueries({ queryKey: muteKeys.all });
        toast("Đã bật lại thông báo");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Chưa bật lại được.");
      }
    },
    [queryClient],
  );

  /** Xem sau on a whole conversation = Xem sau on its newest message. */
  const readLaterConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        const newestMessageId = await fetchNewestMessageId(conversationId);
        if (newestMessageId === null) return;
        await markUnreadFrom(newestMessageId);
        invalidateInbox();
        toast("Đã để xem sau", {
          action: {
            label: "Hoàn tác",
            onClick: () => void markConversationRead(conversationId).then(invalidateInbox),
          },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Chưa để xem sau được.");
      }
    },
    [invalidateInbox],
  );

  const startFocus = useCallback(
    (mode: FocusMode, option: FocusDurationOption): void => {
      const until = focusUntilFor(option);
      setFocus.mutate(
        { mode, until },
        {
          onSuccess: () => {
            toast(until === null ? "Đang tập trung tới khi bạn tắt" : `Đang tập trung tới ${shortUntil(until.toISOString())}`);
            invalidateInbox();
          },
          onError: (error: Error) => toast.error(error.message),
        },
      );
    },
    [setFocus, invalidateInbox],
  );

  const stopFocus = useCallback((): void => {
    setFocus.mutate(
      { mode: null, until: null },
      {
        onSuccess: () => {
          toast("Đã tắt Chế độ tập trung");
          invalidateInbox();
        },
        onError: (error: Error) => toast.error(error.message),
      },
    );
  }, [setFocus, invalidateInbox]);

  return {
    archives,
    conversationMutes,
    focus,
    focusUntil,
    archive,
    unarchive,
    muteConversation,
    unmuteConversation,
    readLaterConversation,
    startFocus,
    stopFocus,
    muteChoices: CONVERSATION_MUTE_DURATIONS,
    isFocusSaving: setFocus.isPending,
  };
}
