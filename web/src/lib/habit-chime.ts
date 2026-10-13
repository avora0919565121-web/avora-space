import { logError } from "@/lib/log";
import { soundPlayer } from "@/lib/sound";

/**
 * AVORA-107 · 1.2 · 4: the habit chime — one soft, short tone made on the device, quieter than the
 * task reminder file, so the two never sound alike. AVORA-114: played on the shared, tap-unlocked
 * context (a fresh `AudioContext` per chime was refused on iPhone), and a refusal is logged.
 */
export function playSoftTone(): void {
  void soundPlayer()
    .play("habit")
    .then((result) => {
      if (result.status === "failed") logError("sound", { code: `habit_${result.reason}`, name: result.name });
    });
}
