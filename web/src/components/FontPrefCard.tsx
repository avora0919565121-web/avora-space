import { Check, Type } from "lucide-react";

import { FONT_HINT, FONT_IDS, FONT_LABEL, FONT_STACK, setFont, useFont } from "@/lib/font-pref";
import { cn } from "@/lib/utils";

/**
 * AVORA-101B · KHỐI 2E — `Phông chữ`: the one place a font is chosen. Changes every tab and every
 * conversation at once, on this device. Only sans faces: no serif reaches a title.
 */
export function FontPrefCard() {
  const font = useFont();
  return (
    <section aria-labelledby="font-heading" className="rounded-card border border-border bg-card p-s-4" data-font-pref="">
      <h2 id="font-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
        <Type className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        Phông chữ
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Một phông cho cả Avora — mọi tab và mọi cuộc trò chuyện. Lưu trên máy này.</p>
      <div role="radiogroup" aria-label="Phông chữ" className="mt-s-2 flex flex-col gap-2">
        {FONT_IDS.map((id) => {
          const isOn = font === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isOn}
              onClick={() => setFont(id)}
              data-font-option={id}
              className={cn(
                "press flex min-h-14 items-center gap-3 rounded-card border px-4 py-2 text-left transition-colors",
                isOn ? "border-personal bg-personal-soft text-personal-soft-foreground" : "border-border bg-background text-foreground hover:bg-accent/30",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium leading-6" style={{ fontFamily: FONT_STACK[id] }}>
                  {FONT_LABEL[id]} · Chữ Việt rõ ràng
                </span>
                <span className="block text-[12.5px] leading-5 text-muted-foreground">{FONT_HINT[id]}</span>
              </span>
              {isOn ? <Check className="h-5 w-5 shrink-0" strokeWidth={2.4} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
