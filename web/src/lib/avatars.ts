import { QueryClient, QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useContext } from "react";

import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";

/**
 * AVORA-115 — ảnh đại diện của tài khoản Avora.
 *
 * Who sees: the owner and friends only (server rule `private.can_see_avatar`). Everyone else gets
 * nothing from `avatar_paths` and falls back to initials. Only the owner sets, changes or removes it.
 *
 * Loading: every `UserAvatar` on screen asks for its user id; the asks of one frame are batched
 * into ONE `avatar_paths` call and ONE `createSignedUrls` call. A signed link lives 5 minutes and
 * is reused while it has more than a minute left, keyed by path — the path holds the version, so a
 * new picture is a new path and an old link never shows a new face.
 *
 * Freshness: the server tells each friend's own topic (`avatar` broadcast) when a picture changes
 * or a friendship / block changes; the realtime layer invalidates that one user's entry.
 */

export const AVATAR_BUCKET = "avatars";
export const AVATAR_SIDE = 512;
export const AVATAR_MAX_BYTES = 200 * 1024;
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_TTL_SECONDS = 300;
const REUSE_MARGIN_MS = 60_000;

export type AvatarEntry = { path: string; version: string | null; url: string } | null;

export const avatarKeys = {
  all: ["avatar"] as const,
  user: (userId: string) => ["avatar", userId] as const,
};

// ------------------------------------------------------------------ batching

type Waiter = { resolve: (entry: AvatarEntry) => void; reject: (error: Error) => void };
const waiting = new Map<string, Waiter[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const signedByPath = new Map<string, { url: string; expiresAt: number }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signPaths(paths: readonly string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const path of paths) {
    const hit = signedByPath.get(path);
    if (hit !== undefined && hit.expiresAt - now > REUSE_MARGIN_MS) out.set(path, hit.url);
    else missing.push(path);
  }
  if (missing.length === 0) return out;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrls(missing, SIGNED_TTL_SECONDS);
  if (error) {
    logError("avatars", { code: "sign", message: error.message });
    throw new Error("avatar_sign_failed");
  }
  for (const row of data ?? []) {
    if (row.path === null || row.signedUrl === null || row.error !== null) continue;
    signedByPath.set(row.path, { url: row.signedUrl, expiresAt: now + SIGNED_TTL_SECONDS * 1000 });
    out.set(row.path, row.signedUrl);
  }
  return out;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const ids = [...batch.keys()];
  const settle = (id: string, entry: AvatarEntry): void => batch.get(id)?.forEach((waiter) => waiter.resolve(entry));
  try {
    const found = new Map<string, { path: string; version: string | null }>();
    for (let start = 0; start < ids.length; start += 1000) {
      const chunk = ids.slice(start, start + 1000);
      const { data, error } = await supabase.rpc("avatar_paths", { p_user_ids: chunk });
      if (error) {
        logError("avatars", { code: error.code, message: error.message });
        throw new Error("avatar_paths_failed");
      }
      for (const row of (data ?? []) as { user_id: string; path: string | null; version: string | null }[]) {
        if (row.path !== null) found.set(row.user_id, { path: row.path, version: row.version });
      }
    }
    const urls = await signPaths([...found.values()].map((item) => item.path));
    for (const id of ids) {
      const item = found.get(id);
      const url = item === undefined ? undefined : urls.get(item.path);
      settle(id, item === undefined || url === undefined ? null : { path: item.path, version: item.version, url });
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("avatar_failed");
    for (const id of ids) batch.get(id)?.forEach((waiter) => waiter.reject(failure));
  }
}

/** One user's picture, batched with every other ask of this frame. Null = initials. */
export function loadAvatar(userId: string): Promise<AvatarEntry> {
  if (!UUID_RE.test(userId)) return Promise.resolve(null);
  return new Promise<AvatarEntry>((resolve, reject) => {
    const list = waiting.get(userId) ?? [];
    list.push({ resolve, reject });
    waiting.set(userId, list);
    if (flushTimer === null) flushTimer = setTimeout(() => void flush(), 16);
  });
}

/** Used only when an avatar is drawn outside the app's provider (an isolated component): never in the app. */
let fallbackClient: QueryClient | null = null;

/** The picture to show for one Avora account (null while loading, for strangers, or when unset). */
export function useAvatar(userId: string | null | undefined): AvatarEntry {
  const provided = useContext(QueryClientContext);
  if (provided === undefined && fallbackClient === null) fallbackClient = new QueryClient();
  const { data } = useQuery<AvatarEntry, Error>(
    {
    queryKey: avatarKeys.user(userId ?? "none"),
    queryFn: () => loadAvatar(userId ?? ""),
    enabled: typeof userId === "string" && userId !== "",
    staleTime: 4 * 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    },
    provided ?? fallbackClient ?? undefined,
  );
  return data ?? null;
}

/** Forget one user's picture (or everyone's), so the next render asks the server again. */
export function invalidateAvatar(queryClient: QueryClient, userId?: string): void {
  void queryClient.invalidateQueries({ queryKey: userId === undefined ? avatarKeys.all : avatarKeys.user(userId) });
}

// ------------------------------------------------------------------ what to draw

export type AvatarLook = "image" | "initials";

/**
 * Image only once that exact link has loaded and not failed; before that, and after any failure,
 * the initials — so a slow or broken picture never flashes an empty circle.
 */
export function avatarLook(input: { url: string | null; loadedUrl: string | null; failedUrl: string | null }): AvatarLook {
  if (input.url === null) return "initials";
  if (input.failedUrl === input.url) return "initials";
  return input.loadedUrl === input.url ? "image" : "initials";
}

// ------------------------------------------------------------------ preparing a picture

export type CropState = { zoom: number; dx: number; dy: number };

/** Largest sideways / vertical move that still keeps the circle covered. */
export function cropLimits(natural: { width: number; height: number }, viewport: number, zoom: number): { maxDx: number; maxDy: number } {
  const scale = (viewport / Math.min(natural.width, natural.height)) * zoom;
  return { maxDx: Math.max(0, (natural.width * scale - viewport) / 2), maxDy: Math.max(0, (natural.height * scale - viewport) / 2) };
}

export function clampCrop(natural: { width: number; height: number }, viewport: number, crop: CropState): CropState {
  const zoom = Math.min(4, Math.max(1, crop.zoom));
  const { maxDx, maxDy } = cropLimits(natural, viewport, zoom);
  return { zoom, dx: Math.min(maxDx, Math.max(-maxDx, crop.dx)), dy: Math.min(maxDy, Math.max(-maxDy, crop.dy)) };
}

/** The square of the source picture that the circle shows, in source pixels. */
export function cropRect(natural: { width: number; height: number }, viewport: number, crop: CropState): { x: number; y: number; size: number } {
  const safe = clampCrop(natural, viewport, crop);
  const scale = (viewport / Math.min(natural.width, natural.height)) * safe.zoom;
  const size = viewport / scale;
  const cx = natural.width / 2 - safe.dx / scale;
  const cy = natural.height / 2 - safe.dy / scale;
  const x = Math.min(natural.width - size, Math.max(0, cx - size / 2));
  const y = Math.min(natural.height - size, Math.max(0, cy - size / 2));
  return { x, y, size };
}

/** Refuses what is not a picture, or is too large to even try, before any work. */
export function checkAvatarFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "Hãy chọn một tệp ảnh.";
  if (file.size > AVATAR_SOURCE_MAX_BYTES) return "Ảnh lớn hơn 10 MB. Hãy chọn ảnh nhỏ hơn.";
  return null;
}

