import { lazy, Suspense, type ReactElement } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";

import { isSpikeAllowed } from "./gate";

const E2eeSpikePage = lazy(() => import("./E2eeSpikePage"));


export function SpikeGate({ fallback }: { fallback: ReactElement }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!isSpikeAllowed(import.meta.env.VITE_E2EE_SPIKE as string | undefined, Boolean(session), location.search)) return fallback;
  return (
    <Suspense fallback={null}>
      <E2eeSpikePage />
    </Suspense>
  );
}
