import { Check, Monitor, Moon, Palette, Smartphone, Sun } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  COLOR_SCHEMES,
  currentLook,
  deviceTone,
  SCHEME_LABEL,
  setPreviewTone,
  subscribeLook,
  TONE_IDS,
  TONE_LABEL,
  TONES,
  type ColorScheme,
  type Hsl,
  type ToneId,
} from "@/lib/theme";
import { useSettingsActions } from "@/lib/use-settings";
import { cn } from "@/lib/utils";

const SCHEME_ICON = { light: Sun, dark: Moon, device: Monitor } as const;
const css = (c: Hsl): string => `hsl(${c.h} ${c.s}% ${c.l}%)`;

/**
 * AVORA-74 · C — Giao diện: Sắc màu changes at once (easy to change back); Tông màu is chosen,
 * previewed over the whole app on this device only, then kept with `Giữ tông này`. Leaving the
 * screen without keeping it goes back to the saved tone.
 */
export function AppearanceCard() {
  const look = useSyncExternalStore(subscribeLook, currentLook, currentLook);
  const { setLookPrefs } = useSettingsActions();
  const saved = look.saved;
  const shownTone: ToneId = look.preview ?? saved.tone;
  const isDark = look.resolved.isDark;
  const device = useMemo(() => deviceTone(), []);

  // Rời màn mà chưa bấm Giữ → trở về tông cũ.
  useEffect(() => () => setPreviewTone(null), []);

  const save = (patch: { colorScheme?: ColorScheme; accentTone?: ToneId }, done?: () => void): void => {
    setLookPrefs.mutate(patch, {
      onSuccess: () => done?.(),
      onError: (error: Error) => toast.error(error.message),
    });
  };

  const pickScheme = (scheme: ColorScheme): void => {
    if (scheme === saved.scheme) return;
    save({ colorScheme: scheme });
  };

  const pickTone = (tone: ToneId): void => {
    setPreviewTone(tone === saved.tone ? null : tone);
  };

  const keep = (): void => {
    if (look.preview === null) return;
    const tone = look.preview;
    save({ accentTone: tone }, () => {
      setPreviewTone(null);
      toast.success("Đã đổi tông màu");
    });
  };

  const swatch = (tone: ToneId): string => {
    if (tone === "device") {
      const set = device.ok ? device.set : TONES.avora;
      return css(isDark ? set.dark.personal : set.light.personal);
    }
    return css(isDark ? TONES[tone].dark.personal : TONES[tone].light.personal);
  };

  const checkColor = (tone: ToneId): string => {
    const set = tone === "device" ? (device.ok ? device.set : TONES.avora) : TONES[tone];
    return css(isDark ? set.dark.personalFg : set.light.personalFg);
  };

  let deviceNote: string | null = null;
  if (shownTone === "device" && device.ok === false) {
    deviceNote = device.reason === "clash" ? "Màu của máy không hợp — đang dùng Avora." : "Trình duyệt này không cho biết màu của máy — đang dùng Avora.";
  }

  return (
    <section aria-labelledby="appearance-heading" className="rounded-card border border-border bg-card p-s-4" data-appearance="">
      <h2 id="appearance-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
        <Palette className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        Giao diện
      </h2>

      <h3 className="mt-s-2 text-[14px] font-semibold text-foreground">Sắc màu</h3>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">Độ sáng của nền. Theo thiết bị đổi cùng máy khi máy chuyển sáng / tối.</p>
      <div role="radiogroup" aria-label="Sắc màu" className="mt-s-2 grid grid-cols-3 gap-2">
        {COLOR_SCHEMES.map((scheme) => {
          const Icon = SCHEME_ICON[scheme];
          const isOn = saved.scheme === scheme;
          return (
            <button
              key={scheme}
              type="button"
              role="radio"
              aria-checked={isOn}
              onClick={() => pickScheme(scheme)}
              data-scheme-option={scheme}
              className={cn(
                "press flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-card border text-[13.5px] font-medium transition-colors",
                isOn ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-background text-foreground hover:bg-accent/30",
              )}
            >
              {scheme === "device" ? <Smartphone className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" /> : <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />}
              {SCHEME_LABEL[scheme]}
            </button>
          );
        })}
      </div>

      <h3 className="mt-s-4 text-[14px] font-semibold text-foreground">Tông màu</h3>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
        Màu cho những gì của bạn: tin bạn gửi, tab đang chọn, việc của bạn. Logo và nút <span className="font-semibold text-primary">+</span> luôn là cam Avora.
      </p>
      <div role="radiogroup" aria-label="Tông màu" className="mt-s-2 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
        {TONE_IDS.map((tone) => {
          const isOn = shownTone === tone;
          return (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={isOn}
              onClick={() => pickTone(tone)}
              data-tone-option={tone}
              className="press flex min-h-[84px] flex-col items-center justify-start gap-1.5 rounded-card px-1 pt-1 text-[13px] font-medium text-foreground"
            >
              <span
                className={cn("relative flex h-12 w-12 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-shadow", isOn ? "ring-2 ring-foreground" : "ring-1 ring-border")}
                style={{ background: tone === "device" ? `conic-gradient(${swatch(tone)} 0 50%, hsl(var(--secondary)) 50% 100%)` : swatch(tone) }}
              >
                {saved.tone === tone ? <Check className="h-5 w-5" style={{ color: checkColor(tone) }} strokeWidth={2.6} aria-hidden="true" data-tone-saved="" /> : null}
              </span>
              <span className="text-center leading-tight">{TONE_LABEL[tone]}</span>
            </button>
          );
        })}
      </div>
      {deviceNote !== null ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground" data-device-tone-note="">{deviceNote}</p>
      ) : null}

      {look.preview !== null ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2" data-tone-preview-bar="">
          <div className="animate-rise-in flex w-full max-w-md items-center gap-2 rounded-card border border-border bg-card px-3 py-2.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)]">
            <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: swatch(look.preview) }} aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
              Đang xem tông <strong className="font-semibold">{TONE_LABEL[look.preview]}</strong>
            </p>
            <button type="button" onClick={() => setPreviewTone(null)} className="press h-10 shrink-0 rounded-lg px-3 text-[13.5px] font-medium text-muted-foreground">
              Quay lại
            </button>
            <button type="button" onClick={keep} disabled={setLookPrefs.isPending} className="press h-10 shrink-0 rounded-lg bg-personal px-3.5 text-[13.5px] font-semibold text-personal-foreground disabled:opacity-60">
              Giữ tông này
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
