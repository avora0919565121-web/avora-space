import { logError } from "@/lib/log";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { outboxStore } from "@/lib/outbox";
import { forgetThreadCache } from "@/lib/thread-cache";
import { INCOMING_MESSAGE_EVENT, type IncomingMessageSignal } from "@/lib/in-app-alerts";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { attachmentKeys } from "@/lib/attachments";
import { useAuth } from "@/lib/auth";
import {
  applyMessageEditToInbox,
  applyMessageToInbox,
  applyMessageUpdate,
  chatKeys,
  clearUnread,
  markMessagesDelivered,
  mergeIncomingMessage,
  toChatMessageRow,
  toIsoTimestamp,
  type MessageRowShape,
  type ChatMessage,
  type ConversationSummary,
} from "@/lib/chat";
import { familyKeys, type FamilyRelation } from "@/lib/family";
import { groupKeys, type GroupMember } from "@/lib/groups";
import { activeFocus } from "@/lib/mute";
import { settingsKeys, type ProfileSettings } from "@/lib/settings";
import { peerLabel } from "@/lib/initials";
import { messageTaskKeys } from "@/lib/message-tasks";
import {
  removeSuggestion,
  suggestionFromRealtimeRow,
  suggestionKeys,
  upsertSuggestion,
  type TaskSuggestion,
} from "@/lib/task-suggestions";
import { removeTask, taskFromRealtimeRow, taskKeys, upsertTask, type TaskItem } from "@/lib/tasks";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type ReadMarkRow = Database["public"]["Tables"]["conversation_read_marks"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type SuggestionRow = Database["public"]["Tables"]["task_suggestions"]["Row"];
type RemovalRequestRow = Database["public"]["Tables"]["group_removal_requests"]["Row"];

export type RealtimeStatus = "connecting" | "live" | "offline";

/** True while the viewer chose `Ngắt kết nối` and it has not run out. */
export function isDisconnected(queryClient: QueryClient): boolean {
  const profile = queryClient.getQueryData<ProfileSettings>(settingsKeys.profile);
  return activeFocus(profile?.focusMode, profile?.focusUntil) === "disconnect";
}

type ChatRealtimeValue = {
  status: RealtimeStatus;
  /** True only while the socket is subscribed; drives the polling fallback. */
  isLive: boolean;
  /**
   * Registers the thread the user is actually reading, so arriving messages
   * for it are not counted as unread. Pass null when nothing is on screen.
   */
  setReadingConversation: (conversationId: string | null) => void;
};

const ChatRealtimeContext = createContext<ChatRealtimeValue>({
  status: "connecting",
  isLive: false,
  setReadingConversation: () => undefined,
});

/** Live-delivery state of the chat socket. */
export function useChatRealtime(): ChatRealtimeValue {
  return useContext(ChatRealtimeContext);
}

/**
 * Owns the single Supabase Realtime subscription for the signed-in user.
 *
 * Rows arrive already filtered by RLS, so unfiltered `messages` and `tasks`
 * subscriptions only ever yield rows the user is allowed to read: their own
 * personal tasks plus shared tasks from conversations they take part in.
 * (A `postgres_changes` filter cannot express "creator OR peer" — it only does a
 * single column equality — so RLS is the filter, exactly as it is for messages.)
 */
export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId: string | undefined = user?.id;
  const queryClient: QueryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const hasBeenLiveRef = useRef<boolean>(false);
  const readingRef = useRef<string | null>(null);
  const previousUserIdRef = useRef<string | null>(null);

  const setReadingConversation = useCallback((conversationId: string | null): void => {
    readingRef.current = conversationId;
  }, []);

  /**
   * The socket authorises RLS from the access token it was given at join time, and
   * supabase-js rotates that token about once an hour. Without re-arming it the
   * connection keeps a stale JWT and delivery quietly stops.
   */
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
      const token: string | undefined = session?.access_token;
      if (token) void Promise.resolve(supabase.realtime.setAuth(token));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  /**
   * Chat data belongs to one account. When the signed-in user changes in this tab,
   * drop the cache so the next account never renders the previous one's inbox.
   */
  useEffect(() => {
    const previous: string | null = previousUserIdRef.current;
    const current: string | null = userId ?? null;
    previousUserIdRef.current = current;
    if (previous === null || previous === current) return;

    queryClient.removeQueries({ queryKey: chatKeys.conversations });
    queryClient.removeQueries({ queryKey: ["messages"] });
    queryClient.removeQueries({ queryKey: ["conversation-peer"] });
    queryClient.removeQueries({ queryKey: taskKeys.all });
    queryClient.removeQueries({ queryKey: suggestionKeys.all });
    queryClient.removeQueries({ queryKey: messageTaskKeys.all });
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId) {
      setStatus("connecting");
      hasBeenLiveRef.current = false;
      return;
    }

    let channel: RealtimeChannel | null = null;
    let isCancelled = false;

    /** Refetch everything after a gap in delivery — events during a drop are lost. */
    const backfill = (): void => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
      void queryClient.invalidateQueries({ queryKey: messageTaskKeys.all });
    };

    /** K2 · C4: the same mapping as every read — a live message is never thinner than a fetched one. */
    const toChatMessage = (row: MessageRow): ChatMessage => {
      const message = toChatMessageRow(row as unknown as MessageRowShape);
      return {
        ...message,
        createdAt: toIsoTimestamp(row.created_at),
        editedAt: row.edited_at === null ? null : toIsoTimestamp(row.edited_at),
        deletedAt: row.deleted_at === null ? null : toIsoTimestamp(row.deleted_at),
      };
    };

    /**
     * An edit or a recall, delivered to everyone in the room.
     *
     * This is what makes đã thu hồi mean something: without it, the words would stay on the
     * other person's screen until they happened to reload, which is exactly the moment that
     * matters most.
     */
    const handleMessageUpdate = (payload: RealtimePostgresUpdatePayload<MessageRow>): void => {
      const incoming = toChatMessage(payload.new);

      const threadKey = chatKeys.messages(incoming.conversationId);
      const thread = queryClient.getQueryData<ChatMessage[]>(threadKey);
      if (thread) {
        const next = applyMessageUpdate(thread, incoming);
        if (next !== thread) queryClient.setQueryData<ChatMessage[]>(threadKey, next);
      }

      // The inbox preview quotes the newest message, so a correction to it has to follow.
      const inbox = queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations);
      if (inbox) {
        const patched = applyMessageEditToInbox(inbox, incoming);
        if (patched !== inbox) {
          queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations, patched);
        }
      }
    };

    const handleMessage = (payload: RealtimePostgresInsertPayload<MessageRow>): void => {
      const row = payload.new;
      const incoming: ChatMessage = toChatMessage(row);

      // Chế độ tập trung · Ngắt kết nối (AVORA-47 · C): new lines are not taken in, so they are not
      // "Đã nhận" either — except from Gia đình and anything Khẩn. `Kết nối lại` re-reads all.
      if (incoming.senderId !== userId && isDisconnected(queryClient)) {
        const family = queryClient.getQueryData<FamilyRelation[]>(familyKeys.list) ?? [];
        const passes = row.is_urgent === true || family.some((entry) => entry.relatedUserId === incoming.senderId);
        if (!passes) return;
      }

      const threadKey = chatKeys.messages(incoming.conversationId);
      const thread = queryClient.getQueryData<ChatMessage[]>(threadKey);
      if (thread) {
        queryClient.setQueryData<ChatMessage[]>(threadKey, mergeIncomingMessage(thread, incoming));
      }

      // Đã nhận (AVORA-47 · E): this device has the line now. The server keeps it to 1-1s.
      if (incoming.senderId !== userId && incoming.systemKind == null) {
        void markMessagesDelivered([incoming.id]);
      }

      // The message row arrives on its own stream; the files hanging off it do not. Without
      // this, a photo sent to someone watching the thread would land as an empty bubble and
      // stay that way until they reloaded.
      if ((incoming.attachmentCount ?? 0) > 0) {
        void queryClient.invalidateQueries({
          queryKey: attachmentKeys.thread(incoming.conversationId),
        });
      }

      // A thread open in a background tab is not being read, so it still counts as unread.
      const isReading =
        readingRef.current === incoming.conversationId &&
        (typeof document === "undefined" || document.visibilityState === "visible");

      // In-app sound (Đợt gộp 2 · A11): the alerts layer decides, with the mute rules.
      if (incoming.senderId !== userId && incoming.systemKind == null && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<IncomingMessageSignal>(INCOMING_MESSAGE_EVENT, {
            detail: {
              conversationId: incoming.conversationId,
              senderId: incoming.senderId,
              mentionsViewer: userId !== undefined && (incoming.mentionedUserIds ?? []).includes(userId),
              isReading,
            },
          }),
        );
      }

      const inbox = queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations);
      const patched = inbox
        ? applyMessageToInbox(inbox, incoming, {
            viewerId: userId,
            readingConversationId: isReading ? incoming.conversationId : null,
          })
        : null;
      if (patched) {
        queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations, patched);
        return;
      }
      // Unknown conversation: only the server can tell us who the peer is.
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    };

    const handleParticipantInsert = (): void => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    };

    /**
     * The viewer's own read watermark, moved on another device, clears the badge here too.
     * Read marks live in their own table whose RLS returns only the reader's rows, so nobody
     * else's watermark ever reaches this socket (Đợt gộp 2 · B3, ADR-028). The user check stays
     * as a second guard.
     */
    const handleReadMark = (payload: { new: Partial<ReadMarkRow> }): void => {
      const row = payload.new;
      if (row.conversation_id === undefined || row.user_id !== userId) return;

      const inbox = queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations);
      if (!inbox) return;

      const next = clearUnread(inbox, row.conversation_id);

      if (next !== inbox) queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations, next);
    };

    /**
     * Every task change either party makes — a new shared task, the peer's
     * confirmation, the assignee's done claim, or the creator's review — lands here.
     * Status, confirmed_at, done_at and completed_confirmed_at all live on this row,
     * so one stream covers the whole
     * pending_confirmation → confirmed → done_pending_review → done flow.
     */
    const handleTaskChange = (payload: RealtimePostgresChangesPayload<TaskRow>): void => {
      // Lịch holds date-bounded slices; a changed row may enter or leave any of them.
      void queryClient.invalidateQueries({ queryKey: taskKeys.rangeRoot });
      const cached = queryClient.getQueryData<TaskItem[]>(taskKeys.list);
      // Nothing rendered yet: the next mount fetches fresh data anyway.
      if (!cached) return;

      if (payload.eventType === "DELETE") {
        const deletedId: string | undefined = payload.old?.id;
        if (!deletedId) {
          void queryClient.invalidateQueries({ queryKey: taskKeys.all });
          return;
        }
        queryClient.setQueryData<TaskItem[]>(taskKeys.list, removeTask(cached, deletedId));
        return;
      }

      const task = taskFromRealtimeRow(payload.new);
      queryClient.setQueryData<TaskItem[]>(taskKeys.list, upsertTask(cached, task));
    };

    /**
     * A suggestion is a question asked of someone who is usually reading the thread right then,
     * so the answer has to land immediately: otherwise the person who asked keeps looking at an
     * open request that has already been answered.
     */
    const handleSuggestionChange = (payload: RealtimePostgresChangesPayload<SuggestionRow>): void => {
      const cached = queryClient.getQueryData<TaskSuggestion[]>(suggestionKeys.list);
      if (!cached) {
        void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
        return;
      }

      if (payload.eventType === "DELETE") {
        const deletedId: string | undefined = payload.old?.id;
        if (!deletedId) {
          void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
          return;
        }
        queryClient.setQueryData<TaskSuggestion[]>(
          suggestionKeys.list,
          removeSuggestion(cached, deletedId),
        );
        void queryClient.invalidateQueries({ queryKey: messageTaskKeys.all });
        return;
      }

      const suggestion = suggestionFromRealtimeRow(payload.new);
      queryClient.setQueryData<TaskSuggestion[]>(
        suggestionKeys.list,
        upsertSuggestion(cached, suggestion),
      );

      /**
       * The mark on the original message is read from these same rows, so every change to a
       * suggestion can change it: raising one puts a dot there, and skipping or withdrawing
       * takes it away. It is a separate query because it is fetched per thread, so patching
       * the list above does not reach it.
       */
      void queryClient.invalidateQueries({ queryKey: messageTaskKeys.all });

      // Accepting creates a task in the same breath. The tasks socket delivers it too, but only
      // to people RLS lets read it — refreshing here keeps the two views from disagreeing for
      // whoever is watching the conversation.
      if (suggestion.status === "accepted") {
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      }
    };

    /**
     * The owner's verdict on one of this viewer's removal asks, delivered the moment it is
     * written. RLS only streams rows the subscriber may read — an admin sees their own asks,
     * never anyone else's — and a resolution is a one-way state change, so each request id is
     * toasted once per session rather than once per redelivery.
     */
    const seenResolvedRequests = new Set<string>();
    const handleRemovalResolution = (payload: RealtimePostgresUpdatePayload<RemovalRequestRow>): void => {
      const row = payload.new;
      if (row.requested_by !== userId) return;
      if (row.status !== "approved" && row.status !== "rejected") return;
      if (seenResolvedRequests.has(row.id)) return;
      seenResolvedRequests.add(row.id);

      // An open roster panel should not keep showing a decided ask, or list a member who is gone.
      void queryClient.invalidateQueries({ queryKey: groupKeys.removalRequests(row.conversation_id) });
      if (row.status === "approved") {
        void queryClient.invalidateQueries({ queryKey: groupKeys.members(row.conversation_id) });
      }

      // The event carries ids, not names. The approved member is already out of the roster by
      // the time we look, so the read-only cache is the only reliable source — otherwise the
      // toast says simply "thành viên", which still answers the question it exists for.
      const cachedMembers = queryClient.getQueryData<GroupMember[]>(groupKeys.members(row.conversation_id));
      const target = cachedMembers?.find((member) => member.userId === row.target_user_id);
      const targetName = target ? peerLabel(target.displayName) : "thành viên";

      if (row.status === "approved") {
        toast.success(`Chủ nhóm đã duyệt — ${targetName} đã bị xoá khỏi nhóm.`);
      } else {
        toast.info(`Chủ nhóm đã từ chối đề nghị xoá ${targetName}.`);
      }
    };

    const start = async (): Promise<void> => {
      // The socket authorises RLS from the access token, so it must be set before joining.
      const { data } = await supabase.auth.getSession();
      const token: string | undefined = data.session?.access_token;
      if (token) await Promise.resolve(supabase.realtime.setAuth(token));
      if (isCancelled) return;

      channel = supabase
        .channel(`avora-chat-${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversation_participants" },
          handleParticipantInsert,
        )
        .on<ReadMarkRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversation_read_marks" },
          (payload) => handleReadMark({ new: payload.new as Partial<ReadMarkRow> }),
        )
        .on<TaskRow>("postgres_changes", { event: "*", schema: "public", table: "tasks" }, handleTaskChange)
        .on<SuggestionRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: "task_suggestions" },
          handleSuggestionChange,
        )
        .on<RemovalRequestRow>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "group_removal_requests" },
          handleRemovalResolution,
        )
        .subscribe((state: string) => {
          if (isCancelled) return;
          if (state === "SUBSCRIBED") {
            setStatus("live");
            if (hasBeenLiveRef.current) backfill();
            hasBeenLiveRef.current = true;
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            logError("realtime", { code: state });
            setStatus("offline");
          }
        });
    };

    const startedRef: Promise<void> = start();

    /**
     * K2 · C11: the server tells this person's own topic (`user-<id>`, private) when they leave or
     * are removed. Every device drops the room from the list, forgets its cache and outbox, and
     * says so once.
     */
    let personal: RealtimeChannel | null = null;
    const startPersonal = (): void => {
      personal = supabase
        .channel(`user-${userId}`, { config: { private: true } })
        // K3 · N1: messages arrive as a broadcast on this person's own private topic (one row per
        // member, sent by the server) — the database no longer evaluates every message for everyone.
        .on("broadcast", { event: "message" }, (message) => {
          const row = (message as { payload?: { message?: MessageRow } }).payload?.message;
          if (row !== undefined) handleMessage({ new: row } as RealtimePostgresInsertPayload<MessageRow>);
        })
        .on("broadcast", { event: "message_update" }, (message) => {
          const row = (message as { payload?: { message?: MessageRow } }).payload?.message;
          if (row !== undefined) handleMessageUpdate({ new: row } as RealtimePostgresUpdatePayload<MessageRow>);
        })
        .on("broadcast", { event: "removed" }, (message) => {
          const payload = (message as { payload?: { conversation_id?: string; name?: string | null } }).payload;
          const removedId = payload?.conversation_id;
          if (typeof removedId !== "string") return;
          const inbox = queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations);
          const wasGroup = inbox?.find((entry) => entry.conversationId === removedId)?.kind === "group";
          if (inbox) {
            queryClient.setQueryData<ConversationSummary[]>(
              chatKeys.conversations,
              inbox.filter((entry) => entry.conversationId !== removedId),
            );
          }
          queryClient.removeQueries({ queryKey: chatKeys.messages(removedId) });
          queryClient.removeQueries({ queryKey: attachmentKeys.thread(removedId) });
          void outboxStore.removeConversation(userId, removedId);
          void forgetThreadCache(userId, removedId);
          if (wasGroup && payload?.name) toast(`Bạn không còn trong nhóm ${payload.name}`);
        })
        .subscribe();
    };
    // Joined after start() has set the access token (private topic → RLS on realtime.messages).
    void startedRef.then(() => {
      if (!isCancelled) startPersonal();
    });

    /**
     * K2 · C13: a socket can say "connected" and still receive nothing. Every 30 s the client
     * checks the connection; when it is not open, it reconnects and the backfill on SUBSCRIBED
     * re-reads what was missed.
     */
    const ping = window.setInterval(() => {
      if (isCancelled || document.visibilityState !== "visible") return;
      const open = supabase.realtime.isConnected();
      if (!open || (channel !== null && channel.state !== "joined")) {
        logError("realtime", { code: "zombie_reconnect" });
        setStatus("offline");
        if (channel) void supabase.removeChannel(channel);
        channel = null;
        void start();
      }
    }, 30_000);

    return () => {
      isCancelled = true;
      window.clearInterval(ping);
      if (channel) void supabase.removeChannel(channel);
      if (personal) void supabase.removeChannel(personal);
    };
  }, [userId, queryClient]);

  const value: ChatRealtimeValue = useMemo(
    () => ({ status, isLive: status === "live", setReadingConversation }),
    [status, setReadingConversation],
  );

  return <ChatRealtimeContext.Provider value={value}>{children}</ChatRealtimeContext.Provider>;
}
