import { beforeEach, describe, expect, it, vi } from "vitest";

import { chimeDecision, SOUND_THROTTLE_MS, type IncomingMessageSignal } from "@/lib/in-app-alerts";
import type { MuteDecision } from "@/lib/mute";
import { SoundPlayer, type SoundDeps } from "@/lib/sound";
import { outcomeLabel, readSoundLog, recordSoundOutcome, SOUND_LOG_KEY, SOUND_STRINGS } from "@/lib/sound-log";

const VIEWER = "viewer";
const OPEN: MuteDecision = { blocked: false, decidedBy: null, exception: null };
const MUTED_GROUP: MuteDecision = { blocked: true, decidedBy: "group", exception: null };
const MUTED_CONVERSATION: MuteDecision = { blocked: true, decidedBy: "conversation", exception: null };
const FOCUS: MuteDecision = { blocked: true, decidedBy: "focus", exception: null };

function signal(over: Partial<IncomingMessageSignal> = {}): IncomingMessageSignal {
  return { conversationId: "c1", senderId: "peer", mentionsViewer: false, isReading: false, ...over };
}

function decide(over: Partial<Parameters<typeof chimeDecision>[0]> = {}) {
  return chimeDecision({ signal: signal(), viewerId: VIEWER, soundOn: true, quietReading: false, lastChimeAt: 0, now: 100_000, decision: OPEN, ...over });
}

describe("AVORA-114 · the sound decision table", () => {
  it("plays for a message from someone else, nothing else in the way", () => {
    expect(decide()).toBe("play");
  });

  const rows: { name: string; input: Partial<Parameters<typeof chimeDecision>[0]>; want: string }[] = [
    { name: "own message (another device of the same account)", input: { signal: signal({ senderId: VIEWER }) }, want: "own" },
    { name: "recalled / disappeared before it played", input: { signal: signal({ isGone: true }) }, want: "gone" },
    { name: "message sound off in Settings", input: { soundOn: false }, want: "setting_off" },
    { name: "reading this conversation", input: { signal: signal({ isReading: true }) }, want: "reading" },
    { name: "Đọc yên tĩnh", input: { quietReading: true }, want: "quiet_reading" },
    { name: "group muted", input: { decision: MUTED_GROUP }, want: "muted" },
    { name: "this conversation muted", input: { decision: MUTED_CONVERSATION }, want: "muted" },
    { name: "Chế độ tập trung", input: { decision: FOCUS }, want: "focus" },
    { name: "a sound within the last 3 seconds", input: { lastChimeAt: 100_000 - SOUND_THROTTLE_MS + 1 }, want: "throttled" },
    { name: "exactly 3 seconds later", input: { lastChimeAt: 100_000 - SOUND_THROTTLE_MS }, want: "play" },
  ];
  for (const row of rows) {
    it(`${row.name} → ${row.want}`, () => {
      expect(decide(row.input)).toBe(row.want);
    });
  }

  it("every combination of the six switches yields exactly one reason, in priority order", () => {
    const flags = [false, true];
    let seen = 0;
    for (const own of flags)
      for (const gone of flags)
        for (const off of flags)
          for (const reading of flags)
            for (const quiet of flags)
              for (const muted of flags)
                for (const recent of flags) {
                  const got = decide({
                    signal: signal({ senderId: own ? VIEWER : "peer", isGone: gone, isReading: reading }),
                    soundOn: !off,
                    quietReading: quiet,
                    decision: muted ? MUTED_GROUP : OPEN,
                    lastChimeAt: recent ? 99_000 : 0,
                  });
                  const want = own ? "own" : gone ? "gone" : off ? "setting_off" : reading ? "reading" : quiet ? "quiet_reading" : muted ? "muted" : recent ? "throttled" : "play";
                  expect(got).toBe(want);
                  seen += 1;
                }
    expect(seen).toBe(128);
  });

  it("Khoá Kết nối is not an input: a locked Kết nối still sounds (the sound reveals nothing)", () => {
    // The decision has no lock parameter at all; locking only hides counts (AVORA-109 · A1).
    expect(chimeDecision.length).toBe(1);
    expect(decide()).toBe("play");
  });
});

describe("AVORA-114 · diagnostics list (this device only)", () => {
  it("without storage (server, private mode) the list is empty and recording does not throw", () => {
    expect(readSoundLog()).toEqual([]);
    expect(() => recordSoundOutcome({ at: 1, outcome: "played" })).not.toThrow();
    expect(SOUND_LOG_KEY).toBe("avora.sound-log");
  });

  it("labels match the spec's wording; an error shows its reason", () => {
    expect(outcomeLabel({ outcome: "played" })).toBe("Đã phát");
    expect(outcomeLabel({ outcome: "reading" })).toBe("Đang đọc cuộc này");
    expect(outcomeLabel({ outcome: "muted" })).toBe("Đã tắt thông báo cuộc/nhóm");
    expect(outcomeLabel({ outcome: "quiet_reading" })).toBe("Đang Đọc yên tĩnh");
    expect(outcomeLabel({ outcome: "setting_off" })).toBe("Đã tắt âm báo tin nhắn trong Cài đặt");
    expect(outcomeLabel({ outcome: "throttled" })).toBe("Phát trong 3 giây trước (gộp)");
    expect(outcomeLabel({ outcome: "locked" })).toBe("Chưa mở khoá âm thanh");
    expect(outcomeLabel({ outcome: "error", detail: "NotSupportedError" })).toBe("Lỗi: NotSupportedError");
  });

  it("every Vietnamese string has an English twin", () => {
    expect(Object.keys(SOUND_STRINGS.en).sort()).toEqual(Object.keys(SOUND_STRINGS.vi).sort());
  });
});

