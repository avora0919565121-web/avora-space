import { FakeSupabaseClient } from "./fake-client";
import { FakeAvoraServer } from "./fake-server";
import { NetworkConditioner } from "./faults";
import type { MountedSession, SessionApi } from "./session-app";
import type { ConversationSummary } from "@/lib/chat-cache";
import type { TaskItem } from "@/lib/tasks";

/**
 * 112-A · 2 — the two-person harness. Every person (or every device of one person) gets:
 *   · their own copy of the app (own module graph: own caches, outbox memory, Supabase client),
 *   · their own network with fault injection (`net`, see faults.ts),
 *   · their own place on the page,
 * and all of them talk to ONE shared server. Test people are made here, never real accounts
 * (the live-database counterpart is the SQL tests' probe users testera/testerb).
 *
 * What two copies in one page still share, unlike two phones: IndexedDB and localStorage of the
 * origin (keys are per user, so two PEOPLE never collide; two TABS of one person share them in a
 * real browser too, which is exactly what luồng 10 asks to test).
 */
declare global {
  var __AVORA_SESSIONS__: Record<string, { client: FakeSupabaseClient }> | undefined;
}

let sessionCounter = 0;

export type Person = {
  userId: string;
  name: string;
  net: NetworkConditioner;
  client: FakeSupabaseClient;
  readonly api: SessionApi;
  readonly container: HTMLElement;
  /** (c) Close the app mid-whatever and open it again: a brand-new app copy over the same device storage. */
  reload: (options?: { waitMs?: number }) => Promise<void>;
  close: () => void;
  /** Re-open after `close()` (the device storage kept everything). */
  open: () => Promise<void>;
};

export type OpenOptions = { conversationId?: string | null; inbox?: ConversationSummary[]; tasks?: TaskItem[] };

export class TwoPeople {
  readonly server = new FakeAvoraServer();
  private readonly people: Person[] = [];

  /** Opens one app copy for `userId` (call twice with the same id for two devices / tabs). */
  async open(userId: string, name: string, options: OpenOptions = {}): Promise<Person> {
    if (!this.server.table("profiles").some((row) => row.id === userId)) this.server.addUser(userId, name);
    const net = new NetworkConditioner();
    const client = new FakeSupabaseClient(this.server, userId, net);
    const host = document.createElement("div");
    host.dataset.person = name;
    host.style.cssText = "display:inline-block;vertical-align:top;width:360px;margin:4px;border:1px solid #ddd;";
    document.body.appendChild(host);
    let mounted: MountedSession | null = null;

    const start = async (): Promise<void> => {
      sessionCounter += 1;
      const key = `s${sessionCounter}`;
      globalThis.__AVORA_SESSIONS__ = { ...(globalThis.__AVORA_SESSIONS__ ?? {}), [key]: { client } };
      const container = document.createElement("div");
      host.replaceChildren(container);
      const module = (await import(/* @vite-ignore */ `/src/test/reliability/session-app.ts?avora_session=${key}`)) as typeof import("./session-app");
      mounted = await module.mountSession(container, options);
    };
    await start();

    const person: Person = {
      userId,
      name,
      net,
      client,
      get api(): SessionApi {
        if (mounted === null) throw new Error(`${name} is closed`);
        return mounted.api;
      },
      get container(): HTMLElement {
        return host;
      },
      reload: async (reloadOptions) => {
        mounted?.unmount();
        mounted = null;
        await client.removeAllChannels();
        if ((reloadOptions?.waitMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, reloadOptions?.waitMs));
        await start();
      },
      close: () => {
        mounted?.unmount();
        mounted = null;
        void client.removeAllChannels();
      },
      open: start,
    };
    this.people.push(person);
    return person;
  }

  /** Tears every copy down; call in afterEach. */
  async dispose(): Promise<void> {
    for (const person of this.people) {
      person.close();
      person.container.remove();
    }
    this.people.length = 0;
  }
}

/** Waits until `check` passes (or throws its last error after `timeoutMs`). */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, label = "condition"): Promise<number> {
  const started = performance.now();
  for (;;) {
    if (await check()) return performance.now() - started;
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** p-th percentile of a list of numbers (nearest rank). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
