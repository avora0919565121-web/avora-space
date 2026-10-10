import { Check, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { GROUP_ICONS } from "@/lib/group-icons";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import {
  ATMOSPHERE_BACKDROPS,
  ATMOSPHERE_COLORS,
  EFFECTS_LEVELS,
  atmosphereToneStyle,
  effectiveEffectsLevel,
  useAtmosphere,
  useIsDarkCanvas,
  type AtmosphereBackdrop,
  type AtmosphereColor,
} from "@/lib/atmosphere";
import { chatBackdropClass } from "@/lib/chat-backdrop";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Redraws a picked photo as a square ≤ 512 px WebP/JPEG — the redraw drops every EXIF block. */
async function squareIcon(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no canvas");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (blob === null) throw new Error("encode failed");
  return blob;
}

/**
 * K5 · 84 §4.1 — ⋯ › Không khí. Colour and backdrop for the whole conversation (1-1: either person;
 * Nhóm / Dự án: owner or admin), the group icon (admins), and "Hiệu ứng khi nhận" which is mine only.
 * Library choices only: no free colour picker, no photo backdrop.
 */
export function AtmosphereSheet({
  open,
  onOpenChange,
  conversationId,
  kind,
  canStyle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  kind: "direct" | "group";
  /** 1-1: always; group: owner or admin. The server checks again. */
  canStyle: boolean;
}) {
  const { appearance, myEffectsLevel, setAppearance, setIcon, setEffectsLevel } = useAtmosphere(conversationId, kind);
  const isDark = useIsDarkCanvas();
  const reduced = prefersReducedMotion();
  const level = effectiveEffectsLevel(myEffectsLevel, kind, reduced);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const color: AtmosphereColor | null = appearance?.color ?? null;
  const backdrop: AtmosphereBackdrop = appearance?.backdrop ?? "giay";

  const save = (next: { color: AtmosphereColor | null; backdrop: AtmosphereBackdrop | null }): void => {
    setAppearance.mutate(next, { onError: (error: Error) => toast.error(error.message) });
  };

  const uploadIcon = async (file: File): Promise<void> => {
    setIsUploading(true);
    try {
      const blob = await squareIcon(file);
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("conversation-icons").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("Chưa tải được ảnh lên.");
      await setIcon.mutateAsync({ iconKey: null, iconPath: path });
      toast.success("Đã đổi icon nhóm.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Chưa đổi được icon.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] scroll-y p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="text-[16px]">Không khí</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {kind === "group"
              ? canStyle
                ? "Màu, nền và icon áp cho cả nhóm. Hiệu ứng khi nhận là của riêng bạn."
                : "Chỉ quản trị đổi màu, nền và icon nhóm. Hiệu ứng khi nhận là của riêng bạn."
              : "Màu và nền áp cho cả hai người. Hiệu ứng khi nhận là của riêng bạn."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-3">
          <section aria-labelledby="atm-color">
            <h3 id="atm-color" className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Màu cuộc trò chuyện</h3>
            <div role="radiogroup" aria-label="Màu cuộc trò chuyện" className="flex flex-wrap gap-2">
              {[{ id: null, label: "Theo tôi" } as { id: AtmosphereColor | null; label: string }, ...ATMOSPHERE_COLORS].map((option) => {
                const style = atmosphereToneStyle(option.id, isDark);
                const isActive = option.id === color;
                return (
                  <button
                    key={option.id ?? "mine"}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!canStyle || setAppearance.isPending}
                    onClick={() => save({ color: option.id, backdrop: appearance?.backdrop ?? null })}
                    style={style}
                    className={cn(
                      "press flex min-h-11 items-center gap-2 rounded-full border px-3 text-[13px] disabled:opacity-50",
                      isActive ? "border-personal text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    <span className="h-4 w-4 rounded-full bg-personal" aria-hidden="true" />
                    {option.label}
                    {isActive ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="atm-backdrop">
            <h3 id="atm-backdrop" className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Nền</h3>
            <div role="radiogroup" aria-label="Nền" className="grid grid-cols-4 gap-2">
              {ATMOSPHERE_BACKDROPS.map((option) => {
                const isActive = option.id === backdrop;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!canStyle || setAppearance.isPending}
                    onClick={() => save({ color, backdrop: option.id === "giay" ? null : option.id })}
                    className={cn(
                      "press flex flex-col gap-1 rounded-lg border p-1 text-[12.5px] disabled:opacity-50",
                      isActive ? "border-personal text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    <span className={cn("block h-12 rounded-md bg-background", chatBackdropClass(option.id === "giay" ? "giay" : option.id))} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>

          {kind === "group" ? (
            <section aria-labelledby="atm-icon">
              <h3 id="atm-icon" className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Icon của nhóm</h3>
              <div className="grid grid-cols-6 gap-1.5">
                {Object.entries(GROUP_ICONS).map(([key, Icon]) => {
                  const isActive = appearance?.iconKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`Icon ${key}`}
                      aria-pressed={isActive}
                      disabled={!canStyle || setIcon.isPending}
                      onClick={() => setIcon.mutate({ iconKey: key, iconPath: null }, { onError: (error: Error) => toast.error(error.message) })}
                      className={cn(
                        "press flex aspect-square min-h-11 items-center justify-center rounded-lg border disabled:opacity-50",
                        isActive ? "border-personal text-personal" : "border-border text-muted-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!canStyle || isUploading}
                onClick={() => fileRef.current?.click()}
                className="press mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                Dùng một ảnh vuông
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file !== undefined) void uploadIcon(file);
                }}
              />
            </section>
          ) : null}

          <section aria-labelledby="atm-effects">
            <h3 id="atm-effects" className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Hiệu ứng khi nhận</h3>
            <p className="mb-2 text-[12.5px] text-muted-foreground">
              {reduced ? "Máy đang bật Giảm chuyển động, nên luôn là Tắt." : "Chỉ bạn thấy lựa chọn này."}
            </p>
            <div role="radiogroup" aria-label="Hiệu ứng khi nhận" className="grid grid-cols-3 gap-2">
              {EFFECTS_LEVELS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={level === option.id}
                  disabled={reduced}
                  onClick={() => setEffectsLevel.mutate(option.id)}
                  className={cn(
                    "press min-h-11 rounded-lg border text-[13.5px] disabled:opacity-50",
                    level === option.id ? "border-personal font-semibold text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
