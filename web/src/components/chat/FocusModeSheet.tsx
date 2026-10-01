import { Moon, WifiOff } from "lucide-react";
import { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { FocusMode } from "@/lib/mute";
import { FOCUS_DURATIONS, type FocusDurationOption } from "@/lib/use-rhythm";
import { cn } from "@/lib/utils";

const LEVELS: readonly { id: FocusMode; label: string; note: string; icon: typeof Moon }[] = [
  { id: "quiet", label: "Yên lặng", note: "Không âm, không thông báo đẩy. Số chưa đọc vẫn hiện.", icon: Moon },
  { id: "disconnect", label: "Ngắt kết nối", note: "Không tải tin mới về. Nhật ký vẫn dùng bình thường.", icon: WifiOff },
];

/**
 * Chế độ tập trung (ADR-027 · AVORA-47 · C). Two levels, four durations; Gia đình and tin Khẩn
 * still come through, reminders always ring, and nobody else can tell it is on.
 */
export function FocusModeSheet({
  open,
  onOpenChange,
  activeMode,
  onStart,
  onStop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeMode: FocusMode | null;
  onStart: (mode: FocusMode, option: FocusDurationOption) => void;
  onStop: () => void;
}) {
  const [mode, setMode] = useState<FocusMode>(activeMode ?? "quiet");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl px-4 pb-6 pt-5">
        <SheetTitle className="flex items-center gap-2 text-[17px]">
          <Moon className="h-4 w-4 text-primary" strokeWidth={1.8} aria-hidden="true" /> Chế độ tập trung
        </SheetTitle>
        <SheetDescription className="mt-1 text-[13px] leading-relaxed">
          Gia đình và tin Khẩn vẫn báo. Nhắc việc luôn kêu. Người khác không thấy bạn đang tập trung.
        </SheetDescription>

        <div role="radiogroup" aria-label="Mức" className="mt-4 space-y-2">
          {LEVELS.map((level) => {
            const Icon = level.icon;
            const isOn = mode === level.id;
            return (
              <button
                key={level.id}
                type="button"
                role="radio"
                aria-checked={isOn}
                onClick={() => setMode(level.id)}
                className={cn(
                  "press flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  isOn ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/30",
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", isOn ? "text-primary" : "text-muted-foreground")} strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium text-foreground">{level.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{level.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[12.5px] font-medium text-muted-foreground">Trong bao lâu</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {FOCUS_DURATIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onStart(mode, option);
                onOpenChange(false);
              }}
              className="press h-12 rounded-xl border border-border bg-card text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              {option.label}
            </button>
          ))}
        </div>

        {activeMode !== null ? (
          <button
            type="button"
            onClick={() => {
              onStop();
              onOpenChange(false);
            }}
            className="press mt-4 h-11 w-full rounded-xl text-[14px] font-medium text-destructive hover:bg-destructive/5"
          >
            Tắt Chế độ tập trung
          </button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
