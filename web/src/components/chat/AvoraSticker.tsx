import { memo, useId, useMemo } from "react";

import { stickerById } from "@/lib/stickers";
import { cn } from "@/lib/utils";

/** The white die-cut edge and soft shadow, one per drawn sticker so ids never collide. */
function dieFilter(id: string): string {
  return `<defs><filter id="${id}" x="-15%" y="-15%" width="130%" height="135%"><feMorphology in="SourceAlpha" operator="dilate" radius="6" result="d"></feMorphology><feFlood flood-color="#FFFFFF" result="w"></feFlood><feComposite in="w" in2="d" operator="in" result="white"></feComposite><feOffset in="d" dy="4" result="o"></feOffset><feGaussianBlur in="o" stdDeviation="3" result="b"></feGaussianBlur><feFlood flood-color="#3B2F2A" flood-opacity="0.2" result="s"></feFlood><feComposite in="s" in2="b" operator="in" result="shadow"></feComposite><feMerge><feMergeNode in="shadow"></feMergeNode><feMergeNode in="white"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs>`;
}

/**
 * AVORA-84 · K5 — one Avora sticker, drawn from `lib/stickers.ts`. The only place a sticker is
 * painted: thread, tray, Avora Space keepsake. `live` plays its motion once (first appearance);
 * otherwise it stands still. Unknown ids render a quiet placeholder, never a broken image.
 */
export const AvoraSticker = memo(function AvoraSticker({
  id,
  size = 120,
  live = false,
  className,
}: {
  id: string;
  size?: number;
  live?: boolean;
  className?: string;
}) {
  const sticker = stickerById(id);
  const rawId = useId();
  const filterId = `die-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const markup = useMemo(
    () => (sticker === null ? "" : dieFilter(filterId) + sticker.body.split("url(#die)").join(`url(#${filterId})`)),
    [sticker, filterId],
  );
  if (sticker === null) {
    return (
      <span
        role="img"
        aria-label="Sticker không còn"
        className={cn("flex items-center justify-center rounded-2xl bg-secondary/50 text-[12px] text-muted-foreground", className)}
        style={{ width: size, height: (size * 240) / 220 }}
      >
        Sticker
      </span>
    );
  }
  return (
    <svg
      data-sticker-id={sticker.id}
      viewBox="0 0 220 240"
      width={size}
      height={(size * 240) / 220}
      role="img"
      aria-label={sticker.label}
      className={cn("avora-sticker block overflow-visible", live && "sticker-live", className)}
      // Static drawings shipped in our own bundle (lib/stickers.ts) — never user content.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});
