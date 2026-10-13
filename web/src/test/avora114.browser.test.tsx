import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, expect, test, vi } from "vitest";

import "@/index.css";

/*
 * AVORA-114 — the message sound on a device that blocks sound until a tap (iPhone). Fake audio
 * output (the real one depends on the browser's autoplay policy); real InAppAlerts, real settings
 * screen, real event from the realtime layer's contract.
 */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: unknown): unknown => {
    let single = false;
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "then") {
            const data = single ? (Array.isArray(rows) ? (rows[0] ?? null) : rows) : rows;
            const done = Promise.resolve({ data, error: null, count: 0 });
            return done.then.bind(done);
          }
          if (key === "single" || key === "maybeSingle") {
            return () => {
              single = true;
              return proxy;
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    supabase: {
      from: (table: string) => builder((globalThis as { __rows114?: Record<string, unknown> }).__rows114?.[table] ?? []),
      rpc: () => builder([]),
      storage: { from: () => builder([]) },
      channel: () => builder([]),
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", email: "me@probe.invalid" }, session: {}, profile: { id: "me", display_name: "Thiện", avatar_url: null, created_at: "" }, isLoading: false, signOut: async () => undefined }),
  useDisplayName: () => "Thiện",
}));
vi.mock("@/lib/realtime", () => ({ useChatRealtime: () => ({ status: "live", isLive: true, setReadingConversation: () => undefined }) }));

import { InAppAlerts } from "@/components/InAppAlerts";
import { INCOMING_MESSAGE_EVENT, type IncomingMessageSignal } from "@/lib/in-app-alerts";
import { resetSoundPlayerForTests, SoundPlayer, type SoundDeps } from "@/lib/sound";
import { readSoundLog, recordSoundOutcome, SOUND_LOG_KEY } from "@/lib/sound-log";
import SettingsNotifications from "@/pages/SettingsNotifications";
import { VaultLockProvider } from "@/lib/use-vault-lock";

const OUT = "../../../docs/screens/2026-10-13";

type Fake = { started: string[]; allowResume: boolean; fileOk: boolean; startThrows: boolean };

function installFakePlayer(fake: Fake): SoundPlayer {
  let state: AudioContextState = "suspended";
  class FakeContext {
    get state() {
      return state;
    }
    currentTime = 0;
    destination = {};
    createBuffer() {
      return {} as AudioBuffer;
    }
    createBufferSource() {
      const node = {
        buffer: null as unknown,
        connect: () => undefined,
        start: () => {
          const name = (node.buffer as { name?: string } | null)?.name ?? "silent";
          if (fake.startThrows && name !== "silent") throw Object.assign(new Error("x"), { name: "InvalidStateError" });
          fake.started.push(name);
        },
      };
      return node;
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined };
    }
    createOscillator() {
      return { frequency: { setValueAtTime: () => undefined }, connect: () => undefined, start: () => fake.started.push("tone"), stop: () => undefined };
    }
    async resume() {
      if (fake.allowResume) state = "running";
    }
    async decodeAudioData(bytes: ArrayBuffer) {
      return { name: new TextDecoder().decode(bytes) } as unknown as AudioBuffer;
    }
  }
  const deps: SoundDeps = {
    AudioContext: FakeContext as unknown as new () => AudioContext,
    createAudio: undefined,
    fetch: async (url: string) =>
      fake.fileOk
        ? ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer } as unknown as Response)
        : ({ ok: false, status: 404 } as Response),
    target: window,
    doc: document,
  };
  const player = new SoundPlayer(deps);
  player.install();
  resetSoundPlayerForTests(player);
  return player;
}

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VaultLockProvider>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-card">
            <main data-app-main="" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={null}>{children}</Suspense>
            </main>
          </div>
          <Toaster />
        </VaultLockProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function incoming(over: Partial<IncomingMessageSignal> = {}): void {
  window.dispatchEvent(
    new CustomEvent<IncomingMessageSignal>(INCOMING_MESSAGE_EVENT, {
      detail: { conversationId: "c-peer", senderId: "peer", mentionsViewer: false, isReading: false, ...over },
    }),
  );
}

const messageSounds = (fake: Fake): number => fake.started.filter((name) => name.includes("message-v1")).length;