/** A fake AudioContext: suspended until resume() is called, which only "works" when allowed. */
function fakeAudio(options: { allowResume: boolean; fileOk?: boolean }) {
  const started: string[] = [];
  let state: AudioContextState = "suspended";
  class FakeContext {
    get state() {
      return state;
    }
    currentTime = 0;
    destination = {};
    createBuffer() {
      return { silent: true } as unknown as AudioBuffer;
    }
    createBufferSource() {
      const node = { buffer: null as unknown, connect: () => undefined, start: () => started.push((node.buffer as { name?: string })?.name ?? "silent") };
      return node;
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined };
    }
    createOscillator() {
      return { type: "sine", frequency: { setValueAtTime: () => undefined }, connect: () => undefined, start: () => started.push("tone"), stop: () => undefined };
    }
    async resume() {
      if (options.allowResume) state = "running";
    }
    async decodeAudioData(bytes: ArrayBuffer) {
      return { name: new TextDecoder().decode(bytes) } as unknown as AudioBuffer;
    }
  }
  const listeners = new Map<string, () => void>();
  const deps: SoundDeps = {
    AudioContext: FakeContext as unknown as new () => AudioContext,
    createAudio: undefined,
    fetch: vi.fn(async (url: string) =>
      options.fileOk === false
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer } as unknown as Response),
    ),
    target: {
      addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => listeners.set(type, fn as () => void),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as SoundDeps["target"],
    doc: { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: "visible" } as unknown as SoundDeps["doc"],
  };
  return { deps, started, listeners, suspend: () => (state = "suspended") };
}

describe("AVORA-114 · the shared player", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

  it("before any tap: locked, not swallowed", async () => {
    const audio = fakeAudio({ allowResume: true });
    const player = new SoundPlayer(audio.deps);
    player.install();
    expect(await player.play("message")).toEqual({ status: "locked" });
    expect(audio.started).toEqual([]);
  });

  it("the first tap unlocks (silent buffer + resume), removes its listeners, then the message plays once", async () => {
    const audio = fakeAudio({ allowResume: true });
    const player = new SoundPlayer(audio.deps);
    player.install();
    expect(audio.listeners.size).toBe(3);
    audio.listeners.get("pointerdown")?.();
    await vi.waitFor(() => expect(player.isUnlocked).toBe(true));
    expect(audio.started).toEqual(["silent"]);
    expect(audio.listeners.size).toBe(0);
    expect(await player.play("message")).toEqual({ status: "played" });
    expect(audio.started).toEqual(["silent", "/sounds/message-v1.mp3"]);
  });

  it("decodes each file once and reuses it", async () => {
    const audio = fakeAudio({ allowResume: true });
    const player = new SoundPlayer(audio.deps);
    await player.unlock();
    await player.play("message");
    await player.play("message");
    await player.play("reminder");
    const urls = (audio.deps.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls.filter((url) => url === "/sounds/message-v1.mp3")).toHaveLength(1);
  });

  it("a missing file says so", async () => {
    const audio = fakeAudio({ allowResume: true, fileOk: false });
    const player = new SoundPlayer(audio.deps);
    await player.unlock();
    expect(await player.play("message")).toEqual({ status: "failed", reason: "file_missing" });
  });

  it("a device that refuses resume stays locked and keeps listening", async () => {
    const audio = fakeAudio({ allowResume: false });
    const player = new SoundPlayer(audio.deps);
    player.install();
    expect(await player.unlock()).toBe(false);
    expect(audio.listeners.size).toBe(3);
    expect(await player.play("message")).toEqual({ status: "locked" });
  });

  it("the habit tone plays on the same context", async () => {
    const audio = fakeAudio({ allowResume: true });
    const player = new SoundPlayer(audio.deps);
    await player.unlock();
    expect(await player.play("habit")).toEqual({ status: "played" });
    expect(audio.started).toContain("tone");
  });

  it("fallback without AudioContext reuses ONE audio element; NotAllowedError → locked", async () => {
    const created: HTMLAudioElement[] = [];
    let allow = false;
    const deps: SoundDeps = {
      AudioContext: undefined,
      createAudio: () => {
        const element = {
          src: "",
          volume: 1,
          muted: false,
          currentTime: 0,
          preload: "",
          play: async () => {
            if (!allow) throw Object.assign(new Error("blocked"), { name: "NotAllowedError" });
          },
          pause: () => undefined,
        } as unknown as HTMLAudioElement;
        created.push(element);
        return element;
      },
      fetch: vi.fn(),
      target: undefined,
      doc: undefined,
    };
    const player = new SoundPlayer(deps);
    expect(await player.play("message")).toEqual({ status: "locked" });
    allow = true;
    expect(await player.play("message")).toEqual({ status: "played" });
    expect(await player.play("reminder")).toEqual({ status: "played" });
    expect(created).toHaveLength(1);
  });
});

import ALERTS_SOURCE from "@/components/InAppAlerts.tsx?raw";
import CHIME_SOURCE from "@/lib/habit-chime.ts?raw";
import SOUND_SOURCE from "@/lib/sound.ts?raw";

describe("AVORA-114 · no silent catch on the sound path", () => {
  it("no `.catch(() => undefined)` and no `catch {` in the player, the alerts or the habit chime", () => {
    for (const source of [ALERTS_SOURCE, CHIME_SOURCE, SOUND_SOURCE]) {
      expect(source).not.toMatch(/\.catch\(\(\)\s*=>\s*(undefined|\{\s*\})\)/);
      expect(source).not.toMatch(/catch\s*\{/);
    }
    expect(ALERTS_SOURCE).not.toMatch(/new Audio\(/);
  });
});
