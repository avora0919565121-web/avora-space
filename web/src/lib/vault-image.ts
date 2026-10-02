/**
 * AVORA-68 · 2.2 — a photo is redrawn through a canvas before it is encrypted: JPEG 0.85, long edge
 * ≤ 2400 px. Redrawing drops every EXIF block (location, camera). PDFs pass through unchanged.
 */
export const VAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const VAULT_MAX_PAGES = 20;
const LONG_EDGE = 2400;

export async function prepareVaultFile(file: File): Promise<{ bytes: Uint8Array; mimeClass: "image" | "pdf"; mime: string }> {
  if (file.size > VAULT_MAX_FILE_BYTES) throw new Error("Tệp lớn hơn 20 MB.");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return { bytes: new Uint8Array(await file.arrayBuffer()), mimeClass: "pdf", mime: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Chỉ nhận ảnh hoặc PDF.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Không đọc được ảnh.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (blob === null) throw new Error("Không đọc được ảnh.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeClass: "image", mime: "image/jpeg" };
}

/** True when a JPEG still carries an APP1/Exif block (68.4). */
export function hasExif(bytes: Uint8Array): boolean {
  for (let i = 0; i + 9 < bytes.length && i < 65_536; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) return true;
  }
  return false;
}
