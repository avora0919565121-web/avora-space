import { useEffect, useState, type ReactNode } from "react";

import { currentRhythm, motionFor } from "@/lib/motion";

/**
 * Content that arrives by fading in once — opacity only, on the motion tokens, nothing else.
 * Re-key it to fade again (for example when the calendar steps to another month).
 */
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const [isShown, setIsShown] = useState<boolean>(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={className} style={{ opacity: isShown ? 1 : 0, transition: motionFor(currentRhythm()).transition }}>
      {children}
    </div>
  );
}
