import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { HOME_ROUTE } from "@/lib/navigation";
import { FEATURE_KEYS, routeFeature, soonInsideSection, statusOf, type FeatureKey } from "@/lib/features";
import { useFeature, useFeatures } from "@/lib/use-feature";
import { cn } from "@/lib/utils";

/**
 * The one quiet line a `soon` feature leaves where it will be: no button, no call to the server.
 * Never on a tab or in the navigation (DESIGN.md › "Không gắn nhãn Sắp có trên tab").
 */
export function FeatureSoon({ className }: { className?: string }) {
  return (
    <p data-feature-soon="" className={cn("text-[13px] text-muted-foreground", className)}>
      Sắp có
    </p>
  );
}

/** Shows the feature when `stable`, the quiet line when `soon`, nothing when `hidden`. */
export function FeatureGate({ feature, children, soon }: { feature: FeatureKey; children: ReactNode; soon?: ReactNode }) {
  const status = useFeature(feature);
  if (status === "hidden") return null;
  if (status === "soon") return <>{soon ?? <FeatureSoon />}</>;
  return <>{children}</>;
}

/**
 * Around the signed-in pages: a `hidden` feature's route (also from a saved or shared link) goes home;
 * a `soon` one shows the quiet line in place of the page.
 */
export function RouteFeatureGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const features = useFeatures();
  const key = routeFeature(location.pathname);
  if (key === null) return <>{children}</>;
  const status = statusOf(features, key);
  if (status === "hidden") return <Navigate to={HOME_ROUTE} replace />;
  // QA01-10: a sub-tab of Cài đặt keeps the section's title and strip; its own frame shows the line.
  if (status === "soon" && !soonInsideSection(location.pathname)) return <RouteSoonPage featureKey={key} />;
  return <>{children}</>;
}

function RouteSoonPage({ featureKey }: { featureKey: FeatureKey }) {
  const label = FEATURE_KEYS.find((entry) => entry.key === featureKey)?.label ?? "";
  return (
    <div className="paper min-h-0 flex-1 scroll-y-free">
      <div className="mx-auto max-w-3xl px-6 py-14 text-center md:px-10">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{label}</h1>
        <FeatureSoon className="mt-2" />
      </div>
    </div>
  );
}

/** Inside a section's frame (around its `<Outlet />`): a `soon` sub-tab shows the quiet line there. */
export function SectionFeatureGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const features = useFeatures();
  const key = routeFeature(location.pathname);
  if (key !== null && statusOf(features, key) === "soon" && soonInsideSection(location.pathname)) return <RouteSoonPage featureKey={key} />;
  return <>{children}</>;
}
