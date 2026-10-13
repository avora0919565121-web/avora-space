import { logError } from "@/lib/log";

/**
 * AVORA-114 — the one sound player for the whole app.
 *
 * Why it exists: iPhone browsers (Safari and the app added to the home screen) only let a page
 * make sound from inside a tap, or from an audio output that a tap has already woken. A message
 * that arrives over realtime is not a tap, so `new Audio(url).play()` is refused with
 * `NotAllowedError` — and the old code swallowed that refusal, so nobody knew.
 *
 * How it works:
 *   - One shared `AudioContext`; the two files are decoded once into buffers and played through a
 *     buffer source. The habit tone is synthesised on the same context.
 *   - The first `pointerdown` / `touchend` / `keydown` anywhere unlocks it: `resume()` plus one
 *     silent buffer. The listeners are removed once it runs, and re-armed when the page comes back
 *     from the background with the context suspended.
 *   - Fallback when there is no `AudioContext`: ONE reused `HTMLAudioElement`, never a new one.
 *   - `play()` always says what happened: `played`, `locked` or `failed` with a reason. Nothing is
 *     swallowed.
 */

export type SoundKind = "message" | "reminder" | "habit";

export type SoundFailure = "file_missing" | "decode" | "not_supported" | "play_error";

export type PlayResult =
  | { status: "played" }
  | { status: "locked" }
  | { status: "failed"; reason: SoundFailure; name?: string };

export const SOUND_URLS: Readonly<Record<Exclude<SoundKind, "habit">, string>> = {
  message: "/sounds/message-v1.mp3",
  reminder: "/sounds/reminder-v1.mp3",
};

const VOLUME: Readonly<Record<SoundKind, number>> = { message: 0.6, reminder: 0.6, habit: 0.12 };

type AudioContextCtor = new () => AudioContext;

export type SoundDeps = {
  AudioContext: AudioContextCtor | undefined;
  createAudio: (() => HTMLAudioElement) | undefined;
  fetch: (url: string) => Promise<Response>;
  target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined;
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> | undefined;
};

const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string") {
    return (error as { name: string }).name;
  }
  return undefined;
}

/** The shared player. Exported as a class so tests can build one with fake audio. */
export class SoundPlayer {
  private deps: SoundDeps;
  private context: AudioContext | null = null;
  private element: HTMLAudioElement | null = null;
  private elementUnlocked = false;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | SoundFailure>>();
  private armed = false;
  private listeners = new Set<(unlocked: boolean) => void>();

  constructor(deps: SoundDeps) {
    this.deps = deps;
  }

  /** True once a tap has woken the output (or the device never needed one). */
  get isUnlocked(): boolean {
    if (this.context !== null) return this.context.state === "running";
    return this.elementUnlocked;
  }

  subscribe(listener: (unlocked: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const unlocked = this.isUnlocked;
    this.listeners.forEach((listener) => listener(unlocked));
  }

  private readonly onGesture = (): void => {
    void this.unlock();
  };

  private readonly onVisible = (): void => {
    if (this.deps.doc?.visibilityState !== "visible") return;
    // iOS suspends the context while the app is in the background; the next tap wakes it again.
    if (this.context !== null && this.context.state !== "running") {
      this.notify();
      this.arm();
    }
  };

  /** Starts listening for the first tap. Safe to call more than once. */
  install(): void {
    this.arm();
    this.deps.doc?.addEventListener("visibilitychange", this.onVisible);
  }

  private arm(): void {
    if (this.armed || this.deps.target === undefined) return;
    this.armed = true;
    for (const type of UNLOCK_EVENTS) this.deps.target.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  private disarm(): void {
    if (!this.armed || this.deps.target === undefined) return;
    this.armed = false;
    for (const type of UNLOCK_EVENTS) this.deps.target.removeEventListener(type, this.onGesture, { capture: true });
  }

  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;
    const Ctor = this.deps.AudioContext;
    if (Ctor === undefined) return null;
    try {
      this.context = new Ctor();
    } catch (error) {
      logError("sound", { code: "context_create", name: errorName(error) });
      this.context = null;
    }
    return this.context;
  }

  private ensureElement(): HTMLAudioElement | null {
    if (this.element !== null) return this.element;
    if (this.deps.createAudio === undefined) return null;
    this.element = this.deps.createAudio();
    this.element.preload = "auto";
    return this.element;
  }

  /**
   * Wakes the output. Must run inside a tap or key press to count on iPhone; the first gesture
   * listener and the `Nghe thử` button both call it.
   */
  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (context !== null) {
      try {
        // A silent one-sample buffer, started synchronously inside the gesture: this is what wakes iOS.
        const silent = context.createBuffer(1, 1, 22_050);
        const source = context.createBufferSource();
        source.buffer = silent;
        source.connect(context.destination);
        source.start(0);
        if (context.state !== "running") await context.resume();
      } catch (error) {
        logError("sound", { code: "unlock", name: errorName(error) });
      }
      if (context.state === "running") {
        this.disarm();
        this.notify();
        void this.preload();
        return true;
      }
      this.notify();
      return false;
    }
    const element = this.ensureElement();
    if (element === null) return false;
    try {
      element.muted = true;
      element.src = SOUND_URLS.message;
      await element.play();
      element.pause();
      element.currentTime = 0;
      element.muted = false;
      this.elementUnlocked = true;
      this.disarm();
    } catch (error) {
      element.muted = false;
      logError("sound", { code: "unlock_element", name: errorName(error) });
    }
    this.notify();
    return this.elementUnlocked;
  }

