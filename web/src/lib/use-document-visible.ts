import { useEffect, useState } from "react";

/**
 * Whether the tab is actually in front of the user.
 * A thread open in a background tab must not count as read.
 */
export function useDocumentVisible(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    const handleChange = (): void => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleChange);
    window.addEventListener("focus", handleChange);
    return () => {
      document.removeEventListener("visibilitychange", handleChange);
      window.removeEventListener("focus", handleChange);
    };
  }, []);

  return isVisible;
}
