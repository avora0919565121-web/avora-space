import { MISSING_URL } from "@/lib/attachments";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Download, Forward, Lock, Mic, X } from "lucide-react";
import { toast } from "sonner";

import {
  canExportAttachment,
  formatDuration,
  formatFileSize,
  signedUrlFor,
  type MessageAttachment,
} from "@/lib/attachments";
import { fileIconOf } from "@/components/chat/file-icon";
import { cn } from "@/lib/utils";
import { BackClosesBinding } from "@/lib/use-back-closes";

/** Widest a photo is drawn in a bubble — past this the thread stops being readable. */
const IMAGE_MAX_WIDTH_PX = 320;

function aspectRatio(attachment: MessageAttachment): number {
  if (attachment.width === null || attachment.height === null) return 4 / 3;
  if (attachment.width <= 0 || attachment.height <= 0) return 4 / 3;
  // Very tall screenshots are boxed rather than allowed to run the height of the thread.
  return Math.max(attachment.width / attachment.height, 0.6);
}

/** The photo's true width/height ratio, or null when the attachment does not record it. */
function knownRatio(attachment: MessageAttachment): number | null {
  if (attachment.width === null || attachment.height === null) return null;
  if (attachment.width <= 0 || attachment.height <= 0) return null;
  return attachment.width / attachment.height;
}

/**
 * The full-size viewer's image box (AVORA-35): as large as the screen allows along its longest
 * fitting side, never distorted, never past the frame — small photos grow, large ones shrink.
 * Sized from the ratio rather than stretched with `object-contain`, so the empty space around the
 * photo stays part of the backdrop and a tap there still closes the viewer.
 */
export function fullViewerSize(ratio: number, marginPx: number = 32): { width: string; aspectRatio: string } {
  return {
    width: `min(calc(100vw - ${marginPx}px), calc((100dvh - ${marginPx}px) * ${ratio}))`,
    aspectRatio: `${ratio}`,
  };
}

type AttachmentProps = {
  attachment: MessageAttachment;
  url: string | null;
  outgoing: boolean;
};

