import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";

import { featureKeys, fetchFeatureMap, readCachedFeatures, routeFeature, statusOf, type FeatureKey, type FeatureMap, type FeatureStatus } from "@/lib/features";

/**
 * AVORA-112-B: every feature's state, read when the app opens, again on return to the tab and every 10
 * minutes. Until the server answers (or when offline) the last copy on this device is used; with none at
 * all, every key is `stable`.
 */
/** Used only where a component is rendered outside the app's query provider (isolated tests): never fetches. */
const DETACHED = new QueryClient();

export function useFeatures(): FeatureMap | undefined {
  const client = useContext(QueryClientContext);
  const { data } = useQuery<FeatureMap, Error>({
    queryKey: featureKeys.all,
    queryFn: fetchFeatureMap,
    // Only signed-in screens mount a gate; signed out, the read is refused and the cached copy stays.
    enabled: client !== undefined,
    initialData: readCachedFeatures,
    // The cached copy is shown at once but never counted as fresh: the server is asked on every start.
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 10 * 60_000,
    retry: 1,
  }, client ?? DETACHED);
  return data;
}

/** `stable` · `soon` · `hidden` for one feature. */
export function useFeature(key: FeatureKey): FeatureStatus {
  return statusOf(useFeatures(), key);
}

/** A nav list without the entries whose feature is `hidden` (a `soon` tab stays, plain — the line lives inside). */
export function useVisibleNav<T extends { readonly to: string }>(items: readonly T[]): readonly T[] {
  const features = useFeatures();
  return useMemo(() => {
    const visible = items.filter((item) => {
      const key = routeFeature(item.to);
      return key === null || statusOf(features, key) !== "hidden";
    });
    return visible.length === items.length ? items : visible;
  }, [items, features]);
}
