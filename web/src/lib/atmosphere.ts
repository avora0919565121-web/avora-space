import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import { TONES, type FixedTone, type ToneValues } from "@/lib/theme";

/**
 * AVORA-106 · K5 — Không khí của một cuộc trò chuyện (84 §4.1). Colour, backdrop and group icon are
 * chosen from Avora's library only and shared by the whole conversation; the effects level is each
 * person's own. Written only through RPCs (1-1: either person; Nhóm / Dự án: owner or admin).
 */
export type AtmosphereColor = Exclude<FixedTone, never>;
export type AtmosphereBackdrop = "giay" | "la" | "may" | "song";
export type EffectsLevel = "full" | "light" | "off";

export const ATMOSPHERE_COLORS: readonly { id: AtmosphereColor; label: string }[] = [
  { id: "avora", label: "Avora" },
  { id: "bien", label: "Biển" },
  { id: "ngoc", label: "Ngọc" },
  { id: "tim", label: "Tím" },
  { id: "than", label: "Than" },
];
export const ATMOSPHERE_BACKDROPS: readonly { id: AtmosphereBackdrop; label: string }[] = [
  { id: "giay", label: "Giấy" },
  { id: "la", label: "Lá" },
  { id: "may", label: "Mây" },
  { id: "song", label: "Sóng" },
];
export const EFFECTS_LEVELS: readonly { id: EffectsLevel; label: string }[] = [
  { id: "full", label: "Đầy đủ" },
  { id: "light", label: "Nhẹ" },
  { id: "off", label: "Tắt" },
];
/** The Avora group-icon set (lucide names), chosen instead of a photo. */
export const GROUP_ICON_KEYS = [
  "home", "leaf", "book", "trophy", "music", "cake", "plane", "heart", "star", "sun", "coffee", "camera",
  "flower", "mountain", "fish", "bike", "palette", "gift", "tent", "smile", "school", "tree", "moon", "paw",
] as const;

export type Appearance = {
  color: AtmosphereColor | null;
  backdrop: AtmosphereBackdrop | null;
  iconKey: string | null;
  iconPath: string | null;
};

export const atmosphereKeys = {
  appearance: (conversationId: string) => ["conversation-appearance", conversationId] as const,
  prefs: (conversationId: string) => ["conversation-member-prefs", conversationId] as const,
};

const isColor = (value: unknown): value is AtmosphereColor =>
  value === "avora" || value === "bien" || value === "ngoc" || value === "tim" || value === "than";
const isBackdrop = (value: unknown): value is AtmosphereBackdrop =>
  value === "giay" || value === "la" || value === "may" || value === "song";

export async function fetchAppearance(conversationId: string): Promise<Appearance> {
  const { data, error } = await supabase
    .from("conversation_appearance" as never)
    .select("color_key, backdrop_key, icon_key, icon_path")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) {
    logError("atmosphere", error);
    return { color: null, backdrop: null, iconKey: null, iconPath: null };
  }
  const row = (data ?? null) as { color_key: string | null; backdrop_key: string | null; icon_key: string | null; icon_path: string | null } | null;
  return {
    color: isColor(row?.color_key) ? row.color_key : null,
    backdrop: isBackdrop(row?.backdrop_key) ? row.backdrop_key : null,
    iconKey: row?.icon_key ?? null,
    iconPath: row?.icon_path ?? null,
  };
}

export async function fetchMyEffectsLevel(conversationId: string): Promise<EffectsLevel | null> {
  const { data, error } = await supabase
    .from("conversation_member_prefs" as never)
    .select("effects_level")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) return null;
  const level = (data as { effects_level: string | null } | null)?.effects_level ?? null;
  return level === "full" || level === "light" || level === "off" ? level : null;
}

function atmosphereError(message: string): Error {
  if (message.includes("avora_not_admin")) return new Error("Chỉ quản trị nhóm đổi được Không khí của nhóm.");
  if (message.includes("avora_not_allowed")) return new Error("Cuộc trò chuyện này không có Không khí.");
  return new Error("Chưa đổi được. Thử lại nhé.");
}

