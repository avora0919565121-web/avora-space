import { Check, ImagePlus, Loader2, MoveVertical, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";

import { AvoraSticker } from "@/components/chat/AvoraSticker";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STICKER_PACKS, STICKERS, type StickerPack } from "@/lib/stickers";
import type { useKeepsake } from "@/lib/use-keepsake";
import { cn } from "@/lib/utils";

type Api = ReturnType<typeof useKeepsake>;
type Tab = StickerPack | "photo";

/**
 * AVORA-100 · S.2 §4.3 — `Đặt dấu ấn của tôi`. One choice: a sticker from the Avora set, or one
 * photo (gia đình, bản thân, thần tượng…) with `Đổi vị trí ảnh` — drag the picture up or down.
 * Changing or removing happens here too. Nothing here is shared or searchable.
 */
export function KeepsakeSheet({ open, onOpenChange, api }: { open: boolean; onOpenChange: (open: boolean) => void; api: Api }) {
  const current = api.keepsake;
  const [tab, setTab] = useState<Tab>(current?.kind === "photo" ? "photo" : "thuong_ngay");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tabs: { id: Tab; label: string }[] = [...STICKER_PACKS, { id: "photo", label: "Ảnh của tôi" }];

  const run = async (work: () => Promise<void>, done?: string): Promise<void> => {
    setIsWorking(true);
    try {
      await work();
      if (done !== undefined) toast.success(done);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] scroll-y p-0 md:mx-auto md:max-w-xl md:rounded-t-card" data-keepsake-sheet="">
        <SheetHeader className="px-4 pt-4 text-left">
          <SheetTitle className="text-[17px]">Dấu ấn của tôi</SheetTitle>
          <SheetDescription className="text-[13.5px]">Chỉ hiện ở Avora Space, chỉ bạn thấy.</SheetDescription>
        </SheetHeader>

        <div role="tablist" aria-label="Chọn loại dấu ấn" className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" data-h-scroll="">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("press h-10 shrink-0 rounded-full border px-4 text-[14px] font-medium", tab === t.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "photo" ? (
          <div className="px-4 pb-6 pt-3">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" data-keepsake-file="" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file !== undefined) void run(() => api.setPhoto(file), "Đã đặt ảnh làm dấu ấn.");
            }} />
            {current?.kind === "photo" && api.photoUrl !== null ? (
              <FocusPicker url={api.photoUrl} focusY={current.focusY} onCommit={(y) => void run(() => api.setFocus(y))} />
            ) : null}
            <button type="button" disabled={isWorking} onClick={() => fileRef.current?.click()} className="press mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-dashed border-border text-[15px] text-foreground disabled:opacity-50">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
              {current?.kind === "photo" ? "Chọn ảnh khác" : "Chọn một ảnh"}
            </button>
            <p className="mt-2 text-[12.5px] text-muted-foreground">Ảnh được thu nhỏ và bỏ thông tin vị trí, giờ chụp trước khi lưu. Không ai khác xem được.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-4 gap-1 px-3 pb-4 pt-2">
            {STICKERS.filter((s) => s.pack === tab).map((s) => {
              const isOn = current?.kind === "sticker" && current.stickerId === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={isWorking}
                    aria-label={s.label}
                    aria-pressed={isOn}
                    data-keepsake-sticker={s.id}
                    onClick={() => void run(() => api.setSticker(s.id), "Đã đặt dấu ấn.")}
                    className={cn("press relative flex w-full items-center justify-center rounded-card p-1", isOn ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-secondary")}
                  >
                    <AvoraSticker id={s.id} size={72} />
                    {isOn ? <Check className="absolute right-1 top-1 h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {current !== null ? (
          <div className="border-t border-border px-4 py-3">
            <button type="button" disabled={isWorking} onClick={() => void run(async () => { await api.clear(); onOpenChange(false); }, "Đã gỡ dấu ấn.")} className="press inline-flex min-h-11 items-center gap-2 text-[14.5px] text-muted-foreground hover:text-foreground" data-keepsake-clear="">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Gỡ dấu ấn
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** `Đổi vị trí ảnh`: the strip as it will look; drag the picture up / down, let go to keep. */
function FocusPicker({ url, focusY, onCommit }: { url: string; focusY: number; onCommit: (y: number) => void }) {
  const [y, setY] = useState<number>(focusY);
  const drag = useRef<{ startY: number; startFocus: number; height: number } | null>(null);

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startFocus: y, height: event.currentTarget.getBoundingClientRect().height };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    // Dragging the picture down shows more of its top: focus moves the other way.
    const next = Math.min(1, Math.max(0, d.startFocus - (event.clientY - d.startY) / (d.height * 2.5)));
    setY(next);
  };
  const up = (): void => {
    if (drag.current === null) return;
    drag.current = null;
    onCommit(y);
  };

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
        <MoveVertical className="h-4 w-4" aria-hidden="true" /> Đổi vị trí ảnh
      </p>
      <div
        role="slider"
        aria-label="Đổi vị trí ảnh"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(y * 100)}
        tabIndex={0}
        data-keepsake-focus=""
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const next = Math.min(1, Math.max(0, y + (e.key === "ArrowDown" ? 0.05 : -0.05)));
          setY(next);
          onCommit(next);
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="relative h-[120px] cursor-grab touch-none overflow-hidden rounded-card bg-secondary active:cursor-grabbing"
        style={{ backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: `50% ${Math.round(y * 100)}%` }}
      />
    </div>
  );
}
