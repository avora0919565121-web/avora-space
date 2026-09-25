import { useCallback, useRef, useState } from "react";

/**
 * One submission at a time.
 *
 * `isPending` from a mutation turns true only after React re-renders, and a quick double click
 * lands both clicks before that — which is how "APĐ | Nhà ở" was created twice. The ref closes
 * the door synchronously on the first click; the state disables the button for everyone to see.
 */
export function useSubmitGuard(): {
  isSubmitting: boolean;
  guard: <T>(work: () => Promise<T>) => Promise<T | undefined>;
} {
  const lockRef = useRef<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setIsSubmitting(true);
    try {
      return await work();
    } finally {
      lockRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, guard };
}
