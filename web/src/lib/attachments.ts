import { supabase } from "@/integrations/supabase/client";

/**
 * Files carried by a chat message: a photo, a document, or a recorded voice note.
 *
 * A file is stored once and pointed at. Forwarding adds another pointer rather than another
 * copy, which is why permission travels on the pointer and not on the bytes.
 */
export type AttachmentKind = "image" | "file" | "voice";

/**
 * The one ladder: look at it, carry it further inside AVORA, or take it out of AVORA.
 * `export` is the default because an ordinary file sent to a colleague is meant to be
 * usable — narrowing it is the deliberate act, not the other way round.
 */
export type AttachmentPermission = "view" | "forward" | "export";

export const ATTACHMENT_BUCKET = "chat-attachments";

/** Past this a photo is re-encoded before it leaves the device. */
export const IMAGE_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** The hard ceiling the database and the bucket both enforce. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** A voice note is a remark, not a recording session. */
export const MAX_VOICE_SECONDS = 300;

/** More than this in one message is a folder, and belongs somewhere else. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** Longest edge of a re-encoded photo — enough to read a screenshot of a document. */
const COMPRESSED_MAX_EDGE_PX = 1920;

export type MessageAttachment = {
  id: string;
  messageId: string;
  conversationId: string;
  attachedBy: string;
  kind: AttachmentKind;
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  permission: AttachmentPermission;
  /** Set when this pointer was made by forwarding, so the bubble can say where it came from. */
  originMessageId: string | null;
  createdAt: string;
};

/** What the send RPC is handed — one entry per already-uploaded file. */
export type AttachmentInput = {
  kind: AttachmentKind;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  permission: AttachmentPermission;
};

/** A file chosen but not yet sent: still cancellable, still editable in the composer. */
export type StagedAttachment = {
  /** Local only — the server never sees it. */
  localId: string;
  blob: Blob;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  permission: AttachmentPermission;
  /** Object URL for the thumbnail or the playback control; revoked when the staging clears. */
  previewUrl: string | null;
};

export const attachmentKeys = {
  all: ["message-attachments"] as const,
  thread: (conversationId: string) => ["message-attachments", conversationId] as const,
  urls: (paths: readonly string[]) => ["attachment-urls", [...paths].sort().join("|")] as const,
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[attachments] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_attachment_too_many"))
    return new Error(`Mỗi tin nhắn chỉ gửi được tối đa ${MAX_ATTACHMENTS_PER_MESSAGE} tệp.`);
  if (normalized.includes("avora_attachment_path_invalid") || normalized.includes("avora_attachment_missing"))
    return new Error("Tệp chưa tải lên xong. Thử gửi lại nhé.");
  if (normalized.includes("avora_not_a_participant"))
    return new Error("Bạn không có quyền trong cuộc trò chuyện này.");
  if (normalized.includes("messages_content_not_blank"))
    return new Error("Tin nhắn không được để trống.");
  if (normalized.includes("exceeded the maximum allowed size") || normalized.includes("payload too large"))
    return new Error("Tệp vượt quá 25MB.");
  if (code === "42501" || normalized.includes("permission denied") || normalized.includes("row-level"))
    return new Error("Bạn không có quyền gửi tệp ở đây.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không gửi được tệp. Vui lòng thử lại.");
}

// ---------------------------------------------------------------- pure helpers

/** Which of the three kinds a file is, decided by what it actually is rather than its name. */
export function attachmentKindFor(mimeType: string, isRecording: boolean = false): AttachmentKind {
  if (isRecording) return "voice";
  if (mimeType.startsWith("image/")) return "image";
  return "file";
}

/** Sizes as people say them: "820 KB", not "839680 bytes". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Clock for a voice note: "0:07", "1:42". */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Why a file cannot be sent, or null when it can.
 *
 * Images are exempt from the size check here because they are re-encoded first — telling
 * someone their photo is too big when the app is about to shrink it would be a lie.
 */
export function attachmentRejectionReason(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "Tệp rỗng nên không gửi được.";
  const isImage = file.type.startsWith("image/");
  if (!isImage && file.size > MAX_ATTACHMENT_BYTES) {
    return `Tệp ${formatFileSize(file.size)} vượt quá giới hạn 25MB.`;
  }
  return null;
}

