import { ChevronDown, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { soundPlayer, type PlayResult } from "@/lib/sound";
import { outcomeLabel, readSoundLog, SOUND_LOG_EVENT, SOUND_TEXT, type SoundLogEntry } from "@/lib/sound-log";
import { cn } from "@/lib/utils";

function resultLine(result: PlayResult): string {
  if (result.status === "played") return SOUND_TEXT.testPlayed;
  if (result.status === "locked") return SOUND_TEXT.testLocked;
  if (result.reason === "file_missing") return SOUND_TEXT.testMissing;
  return `${SOUND_TEXT.testFailed} (${result.name ?? result.reason})`;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * AVORA-114 · 3 — `Nghe thử` (the tap itself unlocks the sound) and "Vì sao tôi không nghe thấy?",
 * the last 10 decisions kept on this device.
 */
export function SoundDiagnostics() {
  const [result, setResult] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [log, setLog] = useState<SoundLogEntry[]>(() => readSoundLog());

  useEffect(() => {
    const refresh = (): void => setLog(readSoundLog());
    window.addEventListener(SOUND_LOG_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SOUND_LOG_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const test = useCallback((): void => {
    setIsPlaying(true);
    const player = soundPlayer();
    // Unlock first, inside this very tap; then play the real message sound.
    void player
      .unlock()
      .then(() => player.play("message"))
      .then((outcome) => setResult(resultLine(outcome)))
      .finally(() => setIsPlaying(false));
  }, []);

  return (
    <div className="mt-s-2 space-y-s-2 border-t border-border pt-s-2">
      <p className="text-[12.5px] leading-5 text-muted-foreground">{SOUND_TEXT.silentSwitch}</p>
      <div className="flex min-h-12 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={test}
          disabled={isPlaying}
          className="press inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-[13.5px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-60"
        >
          <Volume2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {SOUND_TEXT.test}
        </button>
        {result !== null ? (
          <p role="status" data-testid="sound-test-result" className="min-w-0 text-[13px] text-muted-foreground">
            {result}
          </p>
        ) : null}
      </div>
      <div>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => {
            setLog(readSoundLog());
            setIsOpen((open) => !open);
          }}
          className="press flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14px] font-medium text-foreground"
        >
          {SOUND_TEXT.why}
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
        </button>
        {isOpen ? (
          <div className="pb-1">
            <p className="text-[12px] leading-5 text-muted-foreground">{SOUND_TEXT.whyNote}</p>
            {log.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">{SOUND_TEXT.whyEmpty}</p>
            ) : (
              <ol data-testid="sound-log" className="mt-2 divide-y divide-border rounded-md border border-border">
                {log.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span className="min-w-0 break-words text-foreground">{outcomeLabel(entry)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(entry.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
