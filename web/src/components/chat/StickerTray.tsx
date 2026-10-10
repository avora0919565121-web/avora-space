import { useState } from "react";

import { AvoraSticker } from "@/components/chat/AvoraSticker";
import { readRecentStickers, rememberSticker } from "@/lib/sticker-recent";
import { STICKER_PACKS, STICKERS, type StickerPack } from "@/lib/stickers";
import { cn } from "@/lib/utils";

type Tab = "recent" | StickerPack;

/**
 * K5 · 84 §4.2D — the sticker tray, in place of the keyboard. Four tabs (Gần đây + three packs),
 * a 4-column grid that fits the margins (no sideways scroll). A tap sends at once. Stickers stand
 * still here; they move only once, when they first arrive in the thread.
 */
export function StickerTray({ onPick }: { onPick: (id: string) => void }) {
  const recent = readRecentStickers();
  const [tab, setTab] = useState<Tab>(recent.length > 0 ? "recent" : "thuong_ngay");
  const tabs: { id: Tab; label: string }[] = [{ id: "recent", label: "Gần đây" }, ...STICKER_PACKS];
  const shown = tab === "recent" ? recent.map((id) => STICKERS.find((s) => s.id === id)).filter((s) => s !== undefined) : STICKERS.filter((s) => s.pack === tab);
  return (
    <div data-sticker-tray="" className="mx-auto max-w-2xl border-t border-border pt-1">
      <div role="tablist" aria-label="Ngăn sticker" className="grid grid-cols-4">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "press relative min-h-10 truncate px-1 text-[12.5px]",
              tab === item.id ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {item.label}
            {tab === item.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-personal" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="grid h-[248px] grid-cols-4 content-start gap-1 overflow-y-auto overflow-x-hidden py-2">
        {shown.length === 0 ? (
          <p className="col-span-4 py-8 text-center text-[13px] text-muted-foreground">Sticker bạn gửi sẽ hiện ở đây.</p>
        ) : (
          shown.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              onClick={() => {
                rememberSticker(sticker.id);
                onPick(sticker.id);
              }}
              aria-label={`Gửi sticker ${sticker.label}`}
              className="press flex aspect-square min-h-11 items-center justify-center rounded-card hover:bg-accent/40"
            >
              <AvoraSticker id={sticker.id} size={68} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
