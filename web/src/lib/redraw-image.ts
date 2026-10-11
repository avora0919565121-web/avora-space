/**
 * Redraws a photo on a canvas — orientation applied, EXIF (time, place, camera) left behind —
 * with its long side at most `maxSide`. WebP where the browser can write it (Safari iOS cannot),
 * JPEG otherwise. Shared by every place that keeps a person's own picture (bìa của tôi, ảnh góp ý,
 * dấu ấn Avora Space).
 */
export async function redrawImage(file: Blob, maxSide: number, quality: number = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  const blob =
    webp !== null && webp.type === "image/webp" ? webp : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", Math.min(0.9, quality + 0.03)));
  if (blob === null) throw new Error("Không đọc được ảnh này.");
  return blob;
}

/** File ending for a redrawn picture. */
export function redrawnExt(blob: Blob): "webp" | "jpg" {
  return blob.type === "image/webp" ? "webp" : "jpg";
}
