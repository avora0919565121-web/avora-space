import { useQuery } from "@tanstack/react-query";
import { BookOpen, MessageCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { withReturn } from "@/lib/return-to";
import { fetchAllReadingStates, FINISHED_PERCENT, type ReadingState } from "@/lib/reading-state";
import { hideRestCard, isRestCardHidden } from "@/lib/rest-day";
import { useRestDay } from "@/lib/use-rest-day";

const SPACE_ORIGIN = { path: "/tong-quan", label: "Avora Space" };

/**
 * AVORA-110 · 5 — on a rest day, one quiet card on Avora Space: `Hôm nay là ngày nghỉ.` and three
 * doors inward. No names suggested, nothing read from chats, no reasons given. `Để sau` hides it
 * until the end of the day, on this device.
 */
export function RestDayCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isRest, now } = useRestDay();
  const [hidden, setHidden] = useState<boolean>(() => isRestCardHidden(new Date()));
  const states = useQuery<ReadingState[], Error>({
    queryKey: ["book-reading-state", "all"],
    queryFn: fetchAllReadingStates,
    enabled: isRest && !hidden && Boolean(user?.id),
    staleTime: 30_000,
  });
  if (!isRest || hidden || isRestCardHidden(now)) return null;

  const readOn = (): void => {
    const current = (states.data ?? []).find((state) => state.percent < FINISHED_PERCENT);
    navigate(withReturn(current === undefined ? "/ke-hoach?ke=5" : `/ke-hoach/ke-sach/doc/${current.recordId}`, SPACE_ORIGIN));
  };
  const reflect = (): void => {
    const block = document.getElementById("space-thought");
    block?.scrollIntoView({ behavior: "smooth", block: "center" });
    block?.querySelector<HTMLElement>("button, textarea")?.focus({ preventScroll: true });
  };
  const door = "press flex min-h-11 items-center gap-2 rounded-control border border-border bg-card px-3.5 text-[15px] text-foreground transition-colors hover:bg-accent/40";

  return (
    <section aria-label="Ngày nghỉ" className="mt-s-4 rounded-card border border-border bg-[hsl(var(--personal-soft)/0.55)] p-s-4" data-rest-card="">
      <p className="text-[16px] font-medium text-foreground">Hôm nay là ngày nghỉ.</p>
      <div className="mt-s-3 flex flex-wrap gap-2">
        <button type="button" onClick={readOn} className={door} data-rest-door="read">
          <BookOpen className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          Đọc tiếp
        </button>
        <button type="button" onClick={reflect} className={door} data-rest-door="reflect">
          <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          Suy gẫm hôm nay
        </button>
        <button type="button" onClick={() => navigate(withReturn("/tin-nhan?tab=1-1", SPACE_ORIGIN))} className={door} data-rest-door="message">
          <MessageCircle className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
          Nhắn cho một người
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          hideRestCard(new Date());
          setHidden(true);
        }}
        className="mt-s-2 min-h-11 text-[14px] text-muted-foreground underline-offset-4 hover:underline"
        data-rest-later=""
      >
        Để sau
      </button>
    </section>
  );
}
