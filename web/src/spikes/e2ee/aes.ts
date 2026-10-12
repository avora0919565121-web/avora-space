/** AVORA-E0 — WebCrypto helpers for the spike (AES-256-GCM, 96-bit nonce, AAD = conversation + message id). */
const enc = new TextEncoder();
const dec = new TextDecoder();

export type Sealed = { iv: Uint8Array; ct: ArrayBuffer };

export async function newAesKey(extractable = false): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

export function aad(conversationId: string, messageId: number): Uint8Array {
  return enc.encode(`${conversationId}:${messageId}`);
}

export async function seal(key: CryptoKey, text: string, extra: Uint8Array): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: extra as BufferSource }, key, enc.encode(text));
  return { iv, ct };
}

export async function open(key: CryptoKey, sealed: Sealed, extra: Uint8Array): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource, additionalData: extra as BufferSource }, key, sealed.ct);
  return dec.decode(pt);
}
