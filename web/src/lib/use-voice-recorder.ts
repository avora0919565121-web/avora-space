import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_VOICE_SECONDS } from "@/lib/attachments";

/** The first container the browser will actually record; Safari and Chrome disagree. */
function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

export type VoiceRecorder = {
  isRecording: boolean;
  /** Whole seconds so far, for the counter next to the stop button. */
  elapsedSeconds: number;
  /** True when this browser cannot record at all, so the button can stay hidden. */
  isUnsupported: boolean;
  start: () => Promise<void>;
  /** Ends the recording and hands back the audio, or null if nothing usable was captured. */
  stop: () => Promise<{ blob: Blob; durationSeconds: number } | null>;
  /** Throws the recording away — the microphone stops and nothing is kept. */
  cancel: () => void;
};

/**
 * Recording a voice note.
 *
 * The microphone is opened when recording starts and closed the moment it stops, rather than
 * held open for the session. A tab that keeps the mic light on after someone has finished
 * speaking is the kind of thing people rightly stop trusting.
 *
 * Recording stops itself at five minutes. A note that runs longer is a meeting, and nobody
 * listens to it — the cap is kinder than an upload that fails at the end.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef<boolean>(false);

  const isUnsupported =
    typeof MediaRecorder === "undefined" ||
    typeof navigator === "undefined" ||
    navigator.mediaDevices === undefined;

  const releaseHardware = useCallback((): void => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // A tab closed mid-recording must not leave the microphone open.
  useEffect(() => releaseHardware, [releaseHardware]);

  const start = useCallback(async (): Promise<void> => {
    if (isUnsupported || recorderRef.current !== null) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType === "" ? undefined : { mimeType });

    chunksRef.current = [];
    cancelledRef.current = false;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setIsRecording(true);
    setElapsedSeconds(0);

    tickRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(seconds);
      // The cap enforces itself; `stop` below reads the same recorder.
      if (seconds >= MAX_VOICE_SECONDS) recorderRef.current?.stop();
    }, 250);
  }, [isUnsupported]);

  const stop = useCallback(async (): Promise<{ blob: Blob; durationSeconds: number } | null> => {
    const recorder = recorderRef.current;
    if (recorder === null) return null;

    const durationSeconds = Math.min(
      MAX_VOICE_SECONDS,
      Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
    );

    const finished = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        if (cancelledRef.current || chunksRef.current.length === 0) {
          resolve(null);
          return;
        }
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
    });

    if (recorder.state !== "inactive") recorder.stop();
    const blob = await finished;

    recorderRef.current = null;
    chunksRef.current = [];
    releaseHardware();
    setIsRecording(false);
    setElapsedSeconds(0);

    if (blob === null || blob.size === 0) return null;
    return { blob, durationSeconds };
  }, [releaseHardware]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    releaseHardware();
    setIsRecording(false);
    setElapsedSeconds(0);
  }, [releaseHardware]);

  return { isRecording, elapsedSeconds, isUnsupported, start, stop, cancel };
}
