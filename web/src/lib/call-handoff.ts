import { toast } from "sonner";

import { callHref, type CallApp } from "@/lib/calls";

/**
 * Hands a call to the app the person picked. Phone opens the dialer; Zalo and WhatsApp get the
 * number copied first (ready to paste if the app opens on its home screen), then open in a new tab.
 * AVORA never dials anything itself.
 */
export async function handOffCall(app: CallApp, phone: string): Promise<void> {
  const href = callHref(app, phone);
  if (app === "phone") {
    window.location.href = href;
    return;
  }
  try {
    await navigator.clipboard.writeText(phone);
    toast.success(`Đã chép số ${phone}.`);
  } catch {
    // Copying is a convenience; the app still opens with the number in its link.
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
