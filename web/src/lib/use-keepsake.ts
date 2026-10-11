import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { redrawImage, redrawnExt } from "@/lib/redraw-image";

/**
 * AVORA-100 · S.2 §4.3 — Dấu ấn riêng ở Avora Space. One sticker or one photo, shown only in
 * Avora Space and only to its owner (private bucket `keepsakes/{uid}/`, own profile row).
 */
export type Keepsake = { kind: "sticker"; stickerId: string } | { kind: "photo"; path: string; focusY: number };

/** Long side of a keepsake photo after it is redrawn (EXIF dropped). */
export const KEEPSAKE_SIDE = 1600;

export function parseKeepsake(raw: unknown): Keepsake | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; sticker_id?: unknown; path?: unknown; focus_y?: unknown };
  if (r.kind === "sticker" && typeof r.sticker_id === "string") return { kind: "sticker", stickerId: r.sticker_id };
  if (r.kind === "photo" && typeof r.path === "string") {
    const y = typeof r.focus_y === "number" ? r.focus_y : 0.5;
    return { kind: "photo", path: r.path, focusY: Math.min(1, Math.max(0, y)) };
  }
  return null;
}

function toRow(k: Keepsake | null): Record<string, unknown> | null {
  if (k === null) return null;
  if (k.kind === "sticker") return { kind: "sticker", sticker_id: k.stickerId };
  return { kind: "photo", path: k.path, focus_y: Math.round(k.focusY * 1000) / 1000 };
}

const keys = {
  mine: (userId: string) => ["keepsake", userId] as const,
  url: (path: string) => ["keepsake-url", path] as const,
};

async function save(k: Keepsake | null): Promise<void> {
  const { data, error } = await supabase.rpc("set_space_keepsake" as never, { p_keepsake: toRow(k) } as never);
  if (error) throw new Error("Chưa lưu được dấu ấn.");
  if (typeof data === "string" && data !== "") await supabase.storage.from("keepsakes").remove([data]);
}

export function useKeepsake() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.mine(userId),
    enabled: userId !== "",
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Keepsake | null> => {
      const { data, error } = await supabase.from("profiles").select("space_keepsake" as never).eq("id", userId).maybeSingle();
      if (error) throw new Error("Chưa tải được dấu ấn.");
      return parseKeepsake((data as { space_keepsake?: unknown } | null)?.space_keepsake ?? null);
    },
  });
  const keepsake = query.data ?? null;
  const photoPath = keepsake?.kind === "photo" ? keepsake.path : null;
  const photoUrl = useQuery({
    queryKey: keys.url(photoPath ?? ""),
    enabled: photoPath !== null,
    staleTime: 45 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.storage.from("keepsakes").createSignedUrl(photoPath ?? "", 3600);
      return data?.signedUrl ?? null;
    },
  });

  const set = useMutation({
    mutationFn: save,
    onMutate: (next: Keepsake | null) => {
      queryClient.setQueryData(keys.mine(userId), next);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.mine(userId) }),
  });

  /** Redraws the photo (EXIF gone, ≤ 1600 px), keeps it in my folder, then sets it. */
  const setPhoto = async (file: File): Promise<void> => {
    if (userId === "") return;
    const blob = await redrawImage(file, KEEPSAKE_SIDE, 0.84);
    const path = `${userId}/${crypto.randomUUID()}.${redrawnExt(blob)}`;
    const { error } = await supabase.storage.from("keepsakes").upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error("Chưa tải được ảnh lên.");
    try {
      await set.mutateAsync({ kind: "photo", path, focusY: 0.5 });
    } catch (err) {
      await supabase.storage.from("keepsakes").remove([path]);
      throw err;
    }
  };

  return {
    keepsake,
    photoUrl: photoUrl.data ?? null,
    isLoaded: query.isFetched,
    setSticker: (stickerId: string) => set.mutateAsync({ kind: "sticker", stickerId }),
    setPhoto,
    setFocus: (focusY: number) => (keepsake?.kind === "photo" ? set.mutateAsync({ ...keepsake, focusY }) : Promise.resolve()),
    clear: () => set.mutateAsync(null),
  };
}
