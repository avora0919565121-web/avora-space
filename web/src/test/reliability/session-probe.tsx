import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useImperativeHandle, useState, forwardRef, type Ref } from "react";

import { MessageComposer } from "@/components/chat/MessageComposer";
import type { StagedAttachment } from "@/lib/attachments";
import { useAuth } from "@/lib/auth";
import { chatKeys, editMessage, fetchMessages, fetchOlderMessages, markConversationRead, recallMessage, type ChatMessage } from "@/lib/chat";
import { mergeThreadPage, type ConversationSummary } from "@/lib/chat-cache";
import { readDraft, writeDraft } from "@/lib/chat-drafts";
import { forwardMessages } from "@/lib/forwarding";
import { outboxStore, type OutboxItem } from "@/lib/outbox";
import { useChatRealtime } from "@/lib/realtime";
import { taskKeys, type TaskItem } from "@/lib/tasks";
import { bubbleLabel } from "./bubble-label";
import { stagedToOutboxFile, useOutboxRunner } from "@/lib/use-outbox";

/**
 * 112-A · 2 — one person's copy of the app, loaded as its own module graph (see session-graphs.ts).
 * The engine is the real one: AuthProvider, ChatRealtimeProvider (private-topic broadcast + table
 * streams + reconnect backfill), the outbox runner, the thread query with the same merge as
 * `Messages.tsx`, the real `MessageComposer` and per-conversation drafts. Only the screen around it
 * is a thin probe, so the harness measures behaviour rather than one page's layout.
 */
export type SessionApi = {
  userId: string;
  queryClient: QueryClient;
  open: (conversationId: string) => void;
  /** Same contract as Messages.tsx `handleSend`: a fresh device id per press, through the outbox. */
  send: (conversationId: string, content: string, options?: { replyTo?: string | null; files?: StagedAttachment[] }) => Promise<string>;
  edit: (messageId: string, content: string) => Promise<void>;
  recall: (messageId: string) => Promise<void>;
  forward: (messageIds: string[], target: string) => Promise<number>;
  markRead: (conversationId: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  drop: (id: string) => Promise<void>;
  thread: (conversationId: string) => ChatMessage[];
  /** Scrolls up one page, as Messages.tsx does: cursor = the oldest message on screen. Returns how many came. */
  loadOlder: (conversationId: string) => Promise<number>;
  outbox: () => Promise<OutboxItem[]>;
  inbox: () => ConversationSummary[];
  tasks: () => TaskItem[];
  isLive: () => boolean;
};

type ProbeProps = { initialConversation: string | null };

export const Probe = forwardRef(function Probe({ initialConversation }: ProbeProps, ref: Ref<SessionApi>) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { isLive, setReadingConversation } = useChatRealtime();
  const outbox = useOutboxRunner(userId);
  const [conversationId, setConversationId] = useState<string | null>(initialConversation);

  useEffect(() => {
    setReadingConversation(conversationId);
  }, [conversationId, setReadingConversation]);

  const thread = useQuery<ChatMessage[]>({
    queryKey: chatKeys.messages(conversationId ?? ""),
    queryFn: async () => {
      const id = conversationId as string;
      const rows = await fetchMessages(id, null);
      const current = queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(id)) ?? [];
      const live = current.filter((message) => message.pending === true || (rows.length > 0 && message.createdAt >= rows[rows.length - 1].createdAt));
      return mergeThreadPage(live, rows);
    },
    enabled: Boolean(conversationId) && Boolean(userId),
  });

  const enqueue = useCallback(
    async (target: string, content: string, options?: { replyTo?: string | null; files?: StagedAttachment[] }): Promise<string> => {
      const id = crypto.randomUUID();
      await outbox.enqueue({
        id,
        conversationId: target,
        content: content.trim(),
        replyToMessageId: options?.replyTo ?? null,
        mentionedUserIds: [],
        refs: [],
        originGroupId: null,
        isUrgent: false,
        files: (options?.files ?? []).map(stagedToOutboxFile),
      });
      return id;
    },
    [outbox],
  );

  const sendMutation = useMutation({ mutationFn: async (input: { target: string; content: string }) => enqueue(input.target, input.content) });

  useImperativeHandle(
    ref,
    (): SessionApi => ({
      userId: userId ?? "",
      queryClient,
      open: setConversationId,
      send: enqueue,
      edit: async (messageId, content) => {
        await editMessage(messageId, content);
      },
      recall: async (messageId) => {
        await recallMessage(messageId);
      },
      forward: async (messageIds, target) => (await forwardMessages(messageIds, target)).forwarded,
      markRead: async (target) => {
        await markConversationRead(target);
      },
      retry: outbox.retry,
      drop: outbox.drop,
      thread: (target) => queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(target)) ?? [],
      loadOlder: async (target) => {
        const current = (queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(target)) ?? []).filter((message) => message.pending !== true);
        const oldest = current[0];
        if (oldest === undefined) return 0;
        const older = await fetchOlderMessages(target, { createdAt: oldest.createdAt, id: oldest.id });
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(target), (thread) => mergeThreadPage(thread ?? [], older));
        return older.filter((message) => !current.some((known) => known.id === message.id)).length;
      },
      outbox: () => outboxStore.all(userId ?? ""),
      inbox: () => queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations) ?? [],
      tasks: () => queryClient.getQueryData<TaskItem[]>(taskKeys.list) ?? [],
      isLive: () => isLive,
    }),
    [userId, queryClient, enqueue, outbox, isLive],
  );

  if (!userId) return <p>…</p>;
  return (
    <section data-testid={`session-${userId}`} data-live={isLive ? "yes" : "no"}>
      <ol data-testid="thread">
        {(thread.data ?? []).map((message) => (
          <li
            key={message.id}
            data-testid="bubble"
            data-id={message.id}
            data-state={message.pending === true ? (message.outboxState ?? "queued") : "sent"}
          >
            <span>{message.deletedAt ? "Tin nhắn đã được thu hồi" : message.content}</span>
            <small data-testid="bubble-label">{bubbleLabel(message)}</small>
          </li>
        ))}
      </ol>
      {conversationId !== null ? (
        <Composer
          key={conversationId}
          userId={userId}
          conversationId={conversationId}
          isSending={sendMutation.isPending}
          onSend={(content) => {
            // Messages.tsx · handleSend: refuse while a send is in flight, clear the box, then send.
            if (content.length === 0 || sendMutation.isPending) return;
            sendMutation.mutate({ target: conversationId, content });
          }}
        />
      ) : null}
    </section>
  );
});

function Composer({ userId, conversationId, isSending, onSend }: { userId: string; conversationId: string; isSending: boolean; onSend: (content: string) => void }) {
  const [value, setValue] = useState<string>(() => readDraft(userId, conversationId));
  const change = (next: string): void => {
    setValue(next);
    writeDraft(userId, conversationId, next);
  };
  return (
    <MessageComposer
      value={value}
      onValueChange={change}
      onSend={(content) => {
        change("");
        onSend(content);
      }}
      placeholder="Nhắn tin"
      ariaLabel="Nhắn tin"
      isSending={isSending}
    />
  );
}

