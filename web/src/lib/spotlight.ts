/**
 * Brings one element into view and lights it for a moment (AVORA-39 / Phần 1).
 *
 * Used where a link names one object inside a long list — a task, a Hạng mục — so the person
 * lands looking at it instead of hunting. The element is found by a data attribute, because
 * the list rows live several components deep and are rendered by different views.
 */
export function spotlight(attribute: string, value: string, options?: { durationMs?: number; attempts?: number }): void {
  if (typeof document === "undefined") return;
  const durationMs = options?.durationMs ?? 2400;
  let attemptsLeft = options?.attempts ?? 12;
  const selector = `[${attribute}="${CSS.escape(value)}"]`;

  const tryOnce = (): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
      attemptsLeft -= 1;
      if (attemptsLeft > 0) window.setTimeout(tryOnce, 120);
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    element.setAttribute("data-lit", "true");
    window.setTimeout(() => element.removeAttribute("data-lit"), durationMs);
  };

  window.setTimeout(tryOnce, 60);
}
