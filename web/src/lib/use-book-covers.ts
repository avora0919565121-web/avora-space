import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { fetchShelfCatalog, requestCover, sourceOf, type ShelfCatalogInfo } from "@/lib/book-catalog";
import { useAuth } from "@/lib/auth";

/**
 * AVORA-103 · C — covers for a set of catalogue books (`source:id` keys). Covers Avora has not
 * fetched yet are asked for in the background, a few at a time; the shelf shows its own drawn
 * cover meanwhile. Nothing here ever loads an image from Gutenberg / Open Library.
 */
const asked = new Set<string>();
const ASK_AT_ONCE = 4;

export function useShelfCatalog(keys: readonly string[]): Map<string, ShelfCatalogInfo> {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const sorted = useMemo(() => [...new Set(keys.filter((key) => key !== ""))].sort(), [keys]);
  const query = useQuery({
    queryKey: ["book-catalog-covers", sorted],
    queryFn: () => fetchShelfCatalog(sorted),
    enabled: Boolean(user?.id) && sorted.length > 0,
    staleTime: 10 * 60_000,
  });
  const data = query.data;

  useEffect(() => {
    if (data === undefined) return;
    const todo = [...data.values()].filter((info) => !info.coverChecked && info.pdStatus === "ok" && !info.key.startsWith("wikisource:") && !asked.has(info.key)).slice(0, ASK_AT_ONCE);
    if (todo.length === 0) return;
    let cancelled = false;
    void (async () => {
      let changed = false;
      for (const info of todo) {
        asked.add(info.key);
        const [source, ...rest] = info.key.split(":");
        if ((await requestCover(sourceOf(source), rest.join(":"))) !== null) changed = true;
        if (cancelled) return;
      }
      if (changed) void queryClient.invalidateQueries({ queryKey: ["book-catalog-covers"] });
    })();
    return () => {
      cancelled = true;
    };
  }, [data, queryClient]);

  return data ?? EMPTY;
}

const EMPTY = new Map<string, ShelfCatalogInfo>();

export type MyCover = { recordId: string; path: string; url: string };

/** My own cover photos (`⋯ › Đổi bìa`): only I can read them; short-lived signed links. */
export function useMyCovers(): Map<string, MyCover> {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["book-my-covers", user?.id ?? ""],
    enabled: Boolean(user?.id),
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Map<string, MyCover>> => {
      const { data, error } = await supabase.from("book_my_covers" as never).select("record_id, path");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { record_id: string; path: string }[];
      const out = new Map<string, MyCover>();
      if (rows.length === 0) return out;
      const { data: signed } = await supabase.storage.from("my-book-covers").createSignedUrls(rows.map((row) => row.path), 3600);
      for (const row of rows) {
        const url = signed?.find((item) => item.path === row.path)?.signedUrl;
        if (url != null) out.set(row.record_id, { recordId: row.record_id, path: row.path, url });
      }
      return out;
    },
  });
  return query.data ?? EMPTY_MINE;
}

const EMPTY_MINE = new Map<string, MyCover>();

/** Long side of a cover photo after it is redrawn (which also drops EXIF / location). */
const MY_COVER_SIDE = 600;

/**
 * Redraws a photo on a canvas — orientation applied, EXIF (time, place, camera) left behind —
 * then keeps it in my own folder and sets it as this book's cover.
 */
export async function saveMyCover(userId: string, recordId: string, file: File): Promise<void> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MY_COVER_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  const blob = webp !== null && webp.type === "image/webp" ? webp : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (blob === null) throw new Error("Không đọc được ảnh này.");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${recordId}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("my-book-covers").upload(path, blob, { contentType: blob.type, upsert: false });
  if (uploadError) throw new Error("Chưa lưu được ảnh bìa.");
  const { data: old } = await supabase.from("book_my_covers" as never).select("path").eq("record_id" as never, recordId as never).maybeSingle();
  const { error } = await supabase.rpc("set_my_book_cover" as never, { p_record: recordId, p_path: path } as never);
  if (error) {
    await supabase.storage.from("my-book-covers").remove([path]);
    throw new Error("Chưa đổi được bìa.");
  }
  const previous = (old as { path?: string } | null)?.path;
  if (previous != null && previous !== path) await supabase.storage.from("my-book-covers").remove([previous]);
}

/** Back to the ordinary cover; the photo is deleted. */
export async function clearMyCover(recordId: string): Promise<void> {
  const { data, error } = await supabase.rpc("clear_my_book_cover" as never, { p_record: recordId } as never);
  if (error) throw new Error("Chưa bỏ được bìa của bạn.");
  if (typeof data === "string" && data !== "") await supabase.storage.from("my-book-covers").remove([data]);
}
