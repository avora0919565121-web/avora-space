import { expect, test } from "vitest";

import { hasExif, prepareVaultFile } from "@/lib/vault-image";
import fixtureUrl from "./fixtures/exif-gps.jpg?url";

/** Finds the GPS IFD pointer tag (0x8825) inside an APP1/Exif block. */
function hasGpsTag(bytes: Uint8Array): boolean {
  for (let i = 0; i + 1 < Math.min(bytes.length, 65_536); i += 1) {
    if ((bytes[i] === 0x88 && bytes[i + 1] === 0x25) || (bytes[i] === 0x25 && bytes[i + 1] === 0x88)) return hasExif(bytes);
  }
  return false;
}

test("68.4 · a real photo with EXIF GPS loses every EXIF block before it is encrypted", async () => {
  const original = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
  // The fixture really carries location (Nikon sample, GPS 43°28′N).
  expect(hasExif(original)).toBe(true);
  expect(hasGpsTag(original)).toBe(true);

  const file = new File([original], "cccd-mat-truoc.jpg", { type: "image/jpeg" });
  const prepared = await prepareVaultFile(file);

  expect(prepared.mimeClass).toBe("image");
  expect(prepared.mime).toBe("image/jpeg");
  expect(hasExif(prepared.bytes)).toBe(false);
  expect(hasGpsTag(prepared.bytes)).toBe(false);
  // Still a JPEG the device can show.
  expect(prepared.bytes[0]).toBe(0xff);
  expect(prepared.bytes[1]).toBe(0xd8);
});

test("68.4 · PDFs pass through unchanged; other types are refused", async () => {
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "hop-dong.pdf", { type: "application/pdf" });
  expect((await prepareVaultFile(pdf)).mimeClass).toBe("pdf");
  await expect(prepareVaultFile(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow("Chỉ nhận ảnh hoặc PDF.");
});
