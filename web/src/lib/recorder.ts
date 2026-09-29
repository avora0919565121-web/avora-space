import { useSyncExternalStore } from "react";

/**
 * The one recorder in AVORA (AVORA-44 · duyệt 30/09). A single module-level store rather than
 * one per screen, so a recording keeps going while the person moves around the app, and two
 * screens can never hold the microphone at once. The bar at the top of the screen reads it.
 *
 * Limits: Nhật ký 5 phút, Ghi chép 30 phút. One minute before the end it says so; at the end it
 * stops by itself and hands the audio to whoever started it.
 */

/** "message": Nhật ký and chats (5 phút). "note": Ghi chép (30 phút). */
export type RecordingTarget = "message" | "note";

export const RECORDING_LIMITS: Readonly<Record<RecordingTarget, number>> = { message: 300, note: 1800 };
export const WARN_BEFORE_END_SECONDS = 60;

export type RecordingResult = { blob: Blob; durationSeconds: number; target: RecordingTarget; ownerKey: string };

export type RecorderState = {
  isRecording: boolean;
  target: RecordingTarget | null;
  /** Who started it (a note id, or "journal"), so the right screen takes the audio. */
  ownerKey: string | null;
  /** Where "chạm để quay lại" goes. */
  returnTo: string | null;
  elapsedSeconds: number;
  limitSeconds: number;
  isNearEnd: boolean;
};

const IDLE: RecorderState = {
  isRecording: false,
  target: null,
  ownerKey: null,
  returnTo: null,
  elapsedSeconds: 0,
  limitSeconds: 0,
  isNearEnd: false,
};

let state: RecorderState = IDLE;
const listeners = new Set<() => void>();
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let tick: ReturnType<typeof setInterval> | null = null;
let onDone: ((result: RecordingResult) => void) | null = null;
let discard = false;
let warnListeners: ((target: RecordingTarget) => void)[] = [];

function set(next: Partial<RecorderState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecorderState(): RecorderState {
  return state;
}

export function useRecorder(): RecorderState {
  return useSyncExternalStore(subscribe, getRecorderState, getRecorderState);
}

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && navigator.mediaDevices !== undefined;
}

/** Called once when a recording reaches its last minute (the bar and a toast use it). */
export function onRecordingNearEnd(listener: (target: RecordingTarget) => void): () => void {
  warnListeners.push(listener);
  return () => {
    warnListeners = warnListeners.filter((item) => item !== listener);
  };
}

function pickMimeType(): string {
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function release(): void {
  if (tick !== null) clearInterval(tick);
  tick = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  recorder = null;
  chunks = [];
}

/**
 * Starts recording for `target`. `done` is the one place the audio goes — whether the person
 * pressed Dừng (here or on the bar) or the limit stopped it — and it runs even when the screen
 * that started the recording is no longer open.
 */
export async function startRecording(input: {
  target: RecordingTarget;
  ownerKey: string;
  returnTo: string;
  done: (result: RecordingResult) => void;
}): Promise<void> {
  if (!isRecordingSupported()) throw new Error("Trình duyệt này chưa ghi âm được.");
  if (recorder !== null) throw new Error("Đang có một bản ghi âm khác. Dừng nó trước.");
  const media = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const next = new MediaRecorder(media, mimeType === "" ? undefined : { mimeType });
  chunks = [];
  next.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  next.onstop = () => {
    const durationSeconds = Math.min(RECORDING_LIMITS[input.target], Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    const blob = chunks.length === 0 ? null : new Blob(chunks, { type: next.mimeType || "audio/webm" });
    const handler = onDone;
    const thrownAway = discard;
    onDone = null;
    discard = false;
    release();
    set({ ...IDLE });
    if (!thrownAway && handler !== null && blob !== null && blob.size > 0) {
      handler({ blob, durationSeconds, target: input.target, ownerKey: input.ownerKey });
    }
  };
  onDone = input.done;
  discard = false;
  stream = media;
  recorder = next;
  startedAt = Date.now();
  next.start(1000);
  const limit = RECORDING_LIMITS[input.target];
  set({ isRecording: true, target: input.target, ownerKey: input.ownerKey, returnTo: input.returnTo, elapsedSeconds: 0, limitSeconds: limit, isNearEnd: false });
  let warned = false;
  tick = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const nearEnd = seconds >= limit - WARN_BEFORE_END_SECONDS;
    if (nearEnd && !warned) {
      warned = true;
      warnListeners.forEach((listener) => listener(input.target));
    }
    set({ elapsedSeconds: Math.min(seconds, limit), isNearEnd: nearEnd });
    if (seconds >= limit && recorder !== null && recorder.state !== "inactive") recorder.stop();
  }, 250);
}

/** Stops; the audio goes to the `done` given at start. */
export function stopRecording(): void {
  if (recorder !== null && recorder.state !== "inactive") recorder.stop();
}

/** Throws the recording away. */
export function cancelRecording(): void {
  if (recorder === null) return;
  discard = true;
  chunks = [];
  if (recorder.state !== "inactive") recorder.stop();
}

export function formatRecordingClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Closing the tab ends the recording; what was captured is lost with the page, and the next
// visit says so (A · 44.6: "Đóng tab thì dừng … và báo khi mở lại").
const INTERRUPTED_KEY = "avora.recorder.interrupted";
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (state.isRecording) {
      try {
        window.localStorage.setItem(INTERRUPTED_KEY, String(state.elapsedSeconds));
      } catch {
        // Nothing else to do while the page is going away.
      }
      cancelRecording();
    }
  });
}

/** Seconds of a recording cut off by closing the tab last time, read once. */
export function takeInterruptedRecording(): number | null {
  try {
    const raw = window.localStorage.getItem(INTERRUPTED_KEY);
    if (raw === null) return null;
    window.localStorage.removeItem(INTERRUPTED_KEY);
    const seconds = Number.parseInt(raw, 10);
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}
