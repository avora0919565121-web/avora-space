/**
 * AVORA-68 · S9 — the Bộ khôi phục PDF, made on the device (pdf-lib, lazy-loaded). Nothing goes
 * through a server. The page is drawn on a canvas first so Vietnamese renders with the device's own
 * fonts, then placed into an A4 PDF.
 */
export const KIT_WARNING =
  "Đây là cách duy nhất để mở lại Két sắt nếu bạn quên Mật khẩu Két sắt. AVORA không giữ bản sao nào và không thể giúp bạn mở lại. Hãy in ra hoặc lưu ở nơi an toàn ngoài điện thoại này.";

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (context.measureText(next).width > maxWidth && line !== "") {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The kit page as a canvas (A4 at 150 dpi). Exported for the print fallback and tests. */
export function drawKitPage(words: readonly string[], createdAt: Date): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const c = canvas.getContext("2d");
  if (c === null) throw new Error("canvas");
  const font = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  c.fillStyle = "#FFFFFF";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#E0603C";
  c.font = `700 34px ${font}`;
  c.fillText("A V O R A", 110, 150);
  c.fillStyle = "#1C1A17";
  c.font = `700 58px ${font}`;
  c.fillText("Bộ khôi phục Két sắt", 110, 240);
  c.fillStyle = "#6B655B";
  c.font = `400 26px ${font}`;
  c.fillText(`Tạo lúc ${createdAt.toLocaleString("vi-VN")}`, 110, 290);
  c.fillStyle = "#1C1A17";
  c.font = `600 28px ${font}`;
  let y = 370;
  for (const line of wrapText(c, KIT_WARNING, 1020)) {
    c.fillText(line, 110, y);
    y += 42;
  }
  y += 40;
  c.strokeStyle = "#E6DFD3";
  c.lineWidth = 3;
  c.strokeRect(110, y, 1020, 760);
  c.font = `500 36px ui-monospace, Menlo, Consolas, monospace`;
  words.forEach((word, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 150 + col * 330;
    const wy = y + 90 + row * 86;
    c.fillStyle = "#9B948A";
    c.fillText(String(index + 1).padStart(2, "0"), x, wy);
    c.fillStyle = "#1C1A17";
    c.fillText(word, x + 70, wy);
  });
  c.fillStyle = "#6B655B";
  c.font = `400 24px ${font}`;
  y += 830;
  for (const line of wrapText(c, "Giữ tờ này như giữ chìa khoá nhà. Ai có đủ 24 từ cùng tài khoản AVORA của bạn sẽ mở được Két sắt. Khi bạn tạo Bộ khôi phục mới, tờ này hết hiệu lực.", 1020)) {
    c.fillText(line, 110, y);
    y += 36;
  }
  return canvas;
}

/** Builds the PDF bytes; the caller saves or shares them. */
export async function buildKitPdf(words: readonly string[], createdAt = new Date()): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const canvas = drawKitPage(words, createdAt);
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (pngBlob === null) throw new Error("kit_png");
  const doc = await PDFDocument.create();
  doc.setTitle("AVORA – Bộ khôi phục Két sắt");
  doc.setProducer("AVORA");
  const png = await doc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const bytes = await doc.save();
  canvas.width = 0;
  return bytes;
}

/** Saves through the share sheet where there is one (iPhone → Lưu vào Tệp), a download otherwise. */
export async function saveKitPdf(words: readonly string[]): Promise<void> {
  const bytes = await buildKitPdf(words);
  const file = new File([bytes.slice().buffer as ArrayBuffer], "AVORA-Bo-khoi-phuc.pdf", { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) === true) {
    try {
      await navigator.share({ files: [file], title: "Bộ khôi phục Két sắt" });
      return;
    } catch {
      // Cancelled share sheet: fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `In` (secondary): a print window with the drawn page only. */
export function printKit(words: readonly string[]): void {
  const dataUrl = drawKitPage(words, new Date()).toDataURL("image/png");
  const win = window.open("", "_blank", "noopener=no");
  if (win === null) return;
  win.document.write(`<!doctype html><title>AVORA</title><style>@page{size:A4;margin:0}body{margin:0}img{width:100%}</style><img src="${dataUrl}" onload="window.print()">`);
  win.document.close();
}
