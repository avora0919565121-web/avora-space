import { MISSING_URL } from "@/lib/attachments";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  attachmentKeys,
  attachmentsByMessage,
  fetchThreadAttachments,
  signedUrlsFor,
  thumbnailPathOf,
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
  /** K3 · N2: the 320 px thumbnail of a photo, or null when it has none (older photos). */
  thumbUrlOf: (storagePath: string) => string | null;
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

  const thumbPaths = useMemo(
    () =>
      attachments
        .filter((item) => item.kind === "image")
        .map((item) => thumbnailPathOf(item.storagePath))
        .filter((path): path is string => path !== null)
        .sort(),
    [attachments],
  );
  const { data: thumbUrls } = useQuery<Map<string, string>, Error>({
    queryKey: attachmentKeys.urls(thumbPaths),
    queryFn: () => signedUrlsFor(thumbPaths),
    enabled: thumbPaths.length > 0,
    staleTime: 8 * 60_000,
    refetchInterval: 8 * 60_000,
  });

  const { data: urls, isSuccess: hasUrls } = useQuery<Map<string, string>, Error>({
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
    // K2 · C9: links came back and this file had none → it is gone (MISSING_URL), not loading.
    urlOf: useCallback(
      (storagePath: string) => urls?.get(storagePath) ?? (hasUrls ? MISSING_URL : null),
      [urls, hasUrls],
    ),
    thumbUrlOf: useCallback(
      (storagePath: string) => {
        const thumbPath = thumbnailPathOf(storagePath);
        return thumbPath === null ? null : (thumbUrls?.get(thumbPath) ?? null);
      },
      [thumbUrls],
    ),
    isLoading,
  };
}
