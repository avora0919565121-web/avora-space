import { Camera, Copy, QrCode, X } from "lucide-react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePinStatus } from "@/components/PinGate";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { connectLink, NEEDS_OWN_PIN_MESSAGE, pinFromScan } from "@/lib/connections";

type Mode = "mine" | "scan";

type ConnectQrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A valid PIN read from the camera. */
  onScanned: (pin: string) => void;
};

/**
 * Two faces of the same idea: show my PIN as a QR code, or scan someone else's.
 * The PIN is an identifier, not a secret (ADR-019) — showing it is how people meet on AVORA.
 */
export function ConnectQrDialog({ open, onOpenChange, onScanned }: ConnectQrDialogProps) {
  const [mode, setMode] = useState<Mode>("mine");
  const pin = usePinStatus().data?.pin ?? null;

  useEffect(() => {
    if (!open) setMode("mine");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[420px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0">
        <div className="flex items-start justify-between px-6 pb-3 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">Kết bạn bằng QR</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              Đưa mã của bạn, hoặc quét mã của người kia
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        <div role="tablist" className="mx-6 mb-4 grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">
          {(
            [
              { id: "mine", label: "Mã của tôi", Icon: QrCode },
              { id: "scan", label: "Quét mã", Icon: Camera },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={cn(
                "press flex h-9 items-center justify-center gap-1.5 rounded-full text-[13.5px] font-medium transition-colors",
                mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <div className="px-6 pb-6">
          {mode === "mine" ? <MyCode pin={pin} /> : open ? <Scanner onScanned={onScanned} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MyCode({ pin }: { pin: string | null }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (pin === null) return;
    let isActive = true;
    QRCode.toDataURL(connectLink(pin), { margin: 1, width: 480, color: { dark: "#1f1a16", light: "#ffffff" } })
      .then((url) => {
        if (isActive) setDataUrl(url);
      })
      .catch(() => {
        if (isActive) setDataUrl(null);
      });
    return () => {
      isActive = false;
    };
  }, [pin]);

  const copy = useCallback(async (): Promise<void> => {
    if (pin === null) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [pin]);

  if (pin === null) {
    return <p className="rounded-lg bg-secondary px-4 py-6 text-center text-[14px] text-muted-foreground">{NEEDS_OWN_PIN_MESSAGE}</p>;
  }

  return (
    <div className="flex flex-col items-center">
      <div className="aspect-square w-full max-w-[260px] rounded-2xl border border-border bg-white p-3 shadow-[0_8px_30px_-12px_hsl(30_20%_20%/0.25)]">
        {dataUrl ? <img src={dataUrl} alt={`Mã QR của PIN ${pin}`} className="h-full w-full" /> : null}
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="press mt-4 flex items-center gap-2 rounded-full bg-secondary px-4 py-2 font-mono text-[16px] font-semibold tracking-wider text-foreground"
      >
        {pin}
        <Copy className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      </button>
      <p role="status" className="mt-2 h-4 text-[12.5px] text-muted-foreground">
        {copied ? "Đã chép PIN" : "PIN là mã định danh, không phải mật khẩu"}
      </p>
    </div>
  );
}

type ScanState = "starting" | "scanning" | "denied" | "no-camera" | "wrong-code";

function Scanner({ onScanned }: { onScanned: (pin: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<ScanState>("starting");
  const doneRef = useRef<boolean>(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let isActive = true;

    const tick = (): void => {
      if (!isActive || doneRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          if (code !== null && code.data.length > 0) {
            const pin = pinFromScan(code.data);
            if (pin !== null) {
              doneRef.current = true;
              onScanned(pin);
              return;
            }
            setState("wrong-code");
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    const start = async (): Promise<void> => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("no-camera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!isActive) return;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setState("scanning");
        frame = window.requestAnimationFrame(tick);
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-camera");
      }
    };

    void start();
    return () => {
      isActive = false;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onScanned]);

  if (state === "denied") {
    return (
      <p className="rounded-lg bg-secondary px-4 py-6 text-center text-[14px] text-muted-foreground">
        AVORA chưa được dùng máy ảnh. Hãy cho phép trong cài đặt trình duyệt, hoặc nhập PIN bằng tay.
      </p>
    );
  }
  if (state === "no-camera") {
    return (
      <p className="rounded-lg bg-secondary px-4 py-6 text-center text-[14px] text-muted-foreground">
        Không tìm thấy máy ảnh trên thiết bị này. Hãy nhập PIN bằng tay.
      </p>
    );
  }

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-foreground/90">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <p role="status" className="mt-3 text-center text-[13px] text-muted-foreground">
        {state === "starting"
          ? "Đang mở máy ảnh…"
          : state === "wrong-code"
            ? "Mã này không phải mã kết bạn AVORA."
            : "Đưa mã QR vào khung"}
      </p>
    </div>
  );
}