  /** Decodes both files ahead of the first message, so the sound is not late. */
  async preload(): Promise<void> {
    await Promise.all(Object.values(SOUND_URLS).map((url) => this.load(url)));
  }

  private load(url: string): Promise<AudioBuffer | SoundFailure> {
    const cached = this.buffers.get(url);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.loading.get(url);
    if (pending !== undefined) return pending;
    const context = this.context;
    if (context === null) return Promise.resolve("not_supported");
    const job = (async (): Promise<AudioBuffer | SoundFailure> => {
      let bytes: ArrayBuffer;
      try {
        const response = await this.deps.fetch(url);
        if (!response.ok) {
          logError("sound", { code: `file_${response.status}` });
          return "file_missing";
        }
        bytes = await response.arrayBuffer();
      } catch (error) {
        logError("sound", { code: "file_fetch", name: errorName(error) });
        return "file_missing";
      }
      try {
        const buffer = await context.decodeAudioData(bytes);
        this.buffers.set(url, buffer);
        return buffer;
      } catch (error) {
        logError("sound", { code: "decode", name: errorName(error) });
        return "decode";
      }
    })();
    this.loading.set(url, job);
    void job.then((result) => {
      // A failure is not remembered: the next try fetches again (the file may be back).
      if (typeof result === "string") this.loading.delete(url);
    });
    return job;
  }

  /** Plays one sound and says exactly what happened. */
  async play(kind: SoundKind): Promise<PlayResult> {
    const context = this.context ?? (this.deps.AudioContext !== undefined ? null : undefined);
    if (context === undefined) return this.playElement(kind);
    if (context === null || context.state !== "running") return { status: "locked" };
    try {
      const gain = context.createGain();
      gain.gain.value = VOLUME[kind];
      gain.connect(context.destination);
      if (kind === "habit") {
        this.tone(context, gain);
        return { status: "played" };
      }
      const buffer = await this.load(SOUND_URLS[kind]);
      if (typeof buffer === "string") return { status: "failed", reason: buffer };
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0);
      return { status: "played" };
    } catch (error) {
      logError("sound", { code: "play", name: errorName(error) });
      return { status: "failed", reason: "play_error", name: errorName(error) };
    }
  }

  /** The habit tone: one soft sine, quieter than the reminder file, so the two never sound alike. */
  private tone(context: AudioContext, gain: GainNode): void {
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(VOLUME.habit, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.connect(gain);
    oscillator.start();
    oscillator.stop(now + 0.95);
  }

  private async playElement(kind: SoundKind): Promise<PlayResult> {
    if (kind === "habit") return { status: "failed", reason: "not_supported" };
    const element = this.ensureElement();
    if (element === null) return { status: "failed", reason: "not_supported" };
    try {
      element.src = SOUND_URLS[kind];
      element.volume = VOLUME[kind];
      element.currentTime = 0;
      await element.play();
      this.elementUnlocked = true;
      return { status: "played" };
    } catch (error) {
      const name = errorName(error);
      if (name === "NotAllowedError") {
        this.elementUnlocked = false;
        this.arm();
        return { status: "locked" };
      }
      logError("sound", { code: "play_element", name });
      return { status: "failed", reason: name === "NotSupportedError" ? "file_missing" : "play_error", name };
    }
  }
}

function browserDeps(): SoundDeps {
  if (typeof window === "undefined") {
    return { AudioContext: undefined, createAudio: undefined, fetch: (url) => fetch(url), target: undefined, doc: undefined };
  }
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return {
    AudioContext: Ctor,
    createAudio: typeof Audio === "undefined" ? undefined : () => new Audio(),
    fetch: (url) => window.fetch(url),
    target: window,
    doc: document,
  };
}

let shared: SoundPlayer | null = null;

/** The app's one player, created on first use. */
export function soundPlayer(): SoundPlayer {
  if (shared === null) {
    shared = new SoundPlayer(browserDeps());
    shared.install();
  }
  return shared;
}

/** Tests only: start from a fresh player. */
export function resetSoundPlayerForTests(player: SoundPlayer | null = null): void {
  shared = player;
}
