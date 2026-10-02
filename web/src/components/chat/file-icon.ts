import { BookOpen, File, FileText, FileType, Image as ImageIcon, Mic, Music, Video, type LucideIcon } from "lucide-react";

import { fileCategoryOf, type CategorizableFile, type FileCategory } from "@/lib/file-category";

/** AVORA-75 · A2 — one glyph per kind, the same kinds the File chips use. */
export const FILE_CATEGORY_ICON: Readonly<Record<FileCategory, LucideIcon>> = {
  image: ImageIcon,
  video: Video,
  voice: Mic,
  audio: Music,
  document: FileText,
  pdf: FileType,
  book: BookOpen,
  other: File,
};

export function fileIconOf(file: CategorizableFile): LucideIcon {
  return FILE_CATEGORY_ICON[fileCategoryOf(file)];
}
