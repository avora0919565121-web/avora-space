import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AuthProvider } from "@/lib/auth";
import { chatKeys } from "@/lib/chat";
import type { ConversationSummary } from "@/lib/chat-cache";
import { ChatRealtimeProvider } from "@/lib/realtime";
import { taskKeys, type TaskItem } from "@/lib/tasks";
import { Probe, type SessionApi } from "./session-probe";

/**
 * 112-A · 2 — the entry of one person's app copy. Imported as
 * `/src/test/reliability/session-app.ts?avora_session=<key>` so its whole `src/` graph is that
 * person's own (see session-graphs.ts). The probe and the real engine live in session-probe.tsx.
 */
export type { SessionApi };

export type MountedSession = { api: SessionApi; unmount: () => void; container: HTMLElement };

/** Starts this app copy in `container`. Resolves once the person is signed in and the API is ready. */
export async function mountSession(container: HTMLElement, options: { conversationId?: string | null; inbox?: ConversationSummary[]; tasks?: TaskItem[] } = {}): Promise<MountedSession> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
  if (options.inbox !== undefined) queryClient.setQueryData(chatKeys.conversations, options.inbox);
  if (options.tasks !== undefined) queryClient.setQueryData(taskKeys.list, options.tasks);
  let api: SessionApi | null = null;
  const root: Root = createRoot(container);
  root.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        AuthProvider,
        null,
        createElement(
          ChatRealtimeProvider,
          null,
          createElement(Probe, {
            initialConversation: options.conversationId ?? null,
            ref: (handle: SessionApi | null) => {
              api = handle;
            },
          }),
        ),
      ),
    ),
  );
  const started = Date.now();
  while ((api === null || (api as SessionApi).userId === "") && Date.now() - started < 5_000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (api === null) throw new Error("session did not start");
  return {
    get api(): SessionApi {
      return api as SessionApi;
    },
    container,
    unmount: () => {
      root.unmount();
      queryClient.clear();
    },
  };
}