export function useAtmosphere(conversationId: string | undefined, kind: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(conversationId) && (kind === "direct" || kind === "group");
  const appearance = useQuery<Appearance, Error>({
    queryKey: atmosphereKeys.appearance(conversationId ?? ""),
    queryFn: () => fetchAppearance(conversationId as string),
    enabled,
    staleTime: 60_000,
  });
  const prefs = useQuery<EffectsLevel | null, Error>({
    queryKey: atmosphereKeys.prefs(conversationId ?? ""),
    queryFn: () => fetchMyEffectsLevel(conversationId as string),
    enabled,
    staleTime: 5 * 60_000,
  });
  const setAppearance = useMutation({
    mutationFn: async (next: { color: AtmosphereColor | null; backdrop: AtmosphereBackdrop | null }) => {
      const { error } = await supabase.rpc("set_conversation_appearance" as never, {
        p_conversation_id: conversationId,
        p_color: next.color,
        p_backdrop: next.backdrop,
      } as never);
      if (error) throw atmosphereError((error as { message: string }).message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: atmosphereKeys.appearance(conversationId ?? "") }),
  });
  const setIcon = useMutation({
    mutationFn: async (next: { iconKey: string | null; iconPath: string | null }) => {
      const { error } = await supabase.rpc("set_group_icon" as never, {
        p_conversation_id: conversationId,
        p_icon_key: next.iconKey,
        p_icon_path: next.iconPath,
      } as never);
      if (error) throw atmosphereError((error as { message: string }).message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: atmosphereKeys.appearance(conversationId ?? "") }),
  });
  const setEffectsLevel = useMutation({
    mutationFn: async (level: EffectsLevel) => {
      const { error } = await supabase.rpc("set_my_conversation_prefs" as never, {
        p_conversation: conversationId,
        p_effects_level: level,
      } as never);
      if (error) throw atmosphereError((error as { message: string }).message);
    },
    onMutate: (level) => queryClient.setQueryData(atmosphereKeys.prefs(conversationId ?? ""), level),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: atmosphereKeys.prefs(conversationId ?? "") }),
  });
  return { appearance: appearance.data ?? null, myEffectsLevel: prefs.data ?? null, setAppearance, setIcon, setEffectsLevel };
}

/** 84 §4.1: default Đầy đủ in a 1-1, Nhẹ in a group; reduced motion on the device → always Tắt. */
export function effectiveEffectsLevel(chosen: EffectsLevel | null, kind: string | undefined, reducedMotion: boolean): EffectsLevel {
  if (reducedMotion) return "off";
  return chosen ?? (kind === "direct" ? "full" : "light");
}

/** The conversation colour as the CSS variables the "your zone" reads — only inside that thread. */
export function atmosphereToneStyle(color: AtmosphereColor | null, isDark: boolean): Record<string, string> | undefined {
  if (color === null) return undefined;
  const values: ToneValues = TONES[color][isDark ? "dark" : "light"];
  const css = (c: { h: number; s: number; l: number }): string => `${c.h} ${c.s}% ${c.l}%`;
  return {
    "--personal": css(values.personal),
    "--personal-foreground": css(values.personalFg),
    "--personal-soft": css(values.soft),
    "--personal-soft-foreground": css(values.softFg),
  };
}

const darkListeners = new Set<() => void>();
let darkObserver: MutationObserver | null = null;
/** Whether the app is drawn dark right now (`.dark` on <html>). */
export function useIsDarkCanvas(): boolean {
  return useSyncExternalStore(
    (listener) => {
      darkListeners.add(listener);
      if (darkObserver === null && typeof MutationObserver !== "undefined") {
        darkObserver = new MutationObserver(() => darkListeners.forEach((fn) => fn()));
        darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      }
      return () => darkListeners.delete(listener);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

/** Messages whose effect already played on this device (84 §4.2A: once, ever). */
const PLAYED_KEY = "avora.effects-played.v1";
export function hasPlayedEffect(messageId: string): boolean {
  try {
    return (window.localStorage.getItem(PLAYED_KEY) ?? "").split(",").includes(messageId);
  } catch {
    return true;
  }
}
export function markEffectPlayed(messageId: string): void {
  try {
    const list = (window.localStorage.getItem(PLAYED_KEY) ?? "").split(",").filter(Boolean);
    if (list.includes(messageId)) return;
    window.localStorage.setItem(PLAYED_KEY, [...list.slice(-199), messageId].join(","));
  } catch {
    // Not remembered: at worst an effect plays once more.
  }
}

/** A short-lived link to a group's photo icon (private bucket, members only). */
export function useGroupIconUrl(iconPath: string | null | undefined): string | null {
  const { data } = useQuery<string | null, Error>({
    queryKey: ["conversation-icon-url", iconPath ?? ""],
    queryFn: async () => {
      const { data: signed, error } = await supabase.storage.from("conversation-icons").createSignedUrl(iconPath as string, 3600);
      if (error) return null;
      return signed.signedUrl;
    },
    enabled: Boolean(iconPath),
    staleTime: 50 * 60_000,
  });
  return data ?? null;
}
