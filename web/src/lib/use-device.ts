import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { deviceApi, proveDevice, type DeviceStatus, type MyDevice } from "@/lib/device";
import { useDocumentVisible } from "@/lib/use-document-visible";

export const deviceKeys = {
  status: (sessionKey: string) => ["device", "status", sessionKey] as const,
  list: ["device", "list"] as const,
};

/** The session id inside the access token — the server ties a device to exactly this. */
export function sessionIdOfToken(token: string | undefined): string | null {
  if (token === undefined) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/**
 * AVORA-67: this device's standing for the current session. Proves the device once per session, then
 * asks `device_status()` on open and every time the tab comes back.
 */
export function useDeviceStatus(): { status: DeviceStatus | undefined; isPending: boolean; refetch: () => void } {
  const { session } = useAuth();
  const visible = useDocumentVisible();
  const sessionKey = sessionIdOfToken(session?.access_token) ?? "none";
  const query = useQuery({
    queryKey: deviceKeys.status(sessionKey),
    queryFn: async () => {
      if (session !== null) {
        await proveDevice(session.user.id, session.access_token, sessionKey).catch(() => undefined);
      }
      return deviceApi.status();
    },
    enabled: session !== null,
    staleTime: 30_000,
    retry: 1,
  });
  const { refetch } = query;
  useEffect(() => {
    if (visible && session !== null) void refetch();
  }, [visible, session, refetch]);
  return { status: query.data, isPending: query.isPending, refetch: () => void refetch() };
}

export function useMyDevices(enabled = true): { devices: MyDevice[]; isPending: boolean } {
  const query = useQuery({ queryKey: deviceKeys.list, queryFn: deviceApi.list, enabled, staleTime: 30_000 });
  return { devices: query.data ?? [], isPending: query.isPending };
}

/** After any device change: both the list and the status are stale. */
export function useInvalidateDevices(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["device"] });
}