/**
 * Cuts the chosen square, draws it at 512×512 and writes a JPEG of at most ~200 KB. Drawing on a
 * canvas leaves EXIF (time, place, camera) behind; the orientation is applied first.
 */
export async function prepareAvatarImage(source: Blob, crop: CropState, viewport: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const rect = cropRect({ width: bitmap.width, height: bitmap.height }, viewport, crop);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Máy này không vẽ được ảnh.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, rect.x, rect.y, rect.size, rect.size, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    let quality = 0.86;
    for (;;) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob === null) throw new Error("Không đọc được ảnh này.");
      if (blob.size <= AVATAR_MAX_BYTES || quality <= 0.42) return blob;
      quality -= 0.08;
    }
  } finally {
    bitmap.close();
  }
}

// ------------------------------------------------------------------ owner actions

function avatarError(code: string | undefined, message: string): Error {
  logError("avatars", { code, message });
  const normalized = message.toLowerCase();
  if (normalized.includes("failed to fetch") || normalized.includes("network")) return new Error("Mất kết nối. Ảnh chưa đổi — thử lại khi có mạng.");
  if (normalized.includes("avora_avatar_invalid") || normalized.includes("mime") || normalized.includes("payload too large")) return new Error("Ảnh này không dùng được. Hãy chọn ảnh khác.");
  if (normalized.includes("avora_attachment_missing")) return new Error("Ảnh chưa tải lên xong. Thử lại.");
  return new Error("Không cập nhật được ảnh. Thử lại.");
}

/** A new name each time: the version lives in the path. */
export function avatarPath(userId: string, now: number = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${userId}/${now.toString(36)}${random}.jpg`;
}

async function removeQuietly(path: string | null): Promise<void> {
  if (path === null || path === "") return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  // The profile already points at the new picture; an old file left behind is only space.
  if (error) logError("avatars", { code: "remove_old", message: error.message });
}

/**
 * Upload → point the profile at it → delete the old file. If pointing fails, the new file is
 * removed again, so a dropped connection never leaves the profile half-changed.
 */
export async function uploadAvatar(userId: string, image: Blob): Promise<void> {
  const path = avatarPath(userId);
  const upload = await supabase.storage.from(AVATAR_BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (upload.error) throw avatarError(undefined, upload.error.message);
  const { data, error } = await supabase.rpc("set_avatar", { p_path: path });
  if (error) {
    await removeQuietly(path);
    throw avatarError(error.code, error.message);
  }
  await removeQuietly(typeof data === "string" ? data : null);
}

export async function removeAvatar(): Promise<void> {
  const { data, error } = await supabase.rpc("clear_avatar");
  if (error) throw avatarError(error.code, error.message);
  await removeQuietly(typeof data === "string" ? data : null);
}

/** Owner actions with the cache kept in step. */
export function useAvatarActions(userId: string | undefined): {
  upload: (image: Blob) => Promise<void>;
  remove: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const upload = useCallback(
    async (image: Blob): Promise<void> => {
      if (userId === undefined) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      await uploadAvatar(userId, image);
      invalidateAvatar(queryClient, userId);
    },
    [queryClient, userId],
  );
  const remove = useCallback(async (): Promise<void> => {
    await removeAvatar();
    if (userId !== undefined) queryClient.setQueryData<AvatarEntry>(avatarKeys.user(userId), null);
  }, [queryClient, userId]);
  return { upload, remove };
}

/** Tests only. */
export function resetAvatarCacheForTests(): void {
  waiting.clear();
  signedByPath.clear();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}
