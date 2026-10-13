import { Camera, ImageIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { toast } from "sonner";

import { askConfirm } from "@/components/ConfirmHost";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { registerAvatarEditor } from "@/lib/avatar-editor";
import { useAuth } from "@/lib/auth";
import { checkAvatarFile, clampCrop, prepareAvatarImage, useAvatar, useAvatarActions, type CropState } from "@/lib/avatars";


type Picked = { file: File; url: string; natural: { width: number; height: number } };

const START: CropState = { zoom: 1, dx: 0, dy: 0 };

/** Mounted once for every signed-in screen. */
export function AvatarEditorHost() {
  const { user } = useAuth();
  const current = useAvatar(user?.id ?? null);
  const { upload, remove } = useAvatarActions(user?.id);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerAvatarEditor(() => setIsMenuOpen(true));
    return () => registerAvatarEditor(null);
  }, []);

  useEffect(
    () => () => {
      if (picked !== null) URL.revokeObjectURL(picked.url);
    },
    [picked],
  );

  const onFile = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    const problem = checkAvatarFile(file);
    if (problem !== null) {
      toast.error(problem);
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setIsMenuOpen(false);
      setPicked({ file, url, natural: { width: probe.naturalWidth, height: probe.naturalHeight } });
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Không đọc được ảnh này. Hãy chọn ảnh khác.");
    };
    probe.src = url;
  }, []);

  const clear = async (): Promise<void> => {
    const yes = await askConfirm({ title: "Xoá ảnh đại diện?", body: "Mọi nơi sẽ quay về chữ cái đầu của tên bạn.", confirmLabel: "Xoá ảnh", danger: true });
    if (!yes) return;
    try {
      await remove();
      setIsMenuOpen(false);
      toast.success("Đã xoá ảnh");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không xoá được ảnh. Thử lại.");
    }
  };

  const row = "press flex min-h-[52px] w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] text-foreground hover:bg-accent/40";

  return (
    <>
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="avatar-library-input" />
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} data-testid="avatar-camera-input" />
      <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-[18px] px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-5 md:mx-auto md:max-w-md">
          <SheetTitle className="px-3 text-[17px]">Ảnh đại diện</SheetTitle>
          <SheetDescription className="px-3 text-[13px]">Chỉ bạn bè đã kết nối thấy ảnh này. Người khác thấy chữ cái đầu.</SheetDescription>
          <div className="mt-3 space-y-1">
            <button type="button" className={row} onClick={() => libraryRef.current?.click()}>
              <ImageIcon className="h-5 w-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              Chọn từ thư viện
            </button>
            <button type="button" className={row} onClick={() => cameraRef.current?.click()}>
              <Camera className="h-5 w-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              Chụp ảnh
            </button>
            {current !== null ? (
              <button type="button" className={`${row} text-destructive`} onClick={() => void clear()}>
                <Trash2 className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                Xoá ảnh
              </button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
      {picked !== null ? <AvatarCropDialog picked={picked} onClose={() => setPicked(null)} onSave={upload} /> : null}
    </>
  );
}

function AvatarCropDialog({ picked, onClose, onSave }: { picked: Picked; onClose: () => void; onSave: (image: Blob) => Promise<void> }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<number>(260);
  const [crop, setCrop] = useState<CropState>(START);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => setViewport(viewRef.current?.clientWidth ?? 260);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const safe = clampCrop(picked.natural, viewport, crop);
  const scale = (viewport / Math.min(picked.natural.width, picked.natural.height)) * safe.zoom;
  const width = picked.natural.width * scale;
  const height = picked.natural.height * scale;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, dx: safe.dx, dy: safe.dy };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (start === null) return;
    setCrop((value) => clampCrop(picked.natural, viewport, { ...value, dx: start.dx + event.clientX - start.x, dy: start.dy + event.clientY - start.y }));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const save = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);
    try {
      const image = await prepareAvatarImage(picked.file, safe, viewport);
      await onSave(image);
      toast.success("Đã cập nhật ảnh");
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không cập nhật được ảnh. Thử lại.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || isSaving ? undefined : onClose())}>
      <DialogContent className="max-h-[96dvh] scroll-y sm:max-w-sm">
        <DialogTitle>Cắt ảnh</DialogTitle>
        <DialogDescription>Kéo để chọn phần hiện trong vòng tròn, trượt để phóng to.</DialogDescription>
        <div className="flex flex-col items-center gap-4">
          <div
            ref={viewRef}
            data-testid="avatar-crop-view"
            className="relative h-[min(260px,64vw,46dvh)] w-[min(260px,64vw,46dvh)] cursor-grab touch-none overflow-hidden rounded-full bg-secondary active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(event) => setCrop((value) => clampCrop(picked.natural, viewport, { ...value, zoom: value.zoom - event.deltaY * 0.002 }))}
          >
            <img
              src={picked.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ width, height, left: viewport / 2 - width / 2 + safe.dx, top: viewport / 2 - height / 2 + safe.dy }}
            />
          </div>
          <label className="flex w-full items-center gap-3 text-[13px] text-muted-foreground">
            <span className="shrink-0">Phóng to</span>
            <Slider
              aria-label="Phóng to"
              min={1}
              max={4}
              step={0.01}
              value={[safe.zoom]}
              onValueChange={(value) => setCrop((current) => clampCrop(picked.natural, viewport, { ...current, zoom: value[0] ?? 1 }))}
            />
          </label>
          {error !== null ? (
            <p role="alert" className="w-full rounded-md bg-accent/70 px-3 py-2 text-[13.5px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex w-full gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="press min-h-11 flex-1 rounded-md border border-border text-[14.5px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-60"
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save()}
              className="press min-h-11 flex-1 rounded-md bg-primary text-[14.5px] font-semibold text-primary-foreground disabled:opacity-60"
            >
              {isSaving ? "Đang tải lên…" : error !== null ? "Thử lại" : "Lưu"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