/** Downloads the file under its own name, rather than leaving a tab open on a signed URL. */
async function download(attachment: MessageAttachment): Promise<void> {
  const url = await signedUrlFor(attachment.storagePath);
  if (url === null) {
    toast.error("Không tải được tệp. Thử lại nhé.");
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** K2 · C9: a file that no longer exists says so, instead of "Đang tải ảnh…" forever. */
export const MISSING_FILE_NOTE = "Tệp không còn";

function ImageAttachment({ attachment, url, outgoing }: AttachmentProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isBroken, setIsBroken] = useState<boolean>(false);
  const canSave = canExportAttachment(attachment.permission);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Xem ảnh ${attachment.fileName}`}
        className="press group relative block overflow-hidden rounded-[12px] border border-border bg-secondary/40"
        style={{ width: IMAGE_MAX_WIDTH_PX, aspectRatio: aspectRatio(attachment) }}
      >
        {isBroken || url === MISSING_URL ? (
          <span data-missing-file="" className="flex h-full w-full items-center justify-center text-[12.5px] text-muted-foreground">
            {MISSING_FILE_NOTE}
          </span>
        ) : url === null ? (
          <span className="flex h-full w-full items-center justify-center text-[12.5px] text-muted-foreground">
            Đang tải ảnh…
          </span>
        ) : (
          <img
            src={url}
            alt={attachment.fileName}
            draggable={false}
            loading="lazy"
            onError={() => setIsBroken(true)}
            className="h-full w-full object-cover"
          />
        )}
        {!canSave ? (
          <span
            className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground backdrop-blur-sm"
            title="Người gửi chỉ cho xem tệp này"
          >
            <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Chỉ xem
          </span>
        ) : null}
      </button>

      {/*
        Full size on top of the thread rather than in a new tab: a signed URL opened as a
        page is a link someone can paste, and it would outlive the conversation it came from.
      */}
      {isOpen && url !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={attachment.fileName}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4"
          onClick={() => setIsOpen(false)}
        >
          <BackClosesBinding close={() => setIsOpen(false)} />
          {/*
            Fills the viewer along its longest fitting side, small photos included. With a known
            ratio the box is sized exactly; without one the photo is stretched to the frame and
            letterboxed by object-contain — never distorted, never past the edge.
          */}
          {knownRatio(attachment) !== null ? (
            <img
              src={url}
              alt={attachment.fileName}
              draggable={false}
              style={fullViewerSize(knownRatio(attachment) ?? 1)}
              className="h-auto max-h-full max-w-full rounded-[12px] object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              src={url}
              alt={attachment.fileName}
              draggable={false}
              className="h-full w-full object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <div className="absolute right-4 top-4 flex items-center gap-2">
            {canSave ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void download(attachment);
                }}
                aria-label="Tải ảnh về"
                className="press rounded-full border border-border bg-card p-2.5 text-foreground"
              >
                <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Đóng"
              className="press rounded-full border border-border bg-card p-2.5 text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {outgoing ? null : null}
    </>
  );
}

function VoiceAttachment({ attachment, url }: AttachmentProps) {
  return (
    <div className="flex w-[280px] items-center gap-2.5 rounded-[12px] border border-border bg-card px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Mic className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {url === null ? (
          <p className="text-[12.5px] text-muted-foreground">Đang tải…</p>
        ) : (
          <audio
            src={url}
            controls
            preload="none"
            // Hides the browser's own save button when the sender did not allow saving.
            controlsList={canExportAttachment(attachment.permission) ? undefined : "nodownload"}
            className="h-8 w-full"
          />
        )}
      </div>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
        {formatDuration(attachment.durationSeconds)}
      </span>
    </div>
  );
}

function FileAttachment({ attachment }: AttachmentProps) {
  const canSave = canExportAttachment(attachment.permission);
  const KindIcon = fileIconOf(attachment);

  return (
    <div className="flex w-[280px] items-center gap-3 rounded-[12px] border border-border bg-card px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-secondary text-muted-foreground">
        <KindIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" data-file-icon="" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-foreground" title={attachment.fileName}>
          {attachment.fileName}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          {formatFileSize(attachment.byteSize)}
          {canSave ? "" : " · chỉ xem"}
        </p>
      </div>
      {canSave ? (
        <button
          type="button"
          onClick={() => void download(attachment)}
          aria-label={`Tải ${attachment.fileName}`}
          className="press shrink-0 rounded-[8px] border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : (
        <span
          className="shrink-0 rounded-[8px] p-2 text-muted-foreground/70"
          title="Người gửi chỉ cho xem tệp này"
        >
          <Lock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

/**
 * AVORA-57 · B — every image of a forwarded conversation, as one grid in send order. A tap opens
 * that very image; the viewer steps to the next / previous one by swipe, arrow key or button.
 */
export function ForwardImageGrid({
  images,
  urlOf,
}: {
  images: readonly MessageAttachment[];
  urlOf: (storagePath: string) => string | null;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  const columns = images.length === 1 ? 1 : images.length === 2 || images.length === 4 ? 2 : 3;
  return (
    <>
      <div
        className="mt-2 grid gap-1 overflow-hidden rounded-[10px]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: IMAGE_MAX_WIDTH_PX }}
      >
        {images.map((image, index) => {
          const url = urlOf(image.storagePath);
          return (
            <button
              key={image.id}
              type="button"
              data-forward-image-index={index}
              onClick={(event) => {
                event.stopPropagation();
                setOpenIndex(index);
              }}
              aria-label={`Xem ảnh ${index + 1} / ${images.length}`}
              className="press relative block aspect-square overflow-hidden bg-secondary/40"
            >
              {url === null ? null : (
                <img src={url} alt={image.fileName} draggable={false} loading="lazy" className="pointer-events-none h-full w-full object-cover" />
              )}
            </button>
          );
        })}
      </div>
      {openIndex !== null ? (
        <ImageViewer images={images} urlOf={urlOf} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />
      ) : null}
    </>
  );
}

function ImageViewer({
  images,
  urlOf,
  index,
  onIndex,
  onClose,
}: {
  images: readonly MessageAttachment[];
  urlOf: (storagePath: string) => string | null;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const url = urlOf(image.storagePath);
  const canSave = canExportAttachment(image.permission);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const go = useCallback(
    (step: number): void => {
      const next = index + step;
      if (next >= 0 && next < images.length) onIndex(next);
    },
    [index, images.length, onIndex],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    startRef.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const start = startRef.current;
    startRef.current = null;
    if (start === null) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - start.y)) go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ảnh ${index + 1} / ${images.length}`}
      data-viewer-index={index}
      className="fixed inset-0 z-50 flex touch-pan-y items-center justify-center bg-background/95 p-4"
      onClick={onClose}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <BackClosesBinding close={onClose} />
      {url !== null ? (
        <img
          src={url}
          alt={image.fileName}
          draggable={false}
          style={knownRatio(image) !== null ? fullViewerSize(knownRatio(image) ?? 1) : undefined}
          className="h-auto max-h-full max-w-full rounded-[12px] object-contain"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">Đang tải ảnh…</p>
      )}
      <span className="tabular absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1 text-[12.5px] text-foreground">
        {index + 1} / {images.length}
      </span>
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {canSave ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void download(image);
            }}
            aria-label="Tải ảnh về"
            className="icon-btn h-11 w-11 text-foreground"
          >
            <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Đóng" className="icon-btn h-11 w-11 text-foreground">
          <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {index > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            go(-1);
          }}
          aria-label="Ảnh trước"
          className="icon-btn absolute left-3 top-1/2 h-11 w-11 -translate-y-1/2 text-foreground"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {index < images.length - 1 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            go(1);
          }}
          aria-label="Ảnh sau"
          className="icon-btn absolute right-3 top-1/2 h-11 w-11 -translate-y-1/2 text-foreground"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export type MessageAttachmentsProps = {
  attachments: readonly MessageAttachment[];
  urlOf: (storagePath: string) => string | null;
  outgoing: boolean;
};

/**
 * The files under a bubble.
 *
 * What is missing here is deliberate: a file the sender marked "chỉ xem" has no save button
 * and no download link. That is a boundary the app respects rather than one it can enforce —
 * a determined reader can always photograph a screen — and saying so plainly beats pretending
 * the file is locked.
 */
export function MessageAttachments({ attachments, urlOf, outgoing }: MessageAttachmentsProps) {
  const renderOne = useCallback(
    (attachment: MessageAttachment) => {
      const url = urlOf(attachment.storagePath);
      const shared = { attachment, url, outgoing };
      if (attachment.kind === "image") return <ImageAttachment key={attachment.id} {...shared} />;
      if (attachment.kind === "voice") return <VoiceAttachment key={attachment.id} {...shared} />;
      return <FileAttachment key={attachment.id} {...shared} />;
    },
    [urlOf, outgoing],
  );

  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", outgoing ? "items-end" : "items-start")}>
      {attachments.map(renderOne)}
      {/*
        A forwarded file says where it came from. The pointer knows its origin, so this is a
        fact rather than a guess — and it stops a file arriving with no account of itself.
      */}
      {attachments.some((item) => item.originMessageId !== null) ? (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Forward className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          Tệp được chuyển tiếp
        </span>
      ) : null}
    </div>
  );
}
