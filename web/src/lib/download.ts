/**
 * Handing a generated file to the browser's download manager.
 *
 * Shared by every export and template in the app so the one browser quirk that matters lives in
 * a single place: the object URL is revoked on a later tick, because Safari has not finished
 * reading the blob at the moment `click()` returns and revoking immediately gives an empty file.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