/**
 * A storage-safe name that still reads like the original.
 *
 * Path separators are the security-relevant part: a name containing "../" would otherwise
 * decide which folder the file lands in, and the folder is what grants access.
 */
export function safeStorageName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "tep";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(-120);
  return cleaned === "" ? "tep" : cleaned;
}

/**
 * Where a file lives: `{conversationId}/{uploadId}/{name}`.
 *
 * The first segment is the whole access rule — storage only lets you write into a folder
 * named after a conversation you are in. The middle segment is a fresh id rather than the
 * message id because the upload necessarily happens before the message exists.
 */
export function attachmentStoragePath(conversationId: string, fileName: string): string {
  return `${conversationId}/${crypto.randomUUID()}/${safeStorageName(fileName)}`;
}

/** True when the file may be carried further inside AVORA. */
export function canForwardAttachment(permission: AttachmentPermission): boolean {
  return permission === "forward" || permission === "export";
}

/** True when the file may leave AVORA — downloaded, saved, sent on. */
export function canExportAttachment(permission: AttachmentPermission): boolean {
  return permission === "export";
}

/** What the permission means, in words rather than a level name. */
export function permissionLabel(permission: AttachmentPermission): string {
  if (permission === "view") return "Chỉ xem";
  if (permission === "forward") return "Cho chuyển tiếp";
  return "Cho tải về";
}

/** Groups a flat list into "the files on this message", for rendering one bubble. */
export function attachmentsByMessage(
  attachments: readonly MessageAttachment[],
): Map<string, MessageAttachment[]> {
  const grouped = new Map<string, MessageAttachment[]>();
  for (const item of attachments) {
    const existing = grouped.get(item.messageId);
    if (existing === undefined) grouped.set(item.messageId, [item]);
    else existing.push(item);
  }
  return grouped;
}

/**
 * What an attachment-only message reads as in the inbox and in a reply quote, where a bubble
 * cannot be drawn. Without this a photo with no caption shows as a blank line.
 */
export function attachmentSummaryText(attachments: readonly MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const [first] = attachments;
  if (attachments.length > 1) return `${attachments.length} tệp đính kèm`;
  if (first.kind === "image") return "Hình ảnh";
  if (first.kind === "voice") return `Tin nhắn thoại ${formatDuration(first.durationSeconds)}`;
  return first.fileName;
}

// ---------------------------------------------------------------- browser work

/** Measures a bitmap so the bubble can hold the right shape before the image loads. */
async function imageSize(blob: Blob): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch (error) {
    console.error("[attachments] could not measure image", error);
    return { width: null, height: null };
  }
}

/**
 * Shrinks a large photo before it is uploaded.
 *
 * Phone cameras produce 6MB files of things that are read at 400px wide in a chat. Re-encoding
 * is done on the sender's device so the cost lands once, on the person who chose to send it,
 * rather than on every reader's data plan. A photo that does not shrink is kept as-is —
 * re-encoding something already small only loses quality.
 */
export async function compressImage(file: File): Promise<Blob> {
  if (file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES) return file;
  if (file.type === "image/gif") return file; // re-encoding would drop the animation

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, COMPRESSED_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.82);
    });

    // Only keep the new one if it actually helped.
    if (encoded === null || encoded.size >= file.size) return file;
    return encoded;
  } catch (error) {
    console.error("[attachments] could not compress image", error);
    return file;
  }
}

/**
 * Turns a chosen file into something the composer can show and later upload.
 * Throws with a sentence worth reading when the file cannot be sent at all.
 */