beforeEach(() => {
  (globalThis as { __rows114?: Record<string, unknown> }).__rows114 = {};
  window.localStorage.removeItem(SOUND_LOG_KEY);
  window.sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (/^\[(sound|badge)\]/.test(String(args[0]))) return;
    console.warn(...args);
  });
});

test("AVORA-114 · (a) chưa chạm → locked → dải nhỏ hiện đúng một lần, không phải toast lặp", async () => {
  await page.viewport(390, 844);
  const fake: Fake = { started: [], allowResume: false, fileOk: true, startThrows: false };
  installFakePlayer(fake);
  await render(
    <Frame>
      <InAppAlerts />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  incoming();
  await expect.element(page.getByTestId("sound-unlock-banner")).toBeVisible();
  await expect.element(page.getByText("Chạm vào màn hình để bật âm báo.")).toBeVisible();
  await page.screenshot({ path: `${OUT}/114-dai-cham-de-bat-am-390x844.png` });
  expect(readSoundLog()[0].outcome).toBe("locked");

  // Close it by unlocking elsewhere, then another locked message in the same session: no second banner.
  // A real tap on the strip (the test frame's own overlay intercepts Playwright's pointer here).
  (page.getByTestId("sound-unlock-banner").element() as HTMLButtonElement).click();
  await expect.element(page.getByTestId("sound-unlock-banner")).not.toBeInTheDocument();
  expect(messageSounds(fake)).toBe(0);

  // This device keeps refusing (resume not allowed): the next message is locked too, but the strip
  // does not come back in the same session.
  fake.allowResume = false;
  await new Promise((resolve) => setTimeout(resolve, 100));
  incoming();
  await vi.waitFor(() => expect(readSoundLog().length).toBeGreaterThanOrEqual(2));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await expect.element(page.getByTestId("sound-unlock-banner")).not.toBeInTheDocument();
});

test("AVORA-114 · (b) chạm một lần → mở khoá → tin kế tiếp phát đúng một lần · (c) bốn tin trong 3 giây → một tiếng", async () => {
  const fake: Fake = { started: [], allowResume: true, fileOk: true, startThrows: false };
  const player = installFakePlayer(fake);
  await render(
    <Frame>
      <div data-testid="anywhere" style={{ width: 200, height: 200 }} />
      <InAppAlerts />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  await userEvent.click(page.getByTestId("anywhere"));
  await vi.waitFor(() => expect(player.isUnlocked).toBe(true));

  incoming();
  await vi.waitFor(() => expect(messageSounds(fake)).toBe(1));

  incoming();
  incoming({ conversationId: "c-other" });
  incoming();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(messageSounds(fake)).toBe(1);
  const outcomes = readSoundLog().map((entry) => entry.outcome);
  expect(outcomes).toEqual(["throttled", "throttled", "throttled", "played"]);

  // Never for the thread being read, nor for one's own message from another device.
  await new Promise((resolve) => setTimeout(resolve, 3_050));
  incoming({ isReading: true });
  incoming({ senderId: "me" });
  incoming({ isGone: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(messageSounds(fake)).toBe(1);
  expect(readSoundLog().slice(0, 2).map((entry) => entry.outcome)).toEqual(["gone", "reading"]);
  await expect.element(page.getByTestId("sound-unlock-banner")).not.toBeInTheDocument();
});

test("AVORA-114 · 4 · tắt thông báo riêng một cuộc chặn âm, Cờ Khẩn vẫn qua (trước đây âm trong app bỏ sót tầng này)", async () => {
  const until = new Date(Date.now() + 3_600_000).toISOString();
  (globalThis as { __rows114?: Record<string, unknown> }).__rows114 = {
    mute_settings: [{ scope: "conversation", muted_until: until, conversation_id: "c-muted" }],
    profiles: [{ id: "me", focus_mode: null, focus_until: null, sound_messages: true }],
  };
  const fake: Fake = { started: [], allowResume: true, fileOk: true, startThrows: false };
  const player = installFakePlayer(fake);
  await player.unlock();
  await render(
    <Frame>
      <InAppAlerts />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  incoming({ conversationId: "c-muted" });
  await vi.waitFor(() => expect(readSoundLog()[0]?.outcome).toBe("muted"));
  expect(messageSounds(fake)).toBe(0);
  // Cờ Khẩn still passes a conversation mute.
  incoming({ conversationId: "c-muted", isUrgent: true });
  await vi.waitFor(() => expect(messageSounds(fake)).toBe(1));
});

test("AVORA-114 · 4 · Chế độ tập trung (Yên lặng) → không có tiếng, lý do ghi đúng", async () => {
  (globalThis as { __rows114?: Record<string, unknown> }).__rows114 = {
    profiles: [{ id: "me", focus_mode: "quiet", focus_until: new Date(Date.now() + 3_600_000).toISOString(), sound_messages: true }],
  };
  const fake: Fake = { started: [], allowResume: true, fileOk: true, startThrows: false };
  const player = installFakePlayer(fake);
  await player.unlock();
  await render(
    <Frame>
      <InAppAlerts />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  incoming();
  await vi.waitFor(() => expect(readSoundLog()[0]?.outcome).toBe("focus"));
  expect(messageSounds(fake)).toBe(0);
});

const TEST_CASES: readonly { name: string; fake: Omit<Fake, "started">; want: string }[] = [
  { name: "máy chặn", fake: { allowResume: false, fileOk: true, startThrows: false }, want: "Máy đang chặn âm thanh, chạm lại" },
  { name: "thiếu tệp", fake: { allowResume: true, fileOk: false, startThrows: false }, want: "Không tìm thấy tệp âm thanh" },
  { name: "phát được", fake: { allowResume: true, fileOk: true, startThrows: false }, want: "Đã phát" },
];
for (const testCase of TEST_CASES) {
  test(`AVORA-114 · (d) Nghe thử · ${testCase.name} → "${testCase.want}"`, async () => {
    const fake: Fake = { started: [], ...testCase.fake };
    installFakePlayer(fake);
    await render(
      <Frame>
        <SettingsNotifications />
      </Frame>,
    );
    await page.getByRole("button", { name: "Nghe thử" }).click();
    await expect.element(page.getByTestId("sound-test-result")).toHaveTextContent(testCase.want);
    expect(messageSounds(fake)).toBe(testCase.want === "Đã phát" ? 1 : 0);
    await expect.element(page.getByText("Nếu điện thoại đang để chế độ im lặng (nút gạt bên hông), bạn có thể không nghe thấy.")).toBeVisible();
  });
}

test("AVORA-114 · (e) mọi lỗi play() hiện trong \"Vì sao tôi không nghe thấy?\" — không có catch rỗng", async () => {
  const fake: Fake = { started: [], allowResume: true, fileOk: true, startThrows: true };
  const player = installFakePlayer(fake);
  await player.unlock();
  await render(
    <Frame>
      <InAppAlerts />
      <SettingsNotifications />
    </Frame>,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  incoming();
  await vi.waitFor(() => expect(readSoundLog()[0]?.outcome).toBe("error"));
  await page.getByRole("button", { name: "Vì sao tôi không nghe thấy?" }).click();
  await expect.element(page.getByTestId("sound-log")).toHaveTextContent("Lỗi: InvalidStateError");
});

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
  test(`AVORA-114 · ảnh Cài đặt › Thông báo › âm báo ${w}×${h}`, async () => {
    await page.viewport(w, h);
    installFakePlayer({ started: [], allowResume: true, fileOk: true, startThrows: false });
    const now = Date.now();
    const sample = ["played", "reading", "muted", "quiet_reading", "throttled", "locked"] as const;
    [...sample].reverse().forEach((outcome, index) => recordSoundOutcome({ at: now - (sample.length - index) * 60_000, outcome }));
    await render(
      <Frame>
        <SettingsNotifications />
      </Frame>,
    );
    await page.getByRole("button", { name: "Nghe thử" }).click();
    await expect.element(page.getByTestId("sound-test-result")).toHaveTextContent("Đã phát");
    await page.getByRole("button", { name: "Vì sao tôi không nghe thấy?" }).click();
    const list = page.getByTestId("sound-log");
    await expect.element(list).toBeVisible();
    list.element().scrollIntoView({ block: "center" });
    await page.screenshot({ path: `${OUT}/114-am-bao-chan-doan-${w}x${h}.png` });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
  });
}
