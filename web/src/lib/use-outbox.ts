import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { attachmentKeys, sendMessageWithAttachments, uploadStagedAttachment, type StagedAttachment } from "@/lib/attachments";
import { chatKeys, mergeIncomingMessage, sendMessage, type ChatMessage } from "@/lib/chat";
import { logError } from "@/lib/log";
import {
  isNetworkError,
  isPermanentSendError,
  nextSeq,
  outboxStore,
  retryDelayMs,
  runLimited,
  sendableHeads,
  type OutboxFile,
  type OutboxItem,
} from "@/lib/outbox";

/**
 * AVORA-106 · K2 — drives the outbox: sends the head of each conversation, retries on the network
 * coming back (`online`) with back-off, and resumes after a reload. Each finished send patches the
 * thread cache with the server's row (K3 · N6: no reload of the thread).
 */
export function useOutboxRunner(userId: string | undefined): {
  enqueue: (input: Omit<OutboxItem, "seq" | "state" | "attempts" | "lastError" | "userId" | "createdAt"> & { createdAt?: string }) => Promise<void>;
  retry: (id: string) => Promise<void>;
  drop: (id: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const runningRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);

  const showWaiting = useCallback(
    (item: OutboxItem): void => {
      const key = chatKeys.messages(item.conversationId);
      const bubble: ChatMessage = {
        id: item.id,
        conversationId: item.conversationId,
        senderId: item.userId,
        content: item.content,
        createdAt: item.createdAt,
        replyToMessageId: item.replyToMessageId,
        attachmentCount: item.files.length,
        isUrgent: item.isUrgent,
        pending: true,
        failed: item.state === "failed",
        outboxState: item.state,
      };
      queryClient.setQueryData<ChatMessage[]>(key, (current) => {
        const rest = (current ?? []).filter((message) => message.id !== item.id);
        return [...rest, bubble].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      });
    },
    [queryClient],
  );

  const sendOne = useCallback(
    async (item: OutboxItem): Promise<void> => {
      if (runningRef.current.has(item.conversationId)) return;
      runningRef.current.add(item.conversationId);
      let current: OutboxItem = { ...item, state: "sending", attempts: item.attempts + 1 };
      await outboxStore.put(current);
      showWaiting(current);
      try {
        if (current.files.length > 0) {
          const files = await runLimited(
            current.files.map((file) => async (): Promise<OutboxFile> => {
              if (file.storagePath !== undefined) return file;
              const uploaded = await uploadStagedAttachment(current.conversationId, outboxFileToStaged(file));
              return { ...file, storagePath: uploaded.storage_path };
            }),
            3,
          );
          current = { ...current, files };
          await outboxStore.put(current);
          const sent = await sendMessageWithAttachments({
            messageId: current.id,
            conversationId: current.conversationId,
            content: current.content,
            replyToMessageId: current.replyToMessageId,
            mentionedUserIds: current.mentionedUserIds,
            originGroupId: current.originGroupId,
            attachments: files.map((file) => ({
              kind: file.kind,
              storage_path: file.storagePath ?? "",
              file_name: file.fileName,
              mime_type: file.mimeType,
              byte_size: file.blob.size,
              width: file.width,
              height: file.height,
              duration_seconds: file.durationSeconds,
              permission: file.permission,
              capture_source: file.captureSource,
            })),
          });
          void sent;
          void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(current.conversationId) });
          void queryClient.invalidateQueries({ queryKey: chatKeys.messages(current.conversationId) });
        } else {
          const row = await sendMessage(
            current.conversationId,
            current.userId,
            current.content,
            current.replyToMessageId,
            current.mentionedUserIds,
            current.originGroupId,
            null,
            current.isUrgent,
            current.refs,
            current.id,
          );
          queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(current.conversationId), (thread) =>
            mergeIncomingMessage(thread ?? [], row),
          );
        }
        await outboxStore.remove(current.id);
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const state: OutboxItem["state"] =
          isPermanentSendError(message) ? "failed" : offline || isNetworkError(message) ? "waiting_network" : current.attempts >= 5 ? "failed" : "queued";
        current = { ...current, state, lastError: message.slice(0, 160) };
        await outboxStore.put(current);
        showWaiting(current);
        if (state === "failed") logError("outbox", { code: "send_failed", message: message.slice(0, 80) });
      } finally {
        runningRef.current.delete(item.conversationId);
      }
    },
    [queryClient, showWaiting],
  );

  const pump = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const items = await outboxStore.all(userId);
    const heads = sendableHeads(items);
    if (heads.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      for (const head of heads) if (head.state !== "waiting_network") await outboxStore.put({ ...head, state: "waiting_network" });
      return;
    }
    await Promise.all(heads.map((head) => sendOne(head)));
    // Something is still queued (next in line, or a transient failure): run again after back-off.
    const left = sendableHeads(await outboxStore.all(userId));
    if (left.length > 0) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const delay = Math.min(...left.map((entry) => (entry.attempts === 0 ? 0 : retryDelayMs(entry.attempts))));
      timerRef.current = window.setTimeout(() => void pump(), delay);
    }
  }, [userId, sendOne]);

  // Resume after a reload: everything still waiting shows again and is sent.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void outboxStore.all(userId).then((items) => {
      if (cancelled) return;
      items.forEach((entry) => showWaiting(entry.state === "sending" ? { ...entry, state: "queued" } : entry));
      void pump();
    });
    const online = (): void => void pump();
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [userId, pump, showWaiting]);

  const enqueue = useCallback<ReturnType<typeof useOutboxRunner>["enqueue"]>(
    async (input) => {
      if (!userId) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      const item: OutboxItem = {
        ...input,
        userId,
        createdAt: input.createdAt ?? new Date().toISOString(),
        seq: nextSeq(),
        state: "queued",
        attempts: 0,
        lastError: null,
      };
      showWaiting(item);
      await outboxStore.put(item);
      void pump();
    },
    [userId, pump, showWaiting],
  );

  const retry = useCallback(
    async (id: string): Promise<void> => {
      if (!userId) return;
      const found = (await outboxStore.all(userId)).find((entry) => entry.id === id);
      if (found === undefined) return;
      const next: OutboxItem = { ...found, state: "queued", attempts: 0 };
      await outboxStore.put(next);
      showWaiting(next);
      void pump();
    },
    [userId, pump, showWaiting],
  );

  const drop = useCallback(
    async (id: string): Promise<void> => {
      if (!userId) return;
      const found = (await outboxStore.all(userId)).find((entry) => entry.id === id);
      await outboxStore.remove(id);
      if (found !== undefined) {
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(found.conversationId), (thread) =>
          (thread ?? []).filter((message) => message.id !== id),
        );
      }
      void pump();
    },
    [userId, pump, queryClient],
  );

  return { enqueue, retry, drop };
}

/** A staged composer file → what the outbox keeps (the blob itself survives a reload in IndexedDB). */
export function stagedToOutboxFile(staged: StagedAttachment): OutboxFile {
  return {
    localId: staged.localId,
    blob: staged.blob,
    fileName: staged.fileName,
    mimeType: staged.mimeType,
    kind: staged.kind,
    width: staged.width,
    height: staged.height,
    durationSeconds: staged.durationSeconds,
    permission: staged.permission,
    captureSource: staged.captureSource ?? null,
  };
}

function outboxFileToStaged(file: OutboxFile): StagedAttachment {
  return {
    localId: file.localId,
    blob: file.blob,
    kind: file.kind,
    fileName: file.fileName,
    mimeType: file.mimeType,
    byteSize: file.blob.size,
    width: file.width,
    height: file.height,
    durationSeconds: file.durationSeconds,
    permission: file.permission,
    captureSource: file.captureSource,
    previewUrl: null,
  };
}