export async function stageAttachment(
  file: File,
  options: { isRecording?: boolean; durationSeconds?: number | null } = {},
): Promise<StagedAttachment> {
  const rejection = attachmentRejectionReason(file);
  if (rejection !== null) throw new Error(rejection);

  const kind = attachmentKindFor(file.type, options.isRecording === true);
  const blob = kind === "image" ? await compressImage(file) : file;

  // The ceiling still applies to what a re-encoded photo actually became.
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Tệp ${formatFileSize(blob.size)} vượt quá giới hạn 25MB.`);
  }
  if (kind === "voice" && (options.durationSeconds ?? 0) > MAX_VOICE_SECONDS) {
    throw new Error("Tin nhắn thoại tối đa 5 phút.");
  }

  const size = kind === "image" ? await imageSize(blob) : { width: null, height: null };

  return {
    localId: crypto.randomUUID(),
    blob,
    kind,
    fileName: file.name,
    mimeType: blob.type === "" ? file.type : blob.type,
    byteSize: blob.size,
    width: size.width,
    height: size.height,
    durationSeconds: options.durationSeconds ?? null,
    permission: "export",
    previewUrl: kind === "file" ? null : URL.createObjectURL(blob),
  };
}

/** Uploads one staged file and returns what the send RPC needs to record it. */
export async function uploadStagedAttachment(
  conversationId: string,
  staged: StagedAttachment,
): Promise<AttachmentInput> {
  const path = attachmentStoragePath(conversationId, staged.fileName);
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, staged.blob, {
    cacheControl: "3600",
    upsert: false,
    contentType: staged.mimeType === "" ? "application/octet-stream" : staged.mimeType,
  });
  if (error) throw fail(undefined, error.message);

  return {
    kind: staged.kind,
    storage_path: path,
    file_name: safeStorageName(staged.fileName),
    mime_type: staged.mimeType === "" ? "application/octet-stream" : staged.mimeType,
    byte_size: staged.byteSize,
    width: staged.width,
    height: staged.height,
    duration_seconds: staged.durationSeconds,
    permission: staged.permission,
  };
}

type AttachmentRow = {
  id: string;
  message_id: string;
  conversation_id: string;
  attached_by: string;
  kind: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  permission: string;
  origin_message_id: string | null;
  created_at: string;
};

export function toMessageAttachment(row: AttachmentRow): MessageAttachment {
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    attachedBy: row.attached_by,
    kind: row.kind as AttachmentKind,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    permission: row.permission as AttachmentPermission,
    originMessageId: row.origin_message_id,
    createdAt: row.created_at,
  };
}

const ATTACHMENT_COLUMNS =
  "id, message_id, conversation_id, attached_by, kind, storage_path, file_name, mime_type, byte_size, width, height, duration_seconds, permission, origin_message_id, created_at";

/** Every file in one thread. RLS returns nothing for a conversation you are not in. */
export async function fetchThreadAttachments(conversationId: string): Promise<MessageAttachment[]> {
  const { data, error } = await supabase
    .from("message_attachments")
    .select(ATTACHMENT_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toMessageAttachment(row as AttachmentRow));
}

/**
 * Short-lived read links for the files on screen.
 *
 * The bucket is private, so nothing is readable by URL alone. Ten minutes is long enough to
 * look at a thread and short enough that a link pasted elsewhere stops working.
 */
export async function signedUrlsFor(paths: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls([...paths], 600);

  if (error) {
    console.error(`[attachments] signed urls: ${error.message}`);
    return urls;
  }
  for (const entry of data ?? []) {
    if (entry.signedUrl !== null && entry.path !== null) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/** One link, for downloading a single file on demand. */
export async function signedUrlFor(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 600);
  if (error) {
    console.error(`[attachments] signed url: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

/**
 * Sends a message and its files as one thing.
 *
 * A single call on purpose: a photo with no caption is a real message, but an empty message
 * is not, and the rule that tells them apart can only hold if both land together.
 */
export async function sendMessageWithAttachments(params: {
  conversationId: string;
  content: string;
  replyToMessageId?: string | null;
  mentionedUserIds?: readonly string[];
  originGroupId?: string | null;
  attachments: readonly AttachmentInput[];
}): Promise<{ id: string; createdAt: string }> {
  const { data, error } = await supabase.rpc("send_message_with_attachments", {
    p_conversation_id: params.conversationId,
    p_content: params.content.trim(),
    p_reply_to_message_id: params.replyToMessageId ?? undefined,
    p_mentioned_user_ids: [...(params.mentionedUserIds ?? [])],
    p_origin_group_id: params.originGroupId ?? undefined,
    p_attachments: params.attachments as unknown as never,
  });

  if (error) throw fail(error.code, error.message);
  const row = data as unknown as { id: string; created_at: string };
  return { id: row.id, createdAt: row.created_at };
}
