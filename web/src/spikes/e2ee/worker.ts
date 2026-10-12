/// <reference lib="webworker" />
/** AVORA-E0 · M4 — decrypts a batch off the main thread (raw key copied in; spike only). */
type Job = { raw: ArrayBuffer; conversationId: string; items: { id: number; iv: Uint8Array; ct: ArrayBuffer }[] };

const dec = new TextDecoder();
const enc = new TextEncoder();

self.onmessage = async (event: MessageEvent<Job>) => {
  const { raw, conversationId, items } = event.data;
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  let chars = 0;
  for (const item of items) {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: item.iv as BufferSource, additionalData: enc.encode(`${conversationId}:${item.id}`) as BufferSource },
      key,
      item.ct,
    );
    chars += dec.decode(pt).length;
  }
  (self as unknown as Worker).postMessage({ count: items.length, chars });
};
