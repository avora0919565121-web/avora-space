import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLongPress } from "@/hooks/use-long-press";
import { goToTabRoot } from "@/lib/go-back";
import { LOGO_HOLD_MS } from "@/lib/navigation";

/**
 * AVORA-100 · C (ADR-062 bản sửa): tap = one step back (luật 1); hold 450 ms = the top of the big tab
 * (luật 2), dropping the chain inside it. For a `‹` that has its own look.
 */
export function useBackPress(onBack: () => void, onHold?: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const toRoot = useCallback(() => goToTabRoot(navigate, location), [navigate, location]);
  return useLongPress({ onTap: onBack, onHold: onHold ?? toRoot, holdMs: LOGO_HOLD_MS });
}

