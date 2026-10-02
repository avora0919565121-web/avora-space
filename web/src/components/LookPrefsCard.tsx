import { Check, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { celebrate } from "@/lib/confetti";
import { prefersReducedMotion } from "@/lib/motion";
import {
  DEFAULT_BUTTON_STYLE,
  DEFAULT_CELEBRATION_STYLE,
  type ButtonStyle,
  type CelebrationStyle,
} from "@/lib/look-prefs";
import { useProfileSettings, useSettingsActions } from "@/lib/use-settings";
import { cn } from "@/lib/utils";

/** Named by feeling, not by mechanism (VMT 01/10 17:22). */
export const CELEBRATION_OPTIONS: readonly { value: CelebrationStyle; label: string; detail: string }[] = [
  { value: "subtle", label: "Nhẹ nhàng tinh tế", detail: "Chỉ một lớp màu mờ thoáng qua." },
  { value: "inspiring", label: "Chuyển động cảm hứng", detail: "Dòng việc phình nhẹ rồi về chỗ, kèm dấu tích." },
  { value: "vivid", label: "Sắc màu nổi bật", detail: "Một dải màu chạy quanh viền màn hình một vòng." },
  { value: "fireworks", label: "Pháo hoa phấn khích", detail: "Pháo giấy bung ra rồi rơi xuống." },
];

export const BUTTON_OPTIONS: readonly { value: ButtonStyle; label: string }[] = [
  { value: "round", label: "Tròn" },
  { value: "rounded", label: "Bo góc" },
  { value: "icon", label: "Chỉ biểu tượng" },
];

/**
 * Hiệu ứng khi hoàn thành (AVORA-56 · E, ADR-036) and Kiểu nút (AVORA-57 · F, ADR-037).
 * Both change the instant they are picked; `Xem thử` plays the effect without finishing anything.
 */
export function LookPrefsCard() {
  const { data: settings } = useProfileSettings();
  const { setLookPrefs } = useSettingsActions();
  const celebration = settings?.celebrationStyle ?? DEFAULT_CELEBRATION_STYLE;
  const button = settings?.buttonStyle ?? DEFAULT_BUTTON_STYLE;
  const reduced = prefersReducedMotion();

  const save = (patch: Parameters<typeof setLookPrefs.mutate>[0]): void => {
    setLookPrefs.mutate(patch, {
      onError: (error: Error) => toast.error(error.message),
    });
  };

  return (
    <>
      <section aria-labelledby="celebration-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="celebration-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
          <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          Hiệu ứng khi hoàn thành
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Chạy khi bạn xong một việc, đạt cột mốc hoặc vừa kết nối với ai đó. Không âm thanh.
        </p>
        {reduced ? (
          <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-[12.5px] leading-5 text-muted-foreground">
            Máy đang bật Giảm chuyển động, nên AVORA luôn dùng Nhẹ nhàng tinh tế.
          </p>
        ) : null}
        <div role="radiogroup" aria-label="Hiệu ứng khi hoàn thành" className="mt-4 space-y-2">
          {CELEBRATION_OPTIONS.map((option) => {
            const isOn = option.value === celebration;
            return (
              <div
                key={option.value}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                  isOn ? "border-primary/50 bg-primary/[0.05]" : "border-border",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={isOn}
                  onClick={() => save({ celebrationStyle: option.value })}
                  className="press flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      isOn ? "border-personal bg-personal text-personal-foreground" : "border-border",
                    )}
                  >
                    {isOn ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium text-foreground">
                      {option.label}
                      {option.value === DEFAULT_CELEBRATION_STYLE ? (
                        <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">· mặc định</span>
                      ) : null}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">{option.detail}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => celebrate("task", { style: option.value })}
                  className="press h-9 shrink-0 rounded-full border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-accent/40"
                >
                  Xem thử
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="button-style-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="button-style-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
          Kiểu nút
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Một kiểu cho mọi nút biểu tượng: tìm kiếm, +, lịch nổi, ⋯ và nút Gửi.
        </p>
        <div role="radiogroup" aria-label="Kiểu nút" className="mt-4 grid grid-cols-3 gap-2">
          {BUTTON_OPTIONS.map((option) => {
            const isOn = option.value === button;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isOn}
                onClick={() => save({ buttonStyle: option.value })}
                className={cn(
                  "press flex flex-col items-center gap-2.5 rounded-xl border px-2 pb-2.5 pt-3 transition-colors",
                  isOn ? "border-primary/60 bg-primary/[0.05]" : "border-border hover:bg-accent/30",
                )}
              >
                {/* The preview draws each shape itself, so all three show at once. */}
                <span data-button-style={option.value} className="flex items-center gap-1.5">
                  <span className="icon-btn icon-btn-preview h-9 w-9 text-foreground">
                    <Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="icon-btn icon-btn-preview icon-btn-primary h-9 w-9">
                    <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                </span>
                <span className={cn("text-[13px]", isOn ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {option.label}
                  {option.value === DEFAULT_BUTTON_STYLE ? <span className="block text-[11px] font-normal">mặc định</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
