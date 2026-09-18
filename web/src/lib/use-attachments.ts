import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  attachmentKeys,
  attachmentsByMessage,
  fetchThreadAttachments,
  signedUrlsFor,
  type MessageAttachment,
} from "@/lib/attachments";

/**
 * The files in one thread, plus the short-lived links that let them be shown.
 *
 * Fetched per conversation rather than per message: a thread of eighty bubbles would
 * otherwise mean eighty requests, and the rows are small. Links are asked for in one batch
 * and re-asked for before they expire, so a thread left open overnight still renders.
 */
export function useThreadAttachments(conversationId: string | undefined): {
  attachments: MessageAttachment[];
  attachmentsOf: (messageId: string) => MessageAttachment[];
  urlOf: (storagePath: string) => string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<MessageAttachment[], Error>({
    queryKey: attachmentKeys.thread(conversationId ?? ""),
    queryFn: () => fetchThreadAttachments(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });

  const attachments = useMemo(() => data ?? [], [data]);
  const grouped = useMemo(() => attachmentsByMessage(attachments), [attachments]);

  const paths = useMemo(
    () => attachments.map((item) => item.storagePath).sort(),
    [attachments],
  );

  const { data: urls } = useQuery<Map<string, string>, Error>({
    queryKey: attachmentKeys.urls(paths),
    queryFn: () => signedUrlsFor(paths),
    enabled: paths.length > 0,
    // Links last ten minutes; refreshing at eight keeps an open thread from going blank.
    staleTime: 8 * 60_000,
    refetchInterval: 8 * 60_000,
  });

  return {
    attachments,
    attachmentsOf: useCallback((messageId: string) => grouped.get(messageId) ?? [], [grouped]),
    urlOf: useCallback((storagePath: string) => urls?.get(storagePath) ?? null, [urls]),
    isLoading,
  };
}
