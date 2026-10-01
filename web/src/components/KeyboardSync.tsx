import { useEffect } from "react";

/** Below this many px of lost height, it is browser chrome moving, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

function isTextField(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  if (!(node instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "range", "file", "color", "hidden"].includes(node.type);
}

/**
 * AVORA-59 · E — the on-screen keyboard, handled once for the whole app.
 *
 * - `html[data-keyboard="open"]` while it is up: the bottom tab bar (`hide-on-keyboard`) steps
 *   aside so the form keeps its room.
 * - `--keyboard-inset` = how much of the layout the keyboard covers, for anything pinned to the
 *   bottom that has to ride just above it (form footers use it via `pb-[var(--keyboard-inset)]`).
 * - The focused field is scrolled to the middle **once** when the keyboard arrives — never on
 *   every key, so typing does not make the page jump.
 *
 * With `interactive-widget=resizes-content` most browsers already shrink the layout; iOS Safari
 * does not, so the inset is read from `visualViewport` and is 0 wherever the layout did shrink.
 */
export function KeyboardSync() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null || viewport === undefined) return;
    const root = document.documentElement;
    let wasOpen = false;
    let frame = 0;
    // The screen's height with no keyboard. Browsers that resize the layout for the keyboard
    // (Android, `resizes-content`) shrink innerHeight too, so the drop is measured from here.
    let baseline = Math.max(window.innerHeight, viewport.height);
    let width = window.innerWidth;

    const apply = (): void => {
      frame = 0;
      const typing = isTextField(document.activeElement);
      if (window.innerWidth !== width) {
        // Rotated: a new screen, a new baseline.
        width = window.innerWidth;
        baseline = Math.max(window.innerHeight, viewport.height);
      } else if (!typing) {
        baseline = Math.max(window.innerHeight, viewport.height);
      }
      // iOS keeps the layout full height and slides the keyboard over it: that part is covered.
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const isOpen = typing && baseline - viewport.height > KEYBOARD_MIN_PX;
      root.style.setProperty("--keyboard-inset", `${isOpen ? Math.round(covered) : 0}px`);
      if (isOpen) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
      if (isOpen && !wasOpen) {
        const field = document.activeElement;
        if (isTextField(field)) field.scrollIntoView({ block: "center", behavior: "auto" });
      }
      wasOpen = isOpen;
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };

    viewport.addEventListener("resize", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);
    apply();
    return () => {
      viewport.removeEventListener("resize", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      delete root.dataset.keyboard;
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
  return null;
}
