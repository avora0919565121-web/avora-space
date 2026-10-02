import { describe, expect, it } from "vitest";

import { chipCounts, fileCategoryOf, matchesFileChip, type CategorizableFile, type FileCategory } from "@/lib/file-category";

const f = (kind: string, mimeType: string, fileName: string, captureSource: "camera" | "library" | null = null): CategorizableFile => ({ kind, mimeType, fileName, captureSource });

describe("73.5 fileCategoryOf — 20 samples", () => {
  const cases: [CategorizableFile, FileCategory][] = [
    [f("image", "image/jpeg", "anh.jpg"), "image"],
    [f("image", "image/png", "chup.png", "camera"), "image"],
    [f("file", "image/heic", "IMG_1.heic"), "image"],
    [f("file", "video/mp4", "quay.mp4"), "video"],
    [f("file", "video/quicktime", "clip.mov"), "video"],
    [f("voice", "audio/webm", "ghi-am.webm"), "voice"],
    [f("file", "audio/mpeg", "nhac.mp3"), "audio"],
    [f("file", "audio/x-m4a", "cuoc-goi.m4a"), "audio"],
    [f("file", "application/pdf", "bao-gia.pdf"), "pdf"],
    [f("file", "", "hop-dong.PDF"), "pdf"],
    [f("file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "de-xuat.docx"), "document"],
    [f("file", "application/msword", "cu.doc"), "document"],
    [f("file", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "so.xlsx"), "document"],
    [f("file", "application/vnd.ms-powerpoint", "trinh-bay.ppt"), "document"],
    [f("file", "text/plain", "ghi-chu.txt"), "document"],
    [f("file", "text/csv", "danh-sach.csv"), "document"],
    [f("file", "application/epub+zip", "sach.epub"), "book"],
    [f("file", "application/octet-stream", "truyen.mobi"), "book"],
    [f("file", "application/zip", "ho-so.zip"), "other"],
    [f("file", "application/javascript", "ma.js"), "other"],
  ];
  it.each(cases)("%o → %s", (file, expected) => {
    expect(fileCategoryOf(file)).toBe(expected);
  });

  it("73.2: Chụp từ máy only for camera-marked photos / videos; old files never guessed", () => {
    expect(matchesFileChip(f("image", "image/jpeg", "a.jpg", "camera"), "camera")).toBe(true);
    expect(matchesFileChip(f("file", "video/mp4", "b.mp4", "camera"), "camera")).toBe(true);
    expect(matchesFileChip(f("image", "image/jpeg", "c.jpg", "library"), "camera")).toBe(false);
    expect(matchesFileChip(f("image", "image/jpeg", "old.jpg", null), "camera")).toBe(false);
    expect(matchesFileChip(f("file", "application/pdf", "d.pdf", "camera"), "camera")).toBe(false);
  });

  it("73.1: counts per chip; empty chips get no count", () => {
    const counts = chipCounts([f("image", "image/jpeg", "a.jpg", "camera"), f("image", "image/jpeg", "b.jpg"), f("file", "application/pdf", "c.pdf")]);
    expect(counts.get("all")).toBe(3);
    expect(counts.get("image")).toBe(2);
    expect(counts.get("camera")).toBe(1);
    expect(counts.get("pdf")).toBe(1);
    expect(counts.get("video")).toBeUndefined();
  });
});
