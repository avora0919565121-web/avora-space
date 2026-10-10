/**
 * AVORA-107 · 1.2 · 4: the habit chime — one soft, short tone made on the device, quieter than the
 * task reminder file, so the two never sound alike.
 */
export function playSoftTone(): void {
  try {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context === undefined) return;
    const context = new Context();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);
    gain.connect(context.destination);
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(660, context.currentTime);
    tone.connect(gain);
    tone.start();
    tone.stop(context.currentTime + 0.95);
    tone.onended = () => void context.close().catch(() => undefined);
  } catch {
    // No audio on this device.
  }
}
