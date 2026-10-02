/**
 * AVORA-73 · A — one place that says what kind of file an attachment is, for the filter chips of
 * File của tôi and Nhật ký trò chuyện › File. `Chụp từ máy` is a subset of Ảnh / Video, marked only
 * when the file came from AVORA's own camera button (`capture_source = camera`); old files are never guessed.
 */
export type FileCategory = "image" | "video" | "voice" | "audio" | "document" | "pdf" | "book" | "other";
export type FileChip = "all" | "camera" | FileCategory;

export type CategorizableFile = {
  kind: string;
  mimeType: string;
  fileName: string;
  captureSource?: "camera" | "library" | null;
  /** A file attached from Kệ sách counts as Sách whatever its type. */
  fromBookshelf?: boolean;
};

const DOC_EXT = /\.(docx?|xlsx?|pptx?|txt|csv|odt|ods|odp|rtf|md|pages|numbers|key)$/i;
const BOOK_EXT = /\.(epub|mobi|azw3?|fb2)$/i;
const DOC_MIME = /^(text\/(plain|csv|markdown|rtf)|application\/(msword|rtf|vnd\.ms-(excel|powerpoint)|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.))/i;

export function fileCategoryOf(file: CategorizableFile): FileCategory {
  const mime = (file.mimeType ?? "").toLowerCase();
  const name = file.fileName ?? "";
  if (file.fromBookshelf === true || BOOK_EXT.test(name) || mime === "application/epub+zip" || mime === "application/x-mobipocket-ebook") return "book";
  if (file.kind === "voice") return "voice";
  if (file.kind === "image" || mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (DOC_MIME.test(mime) || DOC_EXT.test(name)) return "document";
  return "other";
}

export function isFromCamera(file: CategorizableFile): boolean {
  const category = fileCategoryOf(file);
  return file.captureSource === "camera" && (category === "image" || category === "video");
}

export function matchesFileChip(file: CategorizableFile, chip: FileChip): boolean {
  if (chip === "all") return true;
  if (chip === "camera") return isFromCamera(file);
  return fileCategoryOf(file) === chip;
}

/** Chip order, the same on phone and computer. */
export const FILE_CHIPS: readonly { id: FileChip; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "image", label: "Ảnh" },
  { id: "camera", label: "Chụp từ máy" },
  { id: "video", label: "Video" },
  { id: "voice", label: "Ghi âm" },
  { id: "audio", label: "Âm thanh" },
  { id: "document", label: "Tài liệu" },
  { id: "pdf", label: "PDF" },
  { id: "book", label: "Sách" },
  { id: "other", label: "Khác" },
];

/** Counts per chip; chips with nothing in them are not shown (`Tất cả` always is). */
export function chipCounts(files: readonly CategorizableFile[]): Map<FileChip, number> {
  const counts = new Map<FileChip, number>([["all", files.length]]);
  for (const file of files) {
    const category = fileCategoryOf(file);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (isFromCamera(file)) counts.set("camera", (counts.get("camera") ?? 0) + 1);
  }
  return counts;
}

export function readFileChip(key: string): FileChip {
  try {
    const value = window.localStorage.getItem(key);
    return FILE_CHIPS.some((c) => c.id === value) ? (value as FileChip) : "all";
  } catch {
    return "all";
  }
}

export function writeFileChip(key: string, chip: FileChip): void {
  try {
    window.localStorage.setItem(key, chip);
  } catch {
    // Remembering is a courtesy.
  }
}
