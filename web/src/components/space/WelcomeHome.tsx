import { Check } from "lucide-react";
import { useState } from "react";

import { WELCOME_CHOICES, type WelcomeChoice } from "@/lib/welcome";
import { cn } from "@/lib/utils";

/**
 * Nhà mới — the one screen a newcomer meets before Avora Space. A question, six answers in house
 * wording, and two ways on. Choosing nothing is a fine answer; so is "Để sau".
 */
export function WelcomeHome({ name, onDone }: { name: string; onDone: (choices: WelcomeChoice[]) => void }) {
  const [picked, setPicked] = useState<WelcomeChoice[]>([]);
  const toggle = (id: WelcomeChoice): void =>
    setPicked((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      data-welcome-home=""
      className="paper fixed inset-0 z-[60] flex flex-col scroll-y px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[calc(env(safe-area-inset-top)+28px)]"
    >
      <div className="animate-rise-in mx-auto flex w-full max-w-[480px] flex-1 flex-col">
        <img src="/icon.png" alt="" aria-hidden="true" width={44} height={44} className="h-11 w-11 rounded-control" />
        <p className="mt-6 text-[15px] text-muted-foreground">Chào mừng {name} về nhà.</p>
        <h1 id="welcome-title" className="mt-1 text-[26px] font-semibold leading-[1.2] tracking-tight text-foreground">
          Bạn muốn Avora là nơi để làm gì?
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Chọn bao nhiêu cũng được, đổi lại lúc nào cũng được. Lựa chọn chỉ để gợi ý bước đầu, chỉ lưu trên máy này.
        </p>
        <ul className="mt-5 space-y-2" role="group" aria-label="Những điều bạn muốn">
          {WELCOME_CHOICES.map((choice) => {
            const isOn = picked.includes(choice.id);
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isOn}
                  data-welcome-choice={choice.id}
                  onClick={() => toggle(choice.id)}
                  className={cn(
                    "press flex min-h-14 w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isOn ? "border-primary/60 bg-primary/[0.07]" : "border-border bg-card",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                      isOn ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                    )}
                  >
                    {isOn ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug text-foreground">{choice.label}</span>
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{choice.room}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <button
            type="button"
            data-welcome-enter=""
            onClick={() => onDone(picked)}
            className="press min-h-12 rounded-[12px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground"
          >
            Vào nhà
          </button>
          <button type="button" data-welcome-later="" onClick={() => onDone([])} className="press min-h-11 rounded-[12px] px-5 text-[14px] font-medium text-muted-foreground">
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
