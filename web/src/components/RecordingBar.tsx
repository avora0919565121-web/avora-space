import { Mic, Square, X } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  cancelRecording,
  formatRecordingClock,
  onRecordingNearEnd,
  stopRecording,
  takeInterruptedRecording,
  useRecorder,
} from "@/lib/recorder";
import { cn } from "@/lib/utils";

/**
 * The thin bar at the top of every screen while the one recorder is running (AVORA-44 · B):
 * "🎙 Đang ghi · 02:14 · Dừng". Tapping it returns to the screen that started it.
 */
export function RecordingBar() {
  const recorder = useRecorder();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const cut = takeInterruptedRecording();
    if (cut !== null) toast.info(`Lần trước bản ghi âm bị dừng khi đóng trang (${formatRecordingClock(cut)}). Phần đó không lưu được.`);
    return onRecordingNearEnd((target) => {
      toast.info(target === "note" ? "Còn 1 phút nữa là hết 30 phút ghi âm." : "Còn 1 phút nữa là hết 5 phút ghi âm.");
    });
  }, []);

  if (!recorder.isRecording) return null;
  const here = recorder.returnTo !== null && recorder.returnTo === `${location.pathname}${location.search}`;
  return (
    <div role="status" className={cn("flex h-9 shrink-0 items-center gap-2 px-3 text-[13px] text-white", recorder.isNearEnd ? "bg-amber-600" : "bg-rose-600")}>
      <button
        type="button"
        disabled={here || recorder.returnTo === null}
        onClick={() => recorder.returnTo !== null && navigate(recorder.returnTo)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <Mic className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium">
          Đang ghi · <span className="tabular">{formatRecordingClock(recorder.elapsedSeconds)}</span>
          <span className="opacity-80"> / {formatRecordingClock(recorder.limitSeconds)}</span>
          {here ? "" : " · chạm để quay lại"}
        </span>
      </button>
      <button type="button" onClick={() => stopRecording()} className="press inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 font-semibold">
        <Square className="h-3 w-3 fill-current" /> Dừng
      </button>
      <button type="button" aria-label="Bỏ bản ghi" onClick={() => cancelRecording()} className="press rounded-full p-1 opacity-80 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
