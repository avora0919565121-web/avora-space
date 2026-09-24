import { Flag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { celebrate } from "@/lib/confetti";
import { currentRhythm, motionFor } from "@/lib/motion";
import { onMilestoneBurst, warmMilestoneChannel, type MilestoneBurstEvent } from "@/lib/milestone-burst";
import { useConversations } from "@/lib/use-conversations";
import { useTasks } from "@/lib/use-tasks";
import { useAuth } from "@/lib/auth";

/** How long the overlay stays on screen before clearing itself. */
const BURST_VISIBLE_MS = 2600;

type BurstView = {
  title: string | null;
  at: number;
};

/**
 * The receiving end of a closed milestone: a brief overlay and a toast, then nothing.
 *
 * The broadcast topic itself is not access-controlled, so participation is re-checked here
 * against the viewer's own caches — a burst for a room this person is not in is dropped
 * before anything renders. The task's title is read from the task cache; if it has not
 * arrived yet the burst still plays, unnamed rather than wrong.
 */
export function MilestoneBurstLayer() {
  const { user } = useAuth();
  const { data: conversations } = useConversations();
  const { data: tasks } = useTasks();
  const [burst, setBurst] = useState<BurstView | null>(null);
  const [isShown, setIsShown] = useState<boolean>(false);
  const clearRef = useRef<number | null>(null);
  const fadeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    warmMilestoneChannel();

    return onMilestoneBurst((event: MilestoneBurstEvent) => {
      if (event.actorId === user.id) return;
      if (!conversations?.some((entry) => entry.conversationId === event.conversationId)) return;

      const task = tasks?.find((entry) => entry.id === event.taskId);
      const title: string | null = task?.title ?? null;
      setBurst({ title, at: Date.now() });
      setIsShown(false);
      // Two frames so the card starts transparent, then fades in. Opacity only, once.
      requestAnimationFrame(() => requestAnimationFrame(() => setIsShown(true)));

      // Live, and only live: this fires the moment a milestone closes, never on load.
      celebrate("milestone");

      toast.success(title === null ? "Một cột mốc vừa hoàn thành 🏁" : `Cột mốc hoàn thành: ${title} 🏁`);

      const { durationMs } = motionFor(currentRhythm());
      if (clearRef.current !== null) window.clearTimeout(clearRef.current);
      if (fadeRef.current !== null) window.clearTimeout(fadeRef.current);
      fadeRef.current = window.setTimeout(() => setIsShown(false), BURST_VISIBLE_MS - durationMs);
      clearRef.current = window.setTimeout(() => setBurst(null), BURST_VISIBLE_MS);
    });
  }, [user?.id, conversations, tasks]);

  useEffect(
    () => () => {
      if (clearRef.current !== null) window.clearTimeout(clearRef.current);
      if (fadeRef.current !== null) window.clearTimeout(fadeRef.current);
    },
    [],
  );

  if (burst === null) return null;

  return (
    <div
      key={burst.at}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
      style={{ opacity: isShown ? 1 : 0, transition: motionFor(currentRhythm()).transition }}
    >
      <div className="relative flex flex-col items-center gap-2 rounded-[16px] border border-border bg-card/95 px-6 py-5 shadow-lg">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fdf3d7] text-[#b98a2f]">
          <Flag className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[#b98a2f]">Cột mốc hoàn thành</p>
        {burst.title !== null ? (
          <p className="max-w-[260px] truncate text-[15px] font-semibold text-foreground">{burst.title}</p>
        ) : null}
      </div>
    </div>
  );
}
